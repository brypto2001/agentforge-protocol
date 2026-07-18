# AgentForge v3 — Complete Protocol

The trust layer for autonomous AI crypto agents. Built on Base.

## What's Inside

```
agentforge-v3/
├── contracts/
│   ├── AgentRegistryV2.sol   ← Agent identity + safety rail enforcement (UUPS)
│   ├── AgentExecutor.sol     ← Chainlink-powered tx gating (trustless enforcement)
│   ├── AgentVault.sol        ← Staking + slashing for accountability
│   ├── AgentCommerce.sol     ← Agent-to-agent service marketplace
│   └── AgentForgeDAO.sol     ← $FORGE token + Governor + Timelock
├── sdk/
│   ├── protocols.ts          ← Real Aave/Uniswap/Compound/Moonwell integrations
│   ├── strategies.ts         ← 3 working agent strategies
│   └── agent-runner.ts       ← Production entrypoint (yield/arb/oracle)
├── server/
│   └── server.ts             ← Express + WebSocket backend (real blockchain data)
├── dashboard/src/
│   └── Dashboard.jsx         ← Live dashboard with real data
├── docker/
│   ├── docker-compose.yml    ← Full stack (3 agents + Prometheus + Grafana)
│   ├── Dockerfile.server     ← Server container
│   └── Dockerfile.agent      ← Agent container
├── scripts/
│   ├── deploy.ts             ← Deploy all 4 contracts
│   └── setup.js              ← Auto-configure everything after deploy
├── .env.example              ← All environment variables
├── DEPLOY_LIVE.md            ← Full deployment guide
└── FREE_DEPLOY_GUIDE.md      ← Free testnet deployment ($0)
```

## Quick Start

**Free testnet (no cost):**
```bash
npm install
cp .env.example .env
# Fill in .env with your Alchemy key and private key
npm run deploy:base-test
node scripts/setup.js
npm run server        # terminal 1
npm run dashboard:install && npm run dashboard:dev  # terminal 2
```

**Real mainnet (~$8 one-time gas):**
```bash
npm run deploy:base
node scripts/setup.js
```

## The 3 Agents

| Agent | Command | What it does |
|-------|---------|-------------|
| Yield Optimizer | `npm run agent:yield` | Moves USDC to highest APY across Aave/Compound/Moonwell |
| Arbitrage Bot | `npm run agent:arb` | Captures price gaps on Uniswap V3 |
| Data Oracle | `npm run agent:oracle` | Publishes signed price bundles from Chainlink |

## Full Guide

→ Free deployment: `FREE_DEPLOY_GUIDE.md`  
→ Live mainnet: `DEPLOY_LIVE.md`
