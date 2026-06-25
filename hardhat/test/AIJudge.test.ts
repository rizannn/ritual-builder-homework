import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import {
  type Address,
  keccak256,
  encodePacked,
  parseEther,
  getAddress,
} from "viem";

/**
 * AIJudge Commit-Reveal Test Suite (Hardhat 3 / node:test)
 *
 * 1. Happy path (commit → reveal)
 * 2. Early reveal reverts
 * 3. Late reveal reverts
 * 4. Hash mismatch reverts
 * 5. Duplicate commit overwrites
 * 6. Cross-user replay fails
 * 7. Judge before reveals close reverts
 * 8. No reveals — judgeAll reverts
 * 9. Late commit reverts
 */

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

const REWARD = parseEther("1");
const REVEAL_WINDOW = 3600n; // 1 hour
const SALT_A = ("0x" + "aa".repeat(32)) as `0x${string}`;
const SALT_B = ("0x" + "bb".repeat(32)) as `0x${string}`;
const ANSWER_A = "My answer from Alice";
const ANSWER_B = "My answer from Bob";

async function setup(deadlineOffset = 3600) {
  const connection = await hre.network.getOrCreate();
  const { viem, networkHelpers } = connection;

  const [owner, alice, bob] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.deployContract("AIJudge");

  const block = await publicClient.getBlock();
  const deadline = block.timestamp + BigInt(deadlineOffset);

  const hash = await owner.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName: "createBounty",
    args: ["Test Bounty", "Score by quality", deadline, REVEAL_WINDOW],
    value: REWARD,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  async function advanceTime(seconds: number) {
    await networkHelpers.time.increase(BigInt(seconds));
  }

  return { owner, alice, bob, publicClient, contract, deadline, advanceTime };
}

describe("AIJudge — Commit-Reveal Bounty", () => {
  const bountyId = 1n;

  it("1. Happy path: commit → reveal → verify submissions", async () => {
    const { alice, bob, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);
    const bobAddr = getAddress(bob.account.address);

    // Alice commits
    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    let hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Bob commits
    const commitB = computeCommitment(ANSWER_B, SALT_B, bobAddr, bountyId);
    hash = await bob.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitB],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Check commitment counts
    const counts = (await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getBountyCounts",
      args: [bountyId],
    })) as [bigint, bigint, bigint];
    assert.equal(counts[0], 2n, "commitmentCount should be 2");
    assert.equal(counts[1], 0n, "revealCount should be 0");

    // Advance past deadline into reveal phase
    await advanceTime(3601);

    // Alice reveals
    hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "revealAnswer",
      args: [bountyId, ANSWER_A, SALT_A],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Bob reveals
    hash = await bob.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "revealAnswer",
      args: [bountyId, ANSWER_B, SALT_B],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Check after reveals
    const countsAfter = (await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getBountyCounts",
      args: [bountyId],
    })) as [bigint, bigint, bigint];
    assert.equal(countsAfter[1], 2n, "revealCount should be 2");
    assert.equal(countsAfter[2], 2n, "submissionCount should be 2");

    // Verify Alice's submission
    const sub0 = (await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getSubmission",
      args: [bountyId, 0n],
    })) as [Address, string];
    assert.equal(sub0[0].toLowerCase(), aliceAddr.toLowerCase());
    assert.equal(sub0[1], ANSWER_A);
  });

  it("2. revealAnswer before deadline reverts", async () => {
    const { alice, publicClient, contract } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    const hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, ANSWER_A, SALT_A],
      }),
      (err: Error) => err.message.includes("reveal phase not started"),
    );
  });

  it("3. revealAnswer after revealDeadline reverts", async () => {
    const { alice, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    const hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Advance past both deadline AND revealDeadline
    await advanceTime(3601 + 3601);

    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, ANSWER_A, SALT_A],
      }),
      (err: Error) => err.message.includes("reveal phase ended"),
    );
  });

  it("4. revealAnswer with wrong salt/answer reverts", async () => {
    const { alice, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    const hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    await advanceTime(3601);

    // Wrong salt
    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, ANSWER_A, SALT_B],
      }),
      (err: Error) => err.message.includes("hash mismatch"),
    );

    // Wrong answer
    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, "wrong answer", SALT_A],
      }),
      (err: Error) => err.message.includes("hash mismatch"),
    );
  });

  it("5. Same address can re-commit (overwrite)", async () => {
    const { alice, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    // First commitment
    const commit1 = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    let hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commit1],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Overwrite
    const newAnswer = "Updated answer";
    const commit2 = computeCommitment(newAnswer, SALT_B, aliceAddr, bountyId);
    hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commit2],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Count should still be 1
    const counts = (await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getBountyCounts",
      args: [bountyId],
    })) as [bigint, bigint, bigint];
    assert.equal(counts[0], 1n);

    await advanceTime(3601);

    // Old commitment should fail
    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, ANSWER_A, SALT_A],
      }),
      (err: Error) => err.message.includes("hash mismatch"),
    );

    // New commitment should succeed
    hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "revealAnswer",
      args: [bountyId, newAnswer, SALT_B],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const sub = (await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getSubmission",
      args: [bountyId, 0n],
    })) as [Address, string];
    assert.equal(sub[1], newAnswer);
  });

  it("6. Cross-user replay: Bob can't reveal with Alice's answer+salt", async () => {
    const { alice, bob, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    // Alice commits normally
    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    let hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Bob submits Alice's commitment hash
    hash = await bob.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    await advanceTime(3601);

    // Bob tries to reveal with Alice's answer+salt — fails because
    // hash includes msg.sender
    await assert.rejects(
      bob.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "revealAnswer",
        args: [bountyId, ANSWER_A, SALT_A],
      }),
      (err: Error) => err.message.includes("hash mismatch"),
    );
  });

  it("7. judgeAll before revealDeadline reverts", async () => {
    const { owner, alice, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    let hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Advance past deadline but NOT past revealDeadline
    await advanceTime(3601);

    // Reveal so there's a submission
    hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "revealAnswer",
      args: [bountyId, ANSWER_A, SALT_A],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Try to judge during reveal phase
    await assert.rejects(
      owner.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "judgeAll",
        args: [bountyId, "0x00"],
      }),
      (err: Error) => err.message.includes("reveal phase not ended"),
    );
  });

  it("8. judgeAll with 0 revealed answers reverts", async () => {
    const { owner, alice, publicClient, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    const hash = await alice.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "submitCommitment",
      args: [bountyId, commitA],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Advance past both deadlines without revealing
    await advanceTime(3601 + 3601);

    await assert.rejects(
      owner.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "judgeAll",
        args: [bountyId, "0x00"],
      }),
      (err: Error) => err.message.includes("no revealed submissions"),
    );
  });

  it("9. submitCommitment after deadline reverts", async () => {
    const { alice, contract, advanceTime } = await setup();
    const aliceAddr = getAddress(alice.account.address);

    await advanceTime(3601);

    const commitA = computeCommitment(ANSWER_A, SALT_A, aliceAddr, bountyId);
    await assert.rejects(
      alice.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "submitCommitment",
        args: [bountyId, commitA],
      }),
      (err: Error) => err.message.includes("commit phase ended"),
    );
  });
});
