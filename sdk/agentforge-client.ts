/**
 * AgentForge Client SDK
 * ─────────────────────
 * The only supported path for custom agents:
 *   1. register()        → on-chain identity + rails
 *   2. checkRails()      → view call (will this intent pass?)
 *   3. execute()         → MUST go through AgentExecutor
 *
 * Direct Aave/Uniswap txs without execute() are NOT AgentForge-compliant.
 */

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  BrowserProvider,
  keccak256,
  toUtf8Bytes,
  parseEther,
  isAddress,
  ZeroAddress,
  ZeroHash,
  id,
  type Signer,
  type Provider,
} from "ethers";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const REGISTRY_ABI = [
  "function registerAgent(bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,(uint256 maxSingleTxUSD,uint256 maxDailyVolumeUSD,uint256 maxSlippageBps,address[] allowedProtocols,address[] allowedTokens,bool requiresMultisig,uint256 multisigThresholdUSD,uint256 cooldownPeriod) rails,string metadataURI,uint256 deadline,bytes signature) payable returns (bytes32)",
  "function registrationFee() view returns (uint256)",
  "function getAgent(bytes32 agentId) view returns (tuple(address owner,bytes32 modelHash,bytes32 codeHash,string[] capabilities,uint8 safetyLevel,uint8 status,uint256 registeredAt,uint256 lastAuditAt,uint256 auditScore,address auditor,uint256 totalTxCount,uint256 totalVolumeUSD,uint256 reputationScore,bool kycVerified,address executor,uint256 lastActivityAt,string metadataURI))",
  "function checkTx(bytes32 agentId,address protocol,address token,uint256 amountUSD,uint256 slippageBps) view returns (bool allowed,string reason)",
  "function setExecutor(bytes32 agentId,address executor)",
  "function submitAudit(bytes32 agentId,uint8 score,bytes32 reportHash,string[] findings,bool passed)",
  "function getAllAgentIds() view returns (bytes32[])",
  "function totalAgents() view returns (uint256)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function safetyRails(bytes32 agentId) view returns (uint256 maxSingleTxUSD,uint256 maxDailyVolumeUSD,uint256 maxSlippageBps,bool requiresMultisig,uint256 multisigThresholdUSD,uint256 cooldownPeriod)",
];

export const EXECUTOR_ABI = [
  "function execute((bytes32 agentId,address protocol,address token,uint256 tokenAmount,uint256 slippageBps,bytes callData,uint256 value,string reasoning) req) payable returns ((bool success,bytes returnData,uint256 gasUsed,uint256 amountUSD,uint256 timestamp) result)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role,address account)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function circuitBroken(bytes32 agentId) view returns (bool)",
  "function executionCount(bytes32 agentId) view returns (uint256)",
  "event ExecutionAttempted(bytes32 indexed agentId,address indexed protocol,uint256 amountUSD,bool allowed,string reason)",
  "event ExecutionCompleted(bytes32 indexed agentId,address indexed protocol,uint256 amountUSD,bool success,uint256 gasUsed)",
];

export type SafetyRailsInput = {
  maxSingleTxUSD: number;      // human USD, e.g. 10000
  maxDailyVolumeUSD: number;
  maxSlippageBps: number;
  allowedProtocols?: string[];
  allowedTokens?: string[];
  requiresMultisig?: boolean;
  multisigThresholdUSD?: number;
  cooldownPeriod?: number;     // seconds
};

export type RegisterParams = {
  name: string;
  capabilities?: string[];
  safetyLevel?: 0 | 1 | 2 | 3;
  rails: SafetyRailsInput;
  /** Optional: keccak256 of your source / docker digest. Defaults to hash of name+code. */
  codeHash?: string;
  modelHash?: string;
  metadataURI?: string;
};

export type ExecuteParams = {
  agentId: string;
  protocol: string;
  callData: string;
  token?: string;
  tokenAmount?: bigint;
  valueWei?: bigint;
  slippageBps?: number;
  reasoning?: string;
};

export type AgentForgeConfig = {
  registryAddress: string;
  executorAddress: string;
  /** ethers Signer (wallet) or private key string + rpcUrl */
  signer?: Signer;
  privateKey?: string;
  rpcUrl?: string;
};

const STATUS = ["Pending", "Active", "Suspended", "Deprecated"] as const;

function railsTuple(r: SafetyRailsInput) {
  return {
    maxSingleTxUSD: parseEther(String(r.maxSingleTxUSD)),
    maxDailyVolumeUSD: parseEther(String(r.maxDailyVolumeUSD)),
    maxSlippageBps: BigInt(r.maxSlippageBps),
    allowedProtocols: r.allowedProtocols ?? [],
    allowedTokens: r.allowedTokens ?? [],
    requiresMultisig: Boolean(r.requiresMultisig),
    multisigThresholdUSD: parseEther(String(r.multisigThresholdUSD ?? Math.floor(r.maxSingleTxUSD / 2))),
    cooldownPeriod: BigInt(r.cooldownPeriod ?? 0),
  };
}

/**
 * Primary SDK entry. Use for all custom agents.
 */
export class AgentForgeClient {
  readonly registry: Contract;
  readonly executor: Contract;
  readonly signer: Signer;
  readonly provider: Provider;

  constructor(config: AgentForgeConfig) {
    if (!config.registryAddress || !config.executorAddress) {
      throw new Error("registryAddress and executorAddress are required");
    }

    if (config.signer) {
      this.signer = config.signer;
      this.provider = config.signer.provider!;
    } else if (config.privateKey && config.rpcUrl) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
      this.signer = new Wallet(config.privateKey, this.provider);
    } else {
      throw new Error("Provide signer OR (privateKey + rpcUrl)");
    }

    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.signer);
    this.executor = new Contract(config.executorAddress, EXECUTOR_ABI, this.signer);
  }

  /** Connect from browser wallet (MetaMask / in-app browser). */
  static async fromBrowser(registryAddress: string, executorAddress: string, ethereum: any) {
    const provider = new BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    return new AgentForgeClient({ registryAddress, executorAddress, signer });
  }

  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Register a custom agent on-chain.
   * Returns agentId. Status starts as Pending until audited.
   */
  async register(params: RegisterParams): Promise<{ agentId: string; txHash: string }> {
    const fee = await this.registry.registrationFee();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const name = params.name;
    const modelHash =
      params.modelHash ?? keccak256(toUtf8Bytes(`${name}:model:${Date.now()}`));
    const codeHash =
      params.codeHash ?? keccak256(toUtf8Bytes(`${name}:code:v1`));
    const capabilities = params.capabilities ?? ["custom"];
    const safetyLevel = params.safetyLevel ?? 1;
    const metadataURI =
      params.metadataURI ??
      `ipfs://agentforge/${encodeURIComponent(name)}`;

    const rails = railsTuple(params.rails);

    const tx = await this.registry.registerAgent(
      modelHash,
      codeHash,
      capabilities,
      safetyLevel,
      rails,
      metadataURI,
      deadline,
      "0x", // empty sig accepted on current Sepolia deployment
      { value: fee, gasLimit: 2_500_000n }
    );
    const receipt = await tx.wait();

    // Resolve agentId: latest id for this owner is best-effort via getAllAgentIds
    const ids: string[] = await this.registry.getAllAgentIds();
    const agentId = ids[ids.length - 1];

    return { agentId, txHash: receipt.hash };
  }

  async getAgent(agentId: string) {
    const a = await this.registry.getAgent(agentId);
    return {
      owner: a.owner,
      modelHash: a.modelHash,
      codeHash: a.codeHash,
      capabilities: a.capabilities,
      safetyLevel: Number(a.safetyLevel),
      status: Number(a.status),
      statusLabel: STATUS[Number(a.status)] ?? "Unknown",
      registeredAt: Number(a.registeredAt),
      auditScore: Number(a.auditScore),
      reputation: Number(a.reputationScore),
      totalTxCount: Number(a.totalTxCount),
      totalVolumeUSD: Number(a.totalVolumeUSD) / 1e18,
      metadataURI: a.metadataURI,
      executor: a.executor,
    };
  }

  // ── Rails ─────────────────────────────────────────────────────────────────

  /**
   * Dry-run safety rails (view). amountUSD is human dollars.
   */
  async checkRails(params: {
    agentId: string;
    protocol?: string;
    token?: string;
    amountUSD: number;
    slippageBps?: number;
  }): Promise<{ allowed: boolean; reason: string }> {
    const [allowed, reason] = await this.registry.checkTx(
      params.agentId,
      params.protocol && isAddress(params.protocol) ? params.protocol : ZeroAddress,
      params.token && isAddress(params.token) ? params.token : ZeroAddress,
      parseEther(String(params.amountUSD)),
      BigInt(params.slippageBps ?? 50)
    );
    return { allowed: Boolean(allowed), reason: reason || (allowed ? "ok" : "blocked") };
  }

  // ── Execution (THE compliance path) ───────────────────────────────────────

  /**
   * Execute a protocol call ONLY through AgentExecutor.
   * Caller must have EXECUTOR_ROLE on AgentExecutor.
   */
  async execute(params: ExecuteParams): Promise<{
    success: boolean;
    txHash: string;
    amountUSD?: number;
    gasUsed?: number;
  }> {
    if (!params.agentId) throw new Error("agentId required");
    if (!params.protocol || !isAddress(params.protocol)) {
      throw new Error("valid protocol address required");
    }

    // Rails are enforced on-chain inside AgentExecutor.execute → checkTx.
    // Call checkRails() yourself for UX; do not double-guess USD scale here.

    const req = {
      agentId: params.agentId,
      protocol: params.protocol,
      token: params.token && isAddress(params.token) ? params.token : ZeroAddress,
      tokenAmount: params.tokenAmount ?? 0n,
      slippageBps: BigInt(params.slippageBps ?? 50),
      callData: params.callData || "0x",
      value: params.valueWei ?? 0n,
      reasoning: params.reasoning ?? "agentforge-sdk",
    };

    const tx = await this.executor.execute(req, {
      value: req.value,
      gasLimit: 1_500_000n,
    });
    const receipt = await tx.wait();

    return {
      success: receipt.status === 1,
      txHash: receipt.hash,
    };
  }

  /**
   * Admin helper: grant EXECUTOR_ROLE so a bot wallet can call execute().
   * Must be called by DEFAULT_ADMIN_ROLE on the executor.
   */
  async grantExecutorRole(operator: string): Promise<string> {
    const role = await this.executor.EXECUTOR_ROLE();
    const tx = await this.executor.grantRole(role, operator);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async hasExecutorRole(address: string): Promise<boolean> {
    const role = await this.executor.EXECUTOR_ROLE();
    return this.executor.hasRole(role, address);
  }

  /** Owner binds a preferred executor address on the agent record. */
  async setAgentExecutor(agentId: string, executorAddr: string): Promise<string> {
    const tx = await this.registry.setExecutor(agentId, executorAddr);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /** Auditor only */
  async audit(agentId: string, score = 85, passed = true): Promise<string> {
    const tx = await this.registry.submitAudit(agentId, score, ZeroHash, [], passed);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Rail-gated trade against DemoMarket (or any market with trade(agentId,amountUSD,strategy)).
   * amountUSD is human dollars; encoded as 1e18 for rails + market.
   */
  async tradeUnderRails(params: {
    agentId: string;
    marketAddress: string;
    amountUSD: number;
    strategy: string;
    slippageBps?: number;
  }): Promise<{ success: boolean; txHash: string; blocked?: boolean; reason?: string }> {
    const { Interface, parseEther: pe } = await import("ethers");
    const amount = pe(String(params.amountUSD));
    const pre = await this.checkRails({
      agentId: params.agentId,
      protocol: params.marketAddress,
      token: params.marketAddress,
      amountUSD: params.amountUSD,
      slippageBps: params.slippageBps ?? 50,
    });
    if (!pre.allowed) {
      return { success: false, txHash: "", blocked: true, reason: pre.reason };
    }
    const iface = new Interface([
      "function trade(bytes32 agentId,uint256 amountUSD,string strategy) returns (bool)",
    ]);
    const callData = iface.encodeFunctionData("trade", [
      params.agentId,
      amount,
      params.strategy,
    ]);
    const result = await this.execute({
      agentId: params.agentId,
      protocol: params.marketAddress,
      token: params.marketAddress,
      tokenAmount: amount,
      callData,
      slippageBps: params.slippageBps ?? 50,
      reasoning: `tradeUnderRails:${params.strategy}`,
    });
    return { ...result, blocked: false };
  }

  /** Publish strategy as data:application/json metadata on register */
  static encodeStrategyManifest(manifest: Record<string, unknown>): string {
    const json = JSON.stringify(manifest);
    if (typeof Buffer !== "undefined") {
      return "data:application/json;base64," + Buffer.from(json).toString("base64");
    }
    return "data:application/json;base64," + btoa(json);
  }
}

export { id as roleId };
