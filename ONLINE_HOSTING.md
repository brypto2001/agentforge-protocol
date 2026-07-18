# AgentForge — Online Hosting (Base Sepolia)

Repo: https://github.com/brypto2001/agentforge-protocol

## Deployed contracts

| Contract | Address |
|----------|---------|
| Registry | `0xa64ceF575017C69A85561B37377321A5755DA548` |
| Vault | `0xF4a43c1a3e9B41E4650128DDAA1624157043fC9e` |
| Commerce | `0xaEd7568CF363ce98C06c228403493850ed303958` |
| Executor | `0x948067cAC83c057ad35EEEfE76393f40e8542f32` |

---

## 1) Backend on Render (free)

1. Go to https://render.com → Sign in with **GitHub**
2. **New +** → **Web Service**
3. Connect `brypto2001/agentforge-protocol` (Authorize if asked)
4. Settings:
   - **Name:** `agentforge-server`
   - **Runtime:** Node
   - **Branch:** `main`
   - **Build Command:** `npm install --legacy-peer-deps`
   - **Start Command:** `npm start`
   - **Instance type:** Free
5. **Environment variables** (add each):

| Key | Value |
|-----|-------|
| `BASE_RPC_URL` | your Alchemy Base Sepolia HTTPS URL |
| `REGISTRY_ADDRESS` | `0xa64ceF575017C69A85561B37377321A5755DA548` |
| `COMMERCE_ADDRESS` | `0xaEd7568CF363ce98C06c228403493850ed303958` |
| `VAULT_ADDRESS` | `0xF4a43c1a3e9B41E4650128DDAA1624157043fC9e` |
| `EXECUTOR_ADDRESS` | `0x948067cAC83c057ad35EEEfE76393f40e8542f32` |
| `DEPLOY_BLOCK` | `0` |
| `NODE_ENV` | `production` |
| `DASHBOARD_URL` | `*` |

6. Click **Create Web Service** → wait for green deploy
7. Copy your URL, e.g. `https://agentforge-server.onrender.com`
8. Test: open `https://YOUR-SERVICE.onrender.com/health` → should show `{"status":"ok",...}`

> Free tier sleeps after ~15 min idle; first request may take 30–60s.

---

## 2) Dashboard on Vercel (free)

1. Go to https://vercel.com → Sign in with **GitHub**
2. **Add New…** → **Project** → Import `agentforge-protocol`
3. Configure:
   - **Root Directory:** `dashboard` (Edit → set to `dashboard`)
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `build`
4. **Environment Variables:**

| Key | Value |
|-----|-------|
| `REACT_APP_API_URL` | `https://YOUR-RENDER-URL` (no trailing slash) |
| `REACT_APP_WS_URL` | `wss://YOUR-RENDER-URL` (wss, not https) |
| `REACT_APP_REGISTRY_ADDRESS` | `0xa64ceF575017C69A85561B37377321A5755DA548` |
| `REACT_APP_COMMERCE_ADDRESS` | `0xaEd7568CF363ce98C06c228403493850ed303958` |
| `REACT_APP_VAULT_ADDRESS` | `0xF4a43c1a3e9B41E4650128DDAA1624157043fC9e` |
| `REACT_APP_EXECUTOR_ADDRESS` | `0x948067cAC83c057ad35EEEfE76393f40e8542f32` |
| `REACT_APP_CHAIN_ID` | `84532` |

5. **Deploy**
6. Open the Vercel URL → green **Live** when backend is awake

---

## 3) After both are live

1. MetaMask on **Base Sepolia**
2. Connect wallet on dashboard
3. Grant AUDITOR_ROLE on Registry (Write Contract on Sepolia BaseScan)
4. Register + audit first agent
