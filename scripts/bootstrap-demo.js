/**
 * Registers + audits a demo agent so the product has life.
 * Usage: node scripts/bootstrap-demo.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const REGISTRY = process.env.REGISTRY_ADDRESS;
const RPC = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const KEY = process.env.PRIVATE_KEY;

const ABI = [
  "function registerAgent(bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,(uint256 maxSingleTxUSD,uint256 maxDailyVolumeUSD,uint256 maxSlippageBps,address[] allowedProtocols,address[] allowedTokens,bool requiresMultisig,uint256 multisigThresholdUSD,uint256 cooldownPeriod) rails,string metadataURI,uint256 deadline,bytes signature) payable returns (bytes32)",
  "function registrationFee() view returns (uint256)",
  "function totalAgents() view returns (uint256)",
  "function getAllAgentIds() view returns (bytes32[])",
  "function submitAudit(bytes32 agentId,uint8 score,bytes32 reportHash,string[] findings,bool passed)",
  "function getAgent(bytes32) view returns (tuple(address owner,bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,uint8 status,uint256 registeredAt,uint256 lastAuditAt,uint256 auditScore,address auditor,uint256 totalTxCount,uint256 totalVolumeUSD,uint256 reputationScore,bool kycVerified,address executor,uint256 lastActivityAt,string metadataURI))",
];

async function main() {
  if (!KEY || !REGISTRY) throw new Error("PRIVATE_KEY and REGISTRY_ADDRESS required in .env");

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const c = new ethers.Contract(REGISTRY, ABI, wallet);

  console.log("Deployer", wallet.address);
  console.log("Registry", REGISTRY);

  const before = Number(await c.totalAgents());
  console.log("Agents before:", before);

  const fee = await c.registrationFee();
  const name = `ForgePrime-${Date.now().toString().slice(-6)}`;
  const modelHash = ethers.keccak256(ethers.toUtf8Bytes(name));
  const codeHash = ethers.keccak256(ethers.toUtf8Bytes("agentforge-v3-legendary"));
  const rails = [
    ethers.parseEther("10000"),
    ethers.parseEther("100000"),
    100n,
    [],
    [],
    false,
    ethers.parseEther("5000"),
    0n,
  ];
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  console.log("Registering", name, "…");
  const tx = await c.registerAgent(
    modelHash,
    codeHash,
    ["monitor", "lend", "stake"],
    1,
    rails,
    `ipfs://agentforge/${encodeURIComponent(name)}`,
    deadline,
    "0x",
    { value: fee, gasLimit: 2_000_000n }
  );
  console.log("tx", tx.hash);
  await tx.wait();

  const ids = await c.getAllAgentIds();
  const agentId = ids[ids.length - 1];
  console.log("agentId", agentId);

  console.log("Auditing…");
  const atx = await c.submitAudit(agentId, 88, ethers.ZeroHash, [], true, { gasLimit: 500_000n });
  console.log("audit", atx.hash);
  await atx.wait();

  const agent = await c.getAgent(agentId);
  console.log("status", Number(agent.status), "(1=Active) score", Number(agent.auditScore));
  console.log("totalAgents", Number(await c.totalAgents()));
  console.log("\nOpen Rails Lab → on-chain checkTx with this agent.");
  console.log("Try amountUSD=50000 → expect BLOCK.");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exit(1);
});
