import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  BrowserProvider, Contract, keccak256, id,
  parseEther, ZeroHash, isAddress, toUtf8Bytes,
} from "ethers";
import {
  isMobile, getInjectedProvider, openInMetaMask, openInCoinbaseWallet,
  requestAccounts, ensureChain,
} from "./wallet.js";

// ─── Config ───────────────────────────────────────────────────────────────────
const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
const API_URL = env.REACT_APP_API_URL || env.VITE_API_URL || "http://localhost:4000";
const WS_URL  = env.REACT_APP_WS_URL  || env.VITE_WS_URL  || "ws://localhost:4000";
const REGISTRY_ADDRESS = env.REACT_APP_REGISTRY_ADDRESS || env.VITE_REGISTRY_ADDRESS || "";
const COMMERCE_ADDRESS = env.REACT_APP_COMMERCE_ADDRESS || env.VITE_COMMERCE_ADDRESS || "";
const VAULT_ADDRESS    = env.REACT_APP_VAULT_ADDRESS    || env.VITE_VAULT_ADDRESS || "";
const EXECUTOR_ADDRESS = env.REACT_APP_EXECUTOR_ADDRESS || env.VITE_EXECUTOR_ADDRESS || "";
const TARGET_CHAIN_ID  = Number(env.REACT_APP_CHAIN_ID || env.VITE_CHAIN_ID || 84532);
const TARGET_CHAIN_HEX = "0x" + TARGET_CHAIN_ID.toString(16);
const IS_SEPOLIA = TARGET_CHAIN_ID === 84532;
const EXPLORER = IS_SEPOLIA ? "https://sepolia.basescan.org" : "https://basescan.org";
const NETWORK_NAME = IS_SEPOLIA ? "Base Sepolia" : "Base";
const RPC_FALLBACK = IS_SEPOLIA ? "https://sepolia.base.org" : "https://mainnet.base.org";

const AUDITOR_ROLE = id("AUDITOR_ROLE");

const REGISTRY_ABI = [
  "function registerAgent(bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,(uint256 maxSingleTxUSD,uint256 maxDailyVolumeUSD,uint256 maxSlippageBps,address[] allowedProtocols,address[] allowedTokens,bool requiresMultisig,uint256 multisigThresholdUSD,uint256 cooldownPeriod) rails,string metadataURI,uint256 deadline,bytes signature) payable returns (bytes32)",
  "function nonces(address) view returns (uint256)",
  "function registrationFee() view returns (uint256)",
  "function submitAudit(bytes32 agentId,uint8 score,bytes32 reportHash,string[] findings,bool passed)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function totalAgents() view returns (uint256)",
];

// ─── API ──────────────────────────────────────────────────────────────────────
const api = {
  get: async (path) => {
    const r = await fetch(`${API_URL}${path}`);
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
  },
  post: async (path, body) => {
    const r = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `API ${path} failed: ${r.status}`);
    return data;
  },
};

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useWebSocket(url) {
  const [events, setEvents] = useState([]);
  const [connected, setConn] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setConn(true);
        if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setEvents((prev) => [msg, ...prev.slice(0, 199)]);
        } catch {}
      };
      ws.onclose = () => {
        setConn(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    } catch {
      reconnectRef.current = setTimeout(connect, 5000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { events, connected };
}

function useStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    try { setStats(await api.get("/api/stats")); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 15000);
    return () => clearInterval(id);
  }, [fetch_]);
  return { stats, loading, refetch: fetch_ };
}

function useAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    try {
      const data = await api.get("/api/agents");
      setAgents(data.agents ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch_(); }, [fetch_]);
  return { agents, loading, refetch: fetch_ };
}

function useDailyStats() {
  const [data, setData] = useState([]);
  useEffect(() => {
    api.get("/api/stats/daily?days=30").then((r) => setData(r.stats ?? [])).catch(() => {});
  }, []);
  return { data };
}

function useAudits() {
  const [audits, setAudits] = useState([]);
  useEffect(() => {
    api.get("/api/audits").then((r) => setAudits(r.audits ?? [])).catch(() => {});
  }, []);
  return { audits, setAudits };
}

function useGas() {
  const [gas, setGas] = useState(null);
  useEffect(() => {
    const f = () => api.get("/api/gas").then(setGas).catch(() => {});
    f();
    const id = setInterval(f, 12000);
    return () => clearInterval(id);
  }, []);
  return gas;
}

const CHAIN_PARAMS = {
  chainId: TARGET_CHAIN_HEX,
  chainName: NETWORK_NAME,
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [RPC_FALLBACK],
  blockExplorerUrls: [EXPLORER],
};

function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState("0");
  const [connecting, setConn] = useState(false);
  const [error, setError] = useState(null);
  const [isAuditor, setIsAuditor] = useState(false);
  const [needsWalletApp, setNeedsWalletApp] = useState(false);
  const providerRef = useRef(null);

  const getProvider = () => {
    const p = getInjectedProvider();
    providerRef.current = p;
    return p;
  };

  useEffect(() => {
    const eth = getProvider();
    if (!eth) {
      setNeedsWalletApp(isMobile());
      return;
    }
    setNeedsWalletApp(false);
    eth.request({ method: "eth_accounts" }).then((a) => { if (a[0]) setAccount(a[0]); }).catch(() => {});
    const onAcc = (a) => setAccount(a?.[0] ?? null);
    const onChain = (c) => setChainId(parseInt(c, 16));
    eth.on?.("accountsChanged", onAcc);
    eth.on?.("chainChanged", onChain);
    // EIP-6963: re-check when providers announce
    const onAnnounce = () => getProvider();
    window.addEventListener?.("eip6963:announceProvider", onAnnounce);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
      window.removeEventListener?.("eip6963:announceProvider", onAnnounce);
    };
  }, []);

  useEffect(() => {
    const eth = getProvider();
    if (!account || !eth) return;
    eth.request({ method: "eth_getBalance", params: [account, "latest"] })
      .then((b) => setBalance((parseInt(b, 16) / 1e18).toFixed(4))).catch(() => {});
    eth.request({ method: "eth_chainId" })
      .then((c) => setChainId(parseInt(c, 16))).catch(() => {});

    (async () => {
      try {
        if (!REGISTRY_ADDRESS) return;
        const provider = new BrowserProvider(eth);
        const c = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        setIsAuditor(await c.hasRole(AUDITOR_ROLE, account));
      } catch { setIsAuditor(false); }
    })();
  }, [account]);

  const switchNetwork = async () => {
    const eth = getProvider();
    if (!eth) throw new Error("No wallet provider");
    await ensureChain(eth, TARGET_CHAIN_HEX, CHAIN_PARAMS);
    const c = await eth.request({ method: "eth_chainId" });
    setChainId(parseInt(c, 16));
  };

  const connect = async () => {
    setError(null);
    const eth = getProvider();

    // Mobile browser without injected wallet → deep link into MetaMask
    if (!eth) {
      if (isMobile()) {
        setNeedsWalletApp(true);
        setError("Opening MetaMask… If nothing happens, install MetaMask and reopen this link inside the app.");
        openInMetaMask();
        return;
      }
      setError("No wallet found. Install MetaMask (desktop) or open this site inside MetaMask mobile.");
      return;
    }

    setConn(true);
    try {
      const accounts = await requestAccounts(eth);
      if (!accounts?.[0]) throw new Error("No account returned");
      setAccount(accounts[0]);
      try {
        await switchNetwork();
      } catch (ne) {
        // still connected; user can switch later
        console.warn("chain switch:", ne);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (e?.code === 4001) setError("Connection rejected");
      else setError(msg);
    } finally {
      setConn(false);
    }
  };

  return {
    account, chainId, balance, connecting, error, connect,
    disconnect: () => { setAccount(null); setError(null); },
    isBaseNetwork: chainId === TARGET_CHAIN_ID,
    switchNetwork, isAuditor, needsWalletApp,
    openMetaMask: openInMetaMask,
    openCoinbase: openInCoinbaseWallet,
    isMobile: isMobile(),
    getEthereum: getProvider,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtUSD = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};
const fmtAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmtTime = (ts) => {
  const s = (Date.now() - ts) / 1000;
  return s < 60 ? `${s | 0}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : `${(s / 3600) | 0}h ago`;
};
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const STATUS_LABEL = { 0: "Pending", 1: "Active", 2: "Suspended", 3: "Deprecated" };
const STATUS_COLOR = { 0: "#f59e0b", 1: "#10b981", 2: "#ef4444", 3: "#6b7280" };
const SAFETY_LABEL = { 0: "Minimal", 1: "Standard", 2: "Strict", 3: "Paranoid" };
const SAFETY_COLOR = { 0: "#f59e0b", 1: "#3b82f6", 2: "#8b5cf6", 3: "#10b981" };
const EVENT_COLOR = {
  AgentRegistered: "#3b82f6", TxExecuted: "#10b981", TxBlocked: "#ef4444",
  AgentAudited: "#a78bfa", AgentStatusChanged: "#f59e0b", ReputationUpdated: "#06b6d4",
  OrderCreated: "#f97316", NewBlock: "#1f2937", Connected: "#6b7280",
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;}
  ::-webkit-scrollbar{width:5px;height:5px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:rgba(99,102,241,0.35);border-radius:8px;}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  @keyframes glow{0%,100%{box-shadow:0 0 20px rgba(99,102,241,.25)}50%{box-shadow:0 0 36px rgba(139,92,246,.45)}}
  .glass{
    background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02));
    border:1px solid rgba(255,255,255,0.08);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    box-shadow:0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .glass-hover{transition:transform .2s ease, border-color .2s ease, box-shadow .2s ease;}
  .glass-hover:hover{
    transform:translateY(-2px);
    border-color:rgba(129,140,248,0.35)!important;
    box-shadow:0 12px 40px rgba(79,70,229,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .btn-primary{
    background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a855f7 100%);
    background-size:200% 200%;
    color:#fff;border:none;font-weight:600;cursor:pointer;
    box-shadow:0 4px 20px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.2);
    transition:transform .15s, box-shadow .15s, filter .15s;
  }
  .btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 8px 28px rgba(99,102,241,0.5);}
  .btn-primary:disabled{opacity:.45;cursor:not-allowed;transform:none;filter:none;}
  .btn-ghost{
    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
    color:#a5b4fc;cursor:pointer;transition:all .15s;
  }
  .btn-ghost:hover{background:rgba(99,102,241,0.12);border-color:rgba(129,140,248,0.35);}
  .mesh-bg{
    background:
      radial-gradient(ellipse 80% 60% at 10% -10%, rgba(99,102,241,0.28), transparent 55%),
      radial-gradient(ellipse 60% 50% at 90% 10%, rgba(168,85,247,0.2), transparent 50%),
      radial-gradient(ellipse 50% 40% at 50% 100%, rgba(16,185,129,0.08), transparent 50%),
      #05060f;
  }
  .shine-text{
    background:linear-gradient(90deg,#e0e7ff,#c4b5fd,#a5b4fc,#e0e7ff);
    background-size:200% auto;
    -webkit-background-clip:text;background-clip:text;color:transparent;
    animation:shimmer 6s linear infinite;
  }
  input,select,textarea{
    background:rgba(8,10,20,0.85)!important;color:#f1f5f9!important;
    border:1px solid rgba(255,255,255,0.1)!important;border-radius:10px!important;
    padding:10px 14px!important;font-size:13px!important;outline:none!important;font-family:inherit!important;
    transition:border-color .15s, box-shadow .15s;
  }
  input:focus,select:focus,textarea:focus{
    border-color:rgba(129,140,248,0.5)!important;
    box-shadow:0 0 0 3px rgba(99,102,241,0.15)!important;
  }
  input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);width:100%;}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#a855f7);cursor:pointer;box-shadow:0 0 10px rgba(99,102,241,.5);}
  button,a,.btn-primary,.btn-ghost{-webkit-tap-highlight-color:transparent;}
  .hide-mobile{display:flex;}
  .show-mobile{display:none!important;}
  .nav-tabs-desktop{display:flex;}
  .grid-stats{display:flex;gap:12px;flex-wrap:wrap;}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
  .rails-grid{display:grid;grid-template-columns:1.1fr 0.9fr;gap:16px;}
  .page-pad{padding:24px 20px 48px;max-width:1440px;margin:0 auto;}
  .nav-bar{padding:0 16px;height:60px;gap:10px;}
  .drawer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:200;backdrop-filter:blur(4px);}
  .drawer{
    position:fixed;top:0;right:0;bottom:0;width:min(320px,88vw);z-index:210;
    background:linear-gradient(180deg,#0c0e1a,#080a12);border-left:1px solid rgba(255,255,255,0.08);
    padding:20px 16px;display:flex;flex-direction:column;gap:8px;
    box-shadow:-12px 0 40px rgba(0,0,0,0.5);
  }
  .drawer button.tab{
    text-align:left;padding:14px 14px;border-radius:12px;border:none;font-size:14px;font-weight:600;
    background:transparent;color:#94a3b8;cursor:pointer;width:100%;
  }
  .drawer button.tab.active{background:rgba(99,102,241,0.18);color:#c4b5fd;}
  @media (max-width:900px){
    .hide-mobile{display:none!important;}
    .show-mobile{display:flex!important;}
    .nav-tabs-desktop{display:none!important;}
    .grid-2,.rails-grid,.grid-3,.grid-4{grid-template-columns:1fr!important;}
    .page-pad{padding:16px 12px 100px;}
    .nav-bar{padding:0 12px;height:56px;}
    .stat-card-title{font-size:10px!important;}
    .hero-title{font-size:22px!important;}
    .agent-side{display:none!important;}
    .agent-side.open-mobile{
      display:block!important;position:fixed;inset:0;z-index:180;width:100%!important;
      height:100%!important;top:0!important;border-radius:0!important;
      background:#080a12!important;
    }
  }
  @media (max-width:480px){
    .grid-stats{flex-direction:column;}
    .grid-stats > *{min-width:100%!important;}
  }
`;

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner({ size = 20 }) {
  return (
    <div style={{
      width: size, height: size, border: "2px solid rgba(99,102,241,0.3)",
      borderTopColor: "#818cf8", borderRadius: "50%",
      animation: "spin .7s linear infinite", margin: "0 auto",
    }} />
  );
}

function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 10, padding: "3px 9px", borderRadius: 999,
      background: `${color}18`, border: `1px solid ${color}40`,
      color, fontWeight: 600, letterSpacing: "0.02em",
    }}>{label}</span>
  );
}

function StatCard({ label, value, sub, color = "#10b981", loading }) {
  return (
    <div className="glass glass-hover" style={{
      borderRadius: 16, padding: "16px 16px", flex: 1, minWidth: 130, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}22, transparent 70%)`, pointerEvents: "none",
      }} />
      <div className="stat-card-title" style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 500 }}>{label}</div>
      {loading ? <Spinner /> : (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

function EmptyState({ title, body, action }) {
  return (
    <div className="glass" style={{
      borderRadius: 20, padding: "48px 32px", textAlign: "center",
      border: "1px dashed rgba(129,140,248,0.25)",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, margin: "0 auto 16px",
        background: "linear-gradient(135deg,rgba(99,102,241,0.3),rgba(168,85,247,0.2))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 24, animation: "float 3s ease-in-out infinite",
      }}>⬡</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#64748b", maxWidth: 360, margin: "0 auto 18px", lineHeight: 1.5 }}>{body}</div>
      {action}
    </div>
  );
}

function AgentRow({ agent, onClick, selected }) {
  const caps = (() => { try { return JSON.parse(agent.capabilities || "[]"); } catch { return []; } })();
  return (
    <div className="glass glass-hover" onClick={onClick} style={{
      borderRadius: 14, padding: "14px 16px", cursor: "pointer",
      border: selected ? "1px solid rgba(129,140,248,0.5)" : "1px solid rgba(255,255,255,0.08)",
      background: selected
        ? "linear-gradient(145deg,rgba(99,102,241,0.15),rgba(255,255,255,0.03))"
        : undefined,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{agent.name || `Agent-${agent.id?.slice(2, 10)}`}</div>
          <div style={{ fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono',monospace", marginTop: 3 }}>{agent.id?.slice(0, 22)}…</div>
        </div>
        <Badge label={STATUS_LABEL[agent.status] ?? "-"} color={STATUS_COLOR[agent.status] ?? "#6b7280"} />
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        {caps.slice(0, 4).map((c) => (
          <span key={c} style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 6,
            background: "rgba(99,102,241,0.12)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)",
          }}>{c}</span>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: SAFETY_COLOR[agent.safety_level] ?? "#6b7280" }}>⬡ {SAFETY_LABEL[agent.safety_level] ?? "-"}</span>
        <span style={{ color: "#64748b" }}>Rep <b style={{ color: "#c4b5fd" }}>{agent.reputation ?? 500}</b></span>
        <span style={{ color: "#818cf8", fontFamily: "'JetBrains Mono',monospace" }}>{fmtUSD(agent.total_volume_usd ?? 0)}</span>
      </div>
    </div>
  );
}

function AgentDetail({ agentId, wallet, onAudited }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [auditMsg, setAuditMsg] = useState(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    api.get(`/api/agents/${agentId}`).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [agentId]);

  const submitAudit = async (passed = true) => {
    const eth = getInjectedProvider();
    if (!eth || !REGISTRY_ADDRESS || !wallet.account) return;
    setAuditing(true); setAuditMsg(null);
    try {
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const c = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
      const tx = await c.submitAudit(agentId, passed ? 85 : 30, ZeroHash, [], passed);
      setAuditMsg(`Submitted — ${tx.hash.slice(0, 12)}…`);
      await tx.wait();
      setAuditMsg(passed ? "Audit passed — agent should be Active" : "Audit failed — agent suspended if active");
      onAudited?.();
      const refreshed = await api.get(`/api/agents/${agentId}`);
      setData(refreshed);
    } catch (e) {
      setAuditMsg(e.shortMessage || e.message || String(e));
    } finally {
      setAuditing(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!data) return <div style={{ padding: 20, color: "#64748b" }}>Agent not found</div>;

  const agent = data.agent ?? {};
  const txs = data.transactions ?? [];
  const audits = data.audits ?? [];
  const live = data.chainData ?? {};

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{agent.name || `Agent-${agent.id?.slice(2, 10)}`}</div>
        <div style={{ fontSize: 11, color: "#475569", fontFamily: "'JetBrains Mono',monospace", marginTop: 4, wordBreak: "break-all" }}>{agent.id}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <Badge label={STATUS_LABEL[live.status ?? agent.status] ?? "Pending"} color={STATUS_COLOR[live.status ?? agent.status] ?? "#f59e0b"} />
          <Badge label={SAFETY_LABEL[agent.safety_level] ?? "Standard"} color={SAFETY_COLOR[agent.safety_level] ?? "#3b82f6"} />
          <a href={`${EXPLORER}/address/${agent.owner}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#64748b", textDecoration: "none" }}>{fmtAddr(agent.owner)} ↗</a>
        </div>
      </div>

      <div style={{ display: "flex", gap: 2, marginBottom: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
        {["overview", "transactions", "audits"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
            background: tab === t ? "rgba(99,102,241,0.25)" : "transparent",
            color: tab === t ? "#c4b5fd" : "#64748b", fontSize: 11, cursor: "pointer", textTransform: "capitalize",
          }}>{t}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["Total Volume", fmtUSD(live.totalVolumeUSD ?? agent.total_volume_usd ?? 0), "#818cf8"],
            ["Transactions", (live.totalTxCount ?? agent.total_tx_count ?? 0).toLocaleString(), "#10b981"],
            ["Reputation", `${live.reputation ?? agent.reputation ?? 500}/1000`, "#c4b5fd"],
            ["Audit Score", `${live.auditScore ?? agent.audit_score ?? 0}/100`, (live.auditScore ?? agent.audit_score ?? 0) >= 70 ? "#10b981" : "#ef4444"],
          ].map(([l, v, c]) => (
            <div key={l} className="glass" style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10 }}>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: c, fontFamily: "'JetBrains Mono',monospace" }}>{v}</span>
            </div>
          ))}

          {wallet?.isAuditor && (live.status ?? agent.status) === 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>You have AUDITOR_ROLE — approve this agent:</div>
              <button className="btn-primary" disabled={auditing} onClick={() => submitAudit(true)} style={{ borderRadius: 10, padding: "10px 0", fontSize: 13 }}>
                {auditing ? "Confirm in wallet…" : "Approve Audit (score 85)"}
              </button>
              <button className="btn-ghost" disabled={auditing} onClick={() => submitAudit(false)} style={{ borderRadius: 10, padding: "8px 0", fontSize: 12 }}>
                Reject audit
              </button>
              {auditMsg && <div style={{ fontSize: 11, color: auditMsg.includes("Active") || auditMsg.includes("Submitted") ? "#10b981" : "#f87171" }}>{auditMsg}</div>}
            </div>
          )}

          <a href={`${EXPLORER}/address/${REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer"
            style={{
              display: "block", padding: "10px 12px", borderRadius: 10, marginTop: 4,
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)",
              color: "#a5b4fc", fontSize: 12, textDecoration: "none", textAlign: "center",
            }}>
            View Registry on BaseScan ↗
          </a>
        </div>
      )}

      {tab === "transactions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {txs.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 20 }}>No transactions yet</div>}
          {txs.map((tx, i) => (
            <div key={i} className="glass" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: tx.blocked ? "#ef4444" : tx.success ? "#10b981" : "#f59e0b", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.reasoning || tx.block_reason || "—"}</span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{fmtUSD(tx.amount_usd)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "audits" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {audits.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 20 }}>No audits yet</div>}
          {audits.map((a, i) => (
            <div key={i} className="glass" style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${a.passed ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: a.passed ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>{a.score}/100</span>
                <Badge label={a.passed ? "PASSED" : "FAILED"} color={a.passed ? "#10b981" : "#ef4444"} />
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Auditor: {fmtAddr(a.auditor)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rails Lab (legendary product surface) ────────────────────────────────────
function RailsLab({ agents }) {
  const active = agents.filter((a) => a.status === 1);
  const any = agents[0];
  const [mode, setMode] = useState("simulate"); // simulate | chain
  const [agentId, setAgentId] = useState(active[0]?.id || any?.id || "");
  const [amountUSD, setAmount] = useState(5000);
  const [slippageBps, setSlip] = useState(80);
  const [maxSingle, setMaxSingle] = useState(10000);
  const [maxDaily, setMaxDaily] = useState(100000);
  const [maxSlip, setMaxSlip] = useState(100);
  const [status, setStatus] = useState(1);
  const [dailyUsed, setDailyUsed] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!agentId && agents[0]?.id) setAgentId(agents[0].id);
  }, [agents, agentId]);

  async function runCheck() {
    setLoading(true); setError(null); setResult(null);
    try {
      if (mode === "chain") {
        if (!agentId) throw new Error("Select an on-chain agent");
        const data = await api.post("/api/rails/check", {
          agentId,
          amountUSD,
          slippageBps,
          protocol: "0x0000000000000000000000000000000000000000",
          token: "0x0000000000000000000000000000000000000000",
        });
        setResult(data);
      } else {
        const data = await api.post("/api/rails/simulate", {
          status,
          maxSingleTxUSD: maxSingle,
          maxDailyVolumeUSD: maxDaily,
          maxSlippageBps: maxSlip,
          amountUSD,
          slippageBps,
          dailyUsedUSD: dailyUsed,
        });
        setResult(data);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: "-0.03em" }}>
          Rails <span className="shine-text">Lab</span>
        </h1>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14, maxWidth: 640, lineHeight: 1.55 }}>
          This is the product. Before an agent moves capital, every intent hits the rails.
          Simulate policy offline — or call <code style={{ color: "#a5b4fc" }}>checkTx</code> on-chain for absolute truth.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {[
          { id: "simulate", label: "Policy simulator" },
          { id: "chain", label: "On-chain checkTx" },
        ].map((m) => (
          <button key={m.id} type="button" onClick={() => { setMode(m.id); setResult(null); }}
            className={mode === m.id ? "btn-primary" : "btn-ghost"}
            style={{ padding: "9px 16px", borderRadius: 10, fontSize: 12 }}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="rails-grid">
        <div className="glass" style={{ borderRadius: 18, padding: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 16, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Intent
          </div>

          {mode === "chain" && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Agent</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ width: "100%" }}>
                {agents.length === 0 && <option value="">No agents indexed yet</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id.slice(0, 12)} · {STATUS_LABEL[a.status] ?? "?"}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 6, fontFamily: "monospace" }}>{agentId}</div>
            </div>
          )}

          {mode === "simulate" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Agent status</label>
                <select value={status} onChange={(e) => setStatus(Number(e.target.value))} style={{ width: "100%" }}>
                  <option value={0}>Pending</option>
                  <option value={1}>Active</option>
                  <option value={2}>Suspended</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Daily used (USD)</label>
                <input type="number" value={dailyUsed} onChange={(e) => setDailyUsed(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Max single TX</label>
                <input type="number" value={maxSingle} onChange={(e) => setMaxSingle(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Max daily volume</label>
                <input type="number" value={maxDaily} onChange={(e) => setMaxDaily(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Max slippage (bps)</label>
                <input type="number" value={maxSlip} onChange={(e) => setMaxSlip(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Proposed amount (USD)</label>
              <input type="number" value={amountUSD} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Proposed slippage (bps)</label>
              <input type="number" value={slippageBps} onChange={(e) => setSlip(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            {[
              { label: "Safe $1k", a: 1000, s: 30 },
              { label: "Edge $9.9k", a: 9900, s: 90 },
              { label: "Breach $50k", a: 50000, s: 50 },
              { label: "Slip 5%", a: 2000, s: 500 },
            ].map((p) => (
              <button key={p.label} type="button" className="btn-ghost" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11 }}
                onClick={() => { setAmount(p.a); setSlip(p.s); }}>
                {p.label}
              </button>
            ))}
          </div>

          <button type="button" className="btn-primary" disabled={loading}
            onClick={runCheck}
            style={{ width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 12, fontSize: 14 }}>
            {loading ? "Checking…" : mode === "chain" ? "Run on-chain checkTx" : "Simulate rails"}
          </button>
          {error && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="glass" style={{
          borderRadius: 18, padding: 22, minHeight: 320,
          border: result
            ? `1px solid ${result.allowed ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`
            : "1px solid rgba(255,255,255,0.08)",
          background: result
            ? result.allowed
              ? "linear-gradient(160deg,rgba(16,185,129,0.12),rgba(255,255,255,0.02))"
              : "linear-gradient(160deg,rgba(239,68,68,0.12),rgba(255,255,255,0.02))"
            : undefined,
        }}>
          {!result && !loading && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b", textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 12, animation: "float 3s ease-in-out infinite" }}>⬡</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8" }}>Verdict appears here</div>
              <div style={{ fontSize: 12, marginTop: 8, maxWidth: 260, lineHeight: 1.5 }}>
                Legendary systems don&apos;t hope agents behave. They prove what is allowed.
              </div>
            </div>
          )}
          {loading && <div style={{ padding: 60 }}><Spinner size={32} /></div>}
          {result && (
            <div>
              <div style={{
                fontSize: 42, fontWeight: 800, letterSpacing: "0.08em",
                fontFamily: "'Space Grotesk',sans-serif",
                color: result.allowed ? "#34d399" : "#f87171",
                textShadow: result.allowed ? "0 0 40px rgba(52,211,153,0.4)" : "0 0 40px rgba(248,113,113,0.35)",
              }}>
                {result.verdict || (result.allowed ? "ALLOW" : "BLOCK")}
              </div>
              <div style={{ fontSize: 14, color: "#e2e8f0", marginTop: 8, fontWeight: 500 }}>{result.reason}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                mode: {result.mode || mode} · {new Date(result.ts || Date.now()).toLocaleTimeString()}
              </div>

              {result.agent && (
                <div className="glass" style={{ marginTop: 16, padding: 12, borderRadius: 12, fontSize: 12, color: "#94a3b8" }}>
                  Agent <b style={{ color: "#e2e8f0" }}>{result.agent.name}</b> · {result.agent.statusLabel}
                </div>
              )}

              {result.checks && (
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.checks.map((c, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10,
                      background: "rgba(0,0,0,0.25)", border: `1px solid ${c.pass ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.25)"}`,
                    }}>
                      <span style={{ fontSize: 12, color: c.pass ? "#34d399" : "#f87171", fontWeight: 600 }}>
                        {c.pass ? "✓" : "✕"} {c.rule}
                      </span>
                      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", textAlign: "right" }}>{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {mode === "chain" && result.input && (
                <div style={{ marginTop: 16, fontSize: 11, color: "#475569", fontFamily: "monospace", lineHeight: 1.6 }}>
                  amount=${result.input.amountUSD} · slip={result.input.slippageBps}bps
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid-3">
        {[
          { t: "Identity first", d: "No anonymous capital. Every intent maps to an agent ID and owner." },
          { t: "Rails before alpha", d: "Yield is optional. Blow-up protection is not. Limits are on-chain." },
          { t: "Block is a feature", d: "A blocked tx is success — the protocol refused chaos." },
        ].map((x) => (
          <div key={x.t} className="glass" style={{ borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>{x.t}</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{x.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Register modal ───────────────────────────────────────────────────────────
function RegisterModal({ wallet, onClose, onSuccess }) {
  const [step, setStep] = useState(0);
  const [submitting, setSub] = useState(false);
  const [txHash, setHash] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    name: "", safetyLevel: 1, capabilities: ["monitor", "lend"],
    maxSingleTx: 10000, maxDailyVolume: 100000, maxSlippage: 100,
  });
  const STEPS = ["Identity", "Safety Rails", "Capabilities", "Confirm"];

  async function deploy() {
    const eth = getInjectedProvider();
    if (!eth || !REGISTRY_ADDRESS) {
      setError(isMobile()
        ? "Open this site inside MetaMask app, then try again"
        : "Wallet or registry address missing");
      return;
    }
    if (!wallet.isBaseNetwork) {
      setError(`Switch to ${NETWORK_NAME} first`);
      return;
    }
    setSub(true); setError(null);
    try {
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
      const fee = await registry.registrationFee();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const modelHash = keccak256(toUtf8Bytes(form.name + Date.now()));
      const codeHash = keccak256(toUtf8Bytes("agentforge-v3"));
      const capabilities = form.capabilities;
      const safetyLevel = form.safetyLevel;

      // Empty signature is accepted by upgraded registry (msg.sender is owner)
      const signature = "0x";

      const rails = {
        maxSingleTxUSD: parseEther(String(form.maxSingleTx)),
        maxDailyVolumeUSD: parseEther(String(form.maxDailyVolume)),
        maxSlippageBps: form.maxSlippage,
        allowedProtocols: [],
        allowedTokens: [],
        requiresMultisig: form.safetyLevel >= 3,
        multisigThresholdUSD: parseEther(String(Math.floor(form.maxSingleTx / 2))),
        cooldownPeriod: form.safetyLevel >= 2 ? 3600 : 0,
      };

      const metadataURI = `ipfs://agentforge/${encodeURIComponent(form.name)}`;
      const tx = await registry.registerAgent(
        modelHash, codeHash, capabilities, safetyLevel, rails, metadataURI, deadline, signature,
        { value: fee }
      );
      setHash(tx.hash);
      await tx.wait();
      onSuccess?.({ name: form.name, txHash: tx.hash });
    } catch (e) {
      console.error(e);
      setError(e.shortMessage || e.reason || e.message || String(e));
    } finally {
      setSub(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(2,4,12,0.82)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass" style={{
        borderRadius: 20, width: "min(520px, 100%)", maxHeight: "92vh", overflow: "hidden",
        display: "flex", flexDirection: "column", animation: "glow 4s ease-in-out infinite",
      }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div className="shine-text" style={{ fontSize: 18, fontWeight: 700 }}>Register Agent</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</div>
            </div>
            <button onClick={onClose} className="btn-ghost" style={{ width: 32, height: 32, borderRadius: 8, fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? "linear-gradient(90deg,#6366f1,#a855f7)" : "rgba(255,255,255,0.06)",
                transition: "background .3s",
              }} />
            ))}
          </div>
        </div>

        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {txHash ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>Agent Registered</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 8, fontFamily: "monospace", wordBreak: "break-all" }}>{txHash}</div>
              <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 14, color: "#818cf8", fontSize: 13 }}>View on BaseScan ↗</a>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 12 }}>Status starts as <b style={{ color: "#f59e0b" }}>Pending</b> until an auditor approves it.</div>
              <button onClick={onClose} className="btn-primary" style={{ marginTop: 18, padding: "10px 28px", borderRadius: 10, fontSize: 13 }}>Done</button>
            </div>
          ) : (
            <>
              {step === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Agent Name *</label>
                    <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. YieldMax-v1" style={{ width: "100%" }} />
                  </div>
                  {["Conservative Yield", "DEX Arbitrage", "Data Oracle", "Custom"].map((s, i) => (
                    <div key={s} onClick={() => setForm((f) => ({ ...f, safetyLevel: i === 0 ? 2 : i === 1 ? 1 : i === 2 ? 0 : f.safetyLevel }))}
                      className="glass glass-hover" style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{s}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                        {["Moves USDC between Aave/Compound for max APY", "Captures price gaps on Uniswap V3", "Publishes signed market data on-chain", "Build your own custom strategy"][i]}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {step === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>On-chain limits enforced by AgentExecutor. Values scale with safety level.</div>
                  {[
                    { label: "Max Single TX (USD)", key: "maxSingleTx", min: 100, max: 100000, step: 500 },
                    { label: "Max Daily Volume (USD)", key: "maxDailyVolume", min: 1000, max: 1000000, step: 5000 },
                    { label: "Max Slippage (bps)", key: "maxSlippage", min: 10, max: 500, step: 10 },
                  ].map(({ label, key, min, max, step: s }) => (
                    <div key={key}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <label style={{ fontSize: 11, color: "#94a3b8" }}>{label}</label>
                        <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "monospace" }}>
                          {key === "maxSlippage" ? `${(form[key] / 100).toFixed(1)}%` : `$${form[key].toLocaleString()}`}
                        </span>
                      </div>
                      <input type="range" min={min} max={max} step={s} value={form[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                        style={{ width: "100%" }} />
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>Safety Level</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[0, 1, 2, 3].map((lvl) => (
                        <button key={lvl} type="button" onClick={() => setForm((f) => ({ ...f, safetyLevel: lvl }))}
                          className={form.safetyLevel === lvl ? "btn-primary" : "btn-ghost"}
                          style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12 }}>
                          {SAFETY_LABEL[lvl]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Select what this agent may do on-chain.</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["trade", "swap", "bridge", "lend", "borrow", "stake", "vote", "monitor", "arbitrage", "data_feed", "compute"].map((c) => {
                      const sel = form.capabilities.includes(c);
                      return (
                        <button key={c} type="button"
                          onClick={() => setForm((f) => ({
                            ...f,
                            capabilities: sel ? f.capabilities.filter((x) => x !== c) : [...f.capabilities, c],
                          }))}
                          className={sel ? "btn-primary" : "btn-ghost"}
                          style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {step === 3 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#a5b4fc", marginBottom: 12 }}>Review</div>
                    {[
                      ["Name", form.name || "—"],
                      ["Safety", SAFETY_LABEL[form.safetyLevel]],
                      ["Max TX", `$${form.maxSingleTx.toLocaleString()}`],
                      ["Max Daily", `$${form.maxDailyVolume.toLocaleString()}`],
                      ["Slippage", `${(form.maxSlippage / 100).toFixed(1)}%`],
                      ["Capabilities", form.capabilities.join(", ")],
                      ["Network", NETWORK_NAME],
                      ["Fee", "0.01 ETH"],
                    ].map(([l, v]) => (
                      <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
                        <span style={{ fontSize: 12, color: "#f1f5f9", fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    padding: 12, borderRadius: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5,
                    background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)",
                  }}>
                    Costs <b style={{ color: "#fb923c" }}>0.01 ETH</b> on {NETWORK_NAME}. Agent starts <b>Pending</b> until audited.
                    Confirm the transaction in MetaMask (single step).
                  </div>
                  {error && (
                    <div style={{
                      padding: 12, borderRadius: 10, fontSize: 12, color: "#fca5a5",
                      background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                    }}>{error}</div>
                  )}
                  <button onClick={deploy} disabled={submitting || !form.name} className="btn-primary"
                    style={{ padding: "13px 0", borderRadius: 12, fontSize: 14 }}>
                    {submitting ? "Confirm in MetaMask…" : "Register Agent — 0.01 ETH"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {!txHash && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)} className="btn-ghost" style={{ flex: 1, padding: "10px 0", borderRadius: 10 }}>← Back</button>
            )}
            {step < STEPS.length - 1 && (
              <button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !form.name}
                className="btn-primary" style={{ flex: 2, padding: "10px 0", borderRadius: 10 }}>
                Continue →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const wallet = useWallet();
  const { stats, loading: statsLoad, refetch: refetchStats } = useStats();
  const { agents, loading: agLoad, refetch: refetchAgents } = useAgents();
  const { data: daily } = useDailyStats();
  const { audits } = useAudits();
  const gas = useGas();
  const { events, connected } = useWebSocket(WS_URL);
  const [activeTab, setTab] = useState("overview");
  const [selected, setSelected] = useState(null);
  const [showRegister, setRegister] = useState(false);
  const [filterStatus, setFStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletSheet, setWalletSheet] = useState(false);
  const eventRef = useRef(null);
  const [liveAgents, setLiveAgents] = useState([]);

  useEffect(() => { setLiveAgents(agents); }, [agents]);

  useEffect(() => {
    const latest = events[0];
    if (!latest) return;
    if (latest.type === "AgentRegistered") {
      setLiveAgents((prev) => {
        if (prev.find((a) => a.id === latest.data.agentId)) return prev;
        return [{
          id: latest.data.agentId, owner: latest.data.owner,
          name: `Agent-${latest.data.agentId.slice(2, 10)}`, status: 0,
          reputation: 500, total_volume_usd: 0, total_tx_count: 0, audit_score: 0, safety_level: 1,
        }, ...prev];
      });
      refetchStats();
    }
    if (latest.type === "AgentStatusChanged") {
      setLiveAgents((prev) => prev.map((a) => (a.id === latest.data.agentId ? { ...a, status: latest.data.newStatus } : a)));
    }
    if (latest.type === "TxExecuted") {
      setLiveAgents((prev) => prev.map((a) => (a.id === latest.data.agentId
        ? { ...a, total_tx_count: (a.total_tx_count || 0) + 1, total_volume_usd: (a.total_volume_usd || 0) + (latest.data.amountUSD || 0) }
        : a)));
    }
    if (latest.type === "ReputationUpdated") {
      setLiveAgents((prev) => prev.map((a) => (a.id === latest.data.agentId ? { ...a, reputation: latest.data.newScore } : a)));
    }
  }, [events, refetchStats]);

  useEffect(() => { if (eventRef.current) eventRef.current.scrollTop = 0; }, [events]);

  const filteredAgents = liveAgents.filter((a) => {
    if (filterStatus !== "all" && String(a.status) !== filterStatus) return false;
    const name = (a.name || "").toLowerCase();
    const id_ = (a.id || "").toLowerCase();
    if (search && !name.includes(search.toLowerCase()) && !id_.includes(search.toLowerCase())) return false;
    return true;
  });

  const noticeableEvents = events.filter((e) => e.type !== "NewBlock" && e.type !== "Connected");
  const blockRate = stats ? (parseFloat(stats.blockRate) || 0).toFixed(1) : "0";

  const tabs = useMemo(() => [
    { id: "overview", label: "Overview", icon: "◈" },
    { id: "rails", label: "Rails Lab", icon: "⚡" },
    { id: "agents", label: `Agents (${liveAgents.length})`, icon: "⬡" },
    { id: "events", label: "Live Feed", icon: "▣" },
    { id: "audits", label: "Audits", icon: "◎" },
    { id: "analytics", label: "Analytics", icon: "◆" },
    { id: "contracts", label: "Protocol", icon: "◎" },
  ], [liveAgents.length]);

  const contracts = [
    { name: "AgentRegistry", address: REGISTRY_ADDRESS, desc: "Identity, rails, audits" },
    { name: "AgentVault", address: VAULT_ADDRESS, desc: "Staking & slashing" },
    { name: "AgentCommerce", address: COMMERCE_ADDRESS, desc: "Agent marketplace" },
    { name: "AgentExecutor", address: EXECUTOR_ADDRESS, desc: "Tx gating & execution" },
  ];

  const goTab = (id) => { setTab(id); setMenuOpen(false); };

  return (
    <div className="mesh-bg" style={{ minHeight: "100vh", color: "#f1f5f9", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{CSS}</style>

      {/* Nav */}
      <div className="nav-bar" style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(5,6,15,0.88)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "linear-gradient(135deg,#6366f1,#a855f7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 15,
            boxShadow: "0 4px 16px rgba(99,102,241,0.45)",
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em" }} className="shine-text">AgentForge</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {NETWORK_NAME}
            </div>
          </div>
        </div>

        <div className="nav-tabs-desktop" style={{ gap: 2, flex: 1, overflowX: "auto", marginLeft: 12 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => goTab(t.id)} style={{
              padding: "7px 12px", borderRadius: 8, border: "none",
              background: activeTab === t.id ? "rgba(99,102,241,0.2)" : "transparent",
              color: activeTab === t.id ? "#c4b5fd" : "#64748b",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: activeTab === t.id ? 600 : 400,
            }}>
              <span style={{ fontSize: 10, marginRight: 5, opacity: 0.8 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
          <div className="hide-mobile" style={{
            display: "flex", gap: 6, alignItems: "center", padding: "5px 11px", borderRadius: 999,
            background: connected ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${connected ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "#10b981" : "#ef4444",
              animation: connected ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ fontSize: 11, color: connected ? "#34d399" : "#f87171", fontWeight: 600 }}>
              {connected ? "Live" : "Offline"}
            </span>
          </div>

          {!wallet.account ? (
            <button onClick={() => (wallet.isMobile && !wallet.getEthereum?.() ? setWalletSheet(true) : wallet.connect())}
              disabled={wallet.connecting} className="btn-primary"
              style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, minHeight: 40 }}>
              {wallet.connecting ? "…" : "Connect"}
            </button>
          ) : (
            <button type="button" className="glass" style={{
              padding: "8px 12px", borderRadius: 10, fontSize: 12, color: "#34d399",
              border: "1px solid rgba(16,185,129,0.25)", cursor: "pointer", minHeight: 40,
            }} onClick={() => setWalletSheet(true)}>
              {fmtAddr(wallet.account)}
            </button>
          )}

          <button type="button" className="show-mobile btn-ghost" aria-label="Menu"
            onClick={() => setMenuOpen(true)}
            style={{ width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            ☰
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="drawer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, color: "#e2e8f0" }}>Menu</span>
              <button type="button" className="btn-ghost" style={{ width: 36, height: 36, borderRadius: 8 }} onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <Badge label={connected ? "API Live" : "API Offline"} color={connected ? "#10b981" : "#ef4444"} />
              {gas && <Badge label={`${Number(gas.gasPrice).toFixed(3)} gwei`} color="#64748b" />}
            </div>
            {tabs.map((t) => (
              <button key={t.id} type="button" className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => goTab(t.id)}>
                {t.icon}  {t.label}
              </button>
            ))}
            {wallet.account && wallet.isBaseNetwork && (
              <button type="button" className="btn-primary" style={{ marginTop: 12, padding: 14, borderRadius: 12, fontSize: 14 }}
                onClick={() => { setMenuOpen(false); setRegister(true); }}>
                + Register Agent
              </button>
            )}
            <a href="https://github.com/brypto2001/agentforge-protocol/blob/main/docs/PUBLISH_CUSTOM_AGENT.md"
              target="_blank" rel="noreferrer"
              style={{ marginTop: "auto", fontSize: 12, color: "#818cf8", textDecoration: "none", padding: 12 }}>
              Publish custom agent docs ↗
            </a>
          </div>
        </>
      )}

      {/* Wallet sheet (mobile + desktop) */}
      {walletSheet && (
        <>
          <div className="drawer-backdrop" onClick={() => setWalletSheet(false)} />
          <div className="drawer" style={{ left: 0, right: 0, top: "auto", bottom: 0, width: "100%", maxWidth: "100%", borderRadius: "20px 20px 0 0", borderLeft: "none", borderTop: "1px solid rgba(255,255,255,0.1)", maxHeight: "70vh" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 16px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>Wallet</div>
            {!wallet.account ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, margin: "0 0 8px" }}>
                  {wallet.isMobile
                    ? "On phone, open this site inside MetaMask (or Coinbase Wallet) for the best experience."
                    : "Connect an injected wallet (MetaMask extension)."}
                </p>
                {wallet.getEthereum?.() ? (
                  <button type="button" className="btn-primary" style={{ padding: 16, borderRadius: 14, fontSize: 15 }}
                    onClick={async () => { await wallet.connect(); setWalletSheet(false); }}>
                    Connect injected wallet
                  </button>
                ) : null}
                <button type="button" className="btn-primary" style={{ padding: 16, borderRadius: 14, fontSize: 15 }}
                  onClick={() => { wallet.openMetaMask(); }}>
                  Open in MetaMask app
                </button>
                <button type="button" className="btn-ghost" style={{ padding: 14, borderRadius: 14, fontSize: 14 }}
                  onClick={() => { wallet.openCoinbase(); }}>
                  Open in Coinbase Wallet
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="glass" style={{ padding: 14, borderRadius: 12, fontFamily: "monospace", fontSize: 13, wordBreak: "break-all" }}>
                  {wallet.account}
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>Balance: <b style={{ color: "#e2e8f0" }}>{wallet.balance} ETH</b></div>
                {!wallet.isBaseNetwork && (
                  <button type="button" className="btn-primary" style={{ padding: 14, borderRadius: 12 }}
                    onClick={() => wallet.switchNetwork()}>
                    Switch to {NETWORK_NAME}
                  </button>
                )}
                {wallet.isBaseNetwork && (
                  <button type="button" className="btn-primary" style={{ padding: 14, borderRadius: 12 }}
                    onClick={() => { setWalletSheet(false); setRegister(true); }}>
                    + Register Agent
                  </button>
                )}
                <button type="button" className="btn-ghost" style={{ padding: 14, borderRadius: 12 }}
                  onClick={() => { wallet.disconnect(); setWalletSheet(false); }}>
                  Disconnect
                </button>
              </div>
            )}
            {wallet.error && (
              <div style={{ marginTop: 12, fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>{wallet.error}</div>
            )}
            <button type="button" className="btn-ghost" style={{ marginTop: 16, padding: 12, borderRadius: 10 }}
              onClick={() => setWalletSheet(false)}>Close</button>
          </div>
        </>
      )}

      {wallet.account && !wallet.isBaseNetwork && (
        <div style={{
          background: "linear-gradient(90deg,rgba(239,68,68,0.15),rgba(249,115,22,0.1))",
          borderBottom: "1px solid rgba(239,68,68,0.25)",
          padding: "12px 16px", fontSize: 13, color: "#fca5a5",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span>Wrong network — use <b>{NETWORK_NAME}</b></span>
          <button onClick={wallet.switchNetwork} className="btn-primary" style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, minHeight: 40 }}>
            Switch
          </button>
        </div>
      )}

      {!connected && (
        <div style={{
          background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.15)",
          padding: "10px 14px", fontSize: 12, color: "#f87171", textAlign: "center", lineHeight: 1.4,
        }}>
          Backend waking up (~30s on free tier).{" "}
          <a href={`${API_URL}/health`} target="_blank" rel="noreferrer" style={{ color: "#fca5a5" }}>/health</a>
        </div>
      )}

      <div className="page-pad">
        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h1 className="hero-title" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", fontFamily: "'Space Grotesk',sans-serif" }}>
                Protocol <span className="shine-text">Command Center</span>
              </h1>
              <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
                Live trust layer for autonomous agents on {NETWORK_NAME}
              </p>
            </div>

            <div className="grid-stats">
              <StatCard label="Total Agents" value={stats?.totalAgents ?? "—"} sub={`${stats?.activeAgents ?? 0} active`} color="#34d399" loading={statsLoad} />
              <StatCard label="Total Volume" value={stats ? fmtUSD(stats.totalVolumeUSD) : "—"} sub="all time" color="#818cf8" loading={statsLoad} />
              <StatCard label="Transactions" value={stats ? parseInt(stats.totalTransactions).toLocaleString() : "—"} sub={`${blockRate}% blocked`} color="#c4b5fd" loading={statsLoad} />
              <StatCard label="Audits" value={stats?.totalAudits ?? "—"} color="#fbbf24" loading={statsLoad} />
              <StatCard label="Block Rate" value={`${blockRate}%`} sub="safety rails" color={parseFloat(blockRate) > 5 ? "#f87171" : "#34d399"} loading={statsLoad} />
            </div>

            {daily.length > 0 ? (
              <div className="glass" style={{ borderRadius: 18, padding: 22 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
                  30-Day Protocol Volume
                  <Badge label={connected ? "Live Data" : "Cached"} color={connected ? "#10b981" : "#f59e0b"} />
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={daily}>
                    <defs>
                      <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(d) => d.slice(5)} />
                    <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtUSD(v)} />
                    <Tooltip contentStyle={{ background: "#0f1220", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 10, fontSize: 12 }} formatter={(v) => [fmtUSD(v), "Volume"]} />
                    <Area type="monotone" dataKey="total_volume_usd" stroke="#818cf8" strokeWidth={2.5} fill="url(#vg)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="No volume yet"
                body="Once agents register and execute trades, daily volume charts appear here."
                action={wallet.account && wallet.isBaseNetwork ? (
                  <button className="btn-primary" style={{ padding: "10px 20px", borderRadius: 10, fontSize: 13 }} onClick={() => setRegister(true)}>
                    Register first agent
                  </button>
                ) : (
                  <button className="btn-primary" style={{ padding: "10px 20px", borderRadius: 10, fontSize: 13 }} onClick={wallet.connect}>
                    Connect wallet to start
                  </button>
                )}
              />
            )}

            <div className="grid-2">
              <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>Recent Audits</div>
                {audits.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.passed ? "#10b981" : "#ef4444" }} />
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>{a.agent_name || fmtAddr(a.agent_id)}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: a.score >= 70 ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>{a.score}/100</span>
                  </div>
                ))}
                {audits.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "24px 0" }}>No audits yet</div>}
              </div>
              <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>Live Event Stream</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                  {noticeableEvents.slice(0, 10).map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: EVENT_COLOR[e.type] ?? "#6b7280", flexShrink: 0, marginTop: 4 }} />
                      <span style={{ fontSize: 11, color: EVENT_COLOR[e.type] ?? "#6b7280", flexShrink: 0, fontWeight: 600 }}>{e.type}</span>
                      <span style={{ fontSize: 10, color: "#475569" }}>{fmtTime(e.ts)}</span>
                    </div>
                  ))}
                  {noticeableEvents.length === 0 && (
                    <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "24px 0" }}>
                      Waiting for on-chain events… {connected ? "indexer connected" : "reconnecting"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RAILS LAB */}
        {activeTab === "rails" && <RailsLab agents={liveAgents} />}

        {/* AGENTS */}
        {activeTab === "agents" && (
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                <input placeholder="Search agents…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                {["all", "0", "1", "2"].map((s) => (
                  <button key={s} onClick={() => setFStatus(s)}
                    className={filterStatus === s ? "btn-primary" : "btn-ghost"}
                    style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11 }}>
                    {s === "all" ? "All" : STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              {agLoad ? <div style={{ padding: 40 }}><Spinner size={28} /></div> : filteredAgents.length === 0 ? (
                <EmptyState
                  title="No agents registered yet"
                  body="Be the first to register an autonomous agent on this deployment. Agents start Pending until audited."
                  action={wallet.account && wallet.isBaseNetwork ? (
                    <button className="btn-primary" style={{ padding: "10px 20px", borderRadius: 10 }} onClick={() => setRegister(true)}>+ Register Agent</button>
                  ) : (
                    <button className="btn-primary" style={{ padding: "10px 20px", borderRadius: 10 }} onClick={wallet.connect}>Connect Wallet</button>
                  )}
                />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 12 }}>
                  {filteredAgents.map((a) => (
                    <AgentRow key={a.id} agent={a} selected={selected === a.id} onClick={() => setSelected(selected === a.id ? null : a.id)} />
                  ))}
                </div>
              )}
            </div>
            {selected && (
              <div className={`glass agent-side ${selected ? "open-mobile" : ""}`} style={{
                width: 360, flexShrink: 0, position: "sticky", top: 72,
                height: "calc(100vh - 96px)", borderRadius: 16, overflow: "hidden",
              }}>
                <div className="show-mobile" style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Agent</span>
                  <button type="button" className="btn-ghost" style={{ padding: "8px 12px", borderRadius: 8 }} onClick={() => setSelected(null)}>Close</button>
                </div>
                <AgentDetail
                  agentId={selected}
                  wallet={wallet}
                  onAudited={() => { refetchAgents(); refetchStats(); }}
                />
              </div>
            )}
          </div>
        )}

        {/* EVENTS */}
        {activeTab === "events" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {Object.entries(EVENT_COLOR).filter(([k]) => k !== "NewBlock" && k !== "Connected").map(([type, color]) => (
                <div key={type} className="glass" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{type} ({events.filter((e) => e.type === type).length})</span>
                </div>
              ))}
            </div>
            <div className="glass" style={{ borderRadius: 16, overflow: "hidden" }}>
              <div style={{
                padding: "10px 16px", background: "rgba(0,0,0,0.35)", borderBottom: "1px solid rgba(16,185,129,0.12)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {["#ef4444", "#f59e0b", "#10b981"].map((c, i) => (
                  <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.85 }} />
                ))}
                <span style={{ marginLeft: 8, fontSize: 11, color: "#475569", fontFamily: "monospace" }}>
                  agentforge · registry indexer
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#10b981" : "#ef4444", animation: connected ? "pulse 1.5s infinite" : "none" }} />
                  <span style={{ fontSize: 10, color: connected ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>{connected ? "LIVE" : "OFFLINE"}</span>
                </div>
              </div>
              <div ref={eventRef} style={{ height: 520, overflowY: "auto", padding: "14px 18px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.9 }}>
                {noticeableEvents.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <span style={{ color: "#334155", flexShrink: 0, fontSize: 10 }}>{new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                    <span style={{ color: EVENT_COLOR[e.type] ?? "#6b7280", flexShrink: 0, fontWeight: 700, minWidth: 150 }}>{e.type}</span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>
                      {e.data?.agentId && fmtAddr(e.data.agentId)}
                      {e.data?.amountUSD != null && ` · ${fmtUSD(e.data.amountUSD)}`}
                      {e.data?.score != null && ` · score=${e.data.score}`}
                      {e.data?.reason && ` · "${e.data.reason}"`}
                    </span>
                  </div>
                ))}
                {noticeableEvents.length === 0 && (
                  <div style={{ color: "#475569", textAlign: "center", padding: "48px 0" }}>
                    Waiting for on-chain events… register an agent to generate traffic.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* AUDITS */}
        {activeTab === "audits" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard label="Total Audits" value={audits.length} color="#c4b5fd" loading={false} />
              <StatCard label="Pass Rate" value={audits.length ? `${Math.round(audits.filter((a) => a.passed).length / audits.length * 100)}%` : "—"} color="#34d399" loading={false} />
              <StatCard label="Avg Score" value={audits.length ? `${Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)}/100` : "—"} color="#818cf8" loading={false} />
            </div>
            <div className="glass" style={{ borderRadius: 16, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {["Agent", "Score", "Status", "Auditor", "Date", "Explorer"].map((h) => (
                      <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: "12px 14px", fontSize: 12, color: "#94a3b8" }}>{a.agent_name || fmtAddr(a.agent_id)}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 48, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${a.score}%`, background: a.score >= 70 ? "linear-gradient(90deg,#10b981,#34d399)" : "#ef4444" }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: a.score >= 70 ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>{a.score}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px" }}><Badge label={a.passed ? "PASSED" : "FAILED"} color={a.passed ? "#10b981" : "#ef4444"} /></td>
                      <td style={{ padding: "12px 14px", fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>{fmtAddr(a.auditor)}</td>
                      <td style={{ padding: "12px 14px", fontSize: 11, color: "#475569" }}>{fmtDate(a.timestamp)}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <a href={`${EXPLORER}/address/${REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>View ↗</a>
                      </td>
                    </tr>
                  ))}
                  {audits.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "48px 14px", textAlign: "center", color: "#475569", fontSize: 13 }}>
                      No audits yet — register an agent, then approve it from the Agents panel (deployer has AUDITOR_ROLE).
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {activeTab === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {daily.length === 0 ? (
              <EmptyState title="Analytics need activity" body="Charts populate after agents execute on-chain transactions indexed by the backend." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 14 }}>Daily Txs vs Blocked</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={daily.slice(-14)}>
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9 }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#475569", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0f1220", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 10, fontSize: 11 }} />
                      <Bar dataKey="total_txs" fill="#6366f1" radius={[3, 3, 0, 0]} name="Total" />
                      <Bar dataKey="blocked_txs" fill="#ef4444" radius={[3, 3, 0, 0]} name="Blocked" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 14 }}>New Agents</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={daily.slice(-14)}>
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9 }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#475569", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0f1220", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 10, fontSize: 11 }} />
                      <Bar dataKey="new_agents" fill="#a855f7" radius={[3, 3, 0, 0]} name="New Agents" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PROTOCOL */}
        {activeTab === "contracts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: "-0.03em" }}>
                The <span className="shine-text">Protocol</span>
              </h1>
              <p style={{ color: "#94a3b8", fontSize: 15, marginTop: 10, maxWidth: 640, lineHeight: 1.6 }}>
                Agents will move capital without humans in the loop. Without identity, limits, and auditability, that is chaos.
                AgentForge makes every agent accountable on-chain.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {[
                { t: "Identity", d: "Permanent agent ID, owner, model hash, capabilities." },
                { t: "Rails", d: "Max tx, daily volume, slippage, cooldowns — enforced." },
                { t: "Audit", d: "Scores, reputation, suspend on failure." },
                { t: "Execution", d: "Executor is the choke point. No pass, no tx." },
              ].map((p) => (
                <div key={p.t} className="glass glass-hover" style={{ borderRadius: 16, padding: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{p.t}</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{p.d}</div>
                </div>
              ))}
            </div>

            <div>
              <h2 style={{ margin: "8px 0 14px", fontSize: 16, fontWeight: 700, color: "#94a3b8" }}>
                Deployed on {NETWORK_NAME} · chainId {TARGET_CHAIN_ID}
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
                {contracts.map((c) => (
                  <div key={c.name} className="glass glass-hover" style={{ borderRadius: 16, padding: 20 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{c.desc}</div>
                    <div style={{
                      fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#a5b4fc",
                      wordBreak: "break-all", padding: "10px 12px", borderRadius: 10,
                      background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      {c.address || "Not configured"}
                    </div>
                    {c.address && isAddress(c.address) && (
                      <a href={`${EXPLORER}/address/${c.address}`} target="_blank" rel="noreferrer"
                        style={{ display: "inline-block", marginTop: 12, fontSize: 12, color: "#818cf8", textDecoration: "none" }}>
                        Open on BaseScan ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="glass" style={{ borderRadius: 16, padding: 18, fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
              <b style={{ color: "#e2e8f0" }}>How to feel the product in 60 seconds:</b>
              <br />1. Open <b style={{ color: "#c4b5fd" }}>Rails Lab</b> → run “Breach $50k” → see BLOCK.
              <br />2. Register an agent → approve audit → status Active.
              <br />3. Rails Lab → On-chain checkTx → try a size above its rails → BLOCK from the contract.
              <br />4. Live Feed shows identity, audit, and enforcement as first-class events.
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)", padding: "18px 20px",
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
        fontSize: 11, color: "#475569", maxWidth: 1440, margin: "0 auto",
      }}>
        <span>AgentForge v3 · {NETWORK_NAME}</span>
        <div style={{ display: "flex", gap: 14 }}>
          <a href="https://github.com/brypto2001/agentforge-protocol" target="_blank" rel="noreferrer" style={{ color: "#64748b", textDecoration: "none" }}>GitHub</a>
          <a href={`${API_URL}/health`} target="_blank" rel="noreferrer" style={{ color: "#64748b", textDecoration: "none" }}>API Health</a>
          <a href={EXPLORER} target="_blank" rel="noreferrer" style={{ color: "#64748b", textDecoration: "none" }}>Explorer</a>
        </div>
      </div>

      {showRegister && (
        <RegisterModal
          wallet={wallet}
          onClose={() => setRegister(false)}
          onSuccess={() => {
            setRegister(false);
            setTab("agents");
            refetchAgents();
            refetchStats();
          }}
        />
      )}
    </div>
  );
}
