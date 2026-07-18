/**
 * Autonomous trader — trades ONLY through AgentExecutor → DemoMarket
 *
 * Env:
 *   PRIVATE_KEY, BASE_RPC_URL
 *   REGISTRY_ADDRESS, EXECUTOR_ADDRESS, DEMO_MARKET_ADDRESS
 *   AGENT_ID (optional — uses first Active agent owned by wallet)
 *   STRATEGY=yield|arb|custom
 *   LOOP_MS=60000
 *   MAX_NOTIONAL=200   (USD per trade, must be within rails)
 */
import "dotenv/config";
import { Contract, Interface, JsonRpcProvider, Wallet, parseEther, formatEther } from "ethers";
import { AgentForgeClient } from "../agentforge-client";

const LOOP = parseInt(process.env.LOOP_MS || "45000", 10);
const MAX = parseFloat(process.env.MAX_NOTIONAL || "150");
const STRATEGY = process.env.STRATEGY || "custom";

const MARKET_IFACE = new Interface([
  "function trade(bytes32 agentId,uint256 amountUSD,string strategy) returns (bool)",
]);

async function pickAgent(client: AgentForgeClient, me: string): Promise<string> {
  if (process.env.AGENT_ID) return process.env.AGENT_ID;
  const ids: string[] = await (client.registry as any).getAllAgentIds();
  for (let i = ids.length - 1; i >= 0; i--) {
    const a = await client.getAgent(ids[i]);
    if (a.owner.toLowerCase() === me.toLowerCase() && a.status === 1) {
      return ids[i];
    }
  }
  throw new Error("No Active agent for this wallet — run platform-bootstrap.js");
}

async function main() {
  const registry = process.env.REGISTRY_ADDRESS!;
  const executor = process.env.EXECUTOR_ADDRESS!;
  const market = process.env.DEMO_MARKET_ADDRESS!;
  const key = process.env.PRIVATE_KEY!;
  const rpc = process.env.BASE_RPC_URL || "https://sepolia.base.org";

  if (!registry || !executor || !market || !key) {
    throw new Error("REGISTRY_ADDRESS, EXECUTOR_ADDRESS, DEMO_MARKET_ADDRESS, PRIVATE_KEY required");
  }

  const client = new AgentForgeClient({
    privateKey: key,
    rpcUrl: rpc,
    registryAddress: registry,
    executorAddress: executor,
  });
  const me = await client.getAddress();
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Autonomous Trader (rail-gated)          ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Operator:", me);
  console.log("Market:  ", market);
  console.log("Strategy:", STRATEGY, "| max $", MAX, "| loop", LOOP / 1000, "s");

  if (!(await client.hasExecutorRole(me))) {
    console.log("Granting EXECUTOR_ROLE…");
    try {
      console.log(await client.grantExecutorRole(me));
    } catch (e: any) {
      console.error("Need admin key for EXECUTOR_ROLE:", e.shortMessage || e.message);
      process.exit(1);
    }
  }

  const agentId = await pickAgent(client, me);
  const agent = await client.getAgent(agentId);
  console.log("Agent:", agentId, "|", agent.statusLabel, "| rep", agent.reputation);

  let cycle = 0;
  const run = async () => {
    cycle++;
    // Random notional within max (sometimes try breach for demo)
    const breach = cycle % 7 === 0;
    const amount = breach ? MAX * 50 : Math.max(10, Math.round(Math.random() * MAX));

    console.log(`\n── Cycle ${cycle} ${new Date().toISOString()} ──`);
    console.log(`Intent: $${amount} ${breach ? "(intentional breach probe)" : ""}`);

    const rails = await client.checkRails({
      agentId,
      protocol: market,
      token: market,
      amountUSD: amount,
      slippageBps: 50,
    });
    console.log("Rails:", rails.allowed ? "ALLOW" : "BLOCK", "—", rails.reason);

    if (!rails.allowed) {
      console.log("Skipping execute (rails blocked). This is the product working.");
      return;
    }

    const amountWei = parseEther(String(amount));
    const callData = MARKET_IFACE.encodeFunctionData("trade", [agentId, amountWei, STRATEGY]);

    try {
      const result = await client.execute({
        agentId,
        protocol: market,
        token: market,
        tokenAmount: amountWei,
        callData,
        slippageBps: 50,
        reasoning: `auto:${STRATEGY}:$${amount}`,
      });
      console.log("Executed:", result.success ? "OK" : "FAIL", result.txHash);
    } catch (e: any) {
      console.error("Execute error:", e.shortMessage || e.message);
    }
  };

  await run();
  setInterval(() => {
    run().catch((e) => console.error(e));
  }, LOOP);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
