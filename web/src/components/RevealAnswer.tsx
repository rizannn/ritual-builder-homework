"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canReveal, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Input,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/** localStorage key for a user's pending commitment data. */
function storageKey(bountyId: bigint, address: Address): string {
  return `ritual-commitment-${bountyId}-${address.toLowerCase()}`;
}

export function RevealAnswer({
  bountyId,
  bounty,
  onRevealed,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onRevealed: () => void;
}) {
  const { isConnected, address } = useAccount();
  const [answer, setAnswer] = useState("");
  const [salt, setSalt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const now = useNow();
  const tx = useWriteTx(() => {
    // Clear saved commitment data after successful reveal.
    if (address) {
      try {
        localStorage.removeItem(storageKey(bountyId, address));
      } catch {
        /* ignore */
      }
    }
    onRevealed();
  });

  // Try to load saved commitment from localStorage.
  useEffect(() => {
    if (!address || loaded) return;
    try {
      const raw = localStorage.getItem(storageKey(bountyId, address));
      if (raw) {
        const data = JSON.parse(raw) as { answer: string; salt: string };
        setAnswer(data.answer);
        setSalt(data.salt);
      }
    } catch {
      /* ignore parse errors */
    }
    setLoaded(true);
  }, [address, bountyId, loaded]);

  // Only show during reveal phase.
  if (!canReveal(bounty, now / 1000)) return null;

  const revealDeadlineDate = new Date(Number(bounty.revealDeadline) * 1000);
  const timeLeft = Math.max(0, Number(bounty.revealDeadline) - now / 1000);
  const minutesLeft = Math.ceil(timeLeft / 60);

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !salt.trim() || !contractAddress) return;

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answer.trim(), salt as `0x${string}`],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Reveal your answer"
        subtitle={`Reveal before ${revealDeadlineDate.toLocaleString()} (${minutesLeft} min left)`}
      />
      <CardBody>
        <form onSubmit={handleReveal} className="space-y-3">
          {loaded && answer && salt ? (
            <Notice tone="green">
              ✅ Answer and salt loaded from browser storage.
            </Notice>
          ) : loaded ? (
            <Notice tone="amber">
              ⚠️ No saved data found. Paste your answer and salt manually.
            </Notice>
          ) : null}

          <Field label="Your answer" hint="Must match exactly what you committed.">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              placeholder="Paste your original answer…"
            />
          </Field>

          <Field label="Salt" hint="The 0x-prefixed hex salt from your commitment.">
            <Input
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
              placeholder="0x…"
              className="font-mono text-sm"
            />
          </Field>

          <Button
            type="submit"
            disabled={!isConnected || !answer.trim() || !salt.trim() || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy ? "Revealing…" : "Reveal answer"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-zinc-500">
              Connect your wallet to reveal.
            </p>
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
