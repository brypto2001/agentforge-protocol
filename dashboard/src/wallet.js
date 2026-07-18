/**
 * Mobile-friendly wallet helpers
 * - Desktop: injected EIP-1193 (MetaMask extension)
 * - Mobile: open dapp inside MetaMask / Coinbase in-app browser via deep link
 * - EIP-6963 multi-provider discovery when available
 */

export function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export function isInWalletBrowser() {
  const eth = typeof window !== "undefined" ? window.ethereum : null;
  if (!eth) return false;
  // MetaMask / Coinbase / Rainbow in-app browsers inject ethereum
  return Boolean(eth.isMetaMask || eth.isCoinbaseWallet || eth.isRainbow || eth.providers?.length);
}

/** Best available EIP-1193 provider */
export function getInjectedProvider() {
  if (typeof window === "undefined") return null;
  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.providers?.length) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    return mm || eth.providers[0];
  }
  return eth;
}

/**
 * Deep-link into MetaMask mobile browser for this dapp URL.
 * Works when user is on mobile Safari/Chrome without injected provider.
 */
export function openInMetaMask() {
  const url = window.location.href.replace(/^https?:\/\//, "");
  // Universal link (iOS/Android MetaMask)
  const deep = `https://metamask.app.link/dapp/${url}`;
  window.location.href = deep;
}

export function openInCoinbaseWallet() {
  const url = encodeURIComponent(window.location.href);
  window.location.href = `https://go.cb-w.com/dapp?cb_url=${url}`;
}

/**
 * Request accounts with timeout (mobile often hangs).
 */
export async function requestAccounts(provider, timeoutMs = 60000) {
  return Promise.race([
    provider.request({ method: "eth_requestAccounts" }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out — try again or open in MetaMask app")), timeoutMs)
    ),
  ]);
}

export async function ensureChain(provider, chainIdHex, chainParams) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    if (err?.code === 4902 || String(err?.message || "").includes("4902")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [chainParams],
      });
    } else if (err?.code !== 4001) {
      throw err;
    }
  }
}
