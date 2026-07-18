/**
 * Upgrade AgentRegistryV2 proxy implementation (keeps same address).
 * Usage: npx hardhat run scripts/upgrade-registry.ts --network baseGoerli
 */
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deployPath = path.join(__dirname, "../deployments.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error("deployments.json missing — set REGISTRY_ADDRESS env instead");
  }
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const proxyAddress =
    process.env.REGISTRY_ADDRESS || deployment.contracts?.AgentRegistry;

  if (!proxyAddress) throw new Error("No registry proxy address");

  const [signer] = await ethers.getSigners();
  console.log("Upgrader:", signer.address);
  console.log("Proxy:   ", proxyAddress);

  const Registry = await ethers.getContractFactory("AgentRegistryV2");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Registry, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();

  const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("✅ Registry upgraded");
  console.log("   Proxy still: ", proxyAddress);
  console.log("   New impl:    ", impl);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
