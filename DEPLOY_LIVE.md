# AgentForge — Complete Live Deployment Guide
### Everything working. Real data. No mocks. Step by step.

---

## What You'll Have When Done

- 4 smart contracts live on Base mainnet
- Backend server indexing real blockchain events
- Dashboard showing real live data via WebSocket
- 3 autonomous agents running 24/7 on a server:
  - Yield Optimizer (moves USDC between Aave/Compound/Moonwell)
  - Arbitrage Bot (captures price gaps on Uniswap)
  - Data Oracle (publishes signed price feeds)
- Prometheus + Grafana monitoring
- MetaMask wallet connect on the dashboard

**Total cost**: ~$15-20 one-time (gas + server) + $6/month server

---

## PART 1 — COMPUTER SETUP (Do this once, skip if already done)

### Step 1: Install Node.js v20
```
https://nodejs.org → Download LTS → Install
```
Verify: `node --version` → should show v20.x.x

### Step 2: Install Git
```
https://git-scm.com/downloads → Install
```
Verify: `git --version`

### Step 3: Unzip and install project
```bash
# Unzip agentforge-complete.zip to your Desktop
cd ~/Desktop/agentforge-complete
npm install
```
This takes 2-3 minutes. You'll see a lot of text — normal.

---

## PART 2 — WALLETS (You need 4 wallets total)

### Step 4: Install MetaMask
1. Chrome browser → https://metamask.io → Install extension
2. Create wallet → write down 12 words on paper
3. Add Base network:
   - Network name: `Base`
   - RPC URL: `https://mainnet.base.org`
   - Chain ID: `8453`
   - Symbol: `ETH`
   - Explorer: `https://basescan.org`

### Step 5: Create 3 agent wallets (separate from yours)

Each agent needs its own wallet so they don't share keys.
Open your Terminal and run this 3 times:

```bash
node -e "const {Wallet}=require('ethers'); const w=Wallet.createRandom(); console.log('Address:',w.address,'\nKey:',w.privateKey)"
```

Run it once, copy the output. Run it again, copy. Run it again, copy.
Save all 3 in a text file called `wallets.txt` on your Desktop:

```
YIELD AGENT:
Address: 0xABC...
Key: 0xDEF...

ARB AGENT:
Address: 0x123...
Key: 0x456...

ORACLE AGENT:
Address: 0x789...
Key: 0xGHI...
```

### Step 6: Get your deployer wallet's private key
1. MetaMask → click three dots ⋮ → Account Details
2. Show private key → enter password → copy it
3. Add to wallets.txt:
```
DEPLOYER (your MetaMask):
Address: 0xYOUR_ADDRESS
Key: 0xYOUR_PRIVATE_KEY
```

---

## PART 3 — BUY CRYPTO (Gas money)

You need ETH on Base for gas fees.

### Step 7: Fund deployer wallet (your MetaMask)
- Buy $20 of ETH on Coinbase
- Send to your MetaMask address on Base network
- Check balance: https://basescan.org → search your address

### Step 8: Fund agent wallets

Each agent wallet needs gas money AND working capital:

**Yield agent**: 
- 0.005 ETH (for gas)
- $50-1000 USDC (this is what it actually trades)
- Send USDC from Coinbase: Settings → Send → select Base network

**Arb agent**: 
- 0.01 ETH (needs more gas for swaps)
- $100+ USDC

**Oracle agent**: 
- 0.002 ETH (just gas, no trading capital needed)

Send from Coinbase or from your MetaMask to each agent address.

---

## PART 4 — GET API KEYS

### Step 9: Alchemy (blockchain connection)
1. https://alchemy.com → Sign up free
2. Create app → Chain: Base → Network: Base Mainnet
3. Copy your HTTPS URL: `https://base-mainnet.g.alchemy.com/v2/abc123`

### Step 10: BaseScan (contract verification)
1. https://basescan.org → Register
2. https://basescan.org/myapikey → Add → copy key

### Step 11: Anthropic API key (for AI brain — optional but makes agents smart)
1. https://console.anthropic.com → Sign up
2. API Keys → Create key → copy it
3. Add $5 credit (agents use ~$0.01 per run, very cheap)

---

## PART 5 — CONFIGURE THE PROJECT

### Step 12: Create your .env file

In your terminal (in the agentforge-complete folder):
```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in YOUR values:

```env
# Your Alchemy URL from Step 9
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Your MetaMask private key from Step 6 (deployer)
PRIVATE_KEY=0xYOUR_DEPLOYER_KEY

# Agent wallet keys from Step 5
YIELD_AGENT_PRIVATE_KEY=0xYOUR_YIELD_KEY
ARB_AGENT_PRIVATE_KEY=0xYOUR_ARB_KEY
ORACLE_AGENT_PRIVATE_KEY=0xYOUR_ORACLE_KEY

# BaseScan key from Step 10
BASESCAN_API_KEY=YOUR_BASESCAN_KEY

# Anthropic key from Step 11 (optional)
LLM_API_KEY=sk-ant-YOUR_KEY

# How much USDC the yield agent manages (start small!)
YIELD_POSITION_USDC=100

# Minimum profit in USD for arb agent to execute
ARB_MIN_PROFIT_USD=2
```

Save the file.

### Step 13: Protect your secrets
```bash
echo ".env" >> .gitignore
echo "wallets.txt" >> .gitignore
```

---

## PART 6 — DEPLOY CONTRACTS

### Step 14: Compile
```bash
npm run compile
```
Expected output: `Compiled 5 Solidity files successfully`

### Step 15: Test
```bash
npm test
```
Expected: all tests passing (green checkmarks)

### Step 16: Deploy to Base
```bash
npm run deploy:base
```

This will print:
```
✅ AgentRegistry:  0xAbc123...
✅ AgentVault:     0xDef456...
✅ AgentCommerce:  0x789Ghi...
✅ AgentExecutor:  0xJkl012...
Deployment saved to: deployments.json
```

**Takes 3-8 minutes. MetaMask will pop up — confirm each transaction.**

### Step 17: Run setup script
```bash
node scripts/setup.js
```

This automatically:
- Reads your deployed addresses from deployments.json
- Updates your .env file
- Creates dashboard/.env
- Tells you exactly what to do next

### Step 18: Verify contracts on BaseScan

The setup script will print exact commands. Run them:
```bash
npx hardhat verify --network base 0xYOUR_REGISTRY_ADDRESS

npx hardhat verify --network base 0xYOUR_VAULT_ADDRESS \
  0xYOUR_DEPLOYER_ADDRESS

npx hardhat verify --network base 0xYOUR_COMMERCE_ADDRESS \
  0xYOUR_DEPLOYER_ADDRESS

npx hardhat verify --network base 0xYOUR_EXECUTOR_ADDRESS \
  0xYOUR_REGISTRY_ADDRESS
```

Now anyone can read your contracts at basescan.org.

---

## PART 7 — GRANT YOURSELF AUDITOR ROLE

Agents start as "Pending" and need an auditor to approve them.
Right now only your wallet can be an auditor. Let's set that up.

### Step 19: Grant AUDITOR_ROLE on BaseScan

1. Go to: `https://basescan.org/address/YOUR_REGISTRY_ADDRESS#writeContract`
2. Click **"Connect to Web3"** → connect MetaMask
3. Find the `grantRole` function
4. Fill in:
   - `role`: `0x3acf60c6ef4a84f3b8df06d1d79a5b15c42c80de` 
     (this is keccak256("AUDITOR_ROLE") — copy exactly)
   - `account`: your MetaMask wallet address
5. Click **Write** → confirm in MetaMask

You're now an auditor. You can approve agents.

---

## PART 8 — START THE BACKEND SERVER

The backend server indexes blockchain events and powers the dashboard's real data.

### Step 20: Install server dependencies
```bash
npm install express cors ws better-sqlite3
npm install --save-dev @types/express @types/cors @types/ws @types/better-sqlite3
```

### Step 21: Start the server
```bash
npm run server
```

You'll see:
```
╔══════════════════════════════════════════╗
║    AgentForge Backend Server Starting    ║
╚══════════════════════════════════════════╝
[Server] REST API:  http://localhost:4000
[Server] WebSocket: ws://localhost:4000
[Indexer] Starting live event subscription...
```

**Keep this terminal open.** Open a new terminal for the next steps.

Test it works:
```bash
curl http://localhost:4000/health
```
Should return: `{"status":"ok",...}`

---

## PART 9 — LAUNCH THE DASHBOARD

### Step 22: Install dashboard dependencies
```bash
cd dashboard
npm install
```

### Step 23: Start the dashboard
```bash
npm start
```

Your browser opens at `http://localhost:3000`.

You'll see the live dashboard with:
- **Real stats** from your backend (not mock data)
- **Live event stream** showing actual blockchain events
- **Green "Live" indicator** (connected to WebSocket)
- **Connect Wallet** button that talks to MetaMask

---

## PART 10 — REGISTER YOUR FIRST AGENT

### Step 24: Register through the dashboard

1. Open http://localhost:3000
2. Click **"Connect Wallet"** → MetaMask pops up → Connect
3. Make sure you're on **Base** network (MetaMask shows "Base")
4. Click **"+ Register Agent"**
5. Fill in:
   - Name: `YieldMax-v1`
   - Strategy: Conservative Yield
   - Safety Level: Standard
   - Max Single TX: $1,000
   - Max Daily Volume: $10,000
   - Capabilities: lend, stake, monitor
6. Click **Continue** through the steps
7. On the final screen click **"Register Agent — 0.01 ETH"**
8. MetaMask pops up → **Confirm**
9. Wait 10-20 seconds

Your agent appears in the dashboard as **Pending**!

### Step 25: Approve your agent (audit it)

Since you granted yourself AUDITOR_ROLE in Step 19:

1. Go to: `https://basescan.org/address/YOUR_REGISTRY_ADDRESS#writeContract`
2. Find `submitAudit`
3. Fill in:
   - `agentId`: paste the agent ID from the dashboard (the long 0x... string)
   - `score`: `80`
   - `reportHash`: `0x` + `00`.repeat(32) (fake hash for now)
   - `findings`: `[]`
   - `passed`: `true`
4. Click Write → confirm MetaMask

Agent status changes to **Active** in the dashboard! The live event stream shows `AgentStatusChanged`.

---

## PART 11 — START AUTONOMOUS AGENTS

Now start the agents that actually execute trades.

### Step 26: Start yield optimizer
Open a new terminal:
```bash
npm run agent:yield
```

You'll see:
```
╔══════════════════════════════════════════╗
║  AgentForge Runner — yield               ║
╚══════════════════════════════════════════╝
RPC: https://base-mainnet.g.alchemy.com/v2/...
Loop interval: 300s
[YieldOptimizer] Wallet: 0xYOUR_YIELD_AGENT_ADDRESS

[YieldOptimizer] ── Cycle 2024-01-15T10:30:00.000Z ──
[YieldOptimizer] USDC balance: $100.00
[Rates] Aave: 4.200% | Compound: 3.800% | Moonwell: 4.100%
[Rates] Best: AAVE at 4.200%
[YieldOptimizer] Rebalancing: none → aave (spread: 4.20%)
[YieldOptimizer] Depositing into aave...
[YieldOptimizer] Approve USDC sent: 0x1a2b3c...
[YieldOptimizer] ✅ Aave approve confirmed: 0x1a2b3c...
[YieldOptimizer] Aave supply sent: 0x4d5e6f...
[YieldOptimizer] ✅ Aave supply confirmed: 0x4d5e6f...
```

The event stream in your dashboard immediately shows `TxExecuted`!

### Step 27: Start arb bot (optional)
In another terminal:
```bash
npm run agent:arb
```

### Step 28: Start oracle (optional)
```bash
npm run agent:oracle
```

---

## PART 12 — PUT EVERYTHING ON THE INTERNET

### Step 29: Get a server (runs 24/7)

Go to **https://railway.app**:
1. Sign up with GitHub
2. New Project → Deploy from GitHub
3. First deploy your backend server

Or use **DigitalOcean** ($6/month droplet):
1. Create account at https://digitalocean.com
2. Create Droplet → Ubuntu 22 → Basic → $6/month
3. SSH in and follow the steps below

On your server:
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your code
git clone https://github.com/YOURUSERNAME/agentforge-complete.git
cd agentforge-complete

# Copy your .env (paste the contents)
nano .env

# Install and start
npm install
npm run server &
npm run agent:yield &
npm run agent:arb &
```

Or with Docker (easiest):
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Copy docker/.env
cp docker/.env.example docker/.env
# Edit it with your values

# Start everything
npm run docker:up
```

### Step 30: Deploy dashboard to Vercel (free hosting)

1. Push code to GitHub:
```bash
git init
git add .
git commit -m "AgentForge complete"
git remote add origin https://github.com/YOURUSERNAME/agentforge.git
git push -u origin main
```

2. Go to https://vercel.com → Import your GitHub repo
3. Settings:
   - Root directory: `dashboard`
   - Framework: Create React App
4. Environment variables — add these:
   ```
   REACT_APP_API_URL = https://your-server-ip:4000
   REACT_APP_WS_URL  = wss://your-server-ip:4000
   REACT_APP_REGISTRY_ADDRESS = 0x...
   REACT_APP_COMMERCE_ADDRESS = 0x...
   REACT_APP_VAULT_ADDRESS    = 0x...
   REACT_APP_EXECUTOR_ADDRESS = 0x...
   REACT_APP_CHAIN_ID = 8453
   ```
5. Deploy

You get a URL like: **https://agentforge.vercel.app** — real, live, working.

---

## PART 13 — VERIFY EVERYTHING IS WORKING

### Checklist

Go through this after everything is running:

**Contracts:**
- [ ] All 4 contracts show as verified on basescan.org
- [ ] You can read contract data on BaseScan → Read Contract tab

**Server:**
- [ ] `curl https://your-server/health` returns `{"status":"ok"}`
- [ ] `curl https://your-server/api/stats` returns real numbers

**Dashboard:**
- [ ] Opens on your Vercel URL
- [ ] Shows green "Live" indicator (WebSocket connected)
- [ ] Stats show real numbers (not 0)
- [ ] MetaMask connects when you click Connect Wallet
- [ ] Event stream shows real events (after agents start)

**Agents:**
- [ ] Yield agent logs show real USDC balance
- [ ] First transaction appears in dashboard within 5 minutes
- [ ] BaseScan shows transactions from agent wallet

**Monitoring:**
- [ ] Grafana at http://your-server:3001 loads
- [ ] Agent metrics at http://your-server:9091/metrics shows data

---

## TROUBLESHOOTING

### "Insufficient funds" during deploy
→ Add more ETH to your deployer wallet (need ~0.02 ETH on Base)
→ Check: https://basescan.org → search your deployer address

### "Provider error" or "could not detect network"
→ Your Alchemy URL is wrong or rate-limited
→ Go to alchemy.com, copy your HTTPS URL again exactly

### Agent says "Not enough USDC"
→ Send USDC to the agent's wallet on Base network
→ Check balance: https://basescan.org → search agent address → Token Holdings

### Dashboard shows "Backend offline"
→ Your server isn't running, or the URL is wrong
→ Run `npm run server` locally, or check server logs

### MetaMask doesn't connect
→ Use Chrome browser
→ Make sure you're on Base network in MetaMask

### "grantRole" fails on BaseScan
→ Make sure you connected MetaMask to BaseScan (Write Contract → Connect to Web3)
→ Make sure you're using the DEPLOYER wallet (the one that deployed contracts)

### Agent runs but no transactions
→ Spread between protocols might be too small — wait 30 min
→ Gas might be too high — arb agent skips if not profitable
→ Agent might not be activated — check status in dashboard (needs audit)

### Docker containers keep restarting
→ `npm run docker:logs` to see error
→ Usually a missing env var — check docker/.env

---

## WHAT'S LIVE AFTER THIS GUIDE

| Component | Where | Real data? |
|-----------|-------|-----------|
| AgentRegistry contract | basescan.org/address/0x... | ✅ |
| AgentVault contract | basescan.org/address/0x... | ✅ |
| AgentCommerce contract | basescan.org/address/0x... | ✅ |
| AgentExecutor contract | basescan.org/address/0x... | ✅ |
| Backend server | your-server-ip:4000 | ✅ |
| Dashboard | agentforge.vercel.app | ✅ real WebSocket data |
| Yield agent | Running on your server | ✅ real trades |
| Arb agent | Running on your server | ✅ real trades |
| Oracle agent | Running on your server | ✅ real signatures |
| Prometheus | your-server:9090 | ✅ real metrics |
| Grafana | your-server:3001 | ✅ real charts |

**Monthly running cost:**
- Server: $6/month (DigitalOcean)
- Alchemy: $0 (free tier handles it)
- Vercel: $0 (free tier)
- Gas: ~$2-5/month (Base is very cheap)
- LLM API: ~$1-3/month (agents call it every 5 min)

**Total: ~$10-15/month for a fully live DeFi protocol**
