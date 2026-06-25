import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RITUAL_RPC = "https://rpc.ritualfoundation.org";
const CHAIN_ID = 1979;

const ritualChain = {
  id: CHAIN_ID,
  name: "Ritual Chain",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.ritualfoundation.org" } },
};

async function main() {
  const pk = process.env.DEPLOYER_PK;
  if (!pk) throw new Error("Set DEPLOYER_PK env var");

  const account = privateKeyToAccount(/** @type {`0x${string}`} */ (pk));
  console.log("Deployer:", account.address);

  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RITUAL_RPC) });
  const walletClient = createWalletClient({ account, chain: ritualChain, transport: http(RITUAL_RPC) });

  const artifactPath = join(__dirname, "..", "artifacts", "contracts", "AIJudge.sol", "AIJudge.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Balance:", balance.toString(), "wei");

  if (balance === 0n) {
    console.error("ERROR: No balance! Get funds from https://faucet.ritualfoundation.org");
    process.exit(1);
  }

  console.log("Deploying AIJudge...");
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  });
  console.log("Deploy TX Hash:", hash);

  console.log("Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Contract Address:", receipt.contractAddress);
  console.log("Block:", receipt.blockNumber.toString());
  console.log("Status:", receipt.status);
  console.log("");
  console.log("=== SUBMISSION INFO ===");
  console.log("Deploy TX Hash:", hash);
  console.log("Contract Address:", receipt.contractAddress);
}

main().catch((e) => { console.error(e); process.exit(1); });
