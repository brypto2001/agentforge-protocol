/**
 * agent-runner.ts
 * Boots the correct agent strategy based on AGENT_TYPE env var.
 * Handles graceful shutdown, metrics, and persistent state.
 */

import { YieldOptimizerAgent, ArbitrageAgent, DataOracleAgent } from "./strategies";
import http from "http";

const AGENT_TYPE   = process.env.AGENT_TYPE ?? "yield";
const PRIVATE_KEY  = process.env.PRIVATE_KEY ?? "";
const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? "9091");
const LOOP_MS      = parseInt(process.env.LOOP_INTERVAL_MS ?? "300000");

if (!PRIVATE_KEY || PRIVATE_KEY.length < 10) {
  console.error("❌ PRIVATE_KEY not set or invalid");
  process.exit(1);
}
if (!BASE_RPC_URL) {
  console.error("❌ BASE_RPC_URL not set");
  process.exit(1);
}

// ─── Boot agent ───────────────────────────────────────────────────────────────

let agent: YieldOptimizerAgent | ArbitrageAgent | DataOracleAgent;

console.log("╔══════════════════════════════════════════╗");
console.log(`║  AgentForge Runner — ${AGENT_TYPE.padEnd(18)}║`);
console.log("╚══════════════════════════════════════════╝");
console.log(`RPC: ${BASE_RPC_URL.slice(0, 50)}...`);
console.log(`Loop interval: ${LOOP_MS / 1000}s`);
console.log(`Metrics port: ${METRICS_PORT}`);

switch (AGENT_TYPE) {
  case "yield":
    agent = new YieldOptimizerAgent(
      PRIVATE_KEY,
      BASE_RPC_URL,
      parseInt(process.env.POSITION_USDC ?? "1000")
    );
    break;

  case "arbitrage":
    agent = new ArbitrageAgent(
      PRIVATE_KEY,
      BASE_RPC_URL,
      parseFloat(process.env.MIN_PROFIT_USD ?? "5")
    );
    break;

  case "oracle":
    agent = new DataOracleAgent(
      PRIVATE_KEY,
      BASE_RPC_URL,
      process.env.STORAGE_CONTRACT ?? "0x0000000000000000000000000000000000000000"
    );
    break;

  default:
    console.error(`❌ Unknown AGENT_TYPE: ${AGENT_TYPE}. Use: yield | arbitrage | oracle`);
    process.exit(1);
}

// ─── Metrics HTTP server ──────────────────────────────────────────────────────

const metricsServer = http.createServer((req, res) => {
  if (req.url === "/metrics" || req.url === "/health") {
    const stats = agent.getStats();
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", ...stats, ts: Date.now() }));
      return;
    }
    // Prometheus format
    const lines = [
      `# HELP agentforge_total_txs Total transactions executed`,
      `# TYPE agentforge_total_txs counter`,
      `agentforge_total_txs{agent="${stats.name}"} ${stats.totalTxs}`,
      `# HELP agentforge_success_txs Successful transactions`,
      `agentforge_success_txs{agent="${stats.name}"} ${stats.successTxs}`,
      `# HELP agentforge_failed_txs Failed transactions`,
      `agentforge_failed_txs{agent="${stats.name}"} ${stats.failedTxs}`,
      `# HELP agentforge_volume_usd Total volume in USD`,
      `agentforge_volume_usd{agent="${stats.name}"} ${stats.totalVolumeUSD}`,
      `# HELP agentforge_last_run_timestamp Last run unix timestamp`,
      `agentforge_last_run_timestamp{agent="${stats.name}"} ${stats.lastRunAt}`,
      `# HELP agentforge_uptime_seconds Process uptime`,
      `agentforge_uptime_seconds ${process.uptime()}`,
    ];
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(lines.join("\n"));
    return;
  }
  res.writeHead(404);
  res.end();
});

metricsServer.listen(METRICS_PORT, () => {
  console.log(`[Metrics] http://localhost:${METRICS_PORT}/metrics`);
  console.log(`[Health]  http://localhost:${METRICS_PORT}/health`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Runner] ${signal} received — shutting down gracefully...`);
  agent.stop();
  metricsServer.close(() => {
    console.log("[Runner] Metrics server closed");
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => { console.log("[Runner] Force exit"); process.exit(0); }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[Runner] Uncaught exception (continuing):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Runner] Unhandled rejection (continuing):", String(reason).slice(0, 200));
});

// ─── Start ────────────────────────────────────────────────────────────────────

agent.start(LOOP_MS).catch(err => {
  console.error("[Runner] Fatal agent error:", err);
  process.exit(1);
});
