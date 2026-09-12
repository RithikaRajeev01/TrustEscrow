// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TrustEscrow
 * @notice Academic/local prototype for decentralized freelance escrow
 *         with domain-based arbitration.
 *
 * SECURITY FEATURES:
 * - Only the client can fund and approve projects.
 * - Only the freelancer can accept and upload deliverables.
 * - Only project parties can raise disputes.
 * - Client and freelancer cannot arbitrate their own project.
 * - Only assigned arbiters can vote.
 * - Each assigned arbiter can vote only once.
 * - Escrow funds move only through valid state transitions.
 * - ETH transfers use checks-effects-interactions protection.
 * - Reentrancy protection is included for ETH-moving functions.
 *
 * IMPORTANT:
 * This is an academic/local prototype.
 *
 * Panel selection randomness using block.prevrandao and block.timestamp
 * is NOT production-grade randomness.
 *
 * Production implementations should use verifiable randomness such as
 * Chainlink VRF and production-grade identity/eligibility verification.
 */
contract TrustEscrow {

    /* =========================================================
                            ENUMS
    ========================================================= */

    enum ProjectState {
        Created,
        Funded,
        Accepted,
        DeliverableUploaded,
        Completed,
        Disputed,
        Resolved
    }

    /* =========================================================
                        ARBITER STRUCT
    ========================================================= */

    struct Arbiter {
        address arbiterAddress;

        // Main arbitration domain
        string domain;

        // Detailed profile information
        string expertise;

        uint256 yearsOfExperience;

        uint256 relevantProjectCount;

        string portfolioUrl;

        // On-chain reputation score
        uint256 reputation;
    }

    /* =========================================================
                        PROJECT STRUCT
    ========================================================= */

    struct Project {
        uint256 id;

        address payable client;

        address payable freelancer;

        uint256 budget;

        string domain;

        string description;

        ProjectState state;

        string deliverableCid;

        uint256 createdAt;

        uint256 acceptanceDeadline;

        uint256 deliveryDeadline;

        uint256 reviewDeadline;

        // Assigned arbitration panel
        address[] arbiters;

        /*
         * Voting values:
         *
         * 0 = Not voted
         * 1 = Freelancer wins
         * 2 = Client wins
         */
        mapping(address => uint8) votes;

        uint8 freelancerVotes;

        uint8 clientVotes;
    }

    /* =========================================================
                        CONSTANTS
    ========================================================= */

    uint256 public constant ACCEPTANCE_PERIOD = 1 days;

    uint256 public constant DELIVERY_PERIOD = 7 days;

    uint256 public constant REVIEW_PERIOD = 2 days;

    uint256 public constant MIN_ARBITER_REPUTATION = 100;

    uint256 public constant PANEL_SIZE = 3;

    /*
     * Simple eligibility requirements.
     *
     * These match the frontend eligibility system.
     */
    uint256 public constant MIN_ARBITER_EXPERIENCE = 2;

    uint256 public constant MIN_RELEVANT_PROJECTS = 3;

    /* =========================================================
                        STATE VARIABLES
    ========================================================= */

    uint256 public projectCount;

    mapping(uint256 => Project) public projects;

    /*
     * Stores the main/latest arbiter profile.
     */
    mapping(address => Arbiter) public registeredArbiters;

    /*
     * Keeps track of all unique arbiter addresses.
     */
    address[] public allArbiters;

    /*
     * Checks whether an arbiter is registered for a domain.
     */
    mapping(address => mapping(bytes32 => bool))
        private domainRegistered;

    /*
     * Reputation is maintained separately for each domain.
     */
    mapping(address => mapping(bytes32 => uint256))
        private domainReputation;

    /*
     * Stores arbiters registered in each domain.
     */
    mapping(bytes32 => address[])
        private domainArbiters;

    /*
     * Simple reentrancy protection.
     */
    uint256 private unlocked = 1;

    /* =========================================================
                            EVENTS
    ========================================================= */

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address indexed freelancer,
        uint256 budget
    );

    event ProjectFunded(
        uint256 indexed projectId
    );

    event ProjectAccepted(
        uint256 indexed projectId
    );

    event DeliverableUploaded(
        uint256 indexed projectId,
        string cid
    );

    event ProjectApproved(
        uint256 indexed projectId
    );

    event DisputeRaised(
        uint256 indexed projectId
    );

    event ArbiterRegistered(
        address indexed arbiter,
        string domain,
        string expertise,
        uint256 yearsOfExperience,
        uint256 relevantProjectCount,
        string portfolioUrl
    );

    event ArbiterAssigned(
        uint256 indexed projectId,
        address indexed arbiter
    );

    event VoteCast(
        uint256 indexed projectId,
        address indexed arbiter,
        uint8 vote
    );

    event DisputeResolved(
        uint256 indexed projectId,
        uint8 winner
    );

    event TimeoutClaimed(
        uint256 indexed projectId,
        address indexed claimant,
        uint8 outcome
    );

    /* =========================================================
                            MODIFIERS
    ========================================================= */

    modifier exists(uint256 id) {
        require(
            id > 0 && id <= projectCount,
            "Project does not exist"
        );
        _;
    }

    modifier onlyClient(uint256 id) {
        require(
            msg.sender == projects[id].client,
            "Only client can call this"
        );
        _;
    }

    modifier onlyFreelancer(uint256 id) {
        require(
            msg.sender == projects[id].freelancer,
            "Only freelancer can call this"
        );
        _;
    }

    modifier state(
        uint256 id,
        ProjectState requiredState
    ) {
        require(
            projects[id].state == requiredState,
            "Invalid project state"
        );
        _;
    }

    modifier nonReentrant() {
        require(
            unlocked == 1,
            "Reentrant call"
        );

        unlocked = 2;

        _;

        unlocked = 1;
    }

    /* =========================================================
                        PROJECT CREATION
    ========================================================= */

    function createProject(
        address payable freelancer,
        string memory domain,
        string memory description,
        uint256 budget
    )
        external
        returns (uint256)
    {
        require(
            freelancer != address(0),
            "Invalid freelancer"
        );

        require(
            freelancer != msg.sender,
            "Client and freelancer must differ"
        );

        require(
            bytes(domain).length > 0,
            "Domain required"
        );

        require(
            bytes(description).length > 0,
            "Description required"
        );

        require(
            budget > 0,
            "Budget must be greater than zero"
        );

        projectCount++;

        Project storage p =
            projects[projectCount];

        p.id = projectCount;

        p.client =
            payable(msg.sender);

        p.freelancer =
            freelancer;

        p.budget =
            budget;

        p.domain =
            domain;

        p.description =
            description;

        p.state =
            ProjectState.Created;

        p.createdAt =
            block.timestamp;

        p.acceptanceDeadline =
            block.timestamp +
            ACCEPTANCE_PERIOD;

        p.deliveryDeadline =
            p.acceptanceDeadline +
            DELIVERY_PERIOD;

        emit ProjectCreated(
            projectCount,
            msg.sender,
            freelancer,
            budget
        );

        return projectCount;
    }

    /* =========================================================
                        ESCROW FUNDING
    ========================================================= */

    function depositFunds(
        uint256 id
    )
        external
        payable
        exists(id)
        onlyClient(id)
        state(id, ProjectState.Created)
    {
        require(
            msg.value == projects[id].budget,
            "Deposit must equal project budget"
        );

        projects[id].state =
            ProjectState.Funded;

        emit ProjectFunded(id);
    }

    /* =========================================================
                    FREELANCER ACCEPTANCE
    ========================================================= */

    function acceptProject(
        uint256 id
    )
        external
        exists(id)
        onlyFreelancer(id)
        state(id, ProjectState.Funded)
    {
        require(
            block.timestamp <=
                projects[id].acceptanceDeadline,
            "Acceptance deadline passed"
        );

        projects[id].state =
            ProjectState.Accepted;

        emit ProjectAccepted(id);
    }

    /* =========================================================
                        DELIVERABLE UPLOAD
    ========================================================= */

    function uploadDeliverable(
        uint256 id,
        string memory cid
    )
        external
        exists(id)
        onlyFreelancer(id)
        state(id, ProjectState.Accepted)
    {
        require(
            block.timestamp <=
                projects[id].deliveryDeadline,
            "Delivery deadline passed"
        );

        require(
            bytes(cid).length > 0,
            "CID required"
        );

        Project storage p =
            projects[id];

        p.deliverableCid =
            cid;

        p.state =
            ProjectState.DeliverableUploaded;

        p.reviewDeadline =
            block.timestamp +
            REVIEW_PERIOD;

        emit DeliverableUploaded(
            id,
            cid
        );
    }

    /* =========================================================
                        CLIENT APPROVAL
    ========================================================= */

    function approveProject(
        uint256 id
    )
        external
        exists(id)
        onlyClient(id)
        state(
            id,
            ProjectState.DeliverableUploaded
        )
        nonReentrant
    {
        /*
         * SECURITY:
         * Update state before transferring ETH.
         */
        projects[id].state =
            ProjectState.Completed;

        _pay(id);

        emit ProjectApproved(id);
    }

    /* =========================================================
                            TIMEOUTS
    ========================================================= */

    function claimTimeout(
        uint256 id
    )
        external
        exists(id)
        nonReentrant
    {
        Project storage p =
            projects[id];

        /*
         * Freelancer did not accept.
         *
         * Only the client can reclaim escrow.
         */
        if (
            p.state ==
            ProjectState.Funded
        ) {
            require(
                msg.sender == p.client &&
                block.timestamp >
                p.acceptanceDeadline,
                "Acceptance timeout unavailable"
            );

            p.state =
                ProjectState.Resolved;

            _refund(id);

            emit TimeoutClaimed(
                id,
                msg.sender,
                2
            );

            return;
        }

        /*
         * Freelancer accepted but did not
         * upload the deliverable on time.
         *
         * Only the client can reclaim funds.
         */
        if (
            p.state ==
            ProjectState.Accepted
        ) {
            require(
                msg.sender == p.client &&
                block.timestamp >
                p.deliveryDeadline,
                "Delivery timeout unavailable"
            );

            p.state =
                ProjectState.Resolved;

            _refund(id);

            emit TimeoutClaimed(
                id,
                msg.sender,
                2
            );

            return;
        }

        /*
         * Deliverable was uploaded but
         * client did not review it.
         *
         * Only the freelancer can claim payment.
         */
        if (
            p.state ==
            ProjectState.DeliverableUploaded
        ) {
            require(
                msg.sender == p.freelancer &&
                block.timestamp >
                p.reviewDeadline,
                "Review timeout unavailable"
            );

            p.state =
                ProjectState.Completed;

            _pay(id);

            emit TimeoutClaimed(
                id,
                msg.sender,
                1
            );

            return;
        }

        revert(
            "No timeout available"
        );
    }

    /* =========================================================
                    ARBITER REGISTRATION
    ========================================================= */

    /*
     * BACKWARD-COMPATIBLE VERSION
     *
     * This allows the old frontend to still call:
     *
     * registerArbiter(domain)
     *
     * It supplies default values that satisfy
     * the simple contract eligibility requirements.
     */
    function registerArbiter(
        string memory domain
    )
        external
    {
        _registerArbiter(
            domain,
            domain,
            MIN_ARBITER_EXPERIENCE,
            MIN_RELEVANT_PROJECTS,
            ""
        );
    }

    /*
     * NEW DETAILED ARBITER REGISTRATION
     *
     * The updated frontend should use this version.
     */
    function registerArbiter(
        string memory domain,
        string memory expertise,
        uint256 yearsOfExperience,
        uint256 relevantProjectCount,
        string memory portfolioUrl
    )
        external
    {
        require(
            yearsOfExperience >=
                MIN_ARBITER_EXPERIENCE,
            "Minimum 2 years experience required"
        );

        require(
            relevantProjectCount >=
                MIN_RELEVANT_PROJECTS,
            "Minimum 3 relevant projects required"
        );

        _registerArbiter(
            domain,
            expertise,
            yearsOfExperience,
            relevantProjectCount,
            portfolioUrl
        );
    }

    /*
     * Internal registration logic.
     */
    function _registerArbiter(
        string memory domain,
        string memory expertise,
        uint256 yearsOfExperience,
        uint256 relevantProjectCount,
        string memory portfolioUrl
    )
        internal
    {
        require(
            bytes(domain).length > 0,
            "Domain required"
        );

        require(
            bytes(expertise).length > 0,
            "Expertise required"
        );

        bytes32 key =
            keccak256(
                bytes(domain)
            );

        require(
            !domainRegistered[
                msg.sender
            ][key],
            "Already registered for domain"
        );

        /*
         * Register arbiter for this domain.
         */
        domainRegistered[
            msg.sender
        ][key] = true;

        /*
         * Starting reputation.
         */
        domainReputation[
            msg.sender
        ][key] =
            MIN_ARBITER_REPUTATION;

        /*
         * Add arbiter to the domain pool.
         */
        domainArbiters[key]
            .push(msg.sender);

        /*
         * Store the detailed profile.
         */
        registeredArbiters[
            msg.sender
        ] = Arbiter({
            arbiterAddress: msg.sender,
            domain: domain,
            expertise: expertise,
            yearsOfExperience: yearsOfExperience,
            relevantProjectCount: relevantProjectCount,
            portfolioUrl: portfolioUrl,
            reputation: MIN_ARBITER_REPUTATION
        });

        /*
         * Add to global arbiter list only once.
         */
        bool known =
            false;

        for (
            uint256 i = 0;
            i < allArbiters.length;
            i++
        ) {
            if (
                allArbiters[i] ==
                msg.sender
            ) {
                known = true;
                break;
            }
        }

        if (!known) {
            allArbiters.push(
                msg.sender
            );
        }

        emit ArbiterRegistered(
            msg.sender,
            domain,
            expertise,
            yearsOfExperience,
            relevantProjectCount,
            portfolioUrl
        );
    }

    /* =========================================================
                        DISPUTES
    ========================================================= */

    function raiseDispute(
        uint256 id
    )
        external
        exists(id)
        state(
            id,
            ProjectState.DeliverableUploaded
        )
    {
        Project storage p =
            projects[id];

        /*
         * SECURITY:
         *
         * Only the client or freelancer
         * involved in THIS project can
         * raise a dispute.
         */
        require(
            msg.sender == p.client ||
            msg.sender == p.freelancer,
            "Only project parties can dispute"
        );

        bytes32 key =
            keccak256(
                bytes(p.domain)
            );

        require(
            _eligibleCount(
                id,
                key
            ) >= PANEL_SIZE,
            "Not enough eligible arbiters"
        );

        p.state =
            ProjectState.Disputed;

        emit DisputeRaised(id);

        _selectPanel(
            id,
            key
        );
    }

    /* =========================================================
                        ARBITER VOTING
    ========================================================= */

    function castVote(
        uint256 id,
        uint8 vote
    )
        external
        exists(id)
        state(
            id,
            ProjectState.Disputed
        )
        nonReentrant
    {
        require(
            vote == 1 ||
            vote == 2,
            "Invalid vote"
        );

        Project storage p =
            projects[id];

        bool assigned =
            false;

        /*
         * Check whether this wallet
         * belongs to the assigned panel.
         */
        for (
            uint256 i = 0;
            i < p.arbiters.length;
            i++
        ) {
            if (
                p.arbiters[i] ==
                msg.sender
            ) {
                assigned = true;
                break;
            }
        }

        /*
         * SECURITY:
         *
         * Unauthorized wallets cannot vote.
         */
        require(
            assigned,
            "Not assigned as arbiter"
        );

        /*
         * SECURITY:
         *
         * Duplicate voting prevention.
         *
         * Every assigned arbiter can
         * vote only once.
         */
        require(
            p.votes[msg.sender] == 0,
            "Already voted"
        );

        /*
         * Record the vote permanently.
         */
        p.votes[msg.sender] =
            vote;

        if (vote == 1) {
            p.freelancerVotes++;
        } else {
            p.clientVotes++;
        }

        emit VoteCast(
            id,
            msg.sender,
            vote
        );

        /*
         * PANEL_SIZE is 3.
         *
         * Resolve only when all
         * assigned arbiters have voted.
         */
        if (
            uint256(
                p.freelancerVotes
            ) +
            uint256(
                p.clientVotes
            ) ==
            PANEL_SIZE
        ) {
            _resolve(id);
        }
    }

    /* =========================================================
                        PROJECT VIEW FUNCTIONS
    ========================================================= */

    function getProject(
        uint256 id
    )
        external
        view
        exists(id)
        returns (
            uint256,
            address,
            address,
            uint256,
            string memory,
            string memory,
            ProjectState,
            string memory,
            uint256,
            uint256,
            uint256,
            uint256,
            address[] memory,
            uint8,
            uint8
        )
    {
        Project storage p =
            projects[id];

        return (
            p.id,
            p.client,
            p.freelancer,
            p.budget,
            p.domain,
            p.description,
            p.state,
            p.deliverableCid,
            p.createdAt,
            p.acceptanceDeadline,
            p.deliveryDeadline,
            p.reviewDeadline,
            p.arbiters,
            p.freelancerVotes,
            p.clientVotes
        );
    }

    function getArbiters(
        uint256 id
    )
        external
        view
        exists(id)
        returns (
            address[] memory
        )
    {
        return
            projects[id].arbiters;
    }

    /*
     * Returns a particular arbiter's vote.
     *
     * 0 = Not voted
     * 1 = Freelancer
     * 2 = Client
     */
    function getVote(
        uint256 id,
        address arbiter
    )
        external
        view
        exists(id)
        returns (
            uint8
        )
    {
        return
            projects[id]
                .votes[arbiter];
    }

    /* =========================================================
                    ARBITER PROFILE VIEW
    ========================================================= */

    /*
     * Returns the complete arbiter profile
     * required by the frontend profile/status
     * section.
     */
    function getArbiterProfile(
        address arbiter
    )
        external
        view
        returns (
            address,
            string memory,
            string memory,
            uint256,
            uint256,
            string memory,
            uint256
        )
    {
        Arbiter storage a =
            registeredArbiters[
                arbiter
            ];

        return (
            a.arbiterAddress,
            a.domain,
            a.expertise,
            a.yearsOfExperience,
            a.relevantProjectCount,
            a.portfolioUrl,
            a.reputation
        );
    }

    function getArbiterReputation(
        address arbiter,
        string memory domain
    )
        external
        view
        returns (
            uint256
        )
    {
        return
            domainReputation[
                arbiter
            ][
                keccak256(
                    bytes(domain)
                )
            ];
    }

    function isRegisteredForDomain(
        address arbiter,
        string memory domain
    )
        external
        view
        returns (
            bool
        )
    {
        return
            domainRegistered[
                arbiter
            ][
                keccak256(
                    bytes(domain)
                )
            ];
    }

    /*
     * Returns all registered arbiters.
     */
    function getAllArbiters()
        external
        view
        returns (
            address[] memory
        )
    {
        return allArbiters;
    }

    /*
     * Returns the simple eligibility thresholds.
     *
     * Useful for displaying requirements
     * in the frontend.
     */
    function getArbiterEligibilityRequirements()
        external
        pure
        returns (
            uint256 minimumExperience,
            uint256 minimumProjects,
            uint256 minimumReputation,
            uint256 panelSize
        )
    {
        return (
            MIN_ARBITER_EXPERIENCE,
            MIN_RELEVANT_PROJECTS,
            MIN_ARBITER_REPUTATION,
            PANEL_SIZE
        );
    }

    /* =========================================================
                    ESCROW BALANCE VIEW
    ========================================================= */

    function getEscrowBalance(
        uint256 id
    )
        external
        view
        exists(id)
        returns (
            uint256
        )
    {
        ProjectState currentState =
            projects[id].state;

        if (
            currentState ==
                ProjectState.Funded ||
            currentState ==
                ProjectState.Accepted ||
            currentState ==
                ProjectState.DeliverableUploaded ||
            currentState ==
                ProjectState.Disputed
        ) {
            return
                projects[id].budget;
        }

        return 0;
    }

    /* =========================================================
                INTERNAL ARBITER ELIGIBILITY
    ========================================================= */

    function _eligibleCount(
        uint256 id,
        bytes32 key
    )
        internal
        view
        returns (
            uint256
        )
    {
        Project storage p =
            projects[id];

        address[] storage candidates =
            domainArbiters[key];

        uint256 count;

        for (
            uint256 i = 0;
            i < candidates.length;
            i++
        ) {
            address candidate =
                candidates[i];

            /*
             * SECURITY:
             *
             * Client and freelancer cannot
             * arbitrate their own project.
             */
            if (
                candidate != p.client &&
                candidate != p.freelancer &&

                domainRegistered[
                    candidate
                ][key] &&

                domainReputation[
                    candidate
                ][key] >=
                    MIN_ARBITER_REPUTATION
            ) {
                count++;
            }
        }

        return count;
    }

    /* =========================================================
                INTERNAL PANEL SELECTION
    ========================================================= */

    function _selectPanel(
        uint256 id,
        bytes32 key
    )
        internal
    {
        Project storage p =
            projects[id];

        address[] storage candidates =
            domainArbiters[key];

        address[] memory eligible =
            new address[](
                _eligibleCount(
                    id,
                    key
                )
            );

        uint256 k;

        /*
         * Build the eligible arbiter list.
         */
        for (
            uint256 i = 0;
            i < candidates.length;
            i++
        ) {
            address candidate =
                candidates[i];

            if (
                candidate != p.client &&
                candidate != p.freelancer &&

                domainRegistered[
                    candidate
                ][key] &&

                domainReputation[
                    candidate
                ][key] >=
                    MIN_ARBITER_REPUTATION
            ) {
                eligible[k++] =
                    candidate;
            }
        }

        /*
         * ACADEMIC / LOCAL PROTOTYPE ONLY.
         *
         * This randomness is not secure
         * enough for production use.
         */
        for (
            uint256 i = eligible.length;
            i > 1;
            i--
        ) {
            uint256 j =
                uint256(
                    keccak256(
                        abi.encodePacked(
                            block.prevrandao,
                            block.timestamp,
                            id,
                            i
                        )
                    )
                ) % i;

            address temp =
                eligible[i - 1];

            eligible[i - 1] =
                eligible[j];

            eligible[j] =
                temp;
        }

        /*
         * Select exactly PANEL_SIZE arbiters.
         */
        for (
            uint256 i = 0;
            i < PANEL_SIZE;
            i++
        ) {
            p.arbiters.push(
                eligible[i]
            );

            emit ArbiterAssigned(
                id,
                eligible[i]
            );
        }
    }

    /* =========================================================
                    DISPUTE RESOLUTION
    ========================================================= */

    function _resolve(
        uint256 id
    )
        internal
    {
        Project storage p =
            projects[id];

        /*
         * Majority wins.
         *
         * Since PANEL_SIZE is 3,
         * there cannot be a tie.
         */
        uint8 winner =
            p.freelancerVotes >
            p.clientVotes
                ? 1
                : 2;

        /*
         * SECURITY:
         *
         * Update state before transferring ETH.
         */
        p.state =
            ProjectState.Resolved;

        if (winner == 1) {
            _pay(id);
        } else {
            _refund(id);
        }

        bytes32 key =
            keccak256(
                bytes(p.domain)
            );

        /*
         * Update arbiter reputation.
         *
         * Correct vote: +5
         * Other vote: -1
         */
        for (
            uint256 i = 0;
            i < p.arbiters.length;
            i++
        ) {
            address arbiter =
                p.arbiters[i];

            if (
                p.votes[arbiter] ==
                winner
            ) {
                domainReputation[
                    arbiter
                ][key] += 5;

                /*
                 * Keep the profile's displayed
                 * reputation updated when this
                 * is the arbiter's profile domain.
                 */
                if (
                    keccak256(
                        bytes(
                            registeredArbiters[
                                arbiter
                            ].domain
                        )
                    ) == key
                ) {
                    registeredArbiters[
                        arbiter
                    ].reputation =
                        domainReputation[
                            arbiter
                        ][key];
                }

            } else if (
                domainReputation[
                    arbiter
                ][key] > 0
            ) {
                domainReputation[
                    arbiter
                ][key] -= 1;

                if (
                    keccak256(
                        bytes(
                            registeredArbiters[
                                arbiter
                            ].domain
                        )
                    ) == key
                ) {
                    registeredArbiters[
                        arbiter
                    ].reputation =
                        domainReputation[
                            arbiter
                        ][key];
                }
            }
        }

        emit DisputeResolved(
            id,
            winner
        );
    }

    /* =========================================================
                        ETH TRANSFERS
    ========================================================= */

    function _pay(
        uint256 id
    )
        internal
    {
        Project storage p =
            projects[id];

        (
            bool ok,

        ) =
            p.freelancer.call{
                value: p.budget
            }("");

        require(
            ok,
            "Freelancer payment failed"
        );
    }

    function _refund(
        uint256 id
    )
        internal
    {
        Project storage p =
            projects[id];

        (
            bool ok,

        ) =
            p.client.call{
                value: p.budget
            }("");

        require(
            ok,
            "Client refund failed"
        );
    }
}