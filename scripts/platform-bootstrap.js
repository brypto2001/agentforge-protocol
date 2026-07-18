/**
 * Full platform bootstrap on Base Sepolia:
 *  1) Ensure DemoMarket + EXECUTOR_ROLE
 *  2) Register 3 strategy agents (yield, arb, custom)
 *  3) Audit Active
 *  4) Stake ETH on vault
 *  5) Create marketplace listings
 *  6) Run rail-gated trades through Executor → DemoMarket
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const KEY = process.env.PRIVATE_KEY;

function loadDeploy() {
  const p = path.join(__dirname, "../deployments.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).contracts;
}

const REGISTRY_ABI = [
  "function registerAgent(bytes32,bytes32,string[],uint8,(uint256,uint256,uint256,address[],address[],bool,uint256,uint256),string,uint256,bytes) payable returns (bytes32)",
  "function registrationFee() view returns (uint256)",
  "function getAllAgentIds() view returns (bytes32[])",
  "function submitAudit(bytes32,uint8,bytes32,string[],bool)",
  "function getAgent(bytes32) view returns (tuple(address owner,bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,uint8 status,uint256 registeredAt,uint256 lastAuditAt,uint256 auditScore,address auditor,uint256 totalTxCount,uint256 totalVolumeUSD,uint256 reputationScore,bool kycVerified,address executor,uint256 lastActivityAt,string metadataURI))",
  "function checkTx(bytes32,address,address,uint256,uint256) view returns (bool,string)",
];

const EXECUTOR_ABI = [
  "function execute((bytes32 agentId,address protocol,address token,uint256 tokenAmount,uint256 slippageBps,bytes callData,uint256 value,string reasoning)) payable returns ((bool,bytes,uint256,uint256,uint256))",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function grantRole(bytes32,address)",
  "function hasRole(bytes32,address) view returns (bool)",
];

const VAULT_ABI = [
  "function stakeETH(bytes32 agentId) payable",
  "function totalStaked(bytes32) view returns (uint256)",
];

const COMMERCE_ABI = [
  "function createListing(bytes32 agentId,uint8 serviceType,string name,string description,address paymentToken,uint256 pricePerUnit,uint256 unitSize,uint256 minUnits,uint256 maxUnits,bytes32 slaHash) returns (bytes32)",
  "function allListingIds(uint256) view returns (bytes32)",
  "function getListing(bytes32) view returns (tuple(bytes32 agentId,uint8 serviceType,string name,string description,address paymentToken,uint256 pricePerUnit,uint256 unitSize,uint256 minUnits,uint256 maxUnits,uint256 totalEarned,uint256 totalOrders,bool active,uint256 createdAt,bytes32 slaHash))",
];

// Check if getListing exists - may need raw mapping
const MARKET_ABI = [
  "function trade(bytes32 agentId,uint256 amountUSD,string strategy) returns (bool)",
  "function tradeCount() view returns (uint256)",
];

function manifest(strategy, source) {
  const obj = {
    name: strategy.name,
    version: "1.0.0",
    strategy: strategy.id,
    capabilities: strategy.capabilities,
    codeHash: ethers.keccak256(ethers.toUtf8Bytes(source)),
    sourcePreview: source.slice(0, 500),
    rails: strategy.rails,
    publishedAt: new Date().toISOString(),
    compliant: "AgentExecutor.execute only",
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendWithRetry(sendFn, label) {
  for (let i = 0; i < 6; i++) {
    try {
      const tx = await sendFn();
      console.log(`  ${label}:`, tx.hash);
      await tx.wait();
      await sleep(4000);
      return tx;
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      if (msg.includes("in-flight") || msg.includes("rate") || msg.includes("429")) {
        console.warn(`  ${label} rate-limited, wait ${(i + 1) * 8}s…`);
        await sleep((i + 1) * 8000);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`${label} failed after retries`);
}

async function registerStrategy(registry, wallet, strategy, source) {
  const fee = await registry.registrationFee();
  const modelHash = ethers.keccak256(ethers.toUtf8Bytes(strategy.id + ":model:" + Date.now()));
  const codeHash = ethers.keccak256(ethers.toUtf8Bytes(source));
  const rails = [
    ethers.parseEther(String(strategy.rails.maxSingleTxUSD)),
    ethers.parseEther(String(strategy.rails.maxDailyVolumeUSD)),
    BigInt(strategy.rails.maxSlippageBps),
    [],
    [],
    false,
    ethers.parseEther(String(Math.floor(strategy.rails.maxSingleTxUSD / 2))),
    0n,
  ];
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const meta = manifest(strategy, source);
  const before = (await registry.getAllAgentIds()).length;
  await sendWithRetry(
    () =>
      registry.registerAgent(
        modelHash,
        codeHash,
        strategy.capabilities,
        strategy.safetyLevel,
        rails,
        meta,
        deadline,
        "0x",
        { value: fee, gasLimit: 3_000_000n }
      ),
    `register ${strategy.id}`
  );
  const ids = await registry.getAllAgentIds();
  if (ids.length <= before) throw new Error("register did not add agent");
  return ids[ids.length - 1];
}

async function executeTrade(executor, market, agentId, amountUSD, strategyTag) {
  const iface = new ethers.Interface(MARKET_ABI);
  const amount = ethers.parseEther(String(amountUSD));
  const callData = iface.encodeFunctionData("trade", [agentId, amount, strategyTag]);
  // Unknown token path: tokenAmount used as USD 18-decimals for rails
  const req = {
    agentId,
    protocol: market,
    token: market, // no chainlink feed → usdValue = tokenAmount
    tokenAmount: amount,
    slippageBps: 50n,
    callData,
    value: 0n,
    reasoning: `autonomous:${strategyTag}`,
  };
  const tx = await executor.execute(req, { gasLimit: 1_500_000n });
  console.log(`  execute ${strategyTag} $${amountUSD}:`, tx.hash);
  const r = await tx.wait();
  return r.status === 1;
}

async function main() {
  if (!KEY) throw new Error("PRIVATE_KEY required");
  const d = loadDeploy();
  if (!d.DemoMarket) throw new Error("Run deploy-platform.ts first (no DemoMarket)");

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   AgentForge Platform Bootstrap          ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Wallet:", wallet.address);

  const registry = new ethers.Contract(d.AgentRegistry, REGISTRY_ABI, wallet);
  const executor = new ethers.Contract(d.AgentExecutor, EXECUTOR_ABI, wallet);
  const vault = new ethers.Contract(d.AgentVault, VAULT_ABI, wallet);
  const commerce = new ethers.Contract(d.AgentCommerce, COMMERCE_ABI, wallet);
  const market = d.DemoMarket;

  // EXECUTOR_ROLE
  const role = await executor.EXECUTOR_ROLE();
  if (!(await executor.hasRole(role, wallet.address))) {
    const g = await executor.grantRole(role, wallet.address);
    await g.wait();
    console.log("✅ EXECUTOR_ROLE granted");
  }

  const strategies = [
    {
      id: "yield",
      name: "YieldPrime-v1",
      safetyLevel: 2,
      capabilities: ["lend", "stake", "monitor"],
      rails: { maxSingleTxUSD: 2000, maxDailyVolumeUSD: 20000, maxSlippageBps: 80 },
      source: "strategy yield { rebalance(aave,compound,moonwell); only via AgentExecutor.execute }",
    },
    {
      id: "arb",
      name: "ArbPulse-v1",
      safetyLevel: 1,
      capabilities: ["trade", "arbitrage", "monitor"],
      rails: { maxSingleTxUSD: 1500, maxDailyVolumeUSD: 15000, maxSlippageBps: 50 },
      source: "strategy arb { scan(uniswap); execute only if rails.allow && profit>gas }",
    },
    {
      id: "custom",
      name: "ForgeCustom-v1",
      safetyLevel: 1,
      capabilities: ["custom", "compute", "data_feed"],
      rails: { maxSingleTxUSD: 500, maxDailyVolumeUSD: 5000, maxSlippageBps: 100 },
      source: "strategy custom { userLogic(); must call client.execute() }",
    },
  ];

  const agents = {};
  console.log("\n── 1) Publish strategies ──");
  for (const s of strategies) {
    const id = await registerStrategy(registry, wallet, s, s.source);
    agents[s.id] = id;
    console.log(`  ${s.id} agentId:`, id);
  }

  console.log("\n── 2) Audit → Active ──");
  for (const [k, id] of Object.entries(agents)) {
    await sendWithRetry(
      () => registry.submitAudit(id, 90, ethers.ZeroHash, [], true, { gasLimit: 500_000n }),
      `audit ${k}`
    );
  }

  console.log("\n── 3) Stake ETH (vault) ──");
  for (const [k, id] of Object.entries(agents)) {
    try {
      await sendWithRetry(
        () => vault.stakeETH(id, { value: ethers.parseEther("0.001"), gasLimit: 300_000n }),
        `stake ${k}`
      );
      const total = await vault.totalStaked(id);
      console.log(`  staked total ${k}:`, ethers.formatEther(total));
    } catch (e) {
      console.warn(`  stake ${k} skip:`, e.shortMessage || e.message);
    }
  }

  console.log("\n── 4) Marketplace listings ──");
  for (const [k, id] of Object.entries(agents)) {
    try {
      await sendWithRetry(
        () =>
          commerce.createListing(
            id,
            k === "yield" ? 3 : k === "arb" ? 2 : 0,
            `${k} service`,
            `Autonomous ${k} agent — rail-bound on AgentForge`,
            ethers.ZeroAddress,
            ethers.parseEther("0.0001"),
            1,
            1,
            100,
            ethers.ZeroHash,
            { gasLimit: 500_000n }
          ),
        `list ${k}`
      );
    } catch (e) {
      console.warn(`  list ${k} skip:`, e.shortMessage || e.message);
    }
  }

  console.log("\n── 5) Rail-gated trades ──");
  for (const [k, id] of Object.entries(agents)) {
    try {
      await sendWithRetry(
        () => {
          const iface = new ethers.Interface(MARKET_ABI);
          const amount = ethers.parseEther("100");
          const callData = iface.encodeFunctionData("trade", [id, amount, k]);
          return executor.execute(
            {
              agentId: id,
              protocol: market,
              token: market,
              tokenAmount: amount,
              slippageBps: 50n,
              callData,
              value: 0n,
              reasoning: `bootstrap:${k}`,
            },
            { gasLimit: 1_500_000n }
          );
        },
        `trade $100 ${k}`
      );
    } catch (e) {
      console.warn(`  trade ${k}:`, e.shortMessage || e.message);
    }
  }
  try {
    await executeTrade(executor, market, agents.custom, 5000, "custom");
    console.log("  breach $5000 custom: unexpected OK");
  } catch (e) {
    console.log("  breach $5000 custom: BLOCKED (expected) —", (e.shortMessage || e.message || "").slice(0, 100));
  }

  // Rails view check
  const [allow, reason] = await registry.checkTx(
    agents.custom,
    market,
    market,
    ethers.parseEther("5000"),
    50n
  );
  console.log("  checkTx $5000 custom:", allow ? "ALLOW" : "BLOCK", reason);

  const mkt = new ethers.Contract(market, MARKET_ABI, provider);
  console.log("\n── Summary ──");
  console.log("DemoMarket trades:", (await mkt.tradeCount()).toString());
  console.log("Agents:", agents);
  console.log("\nPlatform bootstrap complete.");
  console.log("Start autonomous loop: npx ts-node --transpile-only sdk/examples/autonomous-trader.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
