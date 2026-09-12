-- ==============================================================================
-- TrustEscrow+ Analytics Database Schema
-- Database: trustescrow_analytics
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS trustescrow_analytics
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE trustescrow_analytics;

-- 1. Projects Table
-- Tracks lifecycle timestamps, parties, domain, budget, and terminal outcome
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
    INDEX idx_projects_client (client),
    INDEX idx_projects_freelancer (freelancer),
    INDEX idx_projects_outcome (final_outcome)
) ENGINE=InnoDB;

-- 2. Disputes Table
-- Records disputes raised on projects with domain categorization
CREATE TABLE IF NOT EXISTS disputes (
    project_id BIGINT PRIMARY KEY,
    domain VARCHAR(100) NOT NULL,
    dispute_time TIMESTAMP NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    INDEX idx_disputes_domain (domain)
) ENGINE=InnoDB;

-- 3. Votes Table
-- Records votes cast by assigned arbiters and maps them against final dispute outcome
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

-- 4. Arbiters Table
-- Stores domain registrations and tracked reputation scores
CREATE TABLE IF NOT EXISTS arbiters (
    arbiter_address VARCHAR(42) NOT NULL,
    domain VARCHAR(100) NOT NULL,
    reputation INT NOT NULL DEFAULT 100,
    PRIMARY KEY (arbiter_address, domain),
    INDEX idx_arbiters_domain (domain)
) ENGINE=InnoDB;

-- 5. Timeouts Table
-- Tracks timeout claims (Acceptance, Delivery, Review)
CREATE TABLE IF NOT EXISTS timeouts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT NOT NULL,
    timeout_state VARCHAR(50) NOT NULL,
    timeout_time TIMESTAMP NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    INDEX idx_timeouts_state (timeout_state)
) ENGINE=InnoDB;
