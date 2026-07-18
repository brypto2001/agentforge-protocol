# How to Deploy AgentForge Completely Free
### Written for someone with zero technical background

---

## First — The Honest Truth About "Free"

Here is exactly what costs money and what doesn't:

**100% Free Forever:**
- GitHub (stores your code)
- Vercel (hosts your dashboard website)
- Alchemy (connects to the blockchain, free tier)
- BaseScan (verifies your contracts, free)
- Base Sepolia Testnet (fake blockchain for testing, completely free)

**Small One-Time Cost for Real Deployment:**
- Gas fees to deploy contracts: about $3-8 worth of ETH
- This is a one-time payment. Once contracts are deployed, they live forever.

**The Strategy:**
We will deploy on the **testnet first** (completely free, fake money, fully working).
This lets you see everything working before spending a single cent.
If you want it on the real blockchain after, that costs $3-8 total, one time.

---

## What You're Going to Build (In Plain English)

By the end of this guide you will have:

1. **A live website** at a real URL like `yourname.vercel.app` that anyone can visit
2. **Smart contracts** running on Base Sepolia (free testnet) that actually work
3. **A backend server** running on Render (free) that feeds real data to your website
4. **Real agents** visible on your dashboard

The whole thing will look and behave exactly like a real product.

---

# PHASE 1 — GET THE TOOLS (30 minutes)

## Step 1: Install Node.js

Node.js is the engine that runs the project. You need it.

1. Go to: **https://nodejs.org**
2. Click the big green button that says **LTS** (left side)
3. Download and open the file
4. Click through all the "Next" buttons until it's installed
5. Open your computer's terminal:
   - **Windows:** Press the Windows key, type `cmd`, press Enter
   - **Mac:** Press Command + Space, type `Terminal`, press Enter
6. Type this and press Enter:
   ```
   node --version
   ```
7. You should see something like `v20.11.0`

If you see that number, Node.js is installed. Move on.

---

## Step 2: Install Git

Git lets you upload your code to the internet.

1. Go to: **https://git-scm.com/downloads**
2. Click your operating system
3. Download and install (click Next through everything)
4. In your terminal, type:
   ```
   git --version
   ```
5. You should see `git version 2.x.x`

---

## Step 3: Get the Project Files

1. Download the `agentforge-complete.zip` file
2. Find it in your Downloads folder
3. Double-click it to unzip
4. Move the `agentforge-complete` folder to your Desktop
5. In your terminal, type:
   - **Mac:** `cd ~/Desktop/agentforge-complete`
   - **Windows:** `cd %USERPROFILE%\Desktop\agentforge-complete`
6. Press Enter
7. Now type:
   ```
   npm install
   ```
8. Press Enter and wait 3-5 minutes. Lots of text will scroll. That's normal.
9. When you see the `$` or `>` symbol again, it's done.

---

# PHASE 2 — CREATE FREE ACCOUNTS (30 minutes)

You need 4 free accounts. Open each in a new browser tab.

## Step 4: GitHub Account

GitHub stores your code online.

1. Go to: **https://github.com**
2. Click **Sign up**
3. Enter your email, create a password, choose a username
4. Verify your email
5. Done. Keep the tab open.

---

## Step 5: Alchemy Account

Alchemy lets your project talk to the blockchain.

1. Go to: **https://alchemy.com**
2. Click **Sign Up** (top right)
3. Sign up with your Google account or email
4. After signing in, you'll see a dashboard
5. Click **+ Create new app**
6. Fill in:
   - Name: `AgentForge`
   - Chain: **Base**
   - Network: **Base Sepolia** ← this is the free testnet
7. Click **Create app**
8. On your app's page, click **API Key**
9. Copy the URL that starts with `https://base-sepolia.g.alchemy.com/v2/...`
10. Open Notepad (Windows) or TextEdit (Mac) and paste it there. Label it:
    ```
    ALCHEMY URL: https://base-sepolia.g.alchemy.com/v2/abc123xyz...
    ```

---

## Step 6: MetaMask Wallet

MetaMask is your crypto wallet — it lives in your browser.

1. Open **Google Chrome** (download it if you don't have it — https://chrome.google.com)
2. Go to: **https://metamask.io**
3. Click **Download** → **Install MetaMask for Chrome**
4. Click **Add to Chrome** → **Add Extension**
5. Click the puzzle piece icon in Chrome's top right, pin MetaMask
6. Click the MetaMask fox icon
7. Click **Create a new wallet**
8. Create a password
9. **WRITE DOWN YOUR 12 WORDS ON PAPER RIGHT NOW**
   - These 12 words are your master key
   - Lose them = lose everything
   - Never type them into any website
   - Never take a photo of them
10. Confirm the words when asked
11. Your wallet is created!

**Add Base Sepolia Network to MetaMask:**
1. Click the MetaMask fox icon
2. Click where it says **Ethereum Mainnet** at the top
3. Click **Add network**
4. Click **Add a network manually**
5. Fill in:
   - Network Name: `Base Sepolia`
   - RPC URL: `https://sepolia.base.org`
   - Chain ID: `84532`
   - Symbol: `ETH`
   - Block Explorer: `https://sepolia.basescan.org`
6. Click **Save** → **Switch to Base Sepolia**

**Get your wallet address:**
1. Click the MetaMask fox
2. Click your account name at the top — it copies your address
3. Paste it in your notes file:
   ```
   MY WALLET ADDRESS: 0x...
   ```

**Get your private key:**
1. MetaMask → click the three dots ⋮ next to your account name
2. Click **Account details**
3. Click **Show private key**
4. Enter your password
5. Copy the private key
6. Paste in your notes:
   ```
   MY PRIVATE KEY: 0x...
   ```

---

## Step 7: Get Free Test ETH (Takes 5 minutes)

This is fake ETH for the testnet. It costs nothing.

1. Go to: **https://www.alchemy.com/faucets/base-sepolia**
2. Log in with your Alchemy account
3. Paste your wallet address in the box
4. Click **Send me ETH**
5. Wait 30-60 seconds

Check your balance:
1. Click MetaMask fox
2. Make sure it shows **Base Sepolia** at the top
3. You should see some ETH in your balance

If the Alchemy faucet doesn't work, try these backups:
- **https://faucet.quicknode.com/base/sepolia**
- **https://learnweb3.io/faucets/base_sepolia/**
- **https://faucet.chainstack.com/base-testnet-faucet**

---

## Step 8: BaseScan Account

This makes your contracts publicly readable.

1. Go to: **https://sepolia.basescan.org**
2. Click **Sign In** (top right) → **Register here**
3. Create account with your email
4. Verify your email
5. After logging in, go to: **https://sepolia.basescan.org/myapikey**
6. Click **Add** → name it `agentforge`
7. Copy your API key
8. Paste in your notes:
   ```
   BASESCAN KEY: YOUR_KEY_HERE
   ```

---

## Step 9: Render Account (For the backend server)

Render runs your backend server for free.

1. Go to: **https://render.com**
2. Click **Get Started for Free**
3. Sign up with your GitHub account (easiest)
4. Authorize Render to access GitHub
5. Done. Keep the tab open.

---

## Step 10: Vercel Account (For the dashboard website)

Vercel hosts your dashboard forever for free.

1. Go to: **https://vercel.com**
2. Click **Sign Up**
3. Click **Continue with GitHub**
4. Authorize Vercel
5. Done. Keep the tab open.

---

# PHASE 3 — CONFIGURE THE PROJECT (15 minutes)

## Step 11: Create the .env File

This file holds all your secret settings.

**On Mac:**
Open your terminal (make sure you're in the project folder) and type:
```
cp .env.example .env
open -e .env
```

**On Windows:**
```
copy .env.example .env
notepad .env
```

The file will open. Now fill it in using your notes:

```
# Your Alchemy URL (from Step 5)
BASE_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY_HERE

# Your private key (from Step 6)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Your BaseScan key (from Step 8)
BASESCAN_API_KEY=YOUR_BASESCAN_KEY

# Leave these blank for now (filled automatically after deploy)
REGISTRY_ADDRESS=
COMMERCE_ADDRESS=
VAULT_ADDRESS=
EXECUTOR_ADDRESS=

# Server settings
PORT=4000
DASHBOARD_URL=http://localhost:3000
```

Save the file (Ctrl+S on Windows, Cmd+S on Mac).

**Protect your secrets:**
```
echo ".env" >> .gitignore
```

---

# PHASE 4 — DEPLOY YOUR CONTRACTS (20 minutes)

## Step 12: Compile the Contracts

In your terminal, type:
```
npm run compile
```

Wait about 30 seconds. You should see:
```
Compiled 5 Solidity files successfully
```

If you see errors, the most common fix is:
```
npm install --legacy-peer-deps
npm run compile
```

---

## Step 13: Run the Tests

This makes sure everything works before deploying:
```
npm test
```

You should see a list of tests with green checkmarks. If all pass, continue.

---

## Step 14: Deploy to Base Sepolia (FREE)

This is the exciting part. Type:
```
npm run deploy:base-test
```

You'll see text like this appearing over 2-5 minutes:
```
╔══════════════════════════════════════════╗
║    AgentForge Protocol v2 Deployment     ║
╚══════════════════════════════════════════╝

Deployer: 0xYourAddress
Network:  base-sepolia

Deploying AgentRegistry...
✅ AgentRegistry:  0xAbc123...
Deploying AgentVault...
✅ AgentVault:     0xDef456...
Deploying AgentCommerce...
✅ AgentCommerce:  0x789Ghi...
Deploying AgentExecutor...
✅ AgentExecutor:  0xJkl012...

Deployment saved to: deployments.json
```

MetaMask may pop up asking to confirm — click **Confirm**.

**These addresses are now your live contracts on Base Sepolia!**
They're permanent. Nobody can change or delete them.

---

## Step 15: Run the Setup Script

This automatically updates all your config files:
```
node scripts/setup.js
```

It will:
- Read your deployed addresses from deployments.json
- Put them in your .env file automatically
- Create the dashboard config
- Tell you what to do next

---

## Step 16: Verify Contracts on BaseScan

This makes your contract code publicly readable (optional but recommended):

The setup script will print the exact commands. They look like:
```
npx hardhat verify --network baseGoerli 0xYOUR_REGISTRY_ADDRESS
npx hardhat verify --network baseGoerli 0xYOUR_VAULT_ADDRESS 0xYOUR_WALLET
npx hardhat verify --network baseGoerli 0xYOUR_COMMERCE_ADDRESS 0xYOUR_WALLET
npx hardhat verify --network baseGoerli 0xYOUR_EXECUTOR_ADDRESS 0xYOUR_REGISTRY
```

Run each one. After each you'll see:
```
Successfully verified contract on BaseScan
https://sepolia.basescan.org/address/0x...#code
```

Click the links — your contracts are now public!

---

# PHASE 5 — START THE BACKEND SERVER (10 minutes)

## Step 17: Install Server Dependencies

```
npm install express cors ws better-sqlite3
```

Wait about 1 minute.

---

## Step 18: Start the Server Locally

```
npm run server
```

You'll see:
```
╔══════════════════════════════════════════╗
║    AgentForge Backend Server Starting    ║
╚══════════════════════════════════════════╝
[Server] REST API:  http://localhost:4000
[Server] WebSocket: ws://localhost:4000
[Indexer] Registry connected: 0xAbc123...
[Indexer] Starting live event subscription...
```

Test it works — open a new tab in your terminal and type:
```
curl http://localhost:4000/health
```

You should see `{"status":"ok",...}` ✅

Keep this terminal running. Open a new one for the next steps.

---

# PHASE 6 — START THE DASHBOARD (10 minutes)

## Step 19: Install Dashboard Dependencies

```
cd dashboard
npm install
```

---

## Step 20: Start the Dashboard

```
npm start
```

Your browser automatically opens to **http://localhost:3000**

You'll see the AgentForge dashboard with:
- Real stats from your backend
- Live event stream (connected to your contracts)
- Green "Live" indicator
- Connect Wallet button

This is running on your computer. In the next phase we put it on the internet.

---

# PHASE 7 — PUT EVERYTHING ONLINE FOR FREE

Now we make it accessible to anyone in the world.

## Step 21: Upload Code to GitHub

Go back to your terminal (in the agentforge-complete folder, not dashboard):
```
cd ..
```

Then run these one by one:
```
git init
git add .
git commit -m "AgentForge live on Base Sepolia"
```

Now go to GitHub in your browser:
1. Click the **+** icon (top right) → **New repository**
2. Name it: `agentforge-protocol`
3. Leave it Public
4. Click **Create repository**
5. GitHub shows commands. Copy the commands under "push an existing repository"
6. Paste them in your terminal — looks like:
```
git remote add origin https://github.com/YOURUSERNAME/agentforge-protocol.git
git branch -M main
git push -u origin main
```

Your code is now on GitHub.

---

## Step 22: Deploy Backend to Render (Free)

**Important note about Render's free tier:** The free tier sleeps after 15 minutes of no traffic. Your first request after sleeping takes 30-60 seconds to wake up. This is fine for testing and demos. If you want it always-on, the $7/month plan keeps it awake — but for now the free tier works great.

1. Go to **https://render.com** (you already signed up in Step 9)
2. Click **New +** → **Web Service**
3. Click **Connect a repository**
4. Find and select `agentforge-protocol`
5. Fill in settings:
   - **Name:** `agentforge-server`
   - **Region:** Oregon (US West) or Singapore
   - **Branch:** main
   - **Root Directory:** (leave blank)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm run server`
   - **Plan:** Free
6. Scroll down to **Environment Variables**
7. Click **Add Environment Variable** for each one:
   - Key: `BASE_RPC_URL` → Value: your Alchemy URL
   - Key: `REGISTRY_ADDRESS` → Value: your registry address from deployments.json
   - Key: `COMMERCE_ADDRESS` → Value: your commerce address
   - Key: `VAULT_ADDRESS` → Value: your vault address
   - Key: `EXECUTOR_ADDRESS` → Value: your executor address
   - Key: `DEPLOY_BLOCK` → Value: `0`
   - Key: `NODE_ENV` → Value: `production`
8. Click **Create Web Service**
9. Render builds and deploys. Takes 3-5 minutes.
10. When done, you'll see a green checkmark and a URL like:
    `https://agentforge-server.onrender.com`

**Copy that URL** — you'll need it in the next step.

Test it works: paste this in your browser:
`https://agentforge-server.onrender.com/health`

You should see: `{"status":"ok",...}` ✅

---

## Step 23: Deploy Dashboard to Vercel (Free, Forever)

1. Go to **https://vercel.com** (you signed up in Step 10)
2. Click **Add New** → **Project**
3. Find `agentforge-protocol` → click **Import**
4. Configure settings:
   - **Framework Preset:** Create React App
   - **Root Directory:** Click **Edit** → type `dashboard`
5. Click **Environment Variables** and add these:
   - `REACT_APP_API_URL` = `https://agentforge-server.onrender.com`
   - `REACT_APP_WS_URL` = `wss://agentforge-server.onrender.com`
   - `REACT_APP_REGISTRY_ADDRESS` = your registry address
   - `REACT_APP_COMMERCE_ADDRESS` = your commerce address
   - `REACT_APP_VAULT_ADDRESS` = your vault address
   - `REACT_APP_EXECUTOR_ADDRESS` = your executor address
   - `REACT_APP_CHAIN_ID` = `84532`
6. Click **Deploy**
7. Wait 2-3 minutes

You get a real URL: **https://agentforge-protocol.vercel.app**

**That's your live website.** Send that link to anyone in the world.

---

# PHASE 8 — REGISTER AND ACTIVATE YOUR FIRST AGENT

## Step 24: Connect Your Wallet to the Live Dashboard

1. Open your Vercel URL in Chrome
2. Make sure MetaMask is set to **Base Sepolia** network
3. Click **Connect Wallet** on the dashboard
4. MetaMask pops up → click **Connect**
5. Your wallet address appears in the top right

---

## Step 25: Register an Agent

1. Click **+ Register Agent** or **+ New Agent**
2. Fill in the form:
   - Name: `MyFirstAgent`
   - Strategy: Conservative Yield
   - Safety Level: Standard
   - Keep default numbers
3. Click through the steps
4. Click **Register Agent**
5. MetaMask pops up → click **Confirm**
6. Wait 15-30 seconds
7. Your agent appears as **Pending** ✅

---

## Step 26: Grant Yourself Auditor Power

So you can approve your own agents:

1. Go to: `https://sepolia.basescan.org/address/YOUR_REGISTRY_ADDRESS#writeContract`
   (replace YOUR_REGISTRY_ADDRESS with your actual address)
2. Click **Connect to Web3** → connect MetaMask
3. Find **grantRole** function
4. Fill in:
   - `role`: `0x3acf60c6ef4a84f3b8df06d1d79a5b15c42c80de`
   - `account`: your wallet address
5. Click **Write** → confirm in MetaMask

---

## Step 27: Approve Your Agent (Audit It)

1. On BaseScan, find **submitAudit** function
2. Fill in:
   - `agentId`: copy from your dashboard (the long 0x... string)
   - `score`: `80`
   - `reportHash`: `0x0000000000000000000000000000000000000000000000000000000000000000`
   - `findings`: `[]`
   - `passed`: `true`
3. Click **Write** → confirm MetaMask

Your agent changes to **Active** on the dashboard. The live event stream shows the status change happening in real time. 🎉

---

# WHAT YOU NOW HAVE — COMPLETELY FREE

| What | Where | Cost |
|------|-------|------|
| AgentRegistry contract | sepolia.basescan.org | Free |
| AgentVault contract | sepolia.basescan.org | Free |
| AgentCommerce contract | sepolia.basescan.org | Free |
| AgentExecutor contract | sepolia.basescan.org | Free |
| Backend server | agentforge-server.onrender.com | Free |
| Live dashboard | agentforge-protocol.vercel.app | Free |
| Code repository | github.com/you/agentforge-protocol | Free |

**Total cost: $0.00**

---

# PHASE 9 — WHEN YOU'RE READY FOR THE REAL BLOCKCHAIN

Testnet is great for showing people and testing everything.
When you want it on the real Base blockchain with real money, here's what changes:

## What's Different on Mainnet

**You need real ETH.** About $5-8 worth for gas fees. That's it.

**Everything else stays free:**
- GitHub stays free
- Vercel stays free  
- Alchemy has a free tier for mainnet too
- Render stays free

## How to Switch

**Step 1:** Buy $10 of ETH on Coinbase (https://coinbase.com)
- Make an account
- Buy ETH with a debit card
- Send it to your MetaMask wallet on **Base** network (not Ethereum)

**Step 2:** Get a mainnet Alchemy URL
- In Alchemy, create a new app
- This time choose **Base Mainnet** instead of Base Sepolia
- Copy the new URL

**Step 3:** Update your .env file
- Change `BASE_RPC_URL` to your mainnet Alchemy URL
- Change `REACT_APP_CHAIN_ID` to `8453`

**Step 4:** Re-deploy
```
npm run deploy:base
```

**Step 5:** Run setup again
```
node scripts/setup.js
```

**Step 6:** Update Render and Vercel env variables with new addresses

Done. Same process, real blockchain.

---

# TROUBLESHOOTING — MOST COMMON PROBLEMS

**"npm install fails"**
Solution: Run `npm install --legacy-peer-deps` instead

**"npm run compile fails"**
Solution: Make sure Node.js is version 18 or higher: `node --version`
If it's lower, reinstall Node.js from nodejs.org

**"Not enough ETH to deploy"**
Solution: Go back to the faucets in Step 7 and get more test ETH
Some faucets give different amounts — try all of them

**"MetaMask won't connect on the website"**
Solution: 
- Make sure you're using Chrome
- Make sure MetaMask extension is installed
- Make sure you're on Base Sepolia network in MetaMask
- Try refreshing the page

**"Dashboard shows Backend Offline"**
Solution:
- Your Render server may be sleeping (free tier wakes up in 30-60 seconds)
- Wait a minute and refresh
- Or check Render dashboard to see if there's an error

**"Render deployment fails"**
Solution:
- Click on the failed deploy to see the error message
- Most common: wrong Start Command. Make sure it says `npm run server`
- Make sure all environment variables are filled in

**"Vercel shows blank page"**
Solution:
- Make sure Root Directory is set to `dashboard` in Vercel settings
- Make sure all REACT_APP_ environment variables are filled in
- Redeploy after fixing

**"submitAudit fails on BaseScan"**
Solution:
- Make sure you connected MetaMask in the "Connect to Web3" step
- Make sure you're using the wallet that deployed the contracts
- The `reportHash` must be exactly 32 bytes: use all zeros

**"My agent stays as Pending"**
Solution: You need to run submitAudit on BaseScan (Step 27). The agent doesn't activate automatically — it needs an auditor to approve it.

---

# QUICK REFERENCE CHEAT SHEET

**Free testnet faucets:**
- https://www.alchemy.com/faucets/base-sepolia
- https://faucet.quicknode.com/base/sepolia
- https://learnweb3.io/faucets/base_sepolia/

**Add Base Sepolia to MetaMask:**
- RPC: https://sepolia.basescan.org/
- Chain ID: 84532
- Symbol: ETH

**Key commands:**
```
npm install          ← install everything
npm run compile      ← compile contracts
npm test             ← run tests
npm run deploy:base-test  ← deploy to testnet (FREE)
node scripts/setup.js     ← configure everything
npm run server       ← start backend server
cd dashboard && npm start ← start dashboard
```

**Key websites:**
- Your contracts: https://sepolia.basescan.org/address/YOUR_ADDRESS
- Your server: https://agentforge-server.onrender.com/health
- Your dashboard: https://agentforge-protocol.vercel.app

---

*Total time to complete: 2-3 hours
Total cost: $0
What you get: A fully working blockchain protocol with live dashboard, running on a real testnet, accessible anywhere in the world*
