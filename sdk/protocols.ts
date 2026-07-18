/**
 * protocols.ts
 * Real ABI-encoded calldata builders for every supported DeFi protocol.
 * These produce actual transaction data that executes on-chain.
 */

import { ethers, Interface, parseUnits, MaxUint256 } from "ethers";

// ─── Token Addresses (Base Mainnet) ──────────────────────────────────────────
export const TOKENS = {
  USDC:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH:  "0x4200000000000000000000000000000000000006",
  WBTC:  "0x1ceA84203673764244E05693e42E6Ace62bE9BA5",
  DAI:   "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
} as const;

// ─── Protocol Addresses (Base Mainnet) ───────────────────────────────────────
export const PROTOCOLS = {
  // Aave V3
  AAVE_POOL:            "0xA238Dd8sB03359a5fE0B36a8DC53A35FC5c9b4D4",
  AAVE_POOL_BASE:       "0x18cd499e3d7ed42feba981ac9236a278e4cdc2ee",

  // Uniswap V3
  UNISWAP_ROUTER:       "0x2626664c2603336E57B271c5C0b26F421741e481",
  UNISWAP_QUOTER_V2:    "0x3d4e44Eb1374240CE5F1B136Cf395a8B9974f378",
  UNISWAP_FACTORY:      "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",

  // Compound V3 (Comet)
  COMPOUND_USDC_COMET:  "0xb125E6687d4313864e53df431d5425969c15Eb2",

  // Curve
  CURVE_3POOL:          "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",

  // Moonwell (Base native lending)
  MOONWELL_COMPTROLLER: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
  MOONWELL_mUSDC:       "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
  MOONWELL_mWETH:       "0x628ff693426583D9a7FB391E54366292F509D457",
} as const;

// ─── ERC-20 ABI ───────────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

// ─── AAVE V3 ─────────────────────────────────────────────────────────────────
const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
];

export class AaveProtocol {
  private iface = new Interface(AAVE_POOL_ABI);
  private erc20 = new Interface(ERC20_ABI);
  readonly address = PROTOCOLS.AAVE_POOL_BASE;

  /** Approve Aave pool to spend your tokens, then supply */
  buildSupply(token: string, amount: bigint, onBehalfOf: string): { approveTx: string; supplyTx: string } {
    const approveTx = this.erc20.encodeFunctionData("approve", [this.address, amount]);
    const supplyTx  = this.iface.encodeFunctionData("supply", [token, amount, onBehalfOf, 0]);
    return { approveTx, supplyTx };
  }

  /** Withdraw all (use MaxUint256) or specific amount */
  buildWithdraw(token: string, amount: bigint, to: string): string {
    return this.iface.encodeFunctionData("withdraw", [token, amount, to]);
  }

  /** Borrow at variable rate (interestRateMode = 2) */
  buildBorrow(token: string, amount: bigint, borrower: string): string {
    return this.iface.encodeFunctionData("borrow", [token, amount, 2, 0, borrower]);
  }

  /** Repay variable-rate debt */
  buildRepay(token: string, amount: bigint, onBehalfOf: string): string {
    return this.iface.encodeFunctionData("repay", [token, amount, 2, onBehalfOf]);
  }

  /** Fetch current supply APY from on-chain data */
  async getCurrentAPY(provider: ethers.JsonRpcProvider, token: string): Promise<number> {
    try {
      const pool = new ethers.Contract(this.address, AAVE_POOL_ABI, provider);
      const data = await pool.getReserveData(token);
      // currentLiquidityRate is in Ray (1e27), convert to APY percentage
      const rayRate = BigInt(data.currentLiquidityRate);
      const apy = Number(rayRate) / 1e27 * 100;
      return apy;
    } catch {
      return 0;
    }
  }
}

// ─── UNISWAP V3 ──────────────────────────────────────────────────────────────
const UNISWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  "function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
  "function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)",
];

const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

export class UniswapProtocol {
  private iface    = new Interface(UNISWAP_ROUTER_ABI);
  private qIface   = new Interface(UNISWAP_QUOTER_ABI);
  private erc20    = new Interface(ERC20_ABI);
  readonly address = PROTOCOLS.UNISWAP_ROUTER;

  /** Get the best fee tier and expected output for a swap */
  async getBestQuote(
    provider: ethers.JsonRpcProvider,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; fee: number; priceImpact: number }> {
    const quoter  = new ethers.Contract(PROTOCOLS.UNISWAP_QUOTER_V2, UNISWAP_QUOTER_ABI, provider);
    const fees    = [100, 500, 3000, 10000];
    let bestOut   = 0n;
    let bestFee   = 3000;

    for (const fee of fees) {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0,
        });
        if (amountOut > bestOut) { bestOut = amountOut; bestFee = fee; }
      } catch { /* fee tier doesn't exist, skip */ }
    }

    const priceImpact = bestOut > 0n
      ? Number((amountIn - bestOut) * 10000n / amountIn) / 100
      : 100;

    return { amountOut: bestOut, fee: bestFee, priceImpact };
  }

  /** Build approve + swap calldata */
  buildSwap(
    tokenIn: string,
    tokenOut: string,
    fee: number,
    recipient: string,
    amountIn: bigint,
    amountOutMinimum: bigint
  ): { approveTx: string; swapTx: string } {
    const approveTx = this.erc20.encodeFunctionData("approve", [this.address, amountIn]);
    const swapTx    = this.iface.encodeFunctionData("exactInputSingle", [{
      tokenIn, tokenOut, fee, recipient,
      amountIn, amountOutMinimum, sqrtPriceLimitX96: 0,
    }]);
    return { approveTx, swapTx };
  }

  /** Build multi-hop swap (e.g. USDC → WETH → WBTC) */
  buildMultiHopSwap(
    path: string,            // abi.encodePacked(token0, fee, token1, fee, token2)
    recipient: string,
    amountIn: bigint,
    amountOutMinimum: bigint
  ): string {
    return this.iface.encodeFunctionData("exactInput", [{
      path, recipient, amountIn, amountOutMinimum,
    }]);
  }

  /** Encode a multi-hop path */
  encodePath(tokens: string[], fees: number[]): string {
    let path = tokens[0].toLowerCase();
    for (let i = 0; i < fees.length; i++) {
      path += fees[i].toString(16).padStart(6, "0");
      path += tokens[i + 1].slice(2).toLowerCase();
    }
    return "0x" + path;
  }
}

// ─── COMPOUND V3 (Comet) ──────────────────────────────────────────────────────
const COMET_ABI = [
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function getSupplyRate(uint256 utilization) view returns (uint64)",
  "function getUtilization() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function isSupplyPaused() view returns (bool)",
];

export class CompoundProtocol {
  private iface = new Interface(COMET_ABI);
  private erc20 = new Interface(ERC20_ABI);
  readonly address = PROTOCOLS.COMPOUND_USDC_COMET;

  buildSupply(token: string, amount: bigint): { approveTx: string; supplyTx: string } {
    const approveTx = this.erc20.encodeFunctionData("approve", [this.address, amount]);
    const supplyTx  = this.iface.encodeFunctionData("supply", [token, amount]);
    return { approveTx, supplyTx };
  }

  buildWithdraw(token: string, amount: bigint): string {
    return this.iface.encodeFunctionData("withdraw", [token, amount]);
  }

  /** Get current supply APY (per-second rate → annualized) */
  async getCurrentAPY(provider: ethers.JsonRpcProvider): Promise<number> {
    try {
      const comet       = new ethers.Contract(this.address, COMET_ABI, provider);
      const utilization = await comet.getUtilization();
      const ratePerSec  = await comet.getSupplyRate(utilization);
      // Rate is per second in 1e18, annualize it
      const apy = Number(ratePerSec) / 1e18 * 365 * 24 * 3600 * 100;
      return apy;
    } catch {
      return 0;
    }
  }

  async getBalance(provider: ethers.JsonRpcProvider, account: string): Promise<bigint> {
    try {
      const comet = new ethers.Contract(this.address, COMET_ABI, provider);
      return await comet.balanceOf(account);
    } catch {
      return 0n;
    }
  }
}

// ─── MOONWELL (Base-native lending) ──────────────────────────────────────────
const MOONWELL_MTOKEN_ABI = [
  "function mint(uint256 mintAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function supplyRatePerTimestamp() view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
];

export class MoonwellProtocol {
  private iface = new Interface(MOONWELL_MTOKEN_ABI);
  private erc20 = new Interface(ERC20_ABI);

  getMarketAddress(token: string): string {
    if (token.toLowerCase() === TOKENS.USDC.toLowerCase()) return PROTOCOLS.MOONWELL_mUSDC;
    if (token.toLowerCase() === TOKENS.WETH.toLowerCase()) return PROTOCOLS.MOONWELL_mWETH;
    throw new Error(`No Moonwell market for token ${token}`);
  }

  buildSupply(token: string, amount: bigint): { approveTx: string; mintTx: string; market: string } {
    const market    = this.getMarketAddress(token);
    const approveTx = this.erc20.encodeFunctionData("approve", [market, amount]);
    const mintTx    = this.iface.encodeFunctionData("mint", [amount]);
    return { approveTx, mintTx, market };
  }

  buildWithdraw(token: string, amount: bigint): { redeemTx: string; market: string } {
    const market   = this.getMarketAddress(token);
    const redeemTx = this.iface.encodeFunctionData("redeemUnderlying", [amount]);
    return { redeemTx, market };
  }

  async getCurrentAPY(provider: ethers.JsonRpcProvider, token: string): Promise<number> {
    try {
      const market   = this.getMarketAddress(token);
      const contract = new ethers.Contract(market, MOONWELL_MTOKEN_ABI, provider);
      const ratePerSec = await contract.supplyRatePerTimestamp();
      // Moonwell uses per-second rate
      const apy = Number(ratePerSec) / 1e18 * 365 * 24 * 3600 * 100;
      return apy;
    } catch {
      return 0;
    }
  }
}

// ─── RATE AGGREGATOR — finds the best yield across all protocols ──────────────
export class RateAggregator {
  private aave     = new AaveProtocol();
  private compound = new CompoundProtocol();
  private moonwell = new MoonwellProtocol();

  async getBestYield(
    provider: ethers.JsonRpcProvider,
    token: string
  ): Promise<{
    protocol: "aave" | "compound" | "moonwell";
    apy: number;
    allRates: Record<string, number>;
  }> {
    const [aaveAPY, compAPY, moonAPY] = await Promise.all([
      this.aave.getCurrentAPY(provider, token),
      token.toLowerCase() === TOKENS.USDC.toLowerCase() ? this.compound.getCurrentAPY(provider) : Promise.resolve(0),
      this.moonwell.getCurrentAPY(provider, token).catch(() => 0),
    ]);

    const rates = { aave: aaveAPY, compound: compAPY, moonwell: moonAPY };
    const best  = Object.entries(rates).sort(([, a], [, b]) => b - a)[0];

    console.log(`[Rates] Aave: ${aaveAPY.toFixed(3)}% | Compound: ${compAPY.toFixed(3)}% | Moonwell: ${moonAPY.toFixed(3)}%`);
    console.log(`[Rates] Best: ${best[0].toUpperCase()} at ${best[1].toFixed(3)}%`);

    return {
      protocol: best[0] as "aave" | "compound" | "moonwell",
      apy:      best[1],
      allRates: rates,
    };
  }
}

// ─── TOKEN HELPER ─────────────────────────────────────────────────────────────
export class TokenHelper {
  private erc20 = new Interface(ERC20_ABI);

  async getBalance(provider: ethers.JsonRpcProvider, token: string, wallet: string): Promise<{ raw: bigint; formatted: number; decimals: number }> {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    const [raw, decimals] = await Promise.all([
      contract.balanceOf(wallet),
      contract.decimals(),
    ]);
    return { raw, formatted: Number(raw) / 10 ** Number(decimals), decimals: Number(decimals) };
  }

  async getAllBalances(provider: ethers.JsonRpcProvider, wallet: string): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    await Promise.all(
      Object.entries(TOKENS).map(async ([symbol, address]) => {
        try {
          const { formatted } = await this.getBalance(provider, address, wallet);
          results[symbol] = formatted;
        } catch { results[symbol] = 0; }
      })
    );
    return results;
  }

  parseAmount(amount: number, decimals: number): bigint {
    return parseUnits(amount.toFixed(decimals), decimals);
  }

  buildApproval(spender: string, amount: bigint): string {
    return this.erc20.encodeFunctionData("approve", [spender, amount]);
  }

  buildMaxApproval(spender: string): string {
    return this.erc20.encodeFunctionData("approve", [spender, MaxUint256]);
  }
}

export const aave     = new AaveProtocol();
export const uniswap  = new UniswapProtocol();
export const compound = new CompoundProtocol();
export const moonwell = new MoonwellProtocol();
export const rates    = new RateAggregator();
export const tokens   = new TokenHelper();
