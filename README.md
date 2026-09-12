# TrustEscrow+

TrustEscrow+ is a decentralized freelance escrow platform on Ethereum featuring domain-specific arbitration, automated milestone timeouts, and an additive analytics data pipeline.

It replaces dependence on a single centralized dispute authority with **programmable smart-contract rules**, while its analytics layer transforms real on-chain activity into structured data for monitoring **escrow exposure, dispute risk, project outcomes, and arbitration behavior**.

---

## Problem

Freelance transactions involve a trust gap between clients and freelancers:

* Clients need assurance that payment is released only for agreed work.
* Freelancers need assurance that committed funds cannot be unfairly withheld.
* Disputes require a transparent and auditable resolution process.
* Operational activity needs to be measurable beyond individual blockchain transactions.

## Solution

TrustEscrow+ combines:

**Programmable Escrow + Domain-Specialized Arbitration + On-Chain Auditability + Data Analytics**

* 🔐 Smart-contract controlled escrow and settlement
* ⚖️ Domain-specific 3-arbiter dispute panels
* ⛓️ On-chain project, payment, dispute, and voting records
* 📊 Analytics pipeline for operational and risk insights

---

## System Architecture

```text
Client / Freelancer / Arbiter
              │
              ▼
        TrustEscrow+ UI
              │
              ▼
     Solidity Smart Contract
              │
              ▼
       Ethereum Sepolia
              │
              ▼
          Alchemy RPC
              │
              ▼
       Python + web3.py
              │
              ▼
            MySQL
              │
              ▼
       SQL + Pandas
              │
              ▼
    Streamlit Analytics Dashboard
```

## Core Functionality

| **Area**              | **Function**                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| **Escrow**            | Holds and releases ETH according to smart-contract conditions                   |
| **Project Lifecycle** | Manages creation, funding, acceptance, delivery, approval and completion        |
| **Disputes**          | Enables escalation when a project cannot be resolved normally                   |
| **Arbitration**       | Selects eligible arbiters based on project domain and reputation                |
| **Voting**            | Records independent arbiter votes and resolves disputes by majority             |
| **Settlement**        | Releases funds to the freelancer or refunds the client based on the outcome     |
| **Reputation**        | Maintains domain-specific arbiter reputation                                    |
| **Auditability**      | Records key project and dispute activity through blockchain events              |
| **Analytics**         | Measures project activity, dispute risk, exposure, outcomes and panel agreement |

## Analytics Snapshot

Validated using 25 real Ethereum Sepolia project scenarios:

| **Metric**               | **Result** |
| ------------------------ | ---------- |
| **Projects**             | 25         |
| **Active Escrows**       | 7          |
| **Disputes**             | 8          |
| **Dispute Rate**         | 32.0%      |
| **Arbitration Votes**    | 24         |
| **Completed & Approved** | 10         |
| **Committed Capital**    | 0.3840 ETH |
| **Timeout Claims**       | 0          |

### Observed Insights

* **Blockchain Development & Web Development:** highest observed dispute rate at 40%
* **Client vs Freelancer outcomes:** 50% / 50% across 8 resolved disputes
* **Panel Agreement Rate:** 66.7% across 24 arbitration votes
* **Blockchain Development:** highest committed escrow exposure at 0.1120 ETH

*Panel Agreement Rate measures voting consistency; it is not treated as arbiter accuracy because there is no external ground-truth outcome.*

## Data Pipeline

```text
Ethereum Sepolia
       │
       ▼
   Alchemy RPC
       │
       ▼
 Python / web3.py
       │
       ▼
Event Extraction & Transformation
       │
       ▼
     MySQL
       │
       ▼
   SQL Analysis
       │
       ▼
Pandas + Streamlit
       │
       ▼
Operational Analytics
```

*The pipeline uses real smart-contract events generated on Ethereum Sepolia rather than fabricated CSV or mock analytics data.*

## Technology Stack

**Blockchain:** Solidity · Ethereum Sepolia · Hardhat · ethers.js · MetaMask

**Data & Analytics:** Python · web3.py · Pandas · SQL · MySQL

**Visualization:** Streamlit

**Decentralized Storage:** IPFS · Pinata

**Cloud Connectivity:** Alchemy RPC

## Repository Structure

```text
PROJECT/
├── frontend/             # React + Vite + ethers.js dApp
│   ├── src/App.tsx       # Main frontend UI
│   └── src/TrustEscrow.json # Contract ABI
├── smart-contracts/      # Hardhat Ethereum contracts
│   ├── contracts/TrustEscrow.sol # Escrow + domain arbitration logic
│   ├── test/TrustEscrow.ts       # Contract unit tests
│   └── hardhat.config.ts         # Hardhat configuration
└── analytics/            # Analytics & Data Pipeline
    ├── .env.example      # Environment configuration template
    ├── requirements.txt  # Python dependencies
    ├── scripts/
    │   └── simulateActivity.ts # Hardhat activity simulation script (25 scenarios)
    ├── python/
    │   └── extract_events.py # web3.py event extraction & MySQL ingestion
    └── sql/
        └── schema.sql    # MySQL database schema (trustescrow_analytics)
```

## Smart Contract

`smart-contracts/contracts/TrustEscrow.sol`

Implements:

* Escrow management
* Project lifecycle state machine
* Role-based authorization
* Project deadlines and timeout mechanisms
* Domain-specific arbiter selection
* Arbitration voting
* Majority-based dispute resolution
* Domain-specific reputation updates

## Analytics Layer

**`analytics/python/extract_events.py`**

Extracts TrustEscrow+ events from Ethereum Sepolia through Alchemy RPC and web3.py, transforms them into structured records, and stores them in MySQL.

**`analytics/sql/`**

Contains the database schema and analytical queries for project lifecycle, dispute rates, outcomes, escrow exposure, arbiter agreement and reputation.

**`analytics/dashboard/app.py`**

Provides an operational dashboard covering:

* Escrow Portfolio Overview
* Risk & Exposure Analysis
* Dispute Resolution & Panel Consensus
* Key Business Insights
* Timeout & SLA Monitoring
* Transaction & Audit Records

## Deployment

**Network:** Ethereum Sepolia

**Contract Address:** `0xFCDcFC0a086a31f573C9ea9d7370E22f5a3E8406`

**Analytics Flow:**

Sepolia → Alchemy → web3.py → MySQL → Streamlit

## Local Setup

### Smart Contracts

```bash
cd smart-contracts
npm install
npx hardhat compile
npx hardhat test
```

Configure environment variables using: `smart-contracts/.env.example`

### Analytics

```bash
cd analytics
pip install -r requirements.txt
```

Configure: `analytics/.env.example`

Run event extraction:

```bash
python python/extract_events.py
```

Run the dashboard:

```bash
python -m streamlit run dashboard/app.py
```

## Project Scope

TrustEscrow+ demonstrates an end-to-end system connecting:

```text
Blockchain
    ↓
Real On-Chain Events
    ↓
Data Extraction
    ↓
Data Transformation
    ↓
MySQL
    ↓
SQL Analytics
    ↓
Operational Insights
    ↓
Interactive Dashboard
```

The architecture can be applied to systems requiring automated escrow, transparent settlement, dispute management, auditability, and operational risk monitoring.
