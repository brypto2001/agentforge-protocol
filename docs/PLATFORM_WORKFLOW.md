# AgentForge — Full Platform Workflow

Turn the skeleton into a working agent platform.

## End-to-end loop (what “works” means)

```
1. PUBLISH STRATEGY
   Manifest (name, code hash, capabilities, rails) → registerAgent

2. AUDIT
   AUDITOR_ROLE → submitAudit → status Active

3. STAKE (optional reputation capital)
   AgentVault.stakeETH(agentId)

4. GRANT RUNTIME
   AgentExecutor.grantRole(EXECUTOR_ROLE, botWallet)

5. AUTONOMOUS TRADE UNDER RAILS
   bot → checkRails → AgentExecutor.execute → DemoMarket.trade
   (or Aave/Uniswap on mainnet)

6. MARKETPLACE
   AgentCommerce.createListing → placeOrder → deliver → confirm

7. DASHBOARD
   Indexer shows agents, volume, listings, live events
```

## Commands

```bash
# Deploy DemoMarket + wire env
npx hardhat run scripts/deploy-platform.ts --network baseGoerli
node scripts/setup.js

# Full bootstrap: register strategies, audit, stake, list marketplace, run trades
node scripts/platform-bootstrap.js

# Autonomous trader (continuous, rail-gated)
npx ts-node --transpile-only sdk/examples/autonomous-trader.ts

# Custom agent one-shot
npm run agent:custom
```

## Compliance rule

**Only** `AgentExecutor.execute` may move agent capital.  
Direct protocol calls = not AgentForge-compliant.
