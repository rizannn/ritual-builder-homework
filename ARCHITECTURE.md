# Advanced Track: Ritual TEE-Native Hidden Submissions

This document describes an alternative architecture for the AI Bounty Judge that leverages Ritual Chain's Trusted Execution Environment (TEE) infrastructure to provide stronger privacy guarantees than the commit-reveal pattern.

---

## Problem with Commit-Reveal

The commit-reveal pattern used in the current implementation works on any EVM chain, but it has meaningful drawbacks:

- **UX friction**: Users must save their salt locally and return to the dApp during the reveal window. Two transactions, two sessions, two things to remember.
- **Lost submissions**: If a user forgets to reveal (or loses their salt), their submission is permanently lost — the commitment is useless without a matching reveal.
- **Post-reveal exposure**: After the reveal phase, all answers are plaintext on-chain forever. Competitors, future bounty participants, or anyone can read them.

Commit-reveal is a reasonable baseline, but Ritual Chain offers infrastructure that eliminates these tradeoffs entirely.

---

## Ritual TEE Architecture

Ritual Chain runs execution inside TEE enclaves — hardware-isolated environments where code and data are protected from the host operator. Combined with the Decentralized Key Management System (DKMS), this enables a single-step encrypted submission flow where answers are **never** exposed in plaintext on-chain.

### 1. Encrypted Submission via DKMS

The DKMS precompile (at address `0x081B`) provides on-chain key derivation and encryption capabilities that are only accessible inside the TEE.

**Flow:**

1. When a bounty is created, the contract derives a **bounty-specific encryption key** using DKMS. This key is generated deterministically from the bounty ID but can only be retrieved inside the TEE — it never appears on-chain.

2. Participants encrypt their answer client-side using the bounty's public encryption parameters and submit the ciphertext on-chain:

   ```solidity
   function submitEncryptedAnswer(uint256 bountyId, bytes calldata ciphertext) external {
       require(block.timestamp < bounties[bountyId].deadline, "Bounty closed");
       submissions[bountyId][msg.sender] = ciphertext;
       participants[bountyId].push(msg.sender);
   }
   ```

3. The encrypted blob is stored on-chain. Anyone can see that a submission exists, but the ciphertext is unreadable without the DKMS key — which lives exclusively inside the TEE.

### 2. TEE-Only Decryption during Judging

When the bounty owner calls `judgeAll()`, the entire judging pipeline runs inside the TEE enclave:

1. The TEE retrieves the bounty-specific DKMS key (this key retrieval is only possible within the TEE's secure context).
2. The TEE decrypts all stored ciphertexts into plaintext answers.
3. The plaintext answers are assembled into a prompt along with the bounty rubric.
4. The prompt is passed to the LLM precompile (also TEE-backed) for scoring and ranking.
5. The LLM returns its review — scores, reasoning, and a winner recommendation.

**Critically, the plaintext answers exist only in TEE memory during this operation.** They are never written to chain state, never emitted in events, and never returned as transaction output.

```
judgeAll() call
    │
    ▼
┌──────────────────────── TEE Enclave ────────────────────────┐
│                                                              │
│  1. Retrieve DKMS key for bountyId                          │
│  2. Decrypt ciphertext[0..n] → plaintext[0..n]              │
│  3. Construct prompt: rubric + all plaintext answers         │
│  4. Call LLM precompile → scores, reasoning, recommendation │
│  5. Return AI review to contract                            │
│                                                              │
│  Plaintext answers live HERE ONLY — never leave the enclave │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
AI review (scores + reasoning) written on-chain
```

### 3. Result Publication

After judging completes:

- The **AI review** (per-submission scores, reasoning, winner recommendation) is written to chain state in plaintext. This preserves auditability — participants can verify that the AI's scoring was consistent with the rubric.
- **Individual answers** can optionally be revealed after finalization at the owner's discretion. This is a policy choice, not a technical requirement.
- The **winner address and reward payout** are recorded on-chain as usual.

---

## Data Location Map

| Data | Location | Visibility |
|------|----------|------------|
| Bounty title, rubric, reward | On-chain | Public |
| Encrypted answers (ciphertext) | On-chain | Public but unreadable |
| DKMS encryption key | TEE-only | Never on-chain |
| Plaintext answers | TEE memory during judging | Ephemeral — destroyed after judging |
| AI review / scores | On-chain | Public |
| Winner + reward payout | On-chain | Public |

---

## Benefits over Commit-Reveal

| Commit-Reveal | TEE-Native (DKMS) |
|----------------|-------------------|
| Two transactions per participant (commit + reveal) | **One transaction** per participant |
| User must save salt and return to reveal | No salt, no reveal step |
| Forgotten reveal = lost submission | Submissions are permanent once submitted |
| Answers become plaintext on-chain after reveal | Answers **never** appear in plaintext on-chain |
| Works on any EVM | Requires Ritual Chain |

The TEE-native approach eliminates the entire reveal phase. Participants submit once, and the AI handles everything inside the enclave. This is a strict UX and privacy upgrade at the cost of chain portability.

---

## Limitations

- **Ritual Chain dependency**: This architecture uses DKMS and TEE-backed execution, which are Ritual Chain-specific. The contract is not portable to other EVM chains.
- **TEE trust model**: Security depends on the integrity of the TEE attestation. If the TEE hardware is compromised (e.g., via side-channel attacks on the enclave), the DKMS key could theoretically leak.
- **DKMS key lifecycle**: The bounty-specific encryption key must be managed carefully. It should be derivable only for the duration of the bounty and should not persist beyond finalization. Key rotation and expiry policies add operational complexity.
- **Enclave capacity**: All ciphertexts are decrypted in memory during a single `judgeAll()` call. Very large bounties (hundreds of long submissions) may stress TEE memory limits.

---

## How the LLM Receives Submissions

Both the LLM precompile and the DKMS precompile are TEE-backed. This is what makes the architecture possible — they share a secure execution context. A single `judgeAll()` transaction triggers the following pipeline:

```
Transaction: judgeAll(bountyId)
│
├─ Step 1: DKMS key retrieval
│   └─ TEE loads the bounty-specific decryption key from DKMS (precompile 0x081B)
│
├─ Step 2: Batch decryption
│   └─ TEE decrypts all stored ciphertexts for this bountyId
│      ciphertext[i] → plaintext[i] for each participant
│
├─ Step 3: Prompt construction
│   └─ TEE assembles a single prompt:
│      "Rubric: {rubric}\n\nSubmission 1: {plaintext[0]}\nSubmission 2: {plaintext[1]}\n..."
│
├─ Step 4: LLM inference
│   └─ Prompt is passed to the LLM precompile (also inside the TEE)
│      LLM returns: scores, per-submission reasoning, winner recommendation
│
└─ Step 5: Result return
    └─ AI review struct is returned to the contract and written to chain state
       Plaintext answers are discarded — they never leave TEE memory
```

> **Note:** This architecture requires composing two precompile capabilities (DKMS + LLM) within a single TEE session. This is a Ritual Chain roadmap feature — the current implementation uses commit-reveal as a production-ready alternative that works today.

---

## Summary

The commit-reveal pattern is the pragmatic choice: it works now, on any EVM, with well-understood security properties. The TEE-native architecture described here is the end-state design — it eliminates UX friction, removes the risk of lost reveals, and ensures answers never appear in plaintext on-chain. When Ritual Chain supports composed precompile sessions, migrating from commit-reveal to DKMS-encrypted submissions will be a strict upgrade across every dimension except chain portability.
