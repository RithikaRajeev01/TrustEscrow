#!/usr/bin/env python3
"""
TrustEscrow+ Blockchain Event Extraction Pipeline
Extracts, decodes, and ingests smart contract events into MySQL.
Supports Sepolia testnet (via Alchemy RPC) and local Hardhat nodes.
"""

import os
import sys
import json
import time

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, List, Optional

try:
    from web3 import Web3
    from web3.contract import Contract
except ImportError:
    print("Error: web3 library is required. Run: pip install web3")
    sys.exit(1)

try:
    import mysql.connector
    from mysql.connector import errorcode
except ImportError:
    print("Error: mysql-connector-python is required. Run: pip install mysql-connector-python")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    # Load .env from analytics/.env or project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(script_dir, "../.env"))
    load_dotenv(os.path.join(script_dir, "../../.env"))
except ImportError:
    pass


# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "http://127.0.0.1:8545")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "")
START_BLOCK = int(os.getenv("START_BLOCK", "0"))

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "trustescrow_analytics")
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")

BLOCK_CACHE: Dict[int, datetime] = {}


def get_abi_path() -> str:
    """Locate TrustEscrow ABI file, preferring the compiled smart-contracts artifact."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.abspath(os.path.join(base_dir, "../../smart-contracts/artifacts/contracts/TrustEscrow.sol/TrustEscrow.json")),
        os.path.abspath(os.path.join(base_dir, "../smart-contracts/artifacts/contracts/TrustEscrow.sol/TrustEscrow.json")),
        os.path.abspath(os.path.join(base_dir, "../../frontend/src/TrustEscrow.json")),
        os.path.abspath(os.path.join(base_dir, "../frontend/src/TrustEscrow.json")),
        os.path.abspath(os.path.join(base_dir, "TrustEscrow.json")),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    raise FileNotFoundError(f"TrustEscrow.json not found in candidate paths: {candidates}")


def get_block_timestamp(w3: Web3, block_number: int) -> datetime:
    """Retrieve block timestamp with in-memory caching."""
    if block_number not in BLOCK_CACHE:
        block = w3.eth.get_block(block_number)
        ts = block.get("timestamp", int(time.time()))
        BLOCK_CACHE[block_number] = datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
    return BLOCK_CACHE[block_number]


def get_db_connection():
    """Establish connection to MySQL and ensure database & tables exist."""
    try:
        conn = mysql.connector.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
        )
        cursor = conn.cursor()
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
        cursor.execute(f"USE `{MYSQL_DATABASE}`;")
        conn.database = MYSQL_DATABASE

        # Initialize tables from schema definition
        tables = [
            """
            CREATE TABLE IF NOT EXISTS projects (
                project_id BIGINT PRIMARY KEY,
                client VARCHAR(42) NOT NULL,
                freelancer VARCHAR(42) NOT NULL,
                domain VARCHAR(100) NOT NULL,
                budget DECIMAL(36, 18) NOT NULL,
                created_at TIMESTAMP NULL,
                funded_at TIMESTAMP NULL,
                accepted_at TIMESTAMP NULL,
                deliverable_uploaded_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                final_outcome VARCHAR(50) DEFAULT 'Pending',
                INDEX idx_projects_domain (domain),
                INDEX idx_projects_outcome (final_outcome)
            ) ENGINE=InnoDB;
            """,
            """
            CREATE TABLE IF NOT EXISTS disputes (
                project_id BIGINT PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                dispute_time TIMESTAMP NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
                INDEX idx_disputes_domain (domain)
            ) ENGINE=InnoDB;
            """,
            """
            CREATE TABLE IF NOT EXISTS votes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                project_id BIGINT NOT NULL,
                arbiter VARCHAR(42) NOT NULL,
                vote TINYINT NOT NULL COMMENT '1 = Freelancer, 2 = Client',
                vote_time TIMESTAMP NOT NULL,
                final_outcome TINYINT NULL COMMENT '1 = Freelancer, 2 = Client',
                UNIQUE KEY uk_project_arbiter (project_id, arbiter),
                FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
                INDEX idx_votes_arbiter (arbiter),
                INDEX idx_votes_outcome (final_outcome)
            ) ENGINE=InnoDB;
            """,
            """
            CREATE TABLE IF NOT EXISTS arbiters (
                arbiter_address VARCHAR(42) NOT NULL,
                domain VARCHAR(100) NOT NULL,
                reputation INT NOT NULL DEFAULT 100,
                PRIMARY KEY (arbiter_address, domain),
                INDEX idx_arbiters_domain (domain)
            ) ENGINE=InnoDB;
            """,
            """
            CREATE TABLE IF NOT EXISTS timeouts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                project_id BIGINT NOT NULL,
                timeout_state VARCHAR(50) NOT NULL,
                timeout_time TIMESTAMP NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
                INDEX idx_timeouts_state (timeout_state)
            ) ENGINE=InnoDB;
            """
        ]
        for t in tables:
            cursor.execute(t)
        conn.commit()
        cursor.close()
        return conn
    except mysql.connector.Error as err:
        print(f"❌ MySQL Connection Error: {err}")
        raise


def fetch_contract_logs(w3: Web3, contract_address: str, from_block: int, to_block: int) -> List[Any]:
    """Fetch all contract logs safely across block ranges, automatically adapting to RPC limitations."""
    logs = []
    current_from = from_block
    # Detect Alchemy Free Tier (which limits to 10 block range) or default to 2000
    chunk_size = 10 if "alchemy" in RPC_URL.lower() else 2000

    while current_from <= to_block:
        current_to = min(current_from + chunk_size - 1, to_block)
        try:
            filter_params = {
                "fromBlock": current_from,
                "toBlock": current_to,
                "address": contract_address,
            }
            batch = w3.eth.get_logs(filter_params)
            logs.extend(batch)
            current_from = current_to + 1
        except Exception as e:
            err_str = str(e).lower()
            if ("10 block range" in err_str or "range" in err_str or "400" in err_str) and chunk_size > 10:
                chunk_size = 10
            elif chunk_size > 10:
                chunk_size = max(10, chunk_size // 4)
            else:
                print(f"  Warning fetching logs for blocks {current_from}-{current_to}: {e}")
                current_from = current_to + 1
    return logs


def extract_and_ingest():
    print("===============================================================")
    print("📥 TrustEscrow+ Blockchain Event Ingestion Starting")
    print(f"🔗 RPC URL: {RPC_URL}")
    print("===============================================================")

    # 1. Connect to Web3 Provider
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"❌ Error: Cannot connect to Ethereum RPC at {RPC_URL}")
        sys.exit(1)
    print(f"✓ Connected to RPC. Chain ID: {w3.eth.chain_id}, Latest Block: {w3.eth.block_number}")

    # 2. Verify Contract Address
    global CONTRACT_ADDRESS
    if not CONTRACT_ADDRESS or not Web3.is_address(CONTRACT_ADDRESS):
        print("❌ Error: Valid CONTRACT_ADDRESS must be specified in .env or environment.")
        sys.exit(1)
    checksum_addr = Web3.to_checksum_address(CONTRACT_ADDRESS)
    print(f"✓ Target Contract: {checksum_addr}")

    # 3. Load ABI
    abi_file = get_abi_path()
    with open(abi_file, "r") as f:
        data = json.load(f)
        abi = data.get("abi", data)
    contract: Contract = w3.eth.contract(address=checksum_addr, abi=abi)
    print(f"✓ Loaded contract ABI from {abi_file}")

    # 4. Connect to MySQL
    db = get_db_connection()
    cursor = db.cursor(dictionary=True)
    print(f"✓ Connected to MySQL: {MYSQL_DATABASE}@{MYSQL_HOST}")

    latest_block = w3.eth.block_number
    from_block = START_BLOCK

    print(f"Scanning blocks from {from_block} to {latest_block}...")
    raw_logs = fetch_contract_logs(w3, checksum_addr, from_block, latest_block)
    print(f"✓ Retrieved {len(raw_logs)} raw on-chain event logs from Sepolia.")

    # Decode and categorize logs by event type
    events_by_type: Dict[str, List[Any]] = {
        "ProjectCreated": [],
        "ProjectFunded": [],
        "ProjectAccepted": [],
        "DeliverableUploaded": [],
        "ProjectApproved": [],
        "DisputeRaised": [],
        "ArbiterAssigned": [],
        "VoteCast": [],
        "DisputeResolved": [],
        "TimeoutClaimed": [],
        "ArbiterRegistered": [],
    }

    for raw_log in raw_logs:
        for ev_name in events_by_type.keys():
            if hasattr(contract.events, ev_name):
                try:
                    decoded = getattr(contract.events, ev_name)().process_log(raw_log)
                    events_by_type[ev_name].append(decoded)
                    break
                except Exception:
                    continue

    # Statistics counters
    stats = {k: 0 for k in events_by_type.keys()}
    stats["ArbitersUpdated"] = 0

    # --------------------------------------------------------------------------
    # Event 1: ProjectCreated
    # --------------------------------------------------------------------------
    events = events_by_type["ProjectCreated"]
    for ev in events:
        pid = int(ev.args["projectId"])
        client = Web3.to_checksum_address(ev.args["client"])
        freelancer = Web3.to_checksum_address(ev.args["freelancer"])
        budget_eth = Decimal(str(Web3.from_wei(ev.args["budget"], "ether")))
        ts = get_block_timestamp(w3, ev.blockNumber)

        # Query domain from on-chain storage via getProject
        domain = "Unknown"
        try:
            p_data = contract.functions.getProject(pid).call()
            domain = p_data[4]
        except Exception as e:
            pass

        cursor.execute(
            """
            INSERT INTO projects 
                (project_id, client, freelancer, domain, budget, created_at, final_outcome)
            VALUES 
                (%s, %s, %s, %s, %s, %s, 'Created')
            ON DUPLICATE KEY UPDATE
                client = VALUES(client),
                freelancer = VALUES(freelancer),
                domain = VALUES(domain),
                budget = VALUES(budget),
                created_at = COALESCE(projects.created_at, VALUES(created_at));
            """,
            (pid, client, freelancer, domain, budget_eth, ts)
        )
        stats["ProjectCreated"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 2: ProjectFunded
    # --------------------------------------------------------------------------
    events = events_by_type["ProjectFunded"]
    for ev in events:
        pid = int(ev.args["projectId"])
        ts = get_block_timestamp(w3, ev.blockNumber)
        cursor.execute(
            """
            UPDATE projects 
            SET funded_at = COALESCE(funded_at, %s),
                final_outcome = IF(final_outcome = 'Created', 'Funded', final_outcome)
            WHERE project_id = %s;
            """,
            (ts, pid)
        )
        stats["ProjectFunded"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 3: ProjectAccepted
    # --------------------------------------------------------------------------
    events = events_by_type["ProjectAccepted"]
    for ev in events:
        pid = int(ev.args["projectId"])
        ts = get_block_timestamp(w3, ev.blockNumber)
        cursor.execute(
            """
            UPDATE projects 
            SET accepted_at = COALESCE(accepted_at, %s),
                final_outcome = IF(final_outcome IN ('Created', 'Funded'), 'Accepted', final_outcome)
            WHERE project_id = %s;
            """,
            (ts, pid)
        )
        stats["ProjectAccepted"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 4: DeliverableUploaded
    # --------------------------------------------------------------------------
    events = events_by_type["DeliverableUploaded"]
    for ev in events:
        pid = int(ev.args["projectId"])
        ts = get_block_timestamp(w3, ev.blockNumber)
        cursor.execute(
            """
            UPDATE projects 
            SET deliverable_uploaded_at = COALESCE(deliverable_uploaded_at, %s),
                final_outcome = IF(final_outcome IN ('Created', 'Funded', 'Accepted'), 'Deliverable Uploaded', final_outcome)
            WHERE project_id = %s;
            """,
            (ts, pid)
        )
        stats["DeliverableUploaded"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 5: ProjectApproved
    # --------------------------------------------------------------------------
    events = events_by_type["ProjectApproved"]
    for ev in events:
        pid = int(ev.args["projectId"])
        ts = get_block_timestamp(w3, ev.blockNumber)
        cursor.execute(
            """
            UPDATE projects 
            SET completed_at = %s,
                final_outcome = 'Completed'
            WHERE project_id = %s;
            """,
            (ts, pid)
        )
        stats["ProjectApproved"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 6: DisputeRaised
    # --------------------------------------------------------------------------
    events = events_by_type["DisputeRaised"]
    for ev in events:
        pid = int(ev.args["projectId"])
        ts = get_block_timestamp(w3, ev.blockNumber)

        # Retrieve domain from projects table or on-chain
        cursor.execute("SELECT domain FROM projects WHERE project_id = %s", (pid,))
        row = cursor.fetchone()
        domain = row["domain"] if row and row["domain"] else "Unknown"
        if domain == "Unknown":
            try:
                domain = contract.functions.getProject(pid).call()[4]
            except Exception:
                pass

        cursor.execute(
            """
            INSERT INTO disputes (project_id, domain, dispute_time)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                domain = VALUES(domain),
                dispute_time = VALUES(dispute_time);
            """,
            (pid, domain, ts)
        )
        cursor.execute(
            """
            UPDATE projects 
            SET final_outcome = IF(final_outcome NOT IN ('Completed', 'Freelancer Won', 'Client Won', 'Resolved'), 'Disputed', final_outcome)
            WHERE project_id = %s;
            """,
            (pid,)
        )
        stats["DisputeRaised"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 7: ArbiterAssigned
    # --------------------------------------------------------------------------
    events = events_by_type["ArbiterAssigned"]
    for ev in events:
        pid = int(ev.args["projectId"])
        arbiter = Web3.to_checksum_address(ev.args["arbiter"])
        stats["ArbiterAssigned"] += 1

    # --------------------------------------------------------------------------
    # Event 8: VoteCast
    # --------------------------------------------------------------------------
    events = events_by_type["VoteCast"]
    for ev in events:
        pid = int(ev.args["projectId"])
        arbiter = Web3.to_checksum_address(ev.args["arbiter"])
        vote = int(ev.args["vote"])
        ts = get_block_timestamp(w3, ev.blockNumber)

        cursor.execute(
            """
            INSERT INTO votes (project_id, arbiter, vote, vote_time)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                vote = VALUES(vote),
                vote_time = VALUES(vote_time);
            """,
            (pid, arbiter, vote, ts)
        )
        stats["VoteCast"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 9: DisputeResolved
    # --------------------------------------------------------------------------
    events = events_by_type["DisputeResolved"]
    for ev in events:
        pid = int(ev.args["projectId"])
        winner = int(ev.args["winner"])
        outcome_str = "Freelancer Won" if winner == 1 else "Client Won"
        ts = get_block_timestamp(w3, ev.blockNumber)

        # Update project completed timestamp & final outcome
        cursor.execute(
            """
            UPDATE projects 
            SET completed_at = %s,
                final_outcome = %s
            WHERE project_id = %s;
            """,
            (ts, outcome_str, pid)
        )

        # Update votes table with final consensus outcome (1 or 2)
        cursor.execute(
            """
            UPDATE votes 
            SET final_outcome = %s
            WHERE project_id = %s;
            """,
            (winner, pid)
        )
        stats["DisputeResolved"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Event 10: TimeoutClaimed
    # --------------------------------------------------------------------------
    events = events_by_type["TimeoutClaimed"]
    for ev in events:
        pid = int(ev.args["projectId"])
        claimant = Web3.to_checksum_address(ev.args["claimant"])
        outcome = int(ev.args["outcome"])
        ts = get_block_timestamp(w3, ev.blockNumber)

        # Determine timeout reason from project timestamps and outcome
        cursor.execute(
            "SELECT accepted_at, deliverable_uploaded_at FROM projects WHERE project_id = %s", 
            (pid,)
        )
        row = cursor.fetchone()
        if outcome == 1:
            timeout_state = "Review Timeout"
            final_status = "Freelancer Won (Timeout)"
        else:
            if row and row.get("accepted_at"):
                timeout_state = "Delivery Timeout"
            else:
                timeout_state = "Acceptance Timeout"
            final_status = "Client Refunded (Timeout)"

        cursor.execute(
            """
            INSERT INTO timeouts (project_id, timeout_state, timeout_time)
            VALUES (%s, %s, %s);
            """,
            (pid, timeout_state, ts)
        )
        cursor.execute(
            """
            UPDATE projects 
            SET completed_at = %s,
                final_outcome = %s
            WHERE project_id = %s;
            """,
            (ts, final_status, pid)
        )
        stats["TimeoutClaimed"] += 1
    db.commit()

    # --------------------------------------------------------------------------
    # Arbiters Extraction & Reputation Sync
    # --------------------------------------------------------------------------
    DOMAINS = [
        "Web Development",
        "Blockchain Development",
        "Data Science",
        "Mobile Development",
        "UI/UX Design",
    ]

    # Process ArbiterRegistered events
    events = events_by_type["ArbiterRegistered"]
    for ev in events:
        arb_addr = Web3.to_checksum_address(ev.args["arbiter"])
        arb_domain = ev.args.get("domain", "")
        if arb_domain:
            try:
                rep = contract.functions.getArbiterReputation(arb_addr, arb_domain).call()
            except Exception:
                rep = 100
            cursor.execute(
                """
                INSERT INTO arbiters (arbiter_address, domain, reputation)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE reputation = VALUES(reputation);
                """,
                (arb_addr, arb_domain, rep)
            )
            stats["ArbitersUpdated"] += 1

    # Also query allArbiters array from contract if available
    try:
        all_arbs = contract.functions.getAllArbiters().call()
        for arb in all_arbs:
            arb_addr = Web3.to_checksum_address(arb)
            for d in DOMAINS:
                try:
                    is_reg = contract.functions.isRegisteredForDomain(arb_addr, d).call()
                    if is_reg:
                        rep = contract.functions.getArbiterReputation(arb_addr, d).call()
                        cursor.execute(
                            """
                            INSERT INTO arbiters (arbiter_address, domain, reputation)
                            VALUES (%s, %s, %s)
                            ON DUPLICATE KEY UPDATE reputation = VALUES(reputation);
                            """,
                            (arb_addr, d, rep)
                        )
                        stats["ArbitersUpdated"] += 1
                except Exception:
                    pass
        db.commit()
    except Exception as e:
        pass

    cursor.close()
    db.close()

    print("\n===============================================================")
    print("📊 Extraction & Ingestion Summary:")
    print("===============================================================")
    for k, v in stats.items():
        print(f"  • {k:<25}: {v} records")
    print("===============================================================")
    print("✅ MySQL Database successfully updated from blockchain events!\n")


if __name__ == "__main__":
    extract_and_ingest()
