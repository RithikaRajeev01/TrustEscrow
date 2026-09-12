import { ethers } from "hardhat";

async function main() {
  const Factory = await ethers.getContractFactory("TrustEscrow");
  const escrow = await Factory.deploy();
  await escrow.waitForDeployment();
  console.log("TrustEscrow deployed to:", await escrow.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
