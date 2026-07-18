/**
 * AgentForge Indexer + API — production-oriented backend
 * Chain is source of truth. SQLite is a hot cache for the UI.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { JsonRpcProvider, Contract, parseEther, formatEther, isAddress, ZeroAddress } = require("ethers");
const Database = require("better-sqlite3");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT ?? 4000);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? process.env.REACT_APP_CHAIN_ID ?? 84532);
const NETWORK_NAME = CHAIN_ID === 8453 ? "Base" : "Base Sepolia";
const EXPLORER =
  CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";

app.use(cors({ origin: process.env.DASHBOARD_URL ?? "*" }));
app.use(express.json({ limit: "1mb" }));

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH ?? "./agentforge.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner TEXT, name TEXT, status INTEGER,
    safety_level INTEGER, audit_score INTEGER,
    reputation INTEGER, total_tx_count INTEGER,
    total_volume_usd REAL, registered_at INTEGER,
    last_audit_at INTEGER, kyc_verified INTEGER,
    capabilities TEXT, chain TEXT,
    metadata_uri TEXT, model_hash TEXT, code_hash TEXT
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
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tx_agent ON transactions(agent_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions(timestamp);
`);

// migrate columns if older DB
try { db.exec("ALTER TABLE agents ADD COLUMN metadata_uri TEXT"); } catch {}
try { db.exec("ALTER TABLE agents ADD COLUMN model_hash TEXT"); } catch {}
try { db.exec("ALTER TABLE agents ADD COLUMN code_hash TEXT"); } catch {}

const upsertAgent = db.prepare(`
  INSERT INTO agents (
    id, owner, name, status, safety_level, audit_score, reputation,
    total_tx_count, total_volume_usd, registered_at, last_audit_at,
    kyc_verified, capabilities, chain, metadata_uri, model_hash, code_hash
  ) VALUES (
    @id, @owner, @name, @status, @safety_level, @audit_score, @reputation,
    @total_tx_count, @total_volume_usd, @registered_at, @last_audit_at,
    @kyc_verified, @capabilities, @chain, @metadata_uri, @model_hash, @code_hash
  )
  ON CONFLICT(id) DO UPDATE SET
    owner=excluded.owner,
    name=excluded.name,
    status=excluded.status,
    safety_level=excluded.safety_level,
    audit_score=excluded.audit_score,
    reputation=excluded.reputation,
    total_tx_count=excluded.total_tx_count,
    total_volume_usd=excluded.total_volume_usd,
    registered_at=excluded.registered_at,
    last_audit_at=excluded.last_audit_at,
    kyc_verified=excluded.kyc_verified,
    capabilities=excluded.capabilities,
    metadata_uri=excluded.metadata_uri,
    model_hash=excluded.model_hash,
    code_hash=excluded.code_hash
`);

// ─── Chain ────────────────────────────────────────────────────────────────────
const provider = new JsonRpcProvider(process.env.BASE_RPC_URL ?? "https://sepolia.base.org");

const REGISTRY_ABI = [
  "event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 modelHash)",
  "event AgentStatusChanged(bytes32 indexed agentId, uint8 oldStatus, uint8 newStatus)",
  "event AgentAudited(bytes32 indexed agentId, address indexed auditor, uint8 score, bool passed)",
  "event TxExecuted(bytes32 indexed agentId, address indexed protocol, uint256 amountUSD)",
  "event TxBlocked(bytes32 indexed agentId, string reason)",
  "event ReputationUpdated(bytes32 indexed agentId, uint256 oldScore, uint256 newScore)",
  "function getAgent(bytes32 agentId) view returns (tuple(address owner, bytes32 modelHash, bytes32 codeHash, string[] capabilities, uint8 safetyLevel, uint8 status, uint256 registeredAt, uint256 lastAuditAt, uint256 auditScore, address auditor, uint256 totalTxCount, uint256 totalVolumeUSD, uint256 reputationScore, bool kycVerified, address executor, uint256 lastActivityAt, string metadataURI))",
  "function getAllAgentIds() view returns (bytes32[])",
  "function totalAgents() view returns (uint256)",
  "function checkTx(bytes32 agentId, address protocol, address token, uint256 amountUSD, uint256 slippageBps) view returns (bool allowed, string reason)",
  "function safetyRails(bytes32 agentId) view returns (uint256 maxSingleTxUSD, uint256 maxDailyVolumeUSD, uint256 maxSlippageBps, bool requiresMultisig, uint256 multisigThresholdUSD, uint256 cooldownPeriod)",
  "function registrationFee() view returns (uint256)",
];

const COMMERCE_ABI = [
  "event ListingCreated(bytes32 indexed listingId, bytes32 indexed agentId, uint8 serviceType)",
  "event OrderCreated(bytes32 indexed orderId, bytes32 indexed listingId, bytes32 indexed buyerAgentId)",
  "event OrderConfirmed(bytes32 indexed orderId)",
];

let registry = null;
let commerce = null;
let indexerRunning = false;
let lastSyncAt = 0;
let lastBlockSeen = 0;
let chainAgentCount = 0;

function initContracts() {
  const regAddr = process.env.REGISTRY_ADDRESS;
  const comAddr = process.env.COMMERCE_ADDRESS;
  if (regAddr && regAddr !== ZeroAddress) {
    registry = new Contract(regAddr, REGISTRY_ABI, provider);
    console.log("[Server] Registry:", regAddr);
  }
  if (comAddr && comAddr !== ZeroAddress) {
    commerce = new Contract(comAddr, COMMERCE_ABI, provider);
    console.log("[Server] Commerce:", comAddr);
  }
}

function nameFromMetadata(uri, agentId) {
  if (!uri) return `Agent-${String(agentId).slice(2, 10)}`;
  try {
    // ipfs://agentforge/Name%20Here or plain name
    const raw = String(uri);
    if (raw.includes("agentforge/")) {
      const part = raw.split("agentforge/").pop();
      return decodeURIComponent(part || "") || `Agent-${String(agentId).slice(2, 10)}`;
    }
    if (raw.startsWith("name:")) return raw.slice(5);
    return raw.length < 48 ? raw : `Agent-${String(agentId).slice(2, 10)}`;
  } catch {
    return `Agent-${String(agentId).slice(2, 10)}`;
  }
}

function agentRowFromChain(agentId, agent) {
  const id = String(agentId);
  return {
    id,
    owner: agent.owner,
    name: nameFromMetadata(agent.metadataURI, id),
    status: Number(agent.status),
    safety_level: Number(agent.safetyLevel),
    audit_score: Number(agent.auditScore),
    reputation: Number(agent.reputationScore),
    total_tx_count: Number(agent.totalTxCount),
    total_volume_usd: Number(agent.totalVolumeUSD) / 1e18,
    registered_at: Number(agent.registeredAt) * 1000,
    last_audit_at: Number(agent.lastAuditAt) * 1000,
    kyc_verified: agent.kycVerified ? 1 : 0,
    capabilities: JSON.stringify(agent.capabilities ?? []),
    chain: CHAIN_ID === 8453 ? "base" : "base-sepolia",
    metadata_uri: agent.metadataURI ?? "",
    model_hash: agent.modelHash ?? "",
    code_hash: agent.codeHash ?? "",
  };
}

async function pullAgent(agentId) {
  if (!registry) return null;
  const agent = await registry.getAgent(agentId);
  if (!agent || !agent.owner || agent.owner === ZeroAddress) return null;
  if (Number(agent.registeredAt) === 0) return null;
  const row = agentRowFromChain(agentId, agent);
  upsertAgent.run(row);
  return row;
}

async function bootstrapFromChain() {
  if (!registry) return;
  console.log("[Sync] Bootstrapping agents from chain…");
  try {
    const total = Number(await registry.totalAgents());
    chainAgentCount = total;
    console.log(`[Sync] totalAgents on-chain: ${total}`);
    let ids = [];
    try {
      ids = await registry.getAllAgentIds();
    } catch {
      // fallback if array getter fails
      ids = [];
    }
    for (let i = 0; i < ids.length; i++) {
      try {
        await pullAgent(ids[i]);
      } catch (e) {
        console.warn(`[Sync] agent ${i} failed:`, String(e).slice(0, 120));
      }
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 50));
    }
    lastSyncAt = Date.now();
    console.log(`[Sync] Bootstrap complete — ${ids.length} agents cached`);
  } catch (e) {
    console.error("[Sync] Bootstrap error:", e.message || e);
  }
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function _updateDailyStats(delta) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare("SELECT * FROM daily_stats WHERE date=?").get(today);
  if (existing) {
    db.prepare(`UPDATE daily_stats SET
      total_volume_usd=total_volume_usd+?,
      total_txs=total_txs+?,
      blocked_txs=blocked_txs+?,
      new_agents=new_agents+?,
      audits_completed=audits_completed+?
      WHERE date=?`).run(
      delta.volume ?? 0,
      delta.txs ?? 0,
      delta.blockedTxs ?? 0,
      delta.newAgents ?? 0,
      delta.audits ?? 0,
      today
    );
  } else {
    const ac = db.prepare("SELECT COUNT(*) as c FROM agents").get().c;
    const act = db.prepare("SELECT COUNT(*) as c FROM agents WHERE status=1").get().c;
    db.prepare(`INSERT INTO daily_stats VALUES (?,?,?,?,?,?,?,?)`).run(
      today,
      ac,
      act,
      delta.volume ?? 0,
      delta.txs ?? 0,
      delta.blockedTxs ?? 0,
      delta.newAgents ?? 0,
      delta.audits ?? 0
    );
  }
}

async function startEventIndexer() {
  if (!registry || indexerRunning) return;
  indexerRunning = true;
  console.log("[Indexer] Live subscriptions…");

  registry.on("AgentRegistered", async (agentId, owner) => {
    console.log(`[Indexer] AgentRegistered ${String(agentId).slice(0, 14)}…`);
    try {
      const row = await pullAgent(agentId);
      broadcast("AgentRegistered", { agentId, owner, name: row?.name, ts: Date.now() });
    } catch {
      broadcast("AgentRegistered", { agentId, owner, ts: Date.now() });
    }
    chainAgentCount += 1;
    _updateDailyStats({ newAgents: 1 });
  });

  registry.on("TxExecuted", (agentId, protocol, amountUSD, event) => {
    const usd = Number(amountUSD) / 1e18;
    db.prepare(
      `INSERT INTO transactions (agent_id,protocol,amount_usd,success,blocked,timestamp,block_number) VALUES (?,?,?,1,0,?,?)`
    ).run(agentId, protocol, usd, Date.now(), event?.log?.blockNumber ?? 0);
    db.prepare(
      `UPDATE agents SET total_tx_count=total_tx_count+1, total_volume_usd=total_volume_usd+? WHERE id=?`
    ).run(usd, agentId);
    broadcast("TxExecuted", { agentId, protocol, amountUSD: usd, ts: Date.now() });
    _updateDailyStats({ volume: usd, txs: 1 });
  });

  registry.on("TxBlocked", (agentId, reason, event) => {
    db.prepare(
      `INSERT INTO transactions (agent_id,amount_usd,success,blocked,block_reason,timestamp,block_number) VALUES (?,0,0,1,?,?,?)`
    ).run(agentId, reason, Date.now(), event?.log?.blockNumber ?? 0);
    broadcast("TxBlocked", { agentId, reason, ts: Date.now() });
    _updateDailyStats({ blockedTxs: 1 });
  });

  registry.on("AgentStatusChanged", async (agentId, oldStatus, newStatus) => {
    db.prepare(`UPDATE agents SET status=? WHERE id=?`).run(Number(newStatus), agentId);
    try { await pullAgent(agentId); } catch {}
    broadcast("AgentStatusChanged", {
      agentId,
      oldStatus: Number(oldStatus),
      newStatus: Number(newStatus),
      ts: Date.now(),
    });
  });

  registry.on("AgentAudited", async (agentId, auditor, score, passed) => {
    db.prepare(
      `INSERT INTO audits (agent_id,auditor,score,passed,timestamp) VALUES (?,?,?,?,?)`
    ).run(agentId, auditor, Number(score), passed ? 1 : 0, Date.now());
    db.prepare(`UPDATE agents SET audit_score=?, last_audit_at=? WHERE id=?`).run(
      Number(score),
      Date.now(),
      agentId
    );
    try { await pullAgent(agentId); } catch {}
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
  }

  provider.on("block", (blockNumber) => {
    lastBlockSeen = blockNumber;
    broadcast("NewBlock", { blockNumber, ts: Date.now() });
  });
}

// ─── REST ─────────────────────────────────────────────────────────────────────

app.get("/health", async (req, res) => {
  let block = lastBlockSeen;
  try {
    if (!block) block = await provider.getBlockNumber();
  } catch {}
  res.json({
    status: "ok",
    service: "agentforge-indexer",
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
    registry: !!registry,
    commerce: !!commerce,
    lastSyncAt,
    lastBlockSeen: block,
    chainAgentCount,
    ts: Date.now(),
  });
});

app.get("/api/protocol", async (req, res) => {
  let fee = null;
  let total = chainAgentCount;
  try {
    if (registry) {
      fee = formatEther(await registry.registrationFee());
      total = Number(await registry.totalAgents());
      chainAgentCount = total;
    }
  } catch {}

  res.json({
    name: "AgentForge",
    tagline: "The trust layer for autonomous crypto agents",
    version: "3.0.0",
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    thesis: [
      "Agents will move capital without humans in the loop.",
      "Without identity, limits, and auditability, that is chaos.",
      "AgentForge makes every agent accountable on-chain.",
    ],
    pillars: [
      { id: "identity", title: "Identity", body: "Every agent gets a permanent on-chain ID, owner, model hash, and capability set." },
      { id: "rails", title: "Safety rails", body: "Max single tx, daily volume, slippage, cooldowns — enforced before execution." },
      { id: "audit", title: "Audit & reputation", body: "Auditors score agents. Failures slash reputation. Trust becomes measurable." },
      { id: "execution", title: "Gated execution", body: "AgentExecutor is the choke point: no rail pass, no transaction." },
    ],
    contracts: {
      registry: process.env.REGISTRY_ADDRESS ?? null,
      vault: process.env.VAULT_ADDRESS ?? null,
      commerce: process.env.COMMERCE_ADDRESS ?? null,
      executor: process.env.EXECUTOR_ADDRESS ?? null,
    },
    registrationFeeEth: fee,
    totalAgents: total,
    links: {
      dashboard: process.env.DASHBOARD_URL ?? null,
      github: "https://github.com/brypto2001/agentforge-protocol",
      health: "/health",
    },
    ts: Date.now(),
  });
});

app.get("/api/stats", async (req, res) => {
  try {
    const agents = db.prepare("SELECT COUNT(*) as total FROM agents").get();
    const active = db.prepare("SELECT COUNT(*) as c FROM agents WHERE status=1").get();
    const volume = db.prepare("SELECT SUM(amount_usd) as v FROM transactions WHERE success=1").get();
    const txs = db.prepare("SELECT COUNT(*) as c FROM transactions").get();
    const blocked = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE blocked=1").get();
    const audits = db.prepare("SELECT COUNT(*) as c FROM audits").get();

    let chainTotal = agents.total;
    if (registry) {
      try {
        chainTotal = Number(await registry.totalAgents());
        chainAgentCount = chainTotal;
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
      network: NETWORK_NAME,
      chainId: CHAIN_ID,
      lastSyncAt,
      syncedAt: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/agents", async (req, res) => {
  try {
    // soft refresh if empty but chain has agents
    const localCount = db.prepare("SELECT COUNT(*) as c FROM agents").get().c;
    if (localCount === 0 && registry) {
      await bootstrapFromChain();
    }

    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const status = req.query.status;

    let query = "SELECT * FROM agents";
    const params = [];
    if (status !== undefined && status !== "" && status !== "all") {
      query += " WHERE status=?";
      params.push(Number(status));
    }
    query += " ORDER BY registered_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const agents = db.prepare(query).all(...params);
    const totalRow = db
      .prepare(
        "SELECT COUNT(*) as c FROM agents" +
          (status !== undefined && status !== "" && status !== "all" ? " WHERE status=?" : "")
      )
      .get(
        ...(status !== undefined && status !== "" && status !== "all" ? [Number(status)] : [])
      );

    res.json({ agents, total: totalRow.c, limit, offset });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/agents/:id", async (req, res) => {
  try {
    let local = db.prepare("SELECT * FROM agents WHERE id=?").get(req.params.id);
    let chainData = null;
    let rails = null;

    if (registry) {
      try {
        const agent = await registry.getAgent(req.params.id);
        local = agentRowFromChain(req.params.id, agent);
        upsertAgent.run(local);
        chainData = {
          status: Number(agent.status),
          reputation: Number(agent.reputationScore),
          totalTxCount: Number(agent.totalTxCount),
          totalVolumeUSD: Number(agent.totalVolumeUSD) / 1e18,
          auditScore: Number(agent.auditScore),
          kycVerified: agent.kycVerified,
          metadataURI: agent.metadataURI,
          executor: agent.executor,
          lastActivityAt: Number(agent.lastActivityAt) * 1000,
        };
        try {
          const r = await registry.safetyRails(req.params.id);
          // mapping getter may not return arrays — handle both
          rails = {
            maxSingleTxUSD: Number(r.maxSingleTxUSD ?? r[0]) / 1e18,
            maxDailyVolumeUSD: Number(r.maxDailyVolumeUSD ?? r[1]) / 1e18,
            maxSlippageBps: Number(r.maxSlippageBps ?? r[2]),
            requiresMultisig: Boolean(r.requiresMultisig ?? r[3]),
            multisigThresholdUSD: Number(r.multisigThresholdUSD ?? r[4]) / 1e18,
            cooldownPeriod: Number(r.cooldownPeriod ?? r[5]),
          };
        } catch {}
      } catch {}
    }

    const txs = db
      .prepare("SELECT * FROM transactions WHERE agent_id=? ORDER BY timestamp DESC LIMIT 50")
      .all(req.params.id);
    const audits = db
      .prepare("SELECT * FROM audits WHERE agent_id=? ORDER BY timestamp DESC")
      .all(req.params.id);

    res.json({ agent: local, chainData, rails, transactions: txs, audits });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * Rails Lab — the legendary product demo
 * POST { agentId, protocol, token, amountUSD, slippageBps }
 * Calls on-chain checkTx (truth).
 */
app.post("/api/rails/check", async (req, res) => {
  try {
    if (!registry) return res.status(503).json({ error: "Registry not connected" });
    const {
      agentId,
      protocol = ZeroAddress,
      token = ZeroAddress,
      amountUSD = 1000,
      slippageBps = 50,
    } = req.body || {};

    if (!agentId || String(agentId).length < 10) {
      return res.status(400).json({ error: "agentId required" });
    }

    // amountUSD in human dollars → 1e18 fixed point used by contract rails
    const amountFixed = parseEther(String(amountUSD));
    const proto = isAddress(protocol) ? protocol : ZeroAddress;
    const tok = isAddress(token) ? token : ZeroAddress;

    const [allowed, reason] = await registry.checkTx(
      agentId,
      proto,
      tok,
      amountFixed,
      BigInt(slippageBps)
    );

    let agent = db.prepare("SELECT * FROM agents WHERE id=?").get(agentId);
    if (!agent) {
      try { agent = await pullAgent(agentId); } catch {}
    }

    res.json({
      allowed: Boolean(allowed),
      reason: reason || (allowed ? "Within safety rails" : "Blocked"),
      input: {
        agentId,
        protocol: proto,
        token: tok,
        amountUSD: Number(amountUSD),
        slippageBps: Number(slippageBps),
      },
      agent: agent
        ? {
            name: agent.name,
            status: agent.status,
            statusLabel: ["Pending", "Active", "Suspended", "Deprecated"][agent.status] ?? "Unknown",
            safety_level: agent.safety_level,
          }
        : null,
      verdict: allowed ? "ALLOW" : "BLOCK",
      ts: Date.now(),
    });
  } catch (e) {
    res.status(500).json({
      error: e.shortMessage || e.message || String(e),
      allowed: false,
      reason: "checkTx failed — agent may not exist or RPC error",
    });
  }
});

/** Offline rail simulator (no chain) — pure policy demo for empty state */
app.post("/api/rails/simulate", (req, res) => {
  const {
    status = 1,
    maxSingleTxUSD = 10000,
    maxDailyVolumeUSD = 100000,
    maxSlippageBps = 100,
    amountUSD = 1000,
    slippageBps = 50,
    dailyUsedUSD = 0,
  } = req.body || {};

  const checks = [];
  let allowed = true;
  let reason = "Within safety rails";

  if (Number(status) !== 1) {
    allowed = false;
    reason = "Agent not active";
    checks.push({ rule: "status == Active", pass: false, detail: `status=${status}` });
  } else {
    checks.push({ rule: "status == Active", pass: true, detail: "Active" });
  }

  if (Number(amountUSD) > Number(maxSingleTxUSD)) {
    allowed = false;
    reason = "Exceeds single tx limit";
    checks.push({
      rule: "amount <= maxSingleTx",
      pass: false,
      detail: `${amountUSD} > ${maxSingleTxUSD}`,
    });
  } else {
    checks.push({
      rule: "amount <= maxSingleTx",
      pass: true,
      detail: `${amountUSD} ≤ ${maxSingleTxUSD}`,
    });
  }

  if (Number(dailyUsedUSD) + Number(amountUSD) > Number(maxDailyVolumeUSD)) {
    allowed = false;
    reason = "Exceeds daily volume limit";
    checks.push({
      rule: "daily volume",
      pass: false,
      detail: `${dailyUsedUSD}+${amountUSD} > ${maxDailyVolumeUSD}`,
    });
  } else {
    checks.push({
      rule: "daily volume",
      pass: true,
      detail: `${Number(dailyUsedUSD) + Number(amountUSD)} ≤ ${maxDailyVolumeUSD}`,
    });
  }

  if (Number(slippageBps) > Number(maxSlippageBps)) {
    allowed = false;
    reason = "Slippage too high";
    checks.push({
      rule: "slippage",
      pass: false,
      detail: `${slippageBps}bps > ${maxSlippageBps}bps`,
    });
  } else {
    checks.push({
      rule: "slippage",
      pass: true,
      detail: `${slippageBps}bps ≤ ${maxSlippageBps}bps`,
    });
  }

  res.json({
    allowed,
    reason: allowed ? "Within safety rails" : reason,
    verdict: allowed ? "ALLOW" : "BLOCK",
    checks,
    mode: "simulate",
    ts: Date.now(),
  });
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
    lastBlockSeen = block;
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

app.post("/api/sync", async (req, res) => {
  try {
    await bootstrapFromChain();
    res.json({ ok: true, lastSyncAt, agents: db.prepare("SELECT COUNT(*) as c FROM agents").get().c });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  const stats = db.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 1").get();
  ws.send(
    JSON.stringify({
      type: "Connected",
      data: { stats, network: NETWORK_NAME, chainId: CHAIN_ID, ts: Date.now() },
    })
  );
  ws.on("close", () => console.log("[WS] Client disconnected"));
  ws.on("error", (e) => console.error("[WS] Error:", e.message));
});

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   AgentForge — Legendary Indexer v2      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Network: ${NETWORK_NAME} (${CHAIN_ID})`);

  initContracts();
  await bootstrapFromChain();
  await startEventIndexer();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] API  http://0.0.0.0:${PORT}`);
    console.log(`[Server] WS   ws://0.0.0.0:${PORT}`);
    console.log(`[Server] Lab  POST /api/rails/check | /api/rails/simulate`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
