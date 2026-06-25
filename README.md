# Privacy-Preserving AI Bounty Judge

**Built on [Ritual Chain](https://ritualfoundation.org)**

## Overview

The Privacy-Preserving AI Bounty Judge is a decentralized bounty platform where submissions are hidden until a reveal phase, then batch-scored by an on-chain AI (Ritual's LLM precompile). The bounty owner makes the final winner decision informed by the AI's recommendation.

### The Problem

In a naïve on-chain bounty system, submissions are public the moment they hit the blockchain. This creates a critical fairness issue: later participants can read earlier submissions and plagiarize or strategically improve upon them. The result is a system that punishes early submitters and rewards copycats.

### The Solution

A **commit-reveal pattern** separates submission into two phases. During the commit phase, participants submit only a cryptographic hash of their answer — proving they locked in a response at a specific time without revealing its content. After the deadline passes, a reveal window opens where participants disclose their actual answers. The contract verifies each reveal matches the original commitment. Only after all reveals are in does the AI judge the submissions.

---

## How It Works — Lifecycle

A bounty moves through five phases:

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  CREATE  │────▶│  COMMIT  │────▶│  REVEAL  │────▶│  JUDGE   │────▶│ FINALIZE │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

1. **CREATE** — The bounty owner creates a bounty with a title, rubric (judging criteria), reward amount, submission deadline, and reveal window duration.

2. **COMMIT** — Before the deadline, participants submit `keccak256(answer, salt, sender, bountyId)`. The hash proves they have an answer without revealing it. No one — not even the bounty owner — can see what was submitted.

3. **REVEAL** — After the submission deadline passes, a reveal window opens. Participants submit their plaintext answer and salt. The contract recomputes the hash and verifies it matches the original commitment. Mismatches revert.

4. **JUDGE** — After the reveal deadline closes, the bounty owner triggers `judgeAll()`. This calls Ritual's LLM precompile, which receives all revealed answers along with the rubric and returns scores, rankings, and reasoning for each submission.

5. **FINALIZE** — The owner reviews the AI's recommendation and picks the winner (which may or may not follow the AI's top pick). The reward is transferred to the winner's address.

---

## Hash Scheme

The commitment hash is computed as:

```solidity
keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
```

Each component serves a purpose:

| Component    | Purpose |
|--------------|---------|
| `answer`     | The actual submission content |
| `salt`       | Random value to prevent brute-force guessing of short answers |
| `msg.sender` | Binds the commitment to a specific address — prevents cross-user replay |
| `bountyId`   | Binds the commitment to a specific bounty — prevents cross-bounty replay |

Including `msg.sender` means Alice cannot take Bob's commitment hash and submit it as her own. Including `bountyId` means a commitment from Bounty #1 cannot be replayed against Bounty #2.

---

## Project Structure

```
├── hardhat/                          # Solidity contract + tests
│   ├── contracts/
│   │   ├── AIJudge.sol               # Main commit-reveal bounty contract
│   │   └── utils/PrecompileConsumer.sol
│   ├── test/
│   │   └── AIJudge.test.ts
│   └── ignition/modules/AIJudge.ts
└── web/                              # Next.js frontend
    └── src/
        ├── components/               # SubmitCommitment, RevealAnswer, JudgeAll, etc.
        ├── hooks/                    # useBounty, useWriteTx, etc.
        ├── lib/                      # ritualLlm.ts, bounty.ts, etc.
        └── config/                   # wagmi.ts, contract.ts
```

---

## Setup & Running

### Smart Contract

```bash
cd hardhat
pnpm install
npx hardhat compile
npx hardhat test

# Deploy to Ritual Chain:
npx hardhat ignition deploy ignition/modules/AIJudge.ts --network ritual
```

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local
# Edit .env.local with your deployed contract address
pnpm dev
```

The frontend will be available at `http://localhost:3000`.

---

## Test Plan

The contract test suite (`AIJudge.test.ts`) covers the following scenarios:

| # | Test Case | Expected Behavior |
|---|-----------|-------------------|
| 1 | **Happy path**: commit → reveal → judge → finalize | Full lifecycle completes successfully; winner receives reward |
| 2 | **Early reveal reverts** | Attempting to reveal before the submission deadline reverts |
| 3 | **Late reveal reverts** | Attempting to reveal after the reveal deadline reverts |
| 4 | **Hash mismatch reverts** | Revealing with wrong answer or wrong salt reverts — hash does not match commitment |
| 5 | **Duplicate commit overwrites** | The same address can re-commit before the deadline; the new hash replaces the old one |
| 6 | **Cross-user replay fails** | Submitting another user's commitment hash reverts on reveal — `msg.sender` is part of the hash |
| 7 | **Judge before reveals close reverts** | Calling `judgeAll()` before the reveal deadline reverts |
| 8 | **No reveals: judgeAll reverts** | If no participants revealed, `judgeAll()` reverts (nothing to judge) |
| 9 | **Late commit reverts** | Attempting to commit after the submission deadline reverts |

---

## Reflection

> "What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?"

In a bounty system, the bounty title, rubric, reward amount, deadlines, and final results (winner, scores) should be public — transparency in judging criteria and outcomes builds trust. Submission content must stay hidden until the reveal phase closes; otherwise, late participants can plagiarize or strategically improve upon earlier entries, undermining fairness. The commitment hashes should be public (they prove a submission was locked in time) but reveal nothing about content. Participant identities are necessarily public on-chain but should be pseudonymous — wallet addresses, not real names. AI should handle the scoring and ranking against the rubric, because it applies criteria consistently without personal bias, fatigue, or favoritism. However, the final winner decision should remain with a human (the bounty owner), because edge cases — ties, submissions that game the rubric, or context the AI misses — require human judgment. The AI's review should be advisory and transparent (published on-chain), so participants can audit the reasoning. This separation — AI evaluates, human decides — balances scalability with accountability.

---

## Ritual Chain Info

| Property   | Value |
|------------|-------|
| Chain Name | Ritual Chain |
| Chain ID   | `1979` |
| RPC        | `https://rpc.ritualfoundation.org` |
| Explorer   | [https://explorer.ritualfoundation.org](https://explorer.ritualfoundation.org) |
| Faucet     | [https://faucet.ritualfoundation.org](https://faucet.ritualfoundation.org) |
