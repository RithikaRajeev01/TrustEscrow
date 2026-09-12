import * as fs from "fs";
import * as path from "path";

// Ensure node resolves packages from smart-contracts/node_modules
const scModules = path.resolve(__dirname, "../../smart-contracts/node_modules");
if (module.paths && !module.paths.includes(scModules)) {
  module.paths.unshift(scModules);
}
if (require.main && require.main.paths && !require.main.paths.includes(scModules)) {
  require.main.paths.unshift(scModules);
}

// Dynamically require hardhat using resolved path
const hardhat = require(path.join(scModules, "hardhat"));
const { ethers, network } = hardhat;

// Helper to load .env manually if dotenv is not present in smart-contracts
function loadEnv() {
  const envPaths = [
    path.resolve(__dirname, "../.env"), // analytics/.env
    path.resolve(__dirname, "../../smart-contracts/.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env"),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const idx = trimmed.indexOf("=");
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            // Prioritize analytics/.env or replace if previously resolved to signer address
            if (!process.env[key] || (key === "CONTRACT_ADDRESS" && process.env[key]?.toLowerCase() === "0xd69bf69f2be30cae1147ae8073c20b2833d929d4")) {
              process.env[key] = val;
            }
          }
        }
      }
    }
  }
}

loadEnv();

// Helper to fast-forward time on local Hardhat network
async function increaseTime(seconds: number) {
  if (network.name === "hardhat" || network.name === "localhost") {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
    console.log(`  ⏳ Advanced EVM time by ${seconds / 86400} day(s).`);
  }
}

async function main() {
  console.log("===============================================================");
  console.log("🚀 TrustEscrow+ Activity Simulation Starting");
  console.log(`🌐 Target Network: ${network.name}`);
  console.log("===============================================================");

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signers found. Check PRIVATE_KEY in .env.");
  }
  const mainSigner = signers[0];
  console.log(`Primary Signer (Account 12): ${mainSigner.address}`);

  // ===========================================================================
  // 1. RESOLVE & VERIFY CONTRACT ADDRESS BEFORE SENDING ANY TRANSACTIONS
  // ===========================================================================
  let contractAddress = process.env.CONTRACT_ADDRESS;
  let escrow: any;

  if (contractAddress && ethers.isAddress(contractAddress) && contractAddress !== ethers.ZeroAddress) {
    // Validate that CONTRACT_ADDRESS is NOT the primary signer address
    if (contractAddress.toLowerCase() === mainSigner.address.toLowerCase()) {
      throw new Error(
        `[CONFIGURATION ERROR] CONTRACT_ADDRESS (${contractAddress}) matches the primary signer address (Account 12: ${mainSigner.address})! ` +
        `CONTRACT_ADDRESS must point to the deployed TrustEscrow contract (e.g. 0xFCDcFC0a086a31f573C9ea9d7370E22f5a3E8406).`
      );
    }

    console.log("\n---------------------------------------------------------------");
    console.log("🔍 Verifying Resolved Contract Address On-Chain...");
    console.log(`   Target Contract Address: ${contractAddress}`);
    console.log(`   Primary Signer Address:  ${mainSigner.address}`);
    console.log("---------------------------------------------------------------");

    // Check bytecode existence on target network
    let bytecode = await ethers.provider.getCode(contractAddress);
    if (bytecode === "0x" || bytecode === "0x0") {
      if (network.name === "hardhat") {
        console.log(`  [INFO] In-memory hardhat network detected with unpopulated state. Deploying local test instance...`);
        const Factory = await ethers.getContractFactory("TrustEscrow");
        escrow = await Factory.deploy();
        await escrow.waitForDeployment();
        contractAddress = await escrow.getAddress();
        bytecode = await ethers.provider.getCode(contractAddress);
        console.log(`  TrustEscrow deployed locally to: ${contractAddress}`);
      } else {
        throw new Error(
          `[VERIFICATION FAILED] No contract bytecode deployed at ${contractAddress} on ${network.name}. ` +
          `Confirm the contract address and network RPC.`
        );
      }
    }

    if (!escrow) {
      escrow = await ethers.getContractAt("TrustEscrow", contractAddress);
    }

    // Call view functions to confirm it is a valid TrustEscrow contract
    const [acceptancePeriod, projectCount] = await Promise.all([
      escrow.ACCEPTANCE_PERIOD(),
      escrow.projectCount(),
    ]);

    console.log(`  ✓ On-chain contract bytecode verified (${(bytecode.length - 2) / 2} bytes)`);
    console.log(`  ✓ TrustEscrow interface confirmed`);
    console.log(`  ✓ Current projectCount: ${projectCount.toString()}`);
    console.log(`  ✓ ACCEPTANCE_PERIOD: ${acceptancePeriod.toString()}s`);
    console.log(`  ✓ Connected to deployed contract: ${contractAddress}`);
    console.log("---------------------------------------------------------------\n");

    if (process.env.VERIFY_ONLY === "true") {
      console.log("✅ Verification complete: simulator successfully connected to deployed TrustEscrow contract.");
      return;
    }
  } else {
    if (network.name === "hardhat" || network.name === "localhost") {
      console.log("Deploying fresh TrustEscrow instance on local network...");
      const Factory = await ethers.getContractFactory("TrustEscrow");
      escrow = await Factory.deploy();
      await escrow.waitForDeployment();
      contractAddress = await escrow.getAddress();
      console.log(`TrustEscrow deployed to: ${contractAddress}`);
    } else {
      throw new Error("CONTRACT_ADDRESS not provided or invalid in .env for Sepolia deployment.");
    }
  }

  // ===========================================================================
  // 2. SETUP SIGNERS & SUB-WALLETS
  // ===========================================================================
  let client: any;
  let freelancer: any;
  let arbiters: any[] = [];

  if (signers.length >= 7) {
    // Local / Hardhat multi-account environment
    [client, freelancer, arbiters[0], arbiters[1], arbiters[2], arbiters[3], arbiters[4]] = signers;
  } else {
    // Single-key environment (e.g. Sepolia via PRIVATE_KEY)
    client = mainSigner;

    // Create deterministic sub-wallets connected to provider
    const provider = ethers.provider;
    const deriveWallet = (seed: string) => {
      const pKey = ethers.keccak256(ethers.toUtf8Bytes(seed + (process.env.PRIVATE_KEY || "seed")));
      return new ethers.Wallet(pKey, provider);
    };

    freelancer = deriveWallet("freelancer_subwallet");
    for (let i = 0; i < 5; i++) {
      arbiters.push(deriveWallet(`arbiter_${i}_subwallet`));
    }

    console.log("Checking sub-wallet gas balances on live network...");
    for (const w of [freelancer, ...arbiters]) {
      const bal = await provider.getBalance(w.address);
      if (bal < ethers.parseEther("0.001")) {
        try {
          console.log(`  Funding ${w.address.slice(0, 10)}... with 0.003 ETH for gas`);
          const tx = await client.sendTransaction({
            to: w.address,
            value: ethers.parseEther("0.003"),
          });
          await tx.wait();
        } catch (e: any) {
          console.log(`  Warning: Could not fund sub-wallet ${w.address}: ${e.message}`);
        }
      }
    }
  }

  const DOMAINS = [
    "Web Development",
    "Blockchain Development",
    "Data Science",
    "Mobile Development",
    "UI/UX Design",
  ];

  // 1. REGISTER ARBITERS FOR EACH DOMAIN
  console.log("\n---------------------------------------------------------------");
  console.log("📝 Registering Arbiters Across All 5 Domains...");
  console.log("---------------------------------------------------------------");

  for (const domain of DOMAINS) {
    for (let i = 0; i < arbiters.length; i++) {
      const arb = arbiters[i];
      const isReg = await escrow.isRegisteredForDomain(arb.address, domain);
      if (!isReg) {
        try {
          const tx = await escrow.connect(arb)["registerArbiter(string,string,uint256,uint256,string)"](
            domain,
            `${domain} Senior Specialist ${i + 1}`,
            4 + i,
            5 + i * 2,
            `https://portfolio.trustescrow.xyz/arbiter/${arb.address.slice(0, 8)}`
          );
          await tx.wait();
          console.log(`  ✓ Arbiter ${arb.address.slice(0, 8)} registered for [${domain}]`);
        } catch (err: any) {
          console.log(`  Notice registering ${arb.address.slice(0, 8)} for ${domain}: ${err.message}`);
        }
      }
    }
  }

  // SCENARIO DEFINITIONS (25 realistic projects across domains)
  const scenarios = [
    // --- 1. Normal Completed Projects (10) ---
    { type: "complete", domain: "Web Development", desc: "Next.js E-Commerce Storefront", budget: "0.01" },
    { type: "complete", domain: "Web Development", desc: "GraphQL API Microservice", budget: "0.015" },
    { type: "complete", domain: "Blockchain Development", desc: "ERC-721 Staking Smart Contract", budget: "0.02" },
    { type: "complete", domain: "Blockchain Development", desc: "DeFi Yield Protocol Subgraph", budget: "0.025" },
    { type: "complete", domain: "Data Science", desc: "Customer Churn Prediction Model", budget: "0.012" },
    { type: "complete", domain: "Data Science", desc: "Automated Airflow ETL Pipeline", budget: "0.018" },
    { type: "complete", domain: "Mobile Development", desc: "Cross-Platform Flutter Health Tracker", budget: "0.02" },
    { type: "complete", domain: "Mobile Development", desc: "iOS Swift Widget & Push Service", budget: "0.015" },
    { type: "complete", domain: "UI/UX Design", desc: "FinTech Banking Design System", budget: "0.01" },
    { type: "complete", domain: "UI/UX Design", desc: "Web3 Portfolio SaaS Wireframes", budget: "0.012" },

    // --- 2. Freelancer-Won Disputes (4) ---
    { type: "dispute_freelancer", domain: "Web Development", desc: "Cloud Infrastructure Terraform Setup", budget: "0.015" },
    { type: "dispute_freelancer", domain: "Blockchain Development", desc: "ZK-SNARK Verifier Smart Contract", budget: "0.025" },
    { type: "dispute_freelancer", domain: "Data Science", desc: "NLP Sentiment Classification Engine", budget: "0.014" },
    { type: "dispute_freelancer", domain: "Mobile Development", desc: "React Native Map Navigation Library", budget: "0.018" },

    // --- 3. Client-Won Disputes (4) ---
    { type: "dispute_client", domain: "UI/UX Design", desc: "Interactive SaaS Mobile App Prototype", budget: "0.01" },
    { type: "dispute_client", domain: "Blockchain Development", desc: "Cross-Chain Token Bridge Relayer", budget: "0.022" },
    { type: "dispute_client", domain: "Web Development", desc: "Real-Time WebSocket Collaboration Room", budget: "0.015" },
    { type: "dispute_client", domain: "Data Science", desc: "Real-Time Object Detection Pipeline", budget: "0.02" },

    // --- 4. Timeout Scenarios (4) ---
    { type: "timeout_acceptance", domain: "Web Development", desc: "Legacy jQuery Refactoring Sprint", budget: "0.008" },
    { type: "timeout_delivery", domain: "Mobile Development", desc: "Bluetooth LE Sensor Integration", budget: "0.015" },
    { type: "timeout_review", domain: "UI/UX Design", desc: "Design Audit & Usability Report", budget: "0.01" },
    { type: "timeout_acceptance", domain: "Data Science", desc: "Exploratory Data Analysis Notebooks", budget: "0.008" },

    // --- 5. In-Progress Projects (3) ---
    { type: "in_progress_review", domain: "Blockchain Development", desc: "Account Abstraction ERC-4337 Wallet", budget: "0.02" },
    { type: "in_progress_dev", domain: "Mobile Development", desc: "Biometric Auth Security Module", budget: "0.015" },
    { type: "in_progress_funded", domain: "Data Science", desc: "Time-Series Financial Forecasting Model", budget: "0.012" },
  ];

  console.log("\n---------------------------------------------------------------");
  console.log(`⚙️ Executing ${scenarios.length} Simulation Scenarios...`);
  console.log("---------------------------------------------------------------");

  let projectIndex = 0;

  for (const s of scenarios) {
    projectIndex++;
    const budgetWei = ethers.parseEther(s.budget);
    console.log(`\n[Scenario ${projectIndex}/${scenarios.length}] Type: ${s.type.toUpperCase()} | Domain: ${s.domain}`);
    console.log(`  Task: "${s.desc}" | Budget: ${s.budget} ETH`);

    // Step A: Create Project
    let tx = await escrow.connect(client).createProject(freelancer.address, s.domain, s.desc, budgetWei);
    let receipt = await tx.wait();
    const pid = projectIndex; // sequential project id in contract

    // Step B: Deposit Funds
    tx = await escrow.connect(client).depositFunds(pid, { value: budgetWei });
    await tx.wait();
    console.log(`  ✓ Created & Funded Project ID #${pid}`);

    if (s.type === "in_progress_funded") {
      console.log(`  -> Left in Funded state (awaiting freelancer acceptance).`);
      continue;
    }

    if (s.type === "timeout_acceptance") {
      if (network.name === "hardhat" || network.name === "localhost") {
        await increaseTime(86400 + 3600); // 1 day + 1 hour
        try {
          tx = await escrow.connect(client).claimTimeout(pid);
          await tx.wait();
          console.log(`  ✓ Client successfully claimed Acceptance Timeout for Project #${pid}`);
        } catch (e: any) {
          console.log(`  Notice claiming acceptance timeout: ${e.message}`);
        }
      } else {
        console.log(`  -> Acceptance timeout simulated (deadline active on Sepolia).`);
      }
      continue;
    }

    // Step C: Freelancer Accepts
    tx = await escrow.connect(freelancer).acceptProject(pid);
    await tx.wait();
    console.log(`  ✓ Freelancer accepted Project #${pid}`);

    if (s.type === "in_progress_dev") {
      console.log(`  -> Left in Accepted state (actively under development).`);
      continue;
    }

    if (s.type === "timeout_delivery") {
      if (network.name === "hardhat" || network.name === "localhost") {
        await increaseTime(86400 * 8 + 3600); // 8 days + 1 hour (acceptance 1d + delivery 7d)
        try {
          tx = await escrow.connect(client).claimTimeout(pid);
          await tx.wait();
          console.log(`  ✓ Client successfully claimed Delivery Timeout for Project #${pid}`);
        } catch (e: any) {
          console.log(`  Notice claiming delivery timeout: ${e.message}`);
        }
      } else {
        console.log(`  -> Delivery timeout simulated (delivery deadline active on Sepolia).`);
      }
      continue;
    }

    // Step D: Upload Deliverable
    const cid = `QmHash_${pid}_${Buffer.from(s.desc).toString("hex").slice(0, 16)}`;
    tx = await escrow.connect(freelancer).uploadDeliverable(pid, cid);
    await tx.wait();
    console.log(`  ✓ Freelancer uploaded deliverable (CID: ${cid.slice(0, 18)}...)`);

    if (s.type === "in_progress_review") {
      console.log(`  -> Left in DeliverableUploaded state (under client review).`);
      continue;
    }

    if (s.type === "timeout_review") {
      if (network.name === "hardhat" || network.name === "localhost") {
        await increaseTime(86400 * 2 + 3600); // 2 days + 1 hour
        try {
          tx = await escrow.connect(freelancer).claimTimeout(pid);
          await tx.wait();
          console.log(`  ✓ Freelancer successfully claimed Review Timeout for Project #${pid}`);
        } catch (e: any) {
          console.log(`  Notice claiming review timeout: ${e.message}`);
        }
      } else {
        console.log(`  -> Review timeout simulated (review deadline active on Sepolia).`);
      }
      continue;
    }

    if (s.type === "complete") {
      // Step E1: Client Approves
      tx = await escrow.connect(client).approveProject(pid);
      await tx.wait();
      console.log(`  ✓ Client approved project. Funds disbursed. State: Completed.`);
      continue;
    }

    if (s.type === "dispute_freelancer" || s.type === "dispute_client") {
      // Step E2: Raise Dispute
      tx = await escrow.connect(client).raiseDispute(pid);
      await tx.wait();
      console.log(`  ⚠️ Dispute raised by client for Project #${pid}`);

      // Retrieve selected panel of 3 arbiters
      const panel = await escrow.getArbiters(pid);
      console.log(`  Assigned panel (${panel.length} arbiters):`, panel.map((a: string) => a.slice(0, 8)));

      // Map panel addresses to signer/wallet objects
      const panelSigners = panel.map((addr: string) => {
        return arbiters.find((a) => a.address.toLowerCase() === addr.toLowerCase());
      });

      // Voting strategy
      // 1 = Freelancer wins, 2 = Client wins
      const targetWinner = s.type === "dispute_freelancer" ? 1 : 2;
      const dissentingVote = targetWinner === 1 ? 2 : 1;

      // Arbiters vote: 2 vote for majority winner, 1 votes dissenting
      const votesToCast = [targetWinner, targetWinner, dissentingVote];

      for (let i = 0; i < panelSigners.length; i++) {
        const arbSigner = panelSigners[i];
        if (arbSigner) {
          const voteVal = votesToCast[i];
          const vTx = await escrow.connect(arbSigner).castVote(pid, voteVal);
          await vTx.wait();
          console.log(`    -> Arbiter ${arbSigner.address.slice(0, 8)} voted: ${voteVal === 1 ? "FREELANCER" : "CLIENT"}`);
        }
      }

      const pState = await escrow.getProject(pid);
      console.log(`  ✓ Dispute resolved! Final State: ${pState[6] === 6n ? "Resolved" : pState[6]}`);
    }
  }

  console.log("\n===============================================================");
  console.log("🎉 All 25 Activity Simulation Scenarios Successfully Executed!");
  console.log(`📌 Contract Address: ${contractAddress}`);
  console.log("===============================================================\n");
}

main().catch((error) => {
  console.error("Simulation failed:", error);
  process.exitCode = 1;
});
