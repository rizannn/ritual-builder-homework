// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;

    function depositFor(address user, uint256 lockDuration) external payable;

    function withdraw(uint256 amount) external;

    function balanceOf(address) external view returns (uint256);

    function lockUntil(address) external view returns (uint256);
}

/**
 * @title AIJudge — Privacy-Preserving Commit-Reveal Bounty
 * @notice Participants submit only a commitment hash during the submission
 *         phase. After the deadline they reveal their answer + salt. The
 *         contract verifies keccak256(answer, salt, msg.sender, bountyId)
 *         matches the commitment. Only valid, revealed answers are eligible
 *         for AI judging via Ritual's LLM precompile.
 *
 * Phase model:
 *   1. Commit   — block.timestamp < deadline
 *   2. Reveal   — deadline <= block.timestamp < revealDeadline
 *   3. Judge    — block.timestamp >= revealDeadline (owner calls judgeAll)
 *   4. Finalize — owner picks winner and pays reward
 */
contract AIJudge is PrecompileConsumer {
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    IRitualWallet wallet =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    struct Submission {
        address submitter;
        string answer;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 deadline;
        uint256 revealDeadline;
        uint256 commitmentCount;
        uint256 revealCount;
        bool judged;
        bool finalized;
        bytes aiReview;
        uint256 winnerIndex;
        Submission[] submissions;
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    mapping(uint256 => Bounty) public bounties;

    /// @dev bountyId => submitter => commitment hash
    mapping(uint256 => mapping(address => bytes32)) public commitments;

    // ── Events ───────────────────────────────────────────────────────────

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 deadline,
        uint256 revealDeadline
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        address indexed submitter
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed submissionIndex,
        address indexed submitter
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not bounty owner");
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        require(bounties[bountyId].owner != address(0), "bounty not found");
        _;
    }

    // ── Bounty Creation ──────────────────────────────────────────────────

    /**
     * @notice Create a new bounty with a submission deadline and reveal window.
     * @param title       Human-readable title.
     * @param rubric      Judging rubric the AI evaluates against.
     * @param deadline    Unix timestamp — commits accepted until this time.
     * @param revealWindow Seconds after deadline during which reveals are accepted.
     * @return bountyId   The id of the newly created bounty.
     */
    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 deadline,
        uint256 revealWindow
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(revealWindow > 0, "reveal window required");

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.deadline = deadline;
        bounty.revealDeadline = deadline + revealWindow;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(
            bountyId,
            msg.sender,
            title,
            msg.value,
            deadline,
            deadline + revealWindow
        );
    }

    // ── Phase 1: Commit ──────────────────────────────────────────────────

    /**
     * @notice Submit a commitment hash for a bounty.
     * @dev    The commitment must be keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId)).
     *         A user may re-commit before the deadline (overwrites the previous commitment).
     * @param bountyId   The bounty to commit to.
     * @param commitment The keccak256 commitment hash.
     */
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp < bounty.deadline, "commit phase ended");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(commitment != bytes32(0), "empty commitment");

        // If this is a new commitment (not an overwrite), increment the count.
        if (commitments[bountyId][msg.sender] == bytes32(0)) {
            require(
                bounty.commitmentCount < MAX_SUBMISSIONS,
                "too many submissions"
            );
            bounty.commitmentCount++;
        }

        commitments[bountyId][msg.sender] = commitment;

        emit CommitmentSubmitted(bountyId, msg.sender);
    }

    // ── Phase 2: Reveal ──────────────────────────────────────────────────

    /**
     * @notice Reveal your answer and salt. The contract verifies the hash
     *         matches your earlier commitment.
     * @param bountyId The bounty to reveal for.
     * @param answer   The plaintext answer.
     * @param salt     The random salt used when committing.
     */
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(
            block.timestamp >= bounty.deadline,
            "reveal phase not started"
        );
        require(
            block.timestamp < bounty.revealDeadline,
            "reveal phase ended"
        );
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bytes(answer).length <= MAX_ANSWER_LENGTH, "answer too long");

        // Verify commitment exists.
        bytes32 stored = commitments[bountyId][msg.sender];
        require(stored != bytes32(0), "no commitment found");

        // Verify hash matches.
        bytes32 computed = keccak256(
            abi.encodePacked(answer, salt, msg.sender, bountyId)
        );
        require(computed == stored, "hash mismatch");

        // Clear commitment so it cannot be revealed twice.
        commitments[bountyId][msg.sender] = bytes32(0);

        // Store the revealed answer.
        bounty.submissions.push(
            Submission({submitter: msg.sender, answer: answer})
        );
        bounty.revealCount++;

        emit AnswerRevealed(
            bountyId,
            bounty.submissions.length - 1,
            msg.sender
        );
    }

    // ── Phase 3: Judge ───────────────────────────────────────────────────

    /**
     * @notice Batch-judge all revealed submissions via the Ritual LLM precompile.
     * @dev    Only callable by the bounty owner after the reveal deadline.
     * @param bountyId The bounty to judge.
     * @param llmInput ABI-encoded LLM request payload.
     */
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(
            block.timestamp >= bounty.revealDeadline,
            "reveal phase not ended"
        );
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bounty.submissions.length > 0, "no revealed submissions");

        bytes memory output = _executePrecompile(
            LLM_INFERENCE_PRECOMPILE,
            llmInput
        );

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        require(!hasError, errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;

        emit AllAnswersJudged(bountyId, completionData);
    }

    // ── Phase 4: Finalize ────────────────────────────────────────────────

    /**
     * @notice Pick the winner and pay out the reward.
     * @param bountyId    The bounty to finalize.
     * @param winnerIndex Index into the submissions array.
     */
    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.judged, "not judged yet");
        require(!bounty.finalized, "already finalized");

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = bounty.submissions[winnerIndex].submitter;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        require(ok, "payment failed");

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    // ── View Functions ───────────────────────────────────────────────────

    /**
     * @notice Read a bounty's core metadata.
     */
    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 deadline,
            uint256 revealDeadline,
            bool judged,
            bool finalized,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];

        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.deadline,
            bounty.revealDeadline,
            bounty.judged,
            bounty.finalized,
            bounty.winnerIndex,
            bounty.aiReview
        );
    }

    /**
     * @notice Read a bounty's submission counts.
     */
    function getBountyCounts(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            uint256 commitmentCount,
            uint256 revealCount,
            uint256 submissionCount
        )
    {
        Bounty storage bounty = bounties[bountyId];

        return (
            bounty.commitmentCount,
            bounty.revealCount,
            bounty.submissions.length
        );
    }

    /**
     * @notice Read a single revealed submission.
     */
    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, string memory answer)
    {
        Bounty storage bounty = bounties[bountyId];

        require(index < bounty.submissions.length, "invalid index");

        Submission storage submission = bounty.submissions[index];

        return (submission.submitter, submission.answer);
    }

    /**
     * @notice Read a user's commitment hash for a bounty.
     * @return commitment The stored commitment, or bytes32(0) if none/already revealed.
     */
    function getCommitment(
        uint256 bountyId,
        address user
    ) external view returns (bytes32 commitment) {
        return commitments[bountyId][user];
    }
}
