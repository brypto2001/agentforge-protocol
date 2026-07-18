# AgentForge Protocol

> Agents will move capital without humans in the loop.  
> Without identity, limits, and auditability, that is chaos.  
> AgentForge makes every agent accountable on-chain.

## The product

Not a chatbot. Not a yield farm UI.

**AgentForge is the trust layer for autonomous crypto agents.**

| Pillar | On-chain surface |
|--------|------------------|
| Identity | `AgentRegistry` — permanent agent ID, owner, model/code hash, capabilities |
| Rails | Safety limits: max single tx, daily volume, slippage, cooldowns |
| Audit | Auditors score agents; reputation; activate / suspend |
| Execution | `AgentExecutor` gates calls through rails + price feeds |
| Stake | `AgentVault` — collateral and slashing path |
| Market | `AgentCommerce` — agent-to-agent services |

## The legendary demo

1. **Rails Lab** — simulate a $50k intent against $10k rails → **BLOCK**
2. **Register** an agent with tight rails
3. **Audit** → Active
4. **On-chain `checkTx`** — prove the contract refuses unsafe size

A blocked transaction is not a failure.  
It is the protocol working.

## Architecture

```
Agent runtime
   → proposes intent
      → AgentExecutor / checkTx(rails)
         → ALLOW → protocol call
         → BLOCK → event + reason
            → Indexer
               → API + WebSocket
                  → Dashboard / Rails Lab
```

**Chain is truth. Indexer is cache. UI is the cockpit.**

## Networks

- **Base Sepolia** — live prototype
- **Base mainnet** — production target after audit + multisig

## Non-goals (for now)

- Competing with every DeFi frontend
- Unscoped “AI everything”
- Governance theater without usage

## Goal

Make “my agent is AgentForge-registered and rail-bound” the default trust signal on Base.
