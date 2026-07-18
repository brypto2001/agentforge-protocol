import { ethers, upgrades } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const d: Record<string, string> = {};

  console.log("╔══════════════════════════════════════════╗");
  console.log("║    AgentForge v3 — Full Deployment       ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network:  ${network.name} (${network.chainId})\n`);

  // 1. AgentRegistryV2 (UUPS proxy)
  console.log("Deploying AgentRegistryV2...");
  const Registry = await ethers.getContractFactory("AgentRegistryV2");
  const registry = await upgrades.deployProxy(Registry, [deployer.address, ethers.ZeroAddress, deployer.address], { initializer: "initialize", kind: "uups" });
  await registry.waitForDeployment();
  d.AgentRegistry = await registry.getAddress();
  console.log(`✅ AgentRegistry: ${d.AgentRegistry}`);

  // 2. AgentVault
  console.log("Deploying AgentVault...");
  const Vault  = await ethers.getContractFactory("AgentVault");
  const vault  = await Vault.deploy(deployer.address);
  await vault.waitForDeployment();
  d.AgentVault = await vault.getAddress();
  console.log(`✅ AgentVault:    ${d.AgentVault}`);

  // 3. AgentCommerce
  console.log("Deploying AgentCommerce...");
  const Commerce  = await ethers.getContractFactory("AgentCommerce");
  const commerce  = await Commerce.deploy(deployer.address);
  await commerce.waitForDeployment();
  d.AgentCommerce = await commerce.getAddress();
  console.log(`✅ AgentCommerce: ${d.AgentCommerce}`);

  // 4. AgentExecutor
  console.log("Deploying AgentExecutor...");
  const Executor  = await ethers.getContractFactory("AgentExecutor");
  const executor  = await Executor.deploy(d.AgentRegistry);
  await executor.waitForDeployment();
  d.AgentExecutor = await executor.getAddress();
  console.log(`✅ AgentExecutor: ${d.AgentExecutor}`);

  // 5. Roles
  console.log("\nConfiguring roles...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
  await (registry as any).grantRole(OPERATOR_ROLE, d.AgentExecutor);
  await executor.grantRole(EXECUTOR_ROLE, deployer.address);
  console.log("✅ Roles configured");

  // 6. Save
  const out = { version: "3.0.0", network: network.name, chainId: Number(network.chainId), deployedAt: new Date().toISOString(), deployer: deployer.address, contracts: d };
  fs.writeFileSync(path.join(__dirname, "../deployments.json"), JSON.stringify(out, null, 2));
  console.log("\n📄 Saved: deployments.json");

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║        Deployment Complete! ✅            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("\nNext: node scripts/setup.js\n");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
