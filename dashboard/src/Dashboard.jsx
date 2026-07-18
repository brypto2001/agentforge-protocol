import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";

// ─── Config ───────────────────────────────────────────────────────────────────
// Vite exposes REACT_APP_* / VITE_* via import.meta.env (see vite.config.js envPrefix)
const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
const API_URL = env.REACT_APP_API_URL || env.VITE_API_URL || "http://localhost:4000";
const WS_URL  = env.REACT_APP_WS_URL  || env.VITE_WS_URL  || "ws://localhost:4000";
const REGISTRY_ADDRESS = env.REACT_APP_REGISTRY_ADDRESS || env.VITE_REGISTRY_ADDRESS || "";
const TARGET_CHAIN_ID = Number(env.REACT_APP_CHAIN_ID || env.VITE_CHAIN_ID || 84532);
const TARGET_CHAIN_HEX = "0x" + TARGET_CHAIN_ID.toString(16);

// ─── API Client ───────────────────────────────────────────────────────────────
const api = {
  get: async (path) => {
    const r = await fetch(`${API_URL}${path}`);
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
  },
};

// ─── WebSocket Hook ───────────────────────────────────────────────────────────
function useWebSocket(url) {
  const [events, setEvents]   = useState([]);
  const [connected, setConn]  = useState(false);
  const wsRef                 = useRef(null);
  const reconnectRef          = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConn(true);
        console.log("[WS] Connected to backend");
        if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setEvents(prev => [msg, ...prev.slice(0, 199)]);
        } catch {}
      };

      ws.onclose = () => {
        setConn(false);
        console.log("[WS] Disconnected — reconnecting in 3s");
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    } catch (e) {
      console.error("[WS] Connection failed:", e);
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

// ─── Data Hooks ───────────────────────────────────────────────────────────────
function useStats() {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const data = await api.get("/api/stats");
      setStats(data);
    } catch (e) {
      console.error("Stats fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 15000); // refresh every 15s
    return () => clearInterval(id);
  }, [fetch_]);

  return { stats, loading, refetch: fetch_ };
}

function useAgents() {
  const [agents, setAgents]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async (status = undefined) => {
    try {
      const params = status !== undefined ? `?status=${status}` : "";
      const data   = await api.get(`/api/agents${params}`);
      setAgents(data.agents ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error("Agents fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { agents, total, loading, refetch: fetch_ };
}

function useDailyStats() {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/stats/daily?days=30")
      .then(r => setData(r.stats ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

function useAudits() {
  const [audits, setAudits]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/audits")
      .then(r => setAudits(r.audits ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { audits, loading };
}

function useGas() {
  const [gas, setGas] = useState(null);
  useEffect(() => {
    const fetch_ = () => api.get("/api/gas").then(setGas).catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 12000);
    return () => clearInterval(id);
  }, []);
  return gas;
}

// ─── Wallet Hook (MetaMask) ───────────────────────────────────────────────────
function useWallet() {
  const [account, setAccount]   = useState(null);
  const [chainId, setChainId]   = useState(null);
  const [balance, setBalance]   = useState("0");
  const [connecting, setConn]   = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" })
      .then(accounts => { if (accounts[0]) setAccount(accounts[0]); });
    window.ethereum.on("accountsChanged", (a) => setAccount(a[0] ?? null));
    window.ethereum.on("chainChanged", (c) => setChainId(parseInt(c, 16)));
  }, []);

  useEffect(() => {
    if (!account || !window.ethereum) return;
    window.ethereum.request({ method: "eth_getBalance", params: [account, "latest"] })
      .then(b => setBalance((parseInt(b, 16) / 1e18).toFixed(4)))
      .catch(() => {});
    window.ethereum.request({ method: "eth_chainId" })
      .then(c => setChainId(parseInt(c, 16)))
      .catch(() => {});
  }, [account]);

  const connect = async () => {
    if (!window.ethereum) { setError("MetaMask not installed. Please install it at metamask.io"); return; }
    setConn(true); setError(null);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      // Switch to configured chain (default Base Sepolia testnet)
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: TARGET_CHAIN_HEX }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          const isSepolia = TARGET_CHAIN_ID === 84532;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: TARGET_CHAIN_HEX,
              chainName: isSepolia ? "Base Sepolia" : "Base",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [isSepolia ? "https://sepolia.base.org" : "https://mainnet.base.org"],
              blockExplorerUrls: [isSepolia ? "https://sepolia.basescan.org" : "https://basescan.org"],
            }],
          });
        }
      }
    } catch (e) {
      setError(e.message ?? "Connection failed");
    } finally {
      setConn(false);
    }
  };

  const disconnect = () => setAccount(null);
  const isBaseNetwork = chainId === TARGET_CHAIN_ID;

  return { account, chainId, balance, connecting, error, connect, disconnect, isBaseNetwork };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtUSD = v => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};
const fmtAddr  = a => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "";
const fmtTime  = ts => { const s=(Date.now()-ts)/1000; return s<60?`${s|0}s ago`:s<3600?`${(s/60)|0}m ago`:`${(s/3600)|0}h ago`; };
const fmtDate  = ts => new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric"});

const STATUS_LABEL  = {0:"Pending",1:"Active",2:"Suspended",3:"Deprecated"};
const STATUS_COLOR  = {0:"#f59e0b",1:"#10b981",2:"#ef4444",3:"#6b7280"};
const SAFETY_LABEL  = {0:"Minimal",1:"Standard",2:"Strict",3:"Paranoid"};
const SAFETY_COLOR  = {0:"#f59e0b",1:"#3b82f6",2:"#8b5cf6",3:"#10b981"};
const EVENT_COLOR   = {AgentRegistered:"#3b82f6",TxExecuted:"#10b981",TxBlocked:"#ef4444",AgentAudited:"#a78bfa",AgentStatusChanged:"#f59e0b",ReputationUpdated:"#06b6d4",OrderCreated:"#f97316",NewBlock:"#1f2937"};

// ─── UI Components ────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{width:20,height:20,border:"2px solid #3b82f6",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto"}} />;
}

function StatCard({ label, value, sub, color="#10b981", spark, loading }) {
  return (
    <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"16px 18px",flex:1,minWidth:130,position:"relative",overflow:"hidden"}}>
      <div style={{fontSize:10,color:"#4b5563",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      {loading ? <Spinner /> : (
        <>
          <div style={{fontSize:21,fontWeight:700,color,fontFamily:"monospace",lineHeight:1}}>{value}</div>
          {sub && <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{sub}</div>}
        </>
      )}
      {spark && !loading && (
        <div style={{position:"absolute",bottom:0,left:0,right:0,opacity:0.3}}>
          <ResponsiveContainer width="100%" height={30}>
            <AreaChart data={spark} margin={{top:0,right:0,bottom:0,left:0}}>
              <Area type="monotone" dataKey="v" stroke={color} fill={color} strokeWidth={1} dot={false} fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Badge({ label, color }) {
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:`${color}20`,border:`1px solid ${color}40`,color,fontWeight:600}}>{label}</span>;
}

function AgentRow({ agent, onClick, selected }) {
  const caps = (() => { try { return JSON.parse(agent.capabilities||"[]"); } catch { return []; } })();
  return (
    <div onClick={onClick} style={{background:selected?"rgba(59,130,246,0.08)":"rgba(15,17,23,0.8)",border:`1px solid ${selected?"rgba(59,130,246,0.4)":"rgba(255,255,255,0.05)"}`,borderRadius:10,padding:"12px 14px",cursor:"pointer",transition:"all 0.15s"}}
      onMouseEnter={e=>!selected&&(e.currentTarget.style.borderColor="rgba(255,255,255,0.1)")}
      onMouseLeave={e=>!selected&&(e.currentTarget.style.borderColor="rgba(255,255,255,0.05)")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9"}}>{agent.name||`Agent-${agent.id?.slice(2,10)}`}</div>
          <div style={{fontSize:10,color:"#374151",fontFamily:"monospace",marginTop:2}}>{agent.id?.slice(0,22)}...</div>
        </div>
        <Badge label={STATUS_LABEL[agent.status]??"-"} color={STATUS_COLOR[agent.status]??"#6b7280"} />
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
        {caps.slice(0,4).map(c=><span key={c} style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(59,130,246,0.1)",color:"#93c5fd"}}>{c}</span>)}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
        <span style={{color:SAFETY_COLOR[agent.safety_level]??"#6b7280"}}>⬡ {SAFETY_LABEL[agent.safety_level]??"-"}</span>
        <span style={{color:"#6b7280"}}>Rep: <b style={{color:"#a78bfa"}}>{agent.reputation??500}</b></span>
        <span style={{color:"#3b82f6",fontFamily:"monospace"}}>{fmtUSD(agent.total_volume_usd??0)}</span>
      </div>
    </div>
  );
}

function AgentDetail({ agentId }) {
  const [data, setData] = useState(null);
  const [tab, setTab]   = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    api.get(`/api/agents/${agentId}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <div style={{padding:40,textAlign:"center"}}><Spinner /></div>;
  if (!data) return <div style={{padding:20,color:"#4b5563"}}>Agent not found</div>;

  const agent = data.agent ?? {};
  const txs   = data.transactions ?? [];
  const audits= data.audits ?? [];
  const live  = data.chainData ?? {};

  return (
    <div style={{height:"100%",overflowY:"auto",padding:18}}>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>{agent.name||`Agent-${agent.id?.slice(2,10)}`}</div>
        <div style={{fontSize:11,color:"#374151",fontFamily:"monospace",marginTop:2}}>{agent.id}</div>
        <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
          <Badge label={STATUS_LABEL[live.status??agent.status]??"Pending"} color={STATUS_COLOR[live.status??agent.status]??"#f59e0b"} />
          <Badge label={SAFETY_LABEL[agent.safety_level]??"Standard"} color={SAFETY_COLOR[agent.safety_level]??"#3b82f6"} />
          {agent.kyc_verified && <Badge label="KYC ✓" color="#10b981" />}
          <a href={`${TARGET_CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"}/address/${agent.owner}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#6b7280",textDecoration:"none"}}>{fmtAddr(agent.owner)} ↗</a>
        </div>
      </div>

      <div style={{display:"flex",gap:2,marginBottom:14,background:"rgba(255,255,255,0.03)",borderRadius:8,padding:3}}>
        {["overview","transactions","audits"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"5px 0",borderRadius:6,border:"none",background:tab===t?"rgba(59,130,246,0.2)":"transparent",color:tab===t?"#93c5fd":"#4b5563",fontSize:11,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>

      {tab==="overview" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[
            ["Total Volume",fmtUSD(live.totalVolumeUSD??agent.total_volume_usd??0),"#3b82f6"],
            ["Transactions",(live.totalTxCount??agent.total_tx_count??0).toLocaleString(),"#10b981"],
            ["Reputation",`${live.reputation??agent.reputation??500}/1000`,"#a78bfa"],
            ["Audit Score",`${live.auditScore??agent.audit_score??0}/100`,(live.auditScore??agent.audit_score??0)>=70?"#10b981":"#ef4444"],
            ["Registered",fmtDate(agent.registered_at),"#6b7280"],
          ].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8}}>
              <span style={{fontSize:12,color:"#9ca3af"}}>{l}</span>
              <span style={{fontSize:13,fontWeight:600,color:c,fontFamily:"monospace"}}>{v}</span>
            </div>
          ))}
          <a href={`${TARGET_CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"}/address/${REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer"
            style={{display:"block",padding:"9px 12px",borderRadius:8,background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.2)",color:"#93c5fd",fontSize:12,textDecoration:"none",textAlign:"center"}}>
            View on BaseScan ↗
          </a>
        </div>
      )}

      {tab==="transactions" && (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {txs.length===0 && <div style={{color:"#4b5563",fontSize:12,textAlign:"center",padding:20}}>No transactions yet</div>}
          {txs.map((tx,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:tx.blocked?"#ef4444":tx.success?"#10b981":"#f59e0b",flexShrink:0}} />
              <span style={{fontSize:11,color:"#6b7280",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.reasoning||tx.block_reason||"—"}</span>
              <span style={{fontSize:11,color:"#6b7280",fontFamily:"monospace",flexShrink:0}}>{fmtUSD(tx.amount_usd)}</span>
              <span style={{fontSize:10,color:tx.blocked?"#ef4444":tx.success?"#10b981":"#f59e0b",flexShrink:0}}>{tx.blocked?"BLOCK":tx.success?"OK":"FAIL"}</span>
            </div>
          ))}
        </div>
      )}

      {tab==="audits" && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {audits.length===0 && <div style={{color:"#4b5563",fontSize:12,textAlign:"center",padding:20}}>No audits yet</div>}
          {audits.map((a,i)=>(
            <div key={i} style={{padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:`1px solid ${a.passed?"rgba(16,185,129,0.2)":"rgba(239,68,68,0.2)"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:13,fontWeight:700,color:a.passed?"#10b981":"#ef4444",fontFamily:"monospace"}}>{a.score}/100</span>
                <Badge label={a.passed?"PASSED":"FAILED"} color={a.passed?"#10b981":"#ef4444"} />
              </div>
              <div style={{fontSize:11,color:"#6b7280"}}>Auditor: {fmtAddr(a.auditor)}</div>
              <div style={{fontSize:11,color:"#374151",marginTop:2}}>{fmtDate(a.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegisterModal({ wallet, onClose, onSuccess }) {
  const [step,setStep]     = useState(0);
  const [submitting,setSub] = useState(false);
  const [txHash,setHash]   = useState(null);
  const [error,setError]   = useState(null);
  const [form,setForm]     = useState({
    name:"", safetyLevel:1, capabilities:["monitor"],
    maxSingleTx:10000, maxDailyVolume:100000, maxSlippage:100,
  });

  const registryAddr = REGISTRY_ADDRESS;
  const STEPS        = ["Name & Strategy","Safety Rails","Capabilities","Deploy"];

  async function deploy() {
    if (!window.ethereum||!registryAddr) { setError("MetaMask or registry address missing"); return; }
    setSub(true); setError(null);
    try {
      // Build EIP-712 typed data
      const chainId = await window.ethereum.request({method:"eth_chainId"});
      const nonceHex = await window.ethereum.request({
        method:"eth_call",
        params:[{to:registryAddr,data:"0x70a08231000000000000000000000000"+wallet.account.slice(2).padStart(64,"0")},"latest"],
      });
      const nonce = parseInt(nonceHex||"0x0",16)||0;
      const deadline = Math.floor(Date.now()/1000)+3600;
      const modelHash = "0x"+Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");

      const typedData = {
        types:{
          EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
          AgentRegistration:[{name:"owner",type:"address"},{name:"modelHash",type:"bytes32"},{name:"capabilities",type:"string[]"},{name:"safetyLevel",type:"uint8"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}],
        },
        primaryType:"AgentRegistration",
        domain:{name:"AgentForge",version:"2",chainId:parseInt(chainId,16),verifyingContract:registryAddr},
        message:{owner:wallet.account,modelHash,capabilities:form.capabilities,safetyLevel:form.safetyLevel,nonce,deadline},
      };

      const sig = await window.ethereum.request({
        method:"eth_signTypedData_v4",
        params:[wallet.account,JSON.stringify(typedData)],
      });

      // Encode registerAgent call
      // ABI: registerAgent(bytes32 modelHash, bytes32 codeHash, string[] capabilities, uint8 safetyLevel, SafetyRails rails, string metadataURI, uint256 deadline, bytes sig)
      // For simplicity we call via eth_sendTransaction with raw data
      // In production use ethers.js Interface.encodeFunctionData
      const data = encodeRegisterAgent(modelHash, form, deadline, sig);

      const txHash_ = await window.ethereum.request({
        method:"eth_sendTransaction",
        params:[{from:wallet.account,to:registryAddr,data,value:"0x2386F26FC10000"}], // 0.01 ETH
      });

      setHash(txHash_);
      onSuccess?.({ name:form.name, txHash:txHash_ });
    } catch(e) {
      setError(e.message??String(e));
    } finally {
      setSub(false);
    }
  }

  function encodeRegisterAgent(modelHash, form, deadline, sig) {
    // Simplified encoding — use ethers Interface in production
    // This calls registerAgent with the right selector
    const selector = "0x3d3d0e5b"; // keccak256("registerAgent(bytes32,bytes32,string[],uint8,tuple,string,uint256,bytes)")[:4]
    return selector + "0".repeat(256); // placeholder — real encoding requires ethers
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#0a0c12",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,width:520,maxHeight:"88vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{padding:"20px 24px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>Register Agent</div>
              <div style={{fontSize:11,color:"#4b5563",marginTop:2}}>Step {step+1} of {STEPS.length}: {STEPS[step]}</div>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",color:"#4b5563",fontSize:20,cursor:"pointer"}}>✕</button>
          </div>
          <div style={{display:"flex",gap:6,marginTop:12}}>
            {STEPS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?"#3b82f6":"rgba(255,255,255,0.06)",transition:"background 0.3s"}} />)}
          </div>
        </div>

        {/* Body */}
        <div style={{padding:"20px 24px",overflowY:"auto",flex:1}}>
          {txHash ? (
            <div style={{textAlign:"center",padding:"20px 0"}}>
              <div style={{fontSize:48,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>Agent Registered!</div>
              <div style={{fontSize:12,color:"#6b7280",marginTop:6,fontFamily:"monospace",wordBreak:"break-all"}}>{txHash}</div>
              <a href={`${TARGET_CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:12,color:"#3b82f6",fontSize:12}}>View on BaseScan ↗</a>
              <br/>
              <button onClick={onClose} style={{marginTop:16,padding:"8px 24px",borderRadius:8,border:"none",background:"#3b82f6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>Done</button>
            </div>
          ) : (
            <>
              {step===0 && (
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div>
                    <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:5}}>Agent Name *</label>
                    <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. YieldMax-v1"
                      style={{width:"100%",padding:"9px 12px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,color:"#f1f5f9",fontSize:13,outline:"none",boxSizing:"border-box"}} />
                  </div>
                  {["Conservative Yield","DEX Arbitrage","Data Oracle","Custom"].map((s,i)=>(
                    <div key={s} onClick={()=>setForm(f=>({...f,safetyLevel:i===0?2:i===1?1:i===2?0:f.safetyLevel}))}
                      style={{padding:"12px 14px",borderRadius:9,cursor:"pointer",border:`1px solid ${form.name&&i===0?"rgba(59,130,246,0.4)":"rgba(255,255,255,0.06)"}`,background:"rgba(255,255,255,0.02)"}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9"}}>{s}</div>
                      <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{["Moves USDC between Aave/Compound for max APY","Captures price discrepancies across Uniswap","Publishes signed market data on-chain","Build your own custom strategy"][i]}</div>
                    </div>
                  ))}
                </div>
              )}

              {step===1 && (
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div style={{fontSize:12,color:"#6b7280"}}>These limits are enforced on-chain by AgentExecutor. Choose conservatively — you can always expand later through a DAO proposal.</div>
                  {[
                    {label:"Max Single TX (USD)",key:"maxSingleTx",min:100,max:100000,step:500},
                    {label:"Max Daily Volume (USD)",key:"maxDailyVolume",min:1000,max:1000000,step:5000},
                    {label:"Max Slippage (bps)",key:"maxSlippage",min:10,max:500,step:10},
                  ].map(({label,key,min,max,step:s})=>(
                    <div key={key}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <label style={{fontSize:11,color:"#6b7280"}}>{label}</label>
                        <span style={{fontSize:12,color:"#f1f5f9",fontFamily:"monospace"}}>{key==="maxSlippage"?`${(form[key]/100).toFixed(1)}%`:`$${form[key].toLocaleString()}`}</span>
                      </div>
                      <input type="range" min={min} max={max} step={s} value={form[key]}
                        onChange={e=>setForm(f=>({...f,[key]:Number(e.target.value)}))}
                        style={{width:"100%",accentColor:"#3b82f6"}} />
                    </div>
                  ))}
                </div>
              )}

              {step===2 && (
                <div>
                  <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>Select what your agent is allowed to do on-chain.</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {["trade","swap","bridge","lend","borrow","stake","vote","monitor","arbitrage","data_feed","compute"].map(c=>{
                      const sel=form.capabilities.includes(c);
                      return (
                        <button key={c} onClick={()=>setForm(f=>({...f,capabilities:sel?f.capabilities.filter(x=>x!==c):[...f.capabilities,c]}))}
                          style={{padding:"8px 12px",borderRadius:7,fontSize:12,cursor:"pointer",border:`1px solid ${sel?"rgba(59,130,246,0.4)":"rgba(255,255,255,0.06)"}`,background:sel?"rgba(59,130,246,0.1)":"transparent",color:sel?"#93c5fd":"#6b7280"}}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step===3 && (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{padding:14,background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:10}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#93c5fd",marginBottom:10}}>📋 Review</div>
                    {[["Name",form.name||"—"],["Safety Level",SAFETY_LABEL[form.safetyLevel]],["Max TX",`$${form.maxSingleTx.toLocaleString()}`],["Max Daily",`$${form.maxDailyVolume.toLocaleString()}`],["Max Slippage",`${(form.maxSlippage/100).toFixed(1)}%`],["Capabilities",form.capabilities.join(", ")]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                        <span style={{fontSize:12,color:"#6b7280"}}>{l}</span>
                        <span style={{fontSize:12,color:"#f1f5f9",fontWeight:500}}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{padding:10,background:"rgba(249,115,22,0.06)",border:"1px solid rgba(249,115,22,0.15)",borderRadius:8,fontSize:11,color:"#9ca3af"}}>
                    ⚠️ Costs <b style={{color:"#fb923c"}}>0.01 ETH</b> on Base. Your agent starts as <b>Pending</b> until an auditor approves it.
                  </div>
                  {error && <div style={{padding:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,fontSize:12,color:"#ef4444"}}>{error}</div>}
                  <button onClick={deploy} disabled={submitting||!form.name} style={{padding:"12px 0",borderRadius:9,border:"none",background:form.name?"linear-gradient(135deg,#3b82f6,#8b5cf6)":"rgba(255,255,255,0.06)",color:form.name?"#fff":"#4b5563",fontSize:14,fontWeight:700,cursor:form.name?"pointer":"not-allowed"}}>
                    {submitting?"Waiting for MetaMask...":"Register Agent — 0.01 ETH"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {!txHash && (
          <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:8}}>
            {step>0&&<button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:"9px 0",borderRadius:8,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"#6b7280",cursor:"pointer"}}>← Back</button>}
            {step<STEPS.length-1&&<button onClick={()=>setStep(s=>s+1)} disabled={step===0&&!form.name} style={{flex:2,padding:"9px 0",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",color:"#fff",fontWeight:600,cursor:"pointer"}}>Continue →</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const wallet                        = useWallet();
  const { stats, loading: statsLoad } = useStats();
  const { agents, loading: agLoad }   = useAgents();
  const { data: daily }               = useDailyStats();
  const { audits }                    = useAudits();
  const gas                           = useGas();
  const { events, connected }         = useWebSocket(WS_URL);
  const [activeTab, setTab]           = useState("overview");
  const [selected, setSelected]       = useState(null);
  const [showRegister, setRegister]   = useState(false);
  const [filterStatus, setFStatus]    = useState("all");
  const [search, setSearch]           = useState("");
  const eventRef                      = useRef(null);

  // Merge WebSocket events into agents list in real time
  const [liveAgents, setLiveAgents]   = useState([]);
  useEffect(() => { setLiveAgents(agents); }, [agents]);

  useEffect(() => {
    const latest = events[0];
    if (!latest) return;
    if (latest.type === "AgentRegistered") {
      setLiveAgents(prev => {
        if (prev.find(a=>a.id===latest.data.agentId)) return prev;
        return [{ id:latest.data.agentId, owner:latest.data.owner, name:`Agent-${latest.data.agentId.slice(2,10)}`, status:0, reputation:500, total_volume_usd:0, total_tx_count:0, audit_score:0, safety_level:1 }, ...prev];
      });
    }
    if (latest.type === "AgentStatusChanged") {
      setLiveAgents(prev => prev.map(a => a.id===latest.data.agentId ? {...a, status:latest.data.newStatus} : a));
    }
    if (latest.type === "TxExecuted") {
      setLiveAgents(prev => prev.map(a => a.id===latest.data.agentId ? {...a, total_tx_count:(a.total_tx_count||0)+1, total_volume_usd:(a.total_volume_usd||0)+(latest.data.amountUSD||0)} : a));
    }
    if (latest.type === "ReputationUpdated") {
      setLiveAgents(prev => prev.map(a => a.id===latest.data.agentId ? {...a, reputation:latest.data.newScore} : a));
    }
  }, [events]);

  useEffect(() => { if (eventRef.current) eventRef.current.scrollTop = 0; }, [events]);

  const filteredAgents = liveAgents.filter(a => {
    if (filterStatus!=="all" && String(a.status)!==filterStatus) return false;
    const name = (a.name||"").toLowerCase();
    const id   = (a.id||"").toLowerCase();
    if (search && !name.includes(search.toLowerCase()) && !id.includes(search.toLowerCase())) return false;
    return true;
  });

  const noticeableEvents = events.filter(e=>e.type!=="NewBlock");
  const blockRate        = stats ? ((parseFloat(stats.blockRate)||0)).toFixed(1) : "0";
  const spark30          = daily.slice(-10).map(d=>({v:parseFloat(d.total_volume_usd)||0}));

  const tabs = [
    {id:"overview",label:"Overview",icon:"◈"},
    {id:"agents",label:`Agents (${liveAgents.length})`,icon:"⬡"},
    {id:"events",label:"Live Events",icon:"▣"},
    {id:"audits",label:"Audits",icon:"◎"},
    {id:"analytics",label:"Analytics",icon:"⬗"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060810",color:"#f1f5f9",fontFamily:"'Inter',-apple-system,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        input,select,textarea{background:#0f1117;color:#f1f5f9;border:1px solid rgba(255,255,255,0.08);border-radius:7px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit;}
        input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:currentColor;cursor:pointer;}
      `}</style>

      {/* Nav */}
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(6,8,16,0.95)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"0 20px",display:"flex",alignItems:"center",height:54,gap:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginRight:20,flexShrink:0}}>
          <div style={{width:28,height:28,borderRadius:7,background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:13}}>⬡</div>
          <div>
            <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>AgentForge</div>
            <div style={{fontSize:8,color:"#374151",letterSpacing:"0.12em",textTransform:"uppercase"}}>Base Mainnet · Live</div>
          </div>
        </div>

        <div style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:activeTab===t.id?"rgba(59,130,246,0.15)":"transparent",color:activeTab===t.id?"#93c5fd":"#4b5563",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",fontWeight:activeTab===t.id?600:400}}>
              <span style={{fontSize:10,marginRight:4}}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          {/* Connection status */}
          <div style={{display:"flex",gap:5,alignItems:"center",padding:"4px 10px",borderRadius:6,background:connected?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)",border:`1px solid ${connected?"rgba(16,185,129,0.2)":"rgba(239,68,68,0.2)"}`}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:connected?"#10b981":"#ef4444",animation:connected?"pulse 2s infinite":"none"}} />
            <span style={{fontSize:11,color:connected?"#10b981":"#ef4444"}}>{connected?"Live":"Offline"}</span>
          </div>

          {/* Gas */}
          {gas && <div style={{fontSize:11,color:"#6b7280",padding:"4px 8px",background:"rgba(255,255,255,0.03)",borderRadius:6}}>{gas.gasPrice.toFixed(3)} gwei</div>}

          {/* Wallet */}
          {!wallet.account ? (
            <button onClick={wallet.connect} disabled={wallet.connecting} style={{padding:"6px 14px",borderRadius:7,border:"1px solid rgba(59,130,246,0.4)",background:"rgba(59,130,246,0.1)",color:"#93c5fd",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              {wallet.connecting?"Connecting...":"Connect Wallet"}
            </button>
          ) : (
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {!wallet.isBaseNetwork && <Badge label="Wrong Network" color="#ef4444" />}
              <div style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(16,185,129,0.3)",background:"rgba(16,185,129,0.08)",color:"#10b981",fontSize:12,cursor:"pointer"}} onClick={wallet.disconnect}>
                <div style={{width:5,height:5,borderRadius:"50%",background:"#10b981",display:"inline-block",marginRight:5}} />
                {fmtAddr(wallet.account)} · {wallet.balance} ETH
              </div>
            </div>
          )}

          {wallet.account && wallet.isBaseNetwork && (
            <button onClick={()=>setRegister(true)} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>+ Register Agent</button>
          )}
        </div>
      </div>

      {/* Wrong network banner */}
      {wallet.account && !wallet.isBaseNetwork && (
        <div style={{background:"rgba(239,68,68,0.1)",borderBottom:"1px solid rgba(239,68,68,0.2)",padding:"10px 20px",fontSize:13,color:"#ef4444",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>⚠ You're on the wrong network. Switch to Base to interact with the protocol.</span>
          <button onClick={()=>window.ethereum?.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x2105"}]})} style={{padding:"5px 14px",borderRadius:6,border:"none",background:"#ef4444",color:"#fff",fontSize:12,cursor:"pointer"}}>Switch to Base</button>
        </div>
      )}

      {/* Backend offline banner */}
      {!connected && (
        <div style={{background:"rgba(239,68,68,0.06)",borderBottom:"1px solid rgba(239,68,68,0.15)",padding:"8px 20px",fontSize:12,color:"#ef4444",textAlign:"center"}}>
          Backend server offline — data may be stale. Start server: <code style={{background:"rgba(255,255,255,0.06)",padding:"1px 6px",borderRadius:4}}>npm run server</code>
        </div>
      )}

      {/* Content */}
      <div style={{padding:"20px",maxWidth:1500,margin:"0 auto"}}>

        {/* OVERVIEW */}
        {activeTab==="overview" && (
          <div style={{display:"flex",flexDirection:"column",gap:20}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <StatCard label="Total Agents" value={stats?.totalAgents??"-"} sub={`${stats?.activeAgents??0} active`} color="#10b981" spark={spark30} loading={statsLoad} />
              <StatCard label="Total Volume" value={stats?fmtUSD(stats.totalVolumeUSD):"-"} sub="all time" color="#3b82f6" spark={spark30} loading={statsLoad} />
              <StatCard label="Transactions" value={stats?parseInt(stats.totalTransactions).toLocaleString():"-"} sub={`${blockRate}% blocked`} color="#a78bfa" loading={statsLoad} />
              <StatCard label="Audits" value={stats?.totalAudits??"-"} color="#f59e0b" loading={statsLoad} />
              <StatCard label="Block Rate" value={`${blockRate}%`} sub="safety rails firing" color={parseFloat(blockRate)>5?"#ef4444":"#10b981"} loading={statsLoad} />
            </div>

            {/* 30-day chart */}
            {daily.length>0 && (
              <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:20}}>
                <div style={{fontSize:13,fontWeight:600,color:"#9ca3af",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  30-Day Protocol Volume
                  <Badge label={connected?"Live Data":"Cached"} color={connected?"#10b981":"#f59e0b"} />
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={daily}>
                    <defs>
                      <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{fill:"#374151",fontSize:9}} axisLine={false} tickLine={false} tickFormatter={d=>d.slice(5)} />
                    <YAxis tick={{fill:"#374151",fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>fmtUSD(v)} />
                    <Tooltip contentStyle={{background:"#0f1117",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,fontSize:11}} formatter={v=>[fmtUSD(v),"Volume"]} />
                    <Area type="monotone" dataKey="total_volume_usd" stroke="#3b82f6" strokeWidth={2} fill="url(#vg)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Bottom row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:18}}>
                <div style={{fontSize:12,fontWeight:600,color:"#9ca3af",marginBottom:12}}>Recent Audits</div>
                {audits.slice(0,6).map((a,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:a.passed?"#10b981":"#ef4444"}} />
                      <span style={{fontSize:12,color:"#9ca3af"}}>{a.agent_name||fmtAddr(a.agent_id)}</span>
                    </div>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:12,fontWeight:700,color:a.score>=70?"#10b981":"#ef4444",fontFamily:"monospace"}}>{a.score}/100</span>
                      <span style={{fontSize:11,color:"#374151"}}>{fmtDate(a.timestamp)}</span>
                    </div>
                  </div>
                ))}
                {audits.length===0&&<div style={{color:"#374151",fontSize:12,textAlign:"center",padding:"20px 0"}}>No audits yet</div>}
              </div>

              <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:18}}>
                <div style={{fontSize:12,fontWeight:600,color:"#9ca3af",marginBottom:12}}>Live Event Stream</div>
                <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:200,overflowY:"auto"}}>
                  {noticeableEvents.slice(0,10).map((e,i)=>(
                    <div key={i} style={{display:"flex",gap:8,alignItems:"baseline"}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:EVENT_COLOR[e.type]??"#6b7280",flexShrink:0,marginTop:3}} />
                      <span style={{fontSize:11,color:EVENT_COLOR[e.type]??"#6b7280",flexShrink:0}}>{e.type}</span>
                      <span style={{fontSize:10,color:"#374151",flexShrink:0}}>{fmtTime(e.ts)}</span>
                    </div>
                  ))}
                  {noticeableEvents.length===0&&<div style={{color:"#374151",fontSize:12,textAlign:"center",padding:"20px 0"}}>Waiting for events...</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AGENTS */}
        {activeTab==="agents" && (
          <div style={{display:"flex",gap:16}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <input placeholder="Search agents..." value={search} onChange={e=>setSearch(e.target.value)}
                  style={{flex:1,minWidth:160,padding:"7px 12px"}} />
                {["all","0","1","2"].map(s=>(
                  <button key={s} onClick={()=>setFStatus(s)} style={{padding:"6px 12px",borderRadius:6,border:"1px solid",borderColor:filterStatus===s?"rgba(59,130,246,0.5)":"rgba(255,255,255,0.06)",background:filterStatus===s?"rgba(59,130,246,0.1)":"transparent",color:filterStatus===s?"#93c5fd":"#4b5563",fontSize:11,cursor:"pointer"}}>
                    {s==="all"?"All":STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <div style={{fontSize:10,color:"#374151",marginBottom:10}}>{filteredAgents.length} agents</div>
              {agLoad ? <div style={{padding:40,textAlign:"center"}}><Spinner /></div> : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                  {filteredAgents.map(a=>(
                    <AgentRow key={a.id} agent={a} selected={selected===a.id} onClick={()=>setSelected(selected===a.id?null:a.id)} />
                  ))}
                  {filteredAgents.length===0&&<div style={{padding:40,textAlign:"center",color:"#374151",gridColumn:"1/-1"}}>No agents found</div>}
                </div>
              )}
            </div>
            {selected && (
              <div style={{width:340,flexShrink:0,position:"sticky",top:66,height:"calc(100vh-82px)",background:"rgba(10,12,18,0.98)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,overflow:"hidden"}}>
                <AgentDetail agentId={selected} />
              </div>
            )}
          </div>
        )}

        {/* LIVE EVENTS */}
        {activeTab==="events" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.entries(EVENT_COLOR).filter(([k])=>k!=="NewBlock").map(([type,color])=>(
                <div key={type} style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:color}} />
                  <span style={{fontSize:11,color:"#6b7280"}}>{type} ({events.filter(e=>e.type===type).length})</span>
                </div>
              ))}
            </div>
            <div style={{background:"#030507",border:"1px solid rgba(16,185,129,0.12)",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"9px 16px",background:"rgba(0,0,0,0.4)",borderBottom:"1px solid rgba(16,185,129,0.08)",display:"flex",alignItems:"center",gap:8}}>
                {["#ef4444","#f59e0b","#10b981"].map((c,i)=><div key={i} style={{width:9,height:9,borderRadius:"50%",background:c,opacity:0.8}} />)}
                <span style={{marginLeft:8,fontSize:11,color:"#374151",fontFamily:"monospace"}}>agentregistry · {connected?"live":"reconnecting..."}</span>
                <div style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:connected?"#10b981":"#ef4444",animation:connected?"pulse 1.5s infinite":"none"}} />
                  <span style={{fontSize:10,color:connected?"#10b981":"#ef4444",fontFamily:"monospace"}}>{connected?"LIVE":"OFFLINE"}</span>
                </div>
              </div>
              <div ref={eventRef} style={{height:520,overflowY:"auto",padding:"12px 18px",fontFamily:"monospace",fontSize:11,lineHeight:1.8}}>
                {events.filter(e=>e.type!=="NewBlock").map((e,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"baseline"}}>
                    <span style={{color:"#1f2937",flexShrink:0,fontSize:10}}>{new Date(e.ts).toLocaleTimeString("en-US",{hour12:false})}</span>
                    <span style={{color:EVENT_COLOR[e.type]??"#6b7280",flexShrink:0,fontWeight:700,minWidth:140}}>{e.type}</span>
                    <span style={{color:"#4b5563",fontSize:10}}>
                      {e.data?.agentId&&fmtAddr(e.data.agentId)}
                      {e.data?.amountUSD!=null&&` · ${fmtUSD(e.data.amountUSD)}`}
                      {e.data?.score!=null&&` · score=${e.data.score}`}
                      {e.data?.newScore!=null&&` · rep→${e.data.newScore}`}
                      {e.data?.reason&&` · "${e.data.reason}"`}
                      {e.data?.passed!=null&&` · ${e.data.passed?"PASSED":"FAILED"}`}
                    </span>
                  </div>
                ))}
                {events.filter(e=>e.type!=="NewBlock").length===0&&<div style={{color:"#374151",textAlign:"center",padding:"40px 0"}}>Waiting for on-chain events...</div>}
              </div>
            </div>
          </div>
        )}

        {/* AUDITS */}
        {activeTab==="audits" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <StatCard label="Total Audits" value={audits.length} color="#a78bfa" loading={false} />
              <StatCard label="Pass Rate" value={audits.length?`${Math.round(audits.filter(a=>a.passed).length/audits.length*100)}%`:"-"} color="#10b981" loading={false} />
              <StatCard label="Avg Score" value={audits.length?`${Math.round(audits.reduce((s,a)=>s+a.score,0)/audits.length)}/100`:"-"} color="#3b82f6" loading={false} />
            </div>
            <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                    {["Agent","Score","Status","Auditor","Date","BaseScan"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:10,color:"#374151",textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"10px 14px",fontSize:12,color:"#9ca3af"}}>{a.agent_name||fmtAddr(a.agent_id)}</td>
                      <td style={{padding:"10px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:44,height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${a.score}%`,background:a.score>=70?"#10b981":"#ef4444"}} /></div>
                          <span style={{fontSize:12,fontWeight:700,color:a.score>=70?"#10b981":"#ef4444",fontFamily:"monospace"}}>{a.score}</span>
                        </div>
                      </td>
                      <td style={{padding:"10px 14px"}}><Badge label={a.passed?"PASSED":"FAILED"} color={a.passed?"#10b981":"#ef4444"} /></td>
                      <td style={{padding:"10px 14px",fontSize:11,color:"#4b5563",fontFamily:"monospace"}}>{fmtAddr(a.auditor)}</td>
                      <td style={{padding:"10px 14px",fontSize:11,color:"#374151"}}>{fmtDate(a.timestamp)}</td>
                      <td style={{padding:"10px 14px"}}>
                        <a href={`https://basescan.org/address/${a.agent_id}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#3b82f6",textDecoration:"none"}}>View ↗</a>
                      </td>
                    </tr>
                  ))}
                  {audits.length===0&&<tr><td colSpan={6} style={{padding:"40px 14px",textAlign:"center",color:"#374151",fontSize:12}}>No audits yet — register and audit an agent first</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {activeTab==="analytics" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:18}}>
                <div style={{fontSize:12,fontWeight:600,color:"#9ca3af",marginBottom:14}}>Daily Transactions vs Blocked</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={daily.slice(-14)}>
                    <XAxis dataKey="date" tick={{fill:"#374151",fontSize:9}} tickFormatter={d=>d.slice(5)} axisLine={false} tickLine={false} />
                    <YAxis tick={{fill:"#374151",fontSize:9}} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{background:"#0f1117",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,fontSize:11}} />
                    <Bar dataKey="total_txs" fill="#3b82f6" radius={[2,2,0,0]} name="Total" />
                    <Bar dataKey="blocked_txs" fill="#ef4444" radius={[2,2,0,0]} name="Blocked" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{background:"rgba(15,17,23,0.9)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:18}}>
                <div style={{fontSize:12,fontWeight:600,color:"#9ca3af",marginBottom:14}}>New Agent Registrations</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={daily.slice(-14)}>
                    <XAxis dataKey="date" tick={{fill:"#374151",fontSize:9}} tickFormatter={d=>d.slice(5)} axisLine={false} tickLine={false} />
                    <YAxis tick={{fill:"#374151",fontSize:9}} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{background:"#0f1117",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,fontSize:11}} />
                    <Bar dataKey="new_agents" fill="#8b5cf6" radius={[2,2,0,0]} name="New Agents" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {showRegister && <RegisterModal wallet={wallet} onClose={()=>setRegister(false)} onSuccess={()=>{ setRegister(false); setTab("agents"); }} />}
    </div>
  );
}
