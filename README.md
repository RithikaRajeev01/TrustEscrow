# TrustEscrow+

TrustEscrow+ is a decentralized freelance escrow platform on Ethereum featuring domain-specific arbitration, automated milestone timeouts, and an additive analytics data pipeline.

---

## Repository Structure

```text
PROJECT/
├── frontend/                     # React + Vite + ethers.js dApp
│   ├── src/App.tsx              # Main frontend UI
│   └── src/TrustEscrow.json     # Contract ABI
├── smart-contracts/             # Hardhat Ethereum contracts
│   ├── contracts/TrustEscrow.sol # Escrow + domain arbitration logic
│   ├── test/TrustEscrow.ts      # Contract unit tests
│   └── hardhat.config.ts        # Hardhat configuration
└── analytics/                   # Analytics & Data Pipeline
    ├── .env.example             # Environment configuration template
    ├── requirements.txt         # Python dependencies
    ├── scripts/
    │   └── simulateActivity.ts  # Hardhat activity simulation script (25 scenarios)
    ├── python/
    │   └── extract_events.py    # web3.py event extraction & MySQL ingestion
    ├── sql/
    │   ├── schema.sql           # MySQL database schema (trustescrow_analytics)
    │   └── analysis_queries.sql # Analytical queries (dispute rate, consensus, timeouts)
    └── dashboard/
        └── app.py               # Interactive Streamlit analytics dashboard
```

---

## Analytics & Data Pipeline

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│               Sepolia Testnet / Local Node                  │
│                     (TrustEscrow.sol)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC (Alchemy / Local)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          analytics/python/extract_events.py (web3.py)       │
│    Pulls & decodes all 9+ smart contract lifecycle events   │
└──────────────────────────────┬──────────────────────────────┘
                               │ SQL Inserts / Upserts
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             MySQL Database: trustescrow_analytics           │
│   (projects, disputes, votes, arbiters, timeouts tables)    │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────┐  ┌────────────────────────────┐
│ analytics/sql/              │  │ analytics/dashboard/app.py │
│ analysis_queries.sql        │  │ Streamlit Telemetry UI     │
│ Direct business analytics   │  │ KPI Cards & Altair Charts  │
└─────────────────────────────┘  └────────────────────────────┘
```

The analytics layer is completely non-invasive to existing contracts and frontend code. It captures on-chain events (`ProjectCreated`, `ProjectFunded`, `ProjectAccepted`, `DeliverableUploaded`, `ProjectApproved`, `DisputeRaised`, `ArbiterAssigned`, `VoteCast`, `DisputeResolved`, `TimeoutClaimed`, `ArbiterRegistered`), decodes their payloads and block timestamps, and populates a normalized relational database for business intelligence and telemetry.

---

### Step-by-Step Execution Guide

#### Step 1: Environment Setup

1. Navigate to the `analytics` directory and copy the environment template:
   ```bash
   cd analytics
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   - `SEPOLIA_RPC_URL`: Your Alchemy Sepolia RPC URL (e.g., `https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY`) or `http://127.0.0.1:8545` for local testing.
   - `CONTRACT_ADDRESS`: Deployed address of `TrustEscrow`.
   - `PRIVATE_KEY`: Signer private key for transactions.
   - `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`: Your MySQL database credentials.

3. Install Python dependencies:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On Linux/macOS:
   source venv/bin/activate

   pip install -r requirements.txt
   ```

#### Step 2: Database Initialization

Create the MySQL database and schema:
```bash
mysql -u root -p < sql/schema.sql
```
This provisions the `trustescrow_analytics` database and creates the five core tables:
- `projects`: Lifecycle timestamps, client, freelancer, domain, budget, final outcome.
- `disputes`: Dispute records mapped to project ID, domain, and timestamp.
- `votes`: Arbiter votes (1 = Freelancer, 2 = Client) and majority outcome.
- `arbiters`: Arbiter addresses, domain registrations, and reputation scores.
- `timeouts`: Timeout records categorized by state (Acceptance, Delivery, Review).

#### Step 3: Simulate Blockchain Activity

Generate 25 realistic scenarios across all 5 domains (Web Development, Blockchain Development, Data Science, Mobile Development, UI/UX Design), covering normal completions, freelancer-won disputes, client-won disputes, and timeout expiries:

- **On Sepolia Testnet (via Alchemy):**
  ```bash
  cd ../smart-contracts
  npx hardhat run ../analytics/scripts/simulateActivity.ts --network sepolia
  ```
- **On Local Hardhat Node:**
  ```bash
  cd ../smart-contracts
  npx hardhat run ../analytics/scripts/simulateActivity.ts --network localhost
  ```
*(Note: When executed on local nodes, EVM time travel automatically triggers realistic milestone timeouts).*

#### Step 4: Extract and Ingest On-Chain Events

Run the event extraction pipeline to pull events from the blockchain via RPC and sync them to MySQL:
```bash
cd ../analytics
python python/extract_events.py
```
The script pulls all events in chunks, decodes them against `frontend/src/TrustEscrow.json`, retrieves block timestamps, resolves domains, and upserts rows into MySQL.

#### Step 5: Run SQL Analytical Queries

Execute the analytical queries directly against MySQL for terminal reporting:
```bash
mysql -u root -p trustescrow_analytics < sql/analysis_queries.sql
```
Analyzed metrics include:
- Dispute rate by domain
- Average project completion duration
- Timeout claim frequency
- Platform outcome distribution
- Arbiter voting consistency (*Agreement Rate* with consensus)
- Arbiter reputation distribution

#### Step 6: Launch Streamlit Dashboard

Start the interactive Streamlit analytics dashboard:
```bash
streamlit run dashboard/app.py
```
Open your browser at `http://localhost:8501` to view:
- Top-level KPI metric cards (Total Projects, Total Disputes, Dispute Rate %, Timeout Count, Avg Completion Time).
- Visual charts: Dispute rate by domain, outcome distribution, completion time, timeout frequency breakdown, arbiter agreement rate, and domain reputation.
- Searchable data tables with tabbed navigation.
*(If MySQL is not currently running, the dashboard automatically provides an integrated telemetry preview mode).*

---

### Streamlit Community Cloud Deployment

To deploy the dashboard publicly via Streamlit Community Cloud:

1. **Push Code to GitHub:**
   Commit the repository to your GitHub account (ensure `.env` is ignored by `.gitignore`).
2. **Provision Cloud MySQL:**
   Create a managed MySQL database using a free tier provider (such as Aiven, PlanetScale, Railway, Supabase, or Clever Cloud). Run `analytics/sql/schema.sql` on the cloud database.
3. **Deploy on Streamlit Cloud:**
   - Go to [share.streamlit.io](https://share.streamlit.io) and log in with GitHub.
   - Click **"New app"**.
   - Select your repository, branch (`main`), and set the **Main file path** to:
     ```text
     analytics/dashboard/app.py
     ```
4. **Configure Secrets:**
   In Streamlit Cloud under **App settings > Secrets**, add your MySQL connection credentials:
   ```toml
   [mysql]
   host = "your-cloud-mysql-host.com"
   port = 3306
   database = "trustescrow_analytics"
   user = "your_user"
   password = "your_secure_password"

   CONTRACT_ADDRESS = "0xYourSepoliaContractAddress"
   SEPOLIA_RPC_URL = "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
   ```
5. **Launch:**
   Click **"Deploy"**. Streamlit Community Cloud will automatically install dependencies from `analytics/requirements.txt` and launch the live analytics portal.
