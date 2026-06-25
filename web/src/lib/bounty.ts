import type { Address } from "viem";

/**
 * Parsed shape of the `getBounty` + `getBountyCounts` combined data.
 * The contract splits these into two view calls to avoid stack-too-deep.
 */
export type Bounty = {
  /* from getBounty */
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  deadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  winnerIndex: bigint;
  aiReview: `0x${string}`;
  /* from getBountyCounts */
  commitmentCount: bigint;
  revealCount: bigint;
  submissionCount: bigint;
};

/** getBounty returns a 10-element positional tuple. */
export function parseBountyCore(
  raw: readonly [
    Address,   // owner
    string,    // title
    string,    // rubric
    bigint,    // reward
    bigint,    // deadline
    bigint,    // revealDeadline
    boolean,   // judged
    boolean,   // finalized
    bigint,    // winnerIndex
    `0x${string}`, // aiReview
  ],
): Omit<Bounty, "commitmentCount" | "revealCount" | "submissionCount"> {
  const [
    owner, title, rubric, reward, deadline, revealDeadline,
    judged, finalized, winnerIndex, aiReview,
  ] = raw;
  return { owner, title, rubric, reward, deadline, revealDeadline, judged, finalized, winnerIndex, aiReview };
}

/** getBountyCounts returns a 3-element positional tuple. */
export function parseBountyCounts(
  raw: readonly [bigint, bigint, bigint],
): Pick<Bounty, "commitmentCount" | "revealCount" | "submissionCount"> {
  const [commitmentCount, revealCount, submissionCount] = raw;
  return { commitmentCount, revealCount, submissionCount };
}

/** Merge the two reads into a full Bounty object. */
export function mergeBounty(
  core: ReturnType<typeof parseBountyCore>,
  counts: ReturnType<typeof parseBountyCounts>,
): Bounty {
  return { ...core, ...counts };
}

// ── Phase helpers ────────────────────────────────────────────────────────

export type BountyPhase = "commit" | "reveal" | "judging" | "judged" | "finalized";

/**
 * Determine which phase a bounty is currently in.
 *
 * - commit:    now < deadline (accepting commitment hashes)
 * - reveal:    deadline <= now < revealDeadline (accepting reveals)
 * - judging:   now >= revealDeadline AND not yet judged
 * - judged:    AI review is in but winner not finalized
 * - finalized: winner picked, reward paid
 */
export function getBountyPhase(b: Bounty, nowSeconds = Date.now() / 1000): BountyPhase {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  if (Number(b.revealDeadline) <= nowSeconds) return "judging";
  if (Number(b.deadline) <= nowSeconds) return "reveal";
  return "commit";
}

export const PHASE_META: Record<
  BountyPhase,
  { label: string; tone: "green" | "amber" | "indigo" | "zinc" | "red" }
> = {
  commit: { label: "Accepting Commitments", tone: "green" },
  reveal: { label: "Reveal Phase", tone: "amber" },
  judging: { label: "Ready for Judging", tone: "indigo" },
  judged: { label: "Judged — Awaiting Finalization", tone: "zinc" },
  finalized: { label: "Finalized", tone: "zinc" },
};

/** Can a participant submit a commitment? */
export function canCommit(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return !b.judged && !b.finalized && Number(b.deadline) > nowSeconds;
}

/** Can a participant reveal their answer? */
export function canReveal(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    Number(b.deadline) <= nowSeconds &&
    Number(b.revealDeadline) > nowSeconds
  );
}

/** Can the owner trigger judging? */
export function canJudge(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return !b.judged && !b.finalized && Number(b.revealDeadline) <= nowSeconds;
}
