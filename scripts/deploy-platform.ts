/**
 * Deploy DemoMarket and grant EXECUTOR_ROLE to deployer.
 * Keeps existing registry/vault/commerce/executor addresses.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployPath = path.join(__dirname, "../deployments.json");
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const d = deployment.contracts;

  console.log("Deployer:", deployer.address);
  console.log("Existing registry:", d.AgentRegistry);

  console.log("\nDeploying DemoMarket...");
  const Market = await ethers.getContractFactory("DemoMarket");
  const market = await Market.deploy();
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("✅ DemoMarket:", marketAddr);

  // Ensure deployer has EXECUTOR_ROLE
  const executor = await ethers.getContractAt(
    [
      "function EXECUTOR_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
    ],
    d.AgentExecutor
  );
  const role = await executor.EXECUTOR_ROLE();
  const has = await executor.hasRole(role, deployer.address);
  if (!has) {
    const tx = await executor.grantRole(role, deployer.address);
    await tx.wait();
    console.log("✅ Granted EXECUTOR_ROLE to deployer");
  } else {
    console.log("✅ Deployer already has EXECUTOR_ROLE");
  }

  d.DemoMarket = marketAddr;
  deployment.contracts = d;
  deployment.platformAt = new Date().toISOString();
  fs.writeFileSync(deployPath, JSON.stringify(deployment, null, 2));

  // Merge into .env
  const envPath = path.join(__dirname, "../.env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const setEnv = (k: string, v: string) => {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(env)) env = env.replace(re, `${k}=${v}`);
    else env += `\n${k}=${v}`;
  };
  setEnv("DEMO_MARKET_ADDRESS", marketAddr);
  setEnv("REGISTRY_ADDRESS", d.AgentRegistry);
  setEnv("VAULT_ADDRESS", d.AgentVault);
  setEnv("COMMERCE_ADDRESS", d.AgentCommerce);
  setEnv("EXECUTOR_ADDRESS", d.AgentExecutor);
  fs.writeFileSync(envPath, env);

  const publicPath = path.join(__dirname, "../deployments.public.json");
  fs.writeFileSync(
    publicPath,
    JSON.stringify(
      {
        ...deployment,
        explorers: {
          AgentRegistry: `https://sepolia.basescan.org/address/${d.AgentRegistry}`,
          AgentVault: `https://sepolia.basescan.org/address/${d.AgentVault}`,
          AgentCommerce: `https://sepolia.basescan.org/address/${d.AgentCommerce}`,
          AgentExecutor: `https://sepolia.basescan.org/address/${d.AgentExecutor}`,
          DemoMarket: `https://sepolia.basescan.org/address/${marketAddr}`,
        },
      },
      null,
      2
    )
  );

  console.log("\n📄 Updated deployments.json + .env");
  console.log("Next: node scripts/platform-bootstrap.js");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
