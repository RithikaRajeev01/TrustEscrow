-- ==============================================================================
-- TrustEscrow+ Analytics Queries
-- Database: trustescrow_analytics
-- ==============================================================================

USE trustescrow_analytics;

-- ==============================================================================
-- 1. Total Platform Escrow Value & High-Level KPIs
-- Computes the overall capital secured, project volume, and platform financial baseline.
-- ==============================================================================
SELECT 
    COUNT(*) AS total_projects,
    SUM(budget) AS total_escrow_value_eth,
    ROUND(AVG(budget), 4) AS avg_project_budget_eth,
    MIN(budget) AS min_project_budget_eth,
    MAX(budget) AS max_project_budget_eth
FROM projects;


-- ==============================================================================
-- 2. Escrow Value & Financial Exposure by Domain
-- Analyzes capital distribution across freelance specializations.
-- ==============================================================================
SELECT 
    domain,
    COUNT(project_id) AS total_projects,
    SUM(budget) AS total_escrow_value_eth,
    ROUND(AVG(budget), 4) AS avg_budget_eth,
    ROUND(
        (SUM(budget) * 100.0) / (SELECT SUM(budget) FROM projects), 
        2
    ) AS escrow_share_percentage
FROM projects
GROUP BY domain
ORDER BY total_escrow_value_eth DESC;


-- ==============================================================================
-- 3. Project Lifecycle & Terminal State Distribution ("What is happening?")
-- Tracks project progression through created, active, completed, and arbitrated states.
-- ==============================================================================
SELECT 
    final_outcome,
    COUNT(*) AS project_count,
    ROUND(
        (COUNT(*) * 100.0) / (SELECT COUNT(*) FROM projects), 
        2
    ) AS outcome_percentage,
    SUM(budget) AS committed_budget_eth
FROM projects
GROUP BY final_outcome
ORDER BY project_count DESC;


-- ==============================================================================
-- 4. Dispute Risk and Exposure by Domain ("Where is the risk?")
-- Evaluates arbitration frequency alongside committed capital to highlight high-exposure domains.
-- ==============================================================================
SELECT 
    p.domain,
    COUNT(p.project_id) AS total_projects,
    COUNT(d.project_id) AS total_disputes,
    ROUND(
        (COUNT(d.project_id) * 100.0) / NULLIF(COUNT(p.project_id), 0), 
        2
    ) AS dispute_rate_percentage,
    SUM(p.budget) AS total_escrow_value_eth,
    SUM(CASE WHEN d.project_id IS NOT NULL THEN p.budget ELSE 0 END) AS disputed_escrow_value_eth
FROM projects p
LEFT JOIN disputes d ON p.project_id = d.project_id
GROUP BY p.domain
ORDER BY dispute_rate_percentage DESC, total_escrow_value_eth DESC;


-- ==============================================================================
-- 5. Dispute Resolution Split ("How are disputes resolved?")
-- Compares arbitration outcomes between Freelancer Won and Client Won.
-- ==============================================================================
SELECT 
    final_outcome AS dispute_resolution,
    COUNT(*) AS dispute_count,
    ROUND(
        (COUNT(*) * 100.0) / (SELECT COUNT(*) FROM disputes), 
        2
    ) AS split_percentage,
    SUM(budget) AS resolved_budget_eth
FROM projects
WHERE project_id IN (SELECT project_id FROM disputes)
GROUP BY final_outcome
ORDER BY dispute_count DESC;


-- ==============================================================================
-- 6. Arbiter Voting Consistency (Agreement Rate)
-- Measures alignment with majority consensus across decentralized juror panels.
-- NOTE: Termed "agreement rate", NOT "accuracy" (no external ground truth exists).
-- ==============================================================================

-- 6a. Overall platform arbiter agreement rate
SELECT 
    COUNT(*) AS total_votes_cast,
    SUM(CASE WHEN vote = final_outcome THEN 1 ELSE 0 END) AS consensus_votes,
    ROUND(
        (SUM(CASE WHEN vote = final_outcome THEN 1 ELSE 0 END) * 100.0) / COUNT(*), 
        2
    ) AS overall_agreement_rate_percentage
FROM votes
WHERE final_outcome IS NOT NULL;

-- 6b. Individual arbiter consensus agreement rate
SELECT 
    v.arbiter,
    COUNT(*) AS total_votes_cast,
    SUM(CASE WHEN v.vote = v.final_outcome THEN 1 ELSE 0 END) AS consensus_votes,
    ROUND(
        (SUM(CASE WHEN v.vote = v.final_outcome THEN 1 ELSE 0 END) * 100.0) / COUNT(*), 
        2
    ) AS agreement_rate_percentage
FROM votes v
WHERE v.final_outcome IS NOT NULL
GROUP BY v.arbiter
ORDER BY agreement_rate_percentage DESC, total_votes_cast DESC;


-- ==============================================================================
-- 7. Arbiter Reputation Summary by Domain
-- Aggregates decentralized reputation scores awarded for consensus participation.
-- ==============================================================================
SELECT 
    domain,
    COUNT(arbiter_address) AS total_arbiters,
    MIN(reputation) AS min_reputation,
    ROUND(AVG(reputation), 1) AS avg_reputation,
    MAX(reputation) AS max_reputation
FROM arbiters
GROUP BY domain
ORDER BY avg_reputation DESC;


-- ==============================================================================
-- 8. Timeout Protection Health & Audit
-- Evaluates automated timeout mechanism integrity across milestones.
-- ==============================================================================
SELECT 
    (SELECT COUNT(*) FROM timeouts) AS total_timeouts_claimed,
    (SELECT COUNT(*) FROM projects) AS total_projects_monitored,
    CASE 
        WHEN (SELECT COUNT(*) FROM timeouts) = 0 THEN 'Active - Zero Expired Claims'
        ELSE 'Active - Expirations Handled'
    END AS protection_status;
