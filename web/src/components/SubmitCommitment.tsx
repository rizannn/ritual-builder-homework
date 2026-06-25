"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import {
  keccak256,
  encodePacked,
  toHex,
  type Address,
} from "viem";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/** Generate a random 32-byte salt. */
function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Compute the commitment hash matching the contract's verification. */
function computeCommitment(
  answer: string,
  salt: `0x${string}`,
  sender: Address,
  bountyId: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, sender, bountyId],
    ),
  );
}

/** localStorage key for a user's pending commitment data. */
function storageKey(bountyId: bigint, address: Address): string {
  return `ritual-commitment-${bountyId}-${address.toLowerCase()}`;
}

export function SubmitCommitment({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { isConnected, address } = useAccount();
  const [answer, setAnswer] = useState("");
  const [saved, setSaved] = useState(false);
  const now = useNow();
  const tx = useWriteTx(() => {
    setSaved(true);
    onSubmitted();
  });

  // Only show during commit phase.
  if (!canCommit(bounty, now / 1000)) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !contractAddress || !address) return;

    const salt = generateSalt();
    const commitment = computeCommitment(answer.trim(), salt, address, bountyId);

    // Persist answer + salt in localStorage so user can reveal later.
    try {
      localStorage.setItem(
        storageKey(bountyId, address),
        JSON.stringify({ answer: answer.trim(), salt }),
      );
    } catch {
      /* storage full or blocked — warn below */
    }

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Submit a commitment"
        subtitle="Your answer is hashed — only you can reveal it after the deadline."
      />
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Your answer">
            <Textarea
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setSaved(false);
              }}
              rows={5}
              placeholder="Write your submission… (only the hash goes on-chain)"
            />
          </Field>

          <Notice tone="amber">
            ⚠️ Your answer and salt are saved in your browser. If you clear
            browser data before revealing, your submission is{" "}
            <strong>permanently lost</strong>. Consider backing up the salt.
          </Notice>

          <Button
            type="submit"
            disabled={!isConnected || !answer.trim() || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy ? "Submitting commitment…" : "Submit commitment"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-zinc-500">
              Connect your wallet to submit.
            </p>
          )}

          {saved && tx.state === "confirmed" && (
            <Notice tone="green">
              ✅ Commitment submitted! Your answer is saved locally. Come back
              after the deadline to reveal.
            </Notice>
          )}

          <TxStatus
            state={tx.state}
            error={tx.error}
            hash={tx.hash}
            explorerBase={explorerBase}
          />
        </form>
      </CardBody>
    </Card>
  );
}
