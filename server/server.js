/**
 * server.js — production Express + WebSocket server (plain Node, no ts-node)
 * Bridges on-chain data to the dashboard in real-time.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { JsonRpcProvider, Contract } = require("ethers");
const Database = require("better-sqlite3");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: process.env.DASHBOARD_URL ?? "*" }));
app.use(express.json());

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH ?? "./agentforge.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner TEXT, name TEXT, status INTEGER,
    safety_level INTEGER, audit_score INTEGER,
    reputation INTEGER, total_tx_count INTEGER,
    total_volume_usd REAL, registered_at INTEGER,
    last_audit_at INTEGER, kyc_verified INTEGER,
    capabilities TEXT, chain TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT, tx_hash TEXT, protocol TEXT,
    amount_usd REAL, success INTEGER, blocked INTEGER,
    block_reason TEXT, reasoning TEXT,
    block_number INTEGER, timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT, auditor TEXT, score INTEGER,
    passed INTEGER, report_hash TEXT,
    findings TEXT, timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    total_agents INTEGER, active_agents INTEGER,
    total_volume_usd REAL, total_txs INTEGER,
    blocked_txs INTEGER, new_agents INTEGER,
    audits_completed INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tx_agent ON transactions(agent_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_tx_time  ON transactions(timestamp);
`);

// ─── Blockchain Connection ────────────────────────────────────────────────────
const provider = new JsonRpcProvider(process.env.BASE_RPC_URL ?? "https://sepolia.base.org");

const REGISTRY_ABI = [
  "event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 modelHash)",
  "event AgentStatusChanged(bytes32 indexed agentId, uint8 oldStatus, uint8 newStatus)",
  "event AgentAudited(bytes32 indexed agentId, address indexed auditor, uint8 score, bool passed)",
  "event TxExecuted(bytes32 indexed agentId, address indexed protocol, uint256 amountUSD)",
  "event TxBlocked(bytes32 indexed agentId, string reason)",
  "event ReputationUpdated(bytes32 indexed agentId, uint256 oldScore, uint256 newScore)",
  "function getAgent(bytes32 agentId) view returns (tuple(address owner, bytes32 modelHash, bytes32 codeHash, string[] capabilities, uint8 safetyLevel, uint8 status, uint256 registeredAt, uint256 lastAuditAt, uint256 auditScore, address auditor, uint256 totalTxCount, uint256 totalVolumeUSD, uint256 reputationScore, bool kycVerified))",
  "function getAllAgentIds() view returns (bytes32[])",
  "function totalAgents() view returns (uint256)",
];

const COMMERCE_ABI = [
  "event ListingCreated(bytes32 indexed listingId, bytes32 indexed agentId, uint8 serviceType)",
  "event OrderCreated(bytes32 indexed orderId, bytes32 indexed listingId, bytes32 indexed buyerAgentId)",
  "event OrderDelivered(bytes32 indexed orderId, bytes32 deliveryProofHash)",
  "event OrderConfirmed(bytes32 indexed orderId)",
  "function getListing(bytes32 listingId) view returns (tuple(bytes32 agentId, uint8 serviceType, string name, string description, address paymentToken, uint256 pricePerUnit, uint256 unitSize, uint256 minUnits, uint256 maxUnits, uint256 totalEarned, uint256 totalOrders, bool active, uint256 createdAt, bytes32 slaHash))",
];

let registry = null;
let commerce = null;
let indexerRunning = false;

function initContracts() {
  const regAddr = process.env.REGISTRY_ADDRESS;
  const comAddr = process.env.COMMERCE_ADDRESS;
  if (regAddr && regAddr !== "0x0000000000000000000000000000000000000000") {
    registry = new Contract(regAddr, REGISTRY_ABI, provider);
    console.log("[Server] Registry connected:", regAddr);
  }
  if (comAddr && comAddr !== "0x0000000000000000000000000000000000000000") {
    commerce = new Contract(comAddr, COMMERCE_ABI, provider);
    console.log("[Server] Commerce connected:", comAddr);
  }
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

async function startEventIndexer() {
  if (!registry || indexerRunning) return;
  indexerRunning = true;
  console.log("[Indexer] Starting live event subscription...");

  registry.on("AgentRegistered", async (agentId, owner) => {
    console.log(`[Indexer] AgentRegistered: ${String(agentId).slice(0, 12)}...`);
    try {
      const agent = await registry.getAgent(agentId);
      const row = {
        id: agentId,
        owner,
        name: `Agent-${String(agentId).slice(2, 10)}`,
        status: Number(agent.status),
        safety_level: Number(agent.safetyLevel),
        audit_score: Number(agent.auditScore),
        reputation: Number(agent.reputationScore),
        total_tx_count: 0,
        total_volume_usd: 0,
        registered_at: Date.now(),
        last_audit_at: 0,
        kyc_verified: agent.kycVerified ? 1 : 0,
        capabilities: JSON.stringify(agent.capabilities),
        chain: "base",
      };
      db.prepare(`INSERT OR REPLACE INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        ...Object.values(row)
      );
    } catch (e) {
      console.error("[Indexer] AgentRegistered error:", e);
    }

    broadcast("AgentRegistered", { agentId, owner, ts: Date.now() });
    _updateDailyStats({ newAgents: 1 });
  });

  registry.on("TxExecuted", (agentId, protocol, amountUSD, event) => {
    const usd = Number(amountUSD) / 1e18;
    console.log(`[Indexer] TxExecuted: ${String(agentId).slice(0, 12)} $${usd.toFixed(2)}`);

    db.prepare(
      `INSERT INTO transactions (agent_id,protocol,amount_usd,success,blocked,timestamp,block_number) VALUES (?,?,?,1,0,?,?)`
    ).run(agentId, protocol, usd, Date.now(), event?.log?.blockNumber ?? event?.blockNumber ?? 0);

    db.prepare(
      `UPDATE agents SET total_tx_count=total_tx_count+1, total_volume_usd=total_volume_usd+? WHERE id=?`
    ).run(usd, agentId);

    broadcast("TxExecuted", { agentId, protocol, amountUSD: usd, ts: Date.now() });
    _updateDailyStats({ volume: usd, txs: 1 });
  });

  registry.on("TxBlocked", (agentId, reason, event) => {
    console.log(`[Indexer] TxBlocked: ${String(agentId).slice(0, 12)} - ${reason}`);
    db.prepare(
      `INSERT INTO transactions (agent_id,amount_usd,success,blocked,block_reason,timestamp,block_number) VALUES (?,0,0,1,?,?,?)`
    ).run(agentId, reason, Date.now(), event?.log?.blockNumber ?? event?.blockNumber ?? 0);
    broadcast("TxBlocked", { agentId, reason, ts: Date.now() });
    _updateDailyStats({ blockedTxs: 1 });
  });

  registry.on("AgentStatusChanged", (agentId, oldStatus, newStatus) => {
    console.log(`[Indexer] Status: ${String(agentId).slice(0, 12)} ${oldStatus}->${newStatus}`);
    db.prepare(`UPDATE agents SET status=? WHERE id=?`).run(Number(newStatus), agentId);
    broadcast("AgentStatusChanged", {
      agentId,
      oldStatus: Number(oldStatus),
      newStatus: Number(newStatus),
      ts: Date.now(),
    });
  });

  registry.on("AgentAudited", (agentId, auditor, score, passed) => {
    console.log(`[Indexer] Audited: ${String(agentId).slice(0, 12)} score=${score} passed=${passed}`);
    db.prepare(`INSERT INTO audits (agent_id,auditor,score,passed,timestamp) VALUES (?,?,?,?,?)`).run(
      agentId,
      auditor,
      Number(score),
      passed ? 1 : 0,
      Date.now()
    );
    db.prepare(`UPDATE agents SET audit_score=?, last_audit_at=? WHERE id=?`).run(
      Number(score),
      Date.now(),
      agentId
    );
    broadcast("AgentAudited", {
      agentId,
      auditor,
      score: Number(score),
      passed,
      ts: Date.now(),
    });
    _updateDailyStats({ audits: 1 });
  });

  registry.on("ReputationUpdated", (agentId, oldScore, newScore) => {
    db.prepare(`UPDATE agents SET reputation=? WHERE id=?`).run(Number(newScore), agentId);
    broadcast("ReputationUpdated", {
      agentId,
      oldScore: Number(oldScore),
      newScore: Number(newScore),
      ts: Date.now(),
    });
  });

  if (commerce) {
    commerce.on("OrderCreated", (orderId, listingId, buyerAgentId) => {
      broadcast("OrderCreated", { orderId, listingId, buyerAgentId, ts: Date.now() });
    });
    commerce.on("OrderConfirmed", (orderId) => {
      broadcast("OrderConfirmed", { orderId, ts: Date.now() });
    });
  }

  provider.on("block", (blockNumber) => {
    broadcast("NewBlock", { blockNumber, ts: Date.now() });
  });
}

function _updateDailyStats(delta) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare("SELECT * FROM daily_stats WHERE date=?").get(today);
  if (existing) {
    db.prepare(
      `UPDATE daily_stats SET
      total_volume_usd=total_volume_usd+?,
      total_txs=total_txs+?,
      blocked_txs=blocked_txs+?,
      new_agents=new_agents+?,
      audits_completed=audits_completed+?
      WHERE date=?`
    ).run(
      delta.volume ?? 0,
      delta.txs ?? 0,
      delta.blockedTxs ?? 0,
      delta.newAgents ?? 0,
      delta.audits ?? 0,
      today
    );
  } else {
    db.prepare(`INSERT INTO daily_stats VALUES (?,0,0,?,?,?,?,?)`).run(
      today,
      delta.volume ?? 0,
      delta.txs ?? 0,
      delta.blockedTxs ?? 0,
      delta.newAgents ?? 0,
      delta.audits ?? 0
    );
  }
}

async function syncHistoricEvents(fromBlock) {
  if (!registry) return;
  console.log(`[Sync] Syncing from block ${fromBlock}...`);
  const current = await provider.getBlockNumber();
  const chunk = 2000;

  for (let from = fromBlock; from <= current; from += chunk) {
    const to = Math.min(from + chunk - 1, current);
    try {
      const regEvents = await registry.queryFilter(registry.filters, from, to);
      console.log(`[Sync] Blocks ${from}-${to}: ${regEvents.length} events`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      console.warn(`[Sync] Block range ${from}-${to} failed, skipping`);
    }
  }
  console.log("[Sync] Historic sync complete");
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: Date.now(), registry: !!registry, commerce: !!commerce });
});

app.get("/api/stats", async (req, res) => {
  try {
    const agents = db.prepare("SELECT COUNT(*) as total FROM agents").get();
    const active = db.prepare("SELECT COUNT(*) as c FROM agents WHERE status=1").get();
    const volume = db.prepare("SELECT SUM(amount_usd) as v FROM transactions WHERE success=1").get();
    const txs = db.prepare("SELECT COUNT(*) as c FROM transactions").get();
    const blocked = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE blocked=1").get();
    const audits = db.prepare("SELECT COUNT(*) as c FROM audits").get();

    let chainTotal = 0;
    if (registry) {
      try {
        chainTotal = Number(await registry.totalAgents());
      } catch {}
    }

    res.json({
      totalAgents: Math.max(agents.total, chainTotal),
      activeAgents: active.c,
      totalVolumeUSD: volume.v ?? 0,
      totalTransactions: txs.c,
      blockedTxs: blocked.c,
      blockRate: txs.c > 0 ? ((blocked.c / txs.c) * 100).toFixed(2) : "0",
      totalAudits: audits.c,
      syncedAt: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/agents", (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const status = req.query.status;

    let query = "SELECT * FROM agents";
    const params = [];
    if (status !== undefined) {
      query += " WHERE status=?";
      params.push(Number(status));
    }
    query += " ORDER BY total_volume_usd DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const agents = db.prepare(query).all(...params);
    const totalRow = db
      .prepare(
        "SELECT COUNT(*) as c FROM agents" + (status !== undefined ? " WHERE status=?" : "")
      )
      .get(...(status !== undefined ? [Number(status)] : []));

    res.json({ agents, total: totalRow.c, limit, offset });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/agents/:id", async (req, res) => {
  try {
    const local = db.prepare("SELECT * FROM agents WHERE id=?").get(req.params.id);

    let chainData = null;
    if (registry) {
      try {
        const agent = await registry.getAgent(req.params.id);
        chainData = {
          status: Number(agent.status),
          reputation: Number(agent.reputationScore),
          totalTxCount: Number(agent.totalTxCount),
          totalVolumeUSD: Number(agent.totalVolumeUSD) / 1e18,
          auditScore: Number(agent.auditScore),
          kycVerified: agent.kycVerified,
        };
      } catch {}
    }

    const txs = db
      .prepare("SELECT * FROM transactions WHERE agent_id=? ORDER BY timestamp DESC LIMIT 50")
      .all(req.params.id);
    const audits = db
      .prepare("SELECT * FROM audits WHERE agent_id=? ORDER BY timestamp DESC")
      .all(req.params.id);

    res.json({ agent: local, chainData, transactions: txs, audits });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/transactions", (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const txs = db.prepare("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?").all(limit);
    res.json({ transactions: txs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/stats/daily", (req, res) => {
  try {
    const days = Number(req.query.days ?? 30);
    const stats = db.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?").all(days);
    res.json({ stats: stats.reverse() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/gas", async (req, res) => {
  try {
    const feeData = await provider.getFeeData();
    res.json({
      gasPrice: Number(feeData.gasPrice ?? 0n) / 1e9,
      maxFee: Number(feeData.maxFeePerGas ?? 0n) / 1e9,
      priorityFee: Number(feeData.maxPriorityFeePerGas ?? 0n) / 1e9,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/block", async (req, res) => {
  try {
    const block = await provider.getBlockNumber();
    res.json({ blockNumber: block, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/audits", (req, res) => {
  try {
    const audits = db
      .prepare(
        "SELECT a.*, ag.name as agent_name FROM audits a LEFT JOIN agents ag ON a.agent_id=ag.id ORDER BY a.timestamp DESC LIMIT 100"
      )
      .all();
    res.json({ audits });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  const stats = db.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 1").get();
  ws.send(JSON.stringify({ type: "Connected", data: { stats, ts: Date.now() } }));
  ws.on("close", () => console.log("[WS] Client disconnected"));
  ws.on("error", (e) => console.error("[WS] Error:", e.message));
});

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║    AgentForge Backend Server Starting    ║");
  console.log("╚══════════════════════════════════════════╝");

  initContracts();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] REST API: http://0.0.0.0:${PORT}`);
    console.log(`[Server] WebSocket: ws://0.0.0.0:${PORT}`);
  });

  await startEventIndexer();

  const DEPLOY_BLOCK = Number(process.env.DEPLOY_BLOCK ?? 0);
  if (DEPLOY_BLOCK > 0 && registry) {
    syncHistoricEvents(DEPLOY_BLOCK).catch(console.error);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
