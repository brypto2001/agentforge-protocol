# Publish a custom agent on AgentForge

This is the **supported** path. Anything that skips `AgentExecutor.execute()` is **not** AgentForge-compliant.

## Architecture

```
Your bot (any language)
   → AgentForgeClient / ethers
      → AgentExecutor.execute(agentId, protocol, callData, …)
         → registry.checkTx (rails)
         → protocol.call(callData)
         → registry.recordTx
            → Indexer → Dashboard
```

## 1. Install / use the SDK

From this repo:

```ts
import { AgentForgeClient } from "./sdk/agentforge-client";

const client = new AgentForgeClient({
  privateKey: process.env.PRIVATE_KEY!,
  rpcUrl: process.env.BASE_RPC_URL!,
  registryAddress: process.env.REGISTRY_ADDRESS!,
  executorAddress: process.env.EXECUTOR_ADDRESS!,
});
```

## 2. Register (publish identity)

```ts
const { agentId, txHash } = await client.register({
  name: "MyArbBot-v1",
  capabilities: ["trade", "arbitrage"],
  safetyLevel: 1, // Minimal | Standard | Strict | Paranoid
  rails: {
    maxSingleTxUSD: 1000,
    maxDailyVolumeUSD: 10000,
    maxSlippageBps: 50,
  },
  // Optional but recommended:
  codeHash: "0x…", // keccak256 of git commit or container digest
  metadataURI: "ipfs://…", // JSON: name, repo, version, docs
});
```

Or use the **dashboard → Register Agent** (same on-chain result).

Status starts as **Pending**.

## 3. Get audited → Active

An address with `AUDITOR_ROLE` must call `submitAudit`.  
On the current demo deployment, the deployer is an auditor (dashboard **Approve Audit**).

Until Active, `checkTx` returns **Agent not active**.

## 4. Grant EXECUTOR_ROLE to your bot wallet

`AgentExecutor.execute` is `onlyRole(EXECUTOR_ROLE)`.

Admin (deployer) once:

```ts
await client.grantExecutorRole("0xYourBotWallet");
```

Or sample script auto-attempts grant when run with the admin key.

## 5. Run only through execute()

```ts
// ALWAYS pre-check
const rails = await client.checkRails({
  agentId,
  protocol: AAVE_POOL,
  token: USDC,
  amountUSD: 500,
  slippageBps: 30,
});
if (!rails.allowed) throw new Error(rails.reason);

// Compliant execution
await client.execute({
  agentId,
  protocol: AAVE_POOL,
  token: USDC,
  tokenAmount: parseUnits("500", 6),
  callData: aaveSupplyCalldata,
  slippageBps: 30,
  reasoning: "rebalance to best APY",
});
```

**Do not** `wallet.sendTransaction` straight to Aave/Uniswap if you claim AgentForge protection.

## 6. Sample runner

```bash
# from repo root
npx ts-node --transpile-only sdk/examples/custom-agent.ts

# rails only
DRY_RUN=1 npx ts-node --transpile-only sdk/examples/custom-agent.ts
```

## 7. Dashboard visibility

- Identity appears after `AgentRegistered` (indexer).
- Trades appear when `TxExecuted` / executor events fire.
- Use **Rails Lab → On-chain checkTx** to demo your rails.

## Manifest (recommended metadata JSON on IPFS)

```json
{
  "name": "MyArbBot-v1",
  "version": "1.0.0",
  "repo": "https://github.com/you/my-bot",
  "commit": "abc123",
  "capabilities": ["trade", "arbitrage"],
  "entrypoint": "docker.io/you/my-bot:1.0.0",
  "railsDefaults": {
    "maxSingleTxUSD": 1000,
    "maxDailyVolumeUSD": 10000,
    "maxSlippageBps": 50
  }
}
```

Set `metadataURI` to the IPFS CID when registering.

## Checklist

- [ ] Registered on-chain (`agentId`)
- [ ] Audited Active
- [ ] Bot wallet has `EXECUTOR_ROLE`
- [ ] Every capital-moving tx uses `client.execute`
- [ ] `codeHash` / metadata published for trust
- [ ] Rails Lab shows BLOCK on oversized intents
