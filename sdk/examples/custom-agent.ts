/**
 * Sample custom agent — AgentForge-compliant
 * ───────────────────────────────────────────
 * All external calls go through AgentExecutor.execute().
 * Direct protocol txs are forbidden in this template.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only sdk/examples/custom-agent.ts
 *
 * Env:
 *   PRIVATE_KEY, BASE_RPC_URL
 *   REGISTRY_ADDRESS, EXECUTOR_ADDRESS
 *   AGENT_ID          (optional — registers new if missing)
 *   DRY_RUN=1         (only checkRails, no execute)
 */

import "dotenv/config";
import { Interface, parseUnits, ZeroAddress } from "ethers";
import { AgentForgeClient } from "../agentforge-client";

const REGISTRY = process.env.REGISTRY_ADDRESS!;
const EXECUTOR = process.env.EXECUTOR_ADDRESS!;
const RPC = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const KEY = process.env.PRIVATE_KEY!;
const DRY = process.env.DRY_RUN === "1";

// Example: ERC20 approve as a "protocol call" (works on any network with a token)
// For demo without real DeFi, we target the zero address with empty callData
// only after rails allow — replace with real Aave/Uniswap calldata in production.
const ERC20_IFACE = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

async function main() {
  if (!KEY || !REGISTRY || !EXECUTOR) {
    throw new Error("Set PRIVATE_KEY, REGISTRY_ADDRESS, EXECUTOR_ADDRESS");
  }

  const client = new AgentForgeClient({
    privateKey: KEY,
    rpcUrl: RPC,
    registryAddress: REGISTRY,
    executorAddress: EXECUTOR,
  });

  const me = await client.getAddress();
  console.log("Operator wallet:", me);
  console.log("Registry:", REGISTRY);
  console.log("Executor:", EXECUTOR);

  // 1) Ensure we can call execute()
  let canExec = await client.hasExecutorRole(me);
  if (!canExec) {
    console.log("No EXECUTOR_ROLE — attempting grant (requires admin key)…");
    try {
      const h = await client.grantExecutorRole(me);
      console.log("Granted EXECUTOR_ROLE:", h);
      canExec = true;
    } catch (e: any) {
      console.warn(
        "Could not grant role (need deployer/admin key):",
        e.shortMessage || e.message
      );
      console.warn("Ask protocol admin to grant EXECUTOR_ROLE to", me);
    }
  } else {
    console.log("EXECUTOR_ROLE: yes");
  }

  // 2) Register or reuse agent
  let agentId = process.env.AGENT_ID;
  if (!agentId) {
    console.log("Registering custom agent…");
    const reg = await client.register({
      name: `CustomBot-${Date.now().toString().slice(-6)}`,
      capabilities: ["custom", "monitor", "trade"],
      safetyLevel: 1,
      rails: {
        maxSingleTxUSD: 1000, // tight rails for demo
        maxDailyVolumeUSD: 5000,
        maxSlippageBps: 100,
      },
      // In production: codeHash = keccak256(dockerDigest or gitCommit)
      codeHash: undefined,
      metadataURI: undefined,
    });
    agentId = reg.agentId;
    console.log("Registered agentId:", agentId, "tx:", reg.txHash);

    // If this wallet is auditor (deployer), auto-activate
    try {
      const auditTx = await client.audit(agentId, 90, true);
      console.log("Audited Active:", auditTx);
    } catch (e: any) {
      console.warn("Audit skipped (need AUDITOR_ROLE):", e.shortMessage || e.message);
      console.warn("Agent stays Pending until audited.");
    }
  } else {
    console.log("Using AGENT_ID:", agentId);
  }

  const agent = await client.getAgent(agentId!);
  console.log("Agent status:", agent.statusLabel, "score:", agent.auditScore);

  // 3) Rails check — small intent
  const small = await client.checkRails({
    agentId: agentId!,
    amountUSD: 100,
    slippageBps: 50,
  });
  console.log("checkRails $100:", small);

  // 4) Rails check — breach
  const big = await client.checkRails({
    agentId: agentId!,
    amountUSD: 50_000,
    slippageBps: 50,
  });
  console.log("checkRails $50000:", big, "← should BLOCK if Active with $1k rail");

  if (DRY) {
    console.log("DRY_RUN=1 — not calling execute()");
    return;
  }

  if (!canExec) {
    console.log("Skipping execute — no EXECUTOR_ROLE");
    return;
  }

  if (agent.status !== 1) {
    console.log("Skipping execute — agent not Active");
    return;
  }

  // 5) Compliant execute: dummy no-op call to self with 0 value
  // Replace protocol + callData with real DeFi once on mainnet + funded.
  // Using ZeroAddress + empty data often fails at call — use a harmless self-call pattern:
  // We pass protocol = registry address with empty data only if rails allow amount 0.
  console.log("Executing through AgentExecutor (compliant path)…");

  // Prefer a zero-value call that won't brick: checkRails with amount 0 first
  const zeroCheck = await client.checkRails({
    agentId: agentId!,
    amountUSD: 0,
    slippageBps: 0,
    protocol: REGISTRY,
  });
  console.log("zero-value rails:", zeroCheck);

  if (!zeroCheck.allowed) {
    console.log("Rails blocked even zero-value — agent may be Pending/Suspended");
    return;
  }

  try {
    // Empty call to registry (view-like, may revert on receive) — better: skip real call on testnet
    // For testnet demo we use execute with empty callData to a contract that accepts empty calls.
    // AgentExecutor does protocol.call(callData) — empty call to EOA fails.
    // Use REGISTRY which is a contract; empty calldata hits fallback and may revert.
    // Safest demo: document that real callData is required.
    // We'll build a pure approve(0) against a known token if TOKEN_ADDRESS set.
    const token = process.env.DEMO_TOKEN;
    if (token) {
      const callData = ERC20_IFACE.encodeFunctionData("approve", [
        EXECUTOR,
        parseUnits("0", 6),
      ]);
      const result = await client.execute({
        agentId: agentId!,
        protocol: token,
        token,
        tokenAmount: 0n,
        callData,
        slippageBps: 50,
        reasoning: "custom-agent demo approve(0)",
      });
      console.log("execute result:", result);
    } else {
      console.log(
        "Set DEMO_TOKEN=0x… (ERC20) to send a real execute(). Rails path verified via checkRails."
      );
      console.log("Your agent is published as:", agentId);
      console.log("Compliant integration: ALWAYS client.execute({ agentId, protocol, callData, ... })");
    }
  } catch (e: any) {
    console.error("execute failed:", e.shortMessage || e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
