"use client";

import { useReadContract } from "wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress, isContractConfigured } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { parseBountyCore, parseBountyCounts, mergeBounty, type Bounty } from "@/lib/bounty";

/**
 * Read + parse a single bounty from two contract calls (getBounty + getBountyCounts),
 * polling so status flips as the deadline passes.
 */
export function useBounty(bountyId?: bigint) {
  const enabled = bountyId !== undefined && isContractConfigured;

  const coreQuery = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getBounty",
    args: bountyId !== undefined ? [bountyId] : undefined,
    chainId: ritualChain.id,
    query: {
      enabled,
      refetchInterval: 12_000,
    },
  });

  const countsQuery = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getBountyCounts",
    args: bountyId !== undefined ? [bountyId] : undefined,
    chainId: ritualChain.id,
    query: {
      enabled,
      refetchInterval: 12_000,
    },
  });

  const bounty: Bounty | undefined =
    coreQuery.data && countsQuery.data
      ? mergeBounty(parseBountyCore(coreQuery.data), parseBountyCounts(countsQuery.data))
      : undefined;

  return {
    bounty,
    isLoading: coreQuery.isLoading || countsQuery.isLoading,
    isError: coreQuery.isError || countsQuery.isError,
    error: coreQuery.error || countsQuery.error,
    refetch: async () => {
      await Promise.all([coreQuery.refetch(), countsQuery.refetch()]);
    },
  };
}
