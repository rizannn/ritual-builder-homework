"use client";

import { useReadContract } from "wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { shortenAddress } from "@/lib/format";
import type { JudgeResult } from "@/lib/aiReview";
import type { BountyPhase } from "@/lib/bounty";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";

export function SubmissionsList({
  bountyId,
  count,
  commitmentCount,
  revealCount,
  phase,
  judge,
  finalWinner,
}: {
  bountyId: bigint;
  count: number;
  commitmentCount: number;
  revealCount: number;
  phase: BountyPhase;
  judge?: JudgeResult | null;
  finalWinner?: number;
}) {
  const indices = Array.from({ length: count }, (_, i) => i);
  const showAnswers = phase === "judging" || phase === "judged" || phase === "finalized";

  return (
    <Card>
      <CardHeader
        title="Submissions"
        subtitle={
          phase === "commit"
            ? "Answers are hidden. Only commitment hashes are on-chain."
            : phase === "reveal"
              ? `Reveal phase: ${revealCount} of ${commitmentCount} commitments revealed.`
              : "All revealed submissions are shown below."
        }
        action={
          <div className="flex gap-1.5">
            {commitmentCount > 0 && (
              <Badge tone="zinc">{commitmentCount} committed</Badge>
            )}
            {revealCount > 0 && (
              <Badge tone="amber">{revealCount} revealed</Badge>
            )}
          </div>
        }
      />
      <CardBody className="space-y-3">
        {phase === "commit" && commitmentCount === 0 && (
          <p className="text-sm text-zinc-500">No commitments yet.</p>
        )}

        {phase === "commit" && commitmentCount > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">
              {commitmentCount} commitment{commitmentCount === 1 ? "" : "s"} received.
              Answers will be revealed after the deadline.
            </p>
            <div className="grid gap-2">
              {Array.from({ length: commitmentCount }, (_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">#{i}</span>
                    <span className="text-sm text-zinc-400">
                      🔒 Commitment hash stored
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(phase === "reveal") && count === 0 && commitmentCount > 0 && (
          <p className="text-sm text-zinc-400">
            Waiting for participants to reveal… ({revealCount}/{commitmentCount})
          </p>
        )}

        {count === 0 && commitmentCount === 0 && phase !== "commit" && (
          <p className="text-sm text-zinc-500">No submissions.</p>
        )}

        {count > 0 &&
          indices.map((i) => (
            <SubmissionRow
              key={i}
              bountyId={bountyId}
              index={i}
              showAnswer={showAnswers}
              ranking={judge?.ranking?.find((r) => r.index === i)}
              recommended={judge?.winnerIndex === i}
              isWinner={finalWinner === i}
            />
          ))}
      </CardBody>
    </Card>
  );
}

function SubmissionRow({
  bountyId,
  index,
  showAnswer,
  ranking,
  recommended,
  isWinner,
}: {
  bountyId: bigint;
  index: number;
  showAnswer: boolean;
  ranking?: { index: number; score: number; reason: string };
  recommended?: boolean;
  isWinner?: boolean;
}) {
  const { data, isLoading } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getSubmission",
    args: [bountyId, BigInt(index)],
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress },
  });

  const submitter = data?.[0];
  const answer = data?.[1];

  return (
    <div
      className={`rounded-xl border p-3 ${
        isWinner
          ? "border-emerald-500/40 bg-emerald-500/5"
          : recommended
            ? "border-indigo-500/40 bg-indigo-500/5"
            : "border-white/10 bg-black/20"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">#{index}</span>
          <span className="font-mono text-sm text-zinc-300">
            {submitter ? shortenAddress(submitter) : isLoading ? "loading…" : "-"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {ranking ? <Badge tone="zinc">score {ranking.score}</Badge> : null}
          {isWinner ? (
            <Badge tone="green">Winner</Badge>
          ) : recommended ? (
            <Badge tone="indigo">AI pick</Badge>
          ) : null}
        </div>
      </div>

      {showAnswer ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">
          {answer ?? (isLoading ? "" : "-")}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-zinc-500">
          🔒 Answer hidden until reveal phase ends
        </p>
      )}

      {ranking?.reason ? (
        <p className="mt-2 border-t border-white/5 pt-2 text-xs text-zinc-400">
          <span className="text-zinc-500">AI: </span>
          {ranking.reason}
        </p>
      ) : null}
    </div>
  );
}
