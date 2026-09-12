import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  BrowserProvider,
  Contract,
  JsonRpcSigner,
  formatEther,
  isAddress,
  parseEther,
} from "ethers";

import { abi } from "./TrustEscrow.json";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;

      on?: (
        event: string,
        handler: (...args: unknown[]) => void
      ) => void;

      removeListener?: (
        event: string,
        handler: (...args: unknown[]) => void
      ) => void;
    };
  }
}

type Project = {
  id: bigint;
  client: string;
  freelancer: string;
  budget: bigint;
  domain: string;
  description: string;
  state: bigint;
  deliverableCid: string;
  createdAt: bigint;
  acceptanceDeadline: bigint;
  deliveryDeadline: bigint;
  reviewDeadline: bigint;
  arbiters: string[];
  freelancerVotes: bigint;
  clientVotes: bigint;
};

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const HARDHAT_CHAIN_ID = 31337n;

const STATES = [
  "Created",
  "Funded",
  "Accepted",
  "Deliverable Uploaded",
  "Completed",
  "Disputed",
  "Resolved",
];

const DOMAINS = [
  "Web Development",
  "UI/UX Design",
  "Content Writing",
  "Blockchain Development",
  "Data Science",
  "Mobile Development",
];

const shortAddress = (value: string) =>
  value
    ? `${value.slice(0, 6)}...${value.slice(-4)}`
    : "—";

const dateText = (value: bigint) =>
  value > 0n
    ? new Date(Number(value) * 1000).toLocaleString()
    : "Not set";

const past = (value: bigint) =>
  value > 0n &&
  value <= BigInt(Math.floor(Date.now() / 1000));

function errText(error: unknown) {
  const e = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    info?: {
      error?: {
        message?: string;
      };
    };
  };

  return (
    e.shortMessage ||
    e.reason ||
    e.info?.error?.message ||
    e.message ||
    "Transaction failed."
  );
}

export default function App() {
  const [provider, setProvider] =
    useState<BrowserProvider | null>(null);

  const [signer, setSigner] =
    useState<JsonRpcSigner | null>(null);

  const [contract, setContract] =
    useState<Contract | null>(null);

  const [account, setAccount] =
    useState("");

  const accountRef =
    useRef("");

  const [chainId, setChainId] =
    useState<bigint | null>(null);

  const [balance, setBalance] =
    useState("0");

  const [projects, setProjects] =
    useState<Project[]>([]);

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [refresh, setRefresh] =
    useState(0);

  /*
   * PROJECT FORM
   */

  const [freelancer, setFreelancer] =
    useState("");

  const [domain, setDomain] =
    useState(DOMAINS[0]);

  const [description, setDescription] =
    useState("");

  const [budget, setBudget] =
    useState("");

  /*
   * ARBITER ELIGIBILITY FORM
   */

  const [arbiterDomain, setArbiterDomain] =
    useState(DOMAINS[0]);

  const [yearsExperience, setYearsExperience] =
    useState("");

  const [relevantProjects, setRelevantProjects] =
    useState("");

  const [portfolioUrl, setPortfolioUrl] =
    useState("");

  const [checks, setChecks] =
    useState({
      independent: false,
      noConflict: false,
      truthful: false,
      available: false,
    });

  /*
   * ON-CHAIN ARBITER STATUS
   */

  const [arbiterRegistered, setArbiterRegistered] =
    useState(false);

  const [arbiterReputation, setArbiterReputation] =
    useState<bigint>(0n);

  /*
   * LOCAL VOTING STATUS
   *
   * This prevents the UI from showing voting buttons again
   * after the current wallet has already voted.
   *
   * The smart contract remains the final security authority.
   */

  const [votedProjects, setVotedProjects] =
    useState<Record<string, boolean>>({});

  // Used to prevent an older async arbiter-status request
  // from updating the UI after the MetaMask account changes.
  const arbiterStatusRequestRef = useRef(0);

  /*
   * FILES
   */

  const [files, setFiles] =
    useState<Record<string, File | null>>({});

  /*
   * =========================================================
   * NOTIFICATIONS
   * =========================================================
   */

  const notify = (text: string) => {
    setMessage(text);

    window.setTimeout(() => {
      setMessage("");
    }, 4500);
  };

  /*
   * =========================================================
   * WALLET
   * =========================================================
   */

  // All of these values belong to the currently selected MetaMask
  // account. They must not leak from one wallet to another.
  const resetAccountSpecificState =
    useCallback(() => {
      setArbiterDomain(DOMAINS[0]);
      setYearsExperience("");
      setRelevantProjects("");
      setPortfolioUrl("");

      setChecks({
        independent: false,
        noConflict: false,
        truthful: false,
        available: false,
      });

      setArbiterRegistered(false);
      setArbiterReputation(0n);
      setVotedProjects({});
      setFiles({});

      // Invalidate any status request that was started for the
      // previous wallet so it cannot repaint this new wallet's UI.
      arbiterStatusRequestRef.current += 1;
    }, []);

  const clearWallet =
    useCallback(() => {
      setProvider(null);
      setSigner(null);
      setContract(null);

      accountRef.current = "";

      setAccount("");
      setBalance("0");
      setChainId(null);

      setProjects([]);

      resetAccountSpecificState();
    }, [resetAccountSpecificState]);

  const updateWallet =
    useCallback(
      async (
        p: BrowserProvider,
        address: string
      ) => {
        const network =
          await p.getNetwork();

        setChainId(network.chainId);

        const walletBalance =
          await p.getBalance(address);

        setBalance(
          formatEther(walletBalance)
        );
      },
      []
    );

  const setActiveAccount =
    useCallback(
      async (address: string) => {
        if (
          !window.ethereum ||
          !address
        ) {
          clearWallet();
          return;
        }

        try {
          const p =
            new BrowserProvider(
              window.ethereum
            );

          const s =
            await p.getSigner(address);

          const normalizedAddress =
            await s.getAddress();

          const previousAddress =
            accountRef.current;

          const accountChanged =
            !previousAddress ||
            previousAddress.toLowerCase() !==
              normalizedAddress.toLowerCase();

          if (accountChanged) {
            resetAccountSpecificState();
          }

          const c =
            new Contract(
              CONTRACT_ADDRESS,
              abi,
              s
            );

          setProvider(p);
          setSigner(s);
          setContract(c);

          accountRef.current =
            normalizedAddress;

          setAccount(
            normalizedAddress
          );

          await updateWallet(
            p,
            normalizedAddress
          );
        } catch (error) {
          console.error(error);

          clearWallet();
        }
      },
      [
        clearWallet,
        resetAccountSpecificState,
        updateWallet,
      ]
    );

  const connect =
    useCallback(
      async () => {
        if (!window.ethereum) {
          notify(
            "MetaMask is not installed."
          );
          return;
        }

        try {
          setBusy(true);

          const accounts =
            (await window.ethereum.request({
              method:
                "eth_requestAccounts",
            })) as string[];

          if (!accounts?.length) {
            throw new Error(
              "No MetaMask account selected."
            );
          }

          await setActiveAccount(
            accounts[0]
          );
        } catch (error) {
          notify(errText(error));
        } finally {
          setBusy(false);
        }
      },
      [setActiveAccount]
    );

  /*
   * =========================================================
   * METAMASK LISTENERS
   * =========================================================
   */

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged =
      async (...args: unknown[]) => {
        const accounts =
          args[0] as string[];

        if (!accounts?.length) {
          clearWallet();
          return;
        }

        await setActiveAccount(
          accounts[0]
        );
      };

    const handleChainChanged =
      async () => {
        if (!accountRef.current) {
          return;
        }

        const accounts =
          (await window.ethereum!.request({
            method: "eth_accounts",
          })) as string[];

        if (accounts?.length) {
          await setActiveAccount(
            accounts[0]
          );
        } else {
          clearWallet();
        }
      };

    window.ethereum.on?.(
      "accountsChanged",
      handleAccountsChanged
    );

    window.ethereum.on?.(
      "chainChanged",
      handleChainChanged
    );

    return () => {
      window.ethereum?.removeListener?.(
        "accountsChanged",
        handleAccountsChanged
      );

      window.ethereum?.removeListener?.(
        "chainChanged",
        handleChainChanged
      );
    };
  }, [
    clearWallet,
    setActiveAccount,
  ]);

  /*
   * =========================================================
   * HARDHAT NETWORK
   * =========================================================
   */

  const switchNetwork =
    async () => {
      if (!window.ethereum) {
        notify(
          "MetaMask is not installed."
        );
        return;
      }

      try {
        await window.ethereum.request({
          method:
            "wallet_switchEthereumChain",

          params: [
            {
              chainId: "0x7a69",
            },
          ],
        });
      } catch (error) {
        const e =
          error as {
            code?: number;
          };

        if (e.code === 4902) {
          await window.ethereum.request({
            method:
              "wallet_addEthereumChain",

            params: [
              {
                chainId: "0x7a69",

                chainName:
                  "Hardhat Local",

                nativeCurrency: {
                  name: "Ether",
                  symbol: "ETH",
                  decimals: 18,
                },

                rpcUrls: [
                  "http://127.0.0.1:8545",
                ],
              },
            ],
          });
        } else {
          notify(errText(error));
        }
      }
    };

  /*
   * =========================================================
   * LOAD PROJECTS
   * =========================================================
   */

  const loadProjects =
    useCallback(
      async () => {
        if (!contract) {
          setProjects([]);
          return;
        }

        try {
          const count =
            (await contract.projectCount()) as bigint;

          const rows: Project[] =
            [];

          for (
            let id = 1n;
            id <= count;
            id++
          ) {
            const p =
              await contract.getProject(id);

            rows.push({
              id: p.id,
              client: p.client,
              freelancer: p.freelancer,
              budget: p.budget,
              domain: p.domain,
              description: p.description,
              state: p.state,
              deliverableCid:
                p.deliverableCid,
              createdAt: p.createdAt,
              acceptanceDeadline:
                p.acceptanceDeadline,
              deliveryDeadline:
                p.deliveryDeadline,
              reviewDeadline:
                p.reviewDeadline,
              arbiters: p.arbiters,
              freelancerVotes:
                p.freelancerVotes,
              clientVotes:
                p.clientVotes,
            });
          }

          setProjects(
            rows.reverse()
          );
        } catch (error) {
          console.error(error);

          notify(
            "Could not read projects from the blockchain."
          );
        }
      },
      [contract]
    );

  /*
   * =========================================================
   * LOAD ARBITER STATUS
   * =========================================================
   */

  const loadArbiterStatus =
    useCallback(
      async () => {
        const requestId =
          ++arbiterStatusRequestRef.current;

        const requestedAccount =
          account;

        const requestedDomain =
          arbiterDomain;

        if (!contract || !requestedAccount) {
          setArbiterRegistered(false);
          setArbiterReputation(0n);
          return;
        }

        try {
          const registered =
            (await contract.isRegisteredForDomain(
              requestedAccount,
              requestedDomain
            )) as boolean;

          const reputation =
            (await contract.getArbiterReputation(
              requestedAccount,
              requestedDomain
            )) as bigint;

          // Ignore a response belonging to an older wallet/domain.
          if (
            requestId !==
              arbiterStatusRequestRef.current ||
            accountRef.current.toLowerCase() !==
              requestedAccount.toLowerCase()
          ) {
            return;
          }

          setArbiterRegistered(
            registered
          );

          setArbiterReputation(
            reputation
          );
        } catch (error) {
          console.error(
            "Arbiter status loading failed:",
            error
          );
        }
      },
      [
        contract,
        account,
        arbiterDomain,
        refresh,
      ]
    );

  useEffect(() => {
    void loadProjects();
  }, [
    loadProjects,
    refresh,
  ]);

  useEffect(() => {
    void loadArbiterStatus();
  }, [
    loadArbiterStatus,
    refresh,
  ]);

  /*
   * =========================================================
   * TRANSACTION HELPER
   * =========================================================
   */

  const tx =
    async (
      fn: () => Promise<{
        wait: () => Promise<unknown>;
      }>,
      success: string
    ): Promise<boolean> => {
      try {
        setBusy(true);

        const transaction =
          await fn();

        await transaction.wait();

        notify(success);

        setRefresh(
          (value) => value + 1
        );

        if (
          provider &&
          account
        ) {
          await updateWallet(
            provider,
            account
          );
        }

        return true;
      } catch (error) {
        console.error(error);

        notify(errText(error));
        return false;
      } finally {
        setBusy(false);
      }
    };

  /*
   * =========================================================
   * CREATE PROJECT
   * =========================================================
   */

  const createProject =
    async () => {
      if (!contract || !provider || !signer) {
        notify(
          "Connect MetaMask first."
        );
        return;
      }

      if (
        chainId !== HARDHAT_CHAIN_ID
      ) {
        notify(
          "Switch MetaMask to Hardhat Local before creating a project."
        );
        return;
      }

      try {
        const signerAddress =
          await signer.getAddress();

        if (
          signerAddress.toLowerCase() !==
          account.toLowerCase()
        ) {
          notify(
            "MetaMask account changed. Reconnect the selected account and try again."
          );
          return;
        }

        const code =
          await provider.getCode(
            CONTRACT_ADDRESS
          );

        if (code === "0x") {
          notify(
            "TrustEscrow is not deployed at the configured contract address. Redeploy it to Hardhat Local."
          );
          return;
        }

        if (!isAddress(freelancer)) {
          notify(
            "Enter a valid freelancer wallet address."
          );
          return;
        }

        if (
          freelancer.toLowerCase() ===
          account.toLowerCase()
        ) {
          notify(
            "Client and freelancer must use different wallets."
          );
          return;
        }

        if (!description.trim()) {
          notify(
            "Enter a project description."
          );
          return;
        }

        let value: bigint;

        try {
          value = parseEther(budget);
        } catch {
          notify(
            "Enter a valid ETH budget."
          );
          return;
        }

        if (value <= 0n) {
          notify(
            "Budget must be greater than zero."
          );
          return;
        }

        /*
         * Preflight the exact contract call first.
         * createProject stores the project details only;
         * the actual ETH escrow deposit happens in the
         * separate depositFunds transaction.
         */
        try {
          await contract.createProject.staticCall(
            freelancer,
            domain,
            description.trim(),
            value
          );
        } catch (error) {
          notify(
            `Create Project rejected: ${errText(error)}`
          );
          return;
        }

        const success =
          await tx(
            () =>
              contract.createProject(
                freelancer,
                domain,
                description.trim(),
                value
              ),
            "Project created on-chain."
          );

        if (success) {
          setFreelancer("");
          setDescription("");
          setBudget("");
        }
      } catch (error) {
        console.error(
          "Create project preflight failed:",
          error
        );
        notify(errText(error));
      }
    };

  /*
   * =========================================================
   * UPLOAD DELIVERABLE
   * =========================================================
   */

  const uploadDeliverable =
    async (project: Project) => {
      if (!contract) {
        notify(
          "Connect MetaMask first."
        );
        return;
      }

      const file =
        files[
          project.id.toString()
        ];

      const jwt =
        import.meta.env
          .VITE_PINATA_JWT as
          | string
          | undefined;

      if (!file) {
        notify(
          "Choose a deliverable file first."
        );
        return;
      }

      if (!jwt) {
        notify(
          "VITE_PINATA_JWT is missing from frontend/.env."
        );
        return;
      }

      try {
        setBusy(true);

        const form =
          new FormData();

        form.append(
          "file",
          file
        );

        const response =
          await fetch(
            "https://api.pinata.cloud/pinning/pinFileToIPFS",
            {
              method: "POST",

              headers: {
                Authorization:
                  `Bearer ${jwt}`,
              },

              body: form,
            }
          );

        const data =
          await response.json();

        if (
          !response.ok ||
          !data.IpfsHash
        ) {
          throw new Error(
            data?.message ||
              "IPFS upload failed."
          );
        }

        const transaction =
          await contract.uploadDeliverable(
            project.id,
            data.IpfsHash
          );

        await transaction.wait();

        setFiles(
          (old) => ({
            ...old,
            [project.id.toString()]:
              null,
          })
        );

        notify(
          `Deliverable uploaded. CID: ${data.IpfsHash}`
        );

        setRefresh(
          (value) => value + 1
        );
      } catch (error) {
        console.error(error);

        notify(errText(error));
      } finally {
        setBusy(false);
      }
    };

  /*
   * =========================================================
   * ARBITER ELIGIBILITY
   * =========================================================
   *
   * Simple frontend eligibility.
   * No OAuth or complex verification.
   */

  const experienceNumber =
    Number(yearsExperience || 0);

  const projectNumber =
    Number(relevantProjects || 0);

  const validPortfolio =
    /^https?:\/\/.+/i.test(
      portfolioUrl.trim()
    );

  const allChecksPassed =
    Object.values(checks).every(
      Boolean
    );

  const arbiterEligible =
    experienceNumber >= 2 &&
    projectNumber >= 3 &&
    validPortfolio &&
    allChecksPassed;

  const eligibilityReasons =
    [
      experienceNumber >= 2
        ? null
        : "At least 2 years of relevant experience required.",

      projectNumber >= 3
        ? null
        : "At least 3 relevant projects required.",

      validPortfolio
        ? null
        : "A valid GitHub or portfolio URL is required.",

      allChecksPassed
        ? null
        : "All eligibility declarations must be confirmed.",
    ].filter(Boolean);

  const toggleCheck = (
    key:
      | "independent"
      | "noConflict"
      | "truthful"
      | "available"
  ) => {
    setChecks(
      (old) => ({
        ...old,
        [key]: !old[key],
      })
    );
  };

  const registerArbiter =
    async () => {
      if (!contract) {
        notify(
          "Connect MetaMask first."
        );
        return;
      }

      if (!arbiterEligible) {
        notify(
          "Complete all eligibility requirements before registering."
        );
        return;
      }

      await tx(
        () =>
          contract.registerArbiter(
            arbiterDomain
          ),

        "Arbiter registered on-chain."
      );
    };

  /*
   * =========================================================
   * ROLE CHECKS
   * =========================================================
   */

  const isClient = (
    project: Project
  ) =>
    account.toLowerCase() ===
    project.client.toLowerCase();

  const isFreelancer = (
    project: Project
  ) =>
    account.toLowerCase() ===
    project.freelancer.toLowerCase();

  const isArbiter = (
    project: Project
  ) =>
    project.arbiters.some(
      (arbiter) =>
        arbiter.toLowerCase() ===
        account.toLowerCase()
    );

  /*
   * =========================================================
   * PROJECT GROUPING
   * =========================================================
   */

  const active =
    useMemo(
      () =>
        projects.filter(
          (project) =>
            project.state !== 4n &&
            project.state !== 6n
        ),
      [projects]
    );

  const settled =
    useMemo(
      () =>
        projects.filter(
          (project) =>
            project.state === 4n ||
            project.state === 6n
        ),
      [projects]
    );

  /*
   * =========================================================
   * PROJECT ACTIONS
   * =========================================================
   */

  const actions = (
    project: Project
  ) => {
    const output: React.ReactNode[] =
      [];

    /*
     * CLIENT DEPOSIT
     */

    if (
      project.state === 0n &&
      isClient(project)
    ) {
      output.push(
        <button
          key="deposit"
          className="action primary"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.depositFunds(
                  project.id,
                  {
                    value:
                      project.budget,
                  }
                ),

              "Escrow funded."
            )
          }
        >
          Deposit{" "}
          {formatEther(project.budget)} ETH
        </button>
      );
    }

    /*
     * FREELANCER ACCEPTANCE
     */

    if (
      project.state === 1n &&
      isFreelancer(project)
    ) {
      output.push(
        <button
          key="accept"
          className="action success"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.acceptProject(
                  project.id
                ),

              "Project accepted."
            )
          }
        >
          Accept Project
        </button>
      );
    }

    /*
     * FREELANCER DELIVERABLE
     */

    if (
      project.state === 2n &&
      isFreelancer(project)
    ) {
      output.push(
        <label
          key="choose"
          className="file-action action secondary"
        >
          Choose Deliverable

          <input
            hidden
            type="file"
            onChange={(event) =>
              setFiles(
                (old) => ({
                  ...old,

                  [project.id.toString()]:
                    event.target.files?.[0] ||
                    null,
                })
              )
            }
          />
        </label>
      );

      if (
        files[
          project.id.toString()
        ]
      ) {
        output.push(
          <button
            key="upload"
            className="action secondary"
            disabled={busy}
            onClick={() =>
              uploadDeliverable(project)
            }
          >
            Upload to IPFS
          </button>
        );
      }
    }

    /*
     * APPROVAL
     */

    if (
      project.state === 3n &&
      isClient(project)
    ) {
      output.push(
        <button
          key="approve"
          className="action success"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.approveProject(
                  project.id
                ),

              "Project approved and freelancer paid."
            )
          }
        >
          Approve & Pay
        </button>
      );
    }

    /*
     * SECURITY MATCH:
     *
     * Contract allows BOTH project parties
     * to raise a dispute.
     */

    if (
      project.state === 3n &&
      (
        isClient(project) ||
        isFreelancer(project)
      )
    ) {
      output.push(
        <button
          key="dispute"
          className="action danger"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.raiseDispute(
                  project.id
                ),

              "Dispute opened."
            )
          }
        >
          Raise Dispute
        </button>
      );
    }

    /*
     * ACCEPTANCE TIMEOUT
     */

    if (
      project.state === 1n &&
      isClient(project) &&
      past(project.acceptanceDeadline)
    ) {
      output.push(
        <button
          key="timeout-accept"
          className="action warning"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.claimTimeout(
                  project.id
                ),

              "Acceptance timeout settled."
            )
          }
        >
          Claim Timeout
        </button>
      );
    }

    /*
     * DELIVERY TIMEOUT
     */

    if (
      project.state === 2n &&
      isClient(project) &&
      past(project.deliveryDeadline)
    ) {
      output.push(
        <button
          key="timeout-delivery"
          className="action warning"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.claimTimeout(
                  project.id
                ),

              "Delivery timeout settled."
            )
          }
        >
          Claim Timeout
        </button>
      );
    }

    /*
     * REVIEW TIMEOUT
     */

    if (
      project.state === 3n &&
      isFreelancer(project) &&
      past(project.reviewDeadline)
    ) {
      output.push(
        <button
          key="timeout-review"
          className="action warning"
          disabled={busy}
          onClick={() =>
            tx(
              () =>
                contract!.claimTimeout(
                  project.id
                ),

              "Review timeout released payment."
            )
          }
        >
          Claim Timeout
        </button>
      );
    }

    /*
     * ARBITRATION VOTING
     */

    const projectKey =
      project.id.toString();

    const alreadyVoted =
      votedProjects[projectKey];

    if (
      project.state === 5n &&
      isArbiter(project) &&
      !alreadyVoted
    ) {
      output.push(
        <button
          key="vote-freelancer"
          className="action success"
          disabled={busy}
          onClick={async () => {
            await tx(
              () =>
                contract!.castVote(
                  project.id,
                  1
                ),

              "Freelancer vote recorded."
            );

            setVotedProjects(
              (old) => ({
                ...old,
                [projectKey]: true,
              })
            );
          }}
        >
          Vote Freelancer
        </button>
      );

      output.push(
        <button
          key="vote-client"
          className="action danger"
          disabled={busy}
          onClick={async () => {
            await tx(
              () =>
                contract!.castVote(
                  project.id,
                  2
                ),

              "Client vote recorded."
            );

            setVotedProjects(
              (old) => ({
                ...old,
                [projectKey]: true,
              })
            );
          }}
        >
          Vote Client
        </button>
      );
    }

    if (
      project.state === 5n &&
      isArbiter(project) &&
      alreadyVoted
    ) {
      output.push(
        <span
          key="voted"
          className="vote-status"
        >
          Your vote has already been recorded.
        </span>
      );
    }

    return output;
  };

  /*
   * =========================================================
   * LANDING PAGE
   * =========================================================
   */

  if (!account) {
    return (
      <div className="app-shell">
        {message && (
          <div className="toast">
            {message}
          </div>
        )}

        <header className="topbar">
          <div className="brand">
            <b className="brand-mark">
              T+
            </b>

            <div>
              <b>
                TrustEscrow+
              </b>

              <small>
                Decentralized freelance escrow
              </small>
            </div>
          </div>

          <button
            className="connect-button"
            onClick={connect}
            disabled={busy}
          >
            {busy
              ? "Connecting..."
              : "Connect MetaMask"}
          </button>
        </header>

        <main className="landing">
          <section className="hero">
            <div className="eyebrow">
              BLOCKCHAIN-FIRST ESCROW
            </div>

            <h1>
              Freelance payments
              <br />
              secured by{" "}
              <span>
                smart contracts.
              </span>
            </h1>

            <p>
              TrustEscrow+ locks client funds
              in an Ethereum-compatible smart
              contract, records IPFS deliverable
              evidence on-chain, and uses
              domain-specialized arbitration
              for disputes.
            </p>

            <div className="hero-actions">
              <button
                className="connect-button large"
                onClick={connect}
                disabled={busy}
              >
                {busy
                  ? "Connecting..."
                  : "Launch TrustEscrow+"}
              </button>

            </div>
          </section>

          <section className="feature-grid">
            <article>
              <b>01</b>

              <h3>
                Smart-contract escrow
              </h3>

              <p>
                Funds are held and released
                by programmable blockchain
                rules.
              </p>
            </article>

            <article>
              <b>02</b>

              <h3>
                IPFS deliverables
              </h3>

              <p>
                Deliverables are stored on
                decentralized storage while
                their CID is anchored on-chain.
              </p>
            </article>

            <article>
              <b>03</b>

              <h3>
                Domain arbitration
              </h3>

              <p>
                Disputes select eligible
                arbiters from the project's
                expertise domain.
              </p>
            </article>
          </section>
        </main>
      </div>
    );
  }

  /*
   * =========================================================
   * DASHBOARD
   * =========================================================
   */

  return (
    <div className="app-shell">
      {message && (
        <div className="toast">
          {message}
        </div>
      )}

      <header className="topbar">
        <div className="brand">
          <b className="brand-mark">
            T+
          </b>

          <div>
            <b>
              TrustEscrow+
            </b>

            <small>
              On-chain escrow dashboard
            </small>
          </div>
        </div>

        <div className="wallet-area">
          <span className="pill">
            ●{" "}
            {chainId === HARDHAT_CHAIN_ID
              ? "Hardhat Local"
              : chainId
              ? `Chain ${chainId}`
              : "Not connected"}
          </span>

          <span className="pill">
            {Number(balance).toFixed(4)} ETH
          </span>

          <span className="pill mono">
            {shortAddress(account)}
          </span>

          {chainId !== HARDHAT_CHAIN_ID && (
            <button
              className="switch-button"
              onClick={switchNetwork}
            >
              Switch Network
            </button>
          )}
        </div>
      </header>

      <main className="dashboard">
        <section className="heading">
          <div>
            <div className="eyebrow">
              TRUSTESCROW+ DASHBOARD
            </div>

            <h1>
              On-chain project
              <br />

              <em>
                management.
              </em>
            </h1>
          </div>

          <div className="contract">
            <small>
              SMART CONTRACT
            </small>

            <code>
              {shortAddress(
                CONTRACT_ADDRESS
              )}
            </code>

            <span>
              Ethereum-compatible • Chain ID 31337
            </span>
          </div>
        </section>

        <section className="stats">
          <div>
            <span>
              Total Projects
            </span>

            <b>
              {projects.length}
            </b>
          </div>

          <div>
            <span>
              Active
            </span>

            <b>
              {active.length}
            </b>
          </div>

          <div>
            <span>
              Settled
            </span>

            <b>
              {settled.length}
            </b>
          </div>

          <div>
            <span>
              Your Wallet
            </span>

            <b>
              {shortAddress(account)}
            </b>
          </div>
        </section>

        <section className="two-col">
          {/* CREATE PROJECT */}

          <article className="panel">
            <div className="panel-title">
              <div>
                <small>
                  CLIENT
                </small>

                <h2>
                  Create Project
                </h2>
              </div>

              <b>
                +
              </b>
            </div>

            <div className="form-grid">
              <label>
                Freelancer wallet

                <input
                  value={freelancer}
                  onChange={(e) =>
                    setFreelancer(
                      e.target.value
                    )
                  }
                  placeholder="0x..."
                />
              </label>

              <label>
                Project domain

                <select
                  value={domain}
                  onChange={(e) =>
                    setDomain(
                      e.target.value
                    )
                  }
                >
                  {DOMAINS.map(
                    (item) => (
                      <option key={item}>
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="full">
                Description

                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) =>
                    setDescription(
                      e.target.value
                    )
                  }
                  placeholder="Requirements, scope and expected deliverable..."
                />
              </label>

              <label>
                Budget

                <div className="suffix">
                  <input
                    value={budget}
                    onChange={(e) =>
                      setBudget(
                        e.target.value
                      )
                    }
                    placeholder="1.00"
                    type="number"
                    min="0"
                    step="0.001"
                  />

                  <b>
                    ETH
                  </b>
                </div>
              </label>
            </div>

            <button
              className="wide primary-wide"
              disabled={
                busy ||
                chainId !== HARDHAT_CHAIN_ID
              }
              onClick={createProject}
            >
              Create Project On-Chain
            </button>
          </article>

          {/* ARBITER REGISTRATION */}

          <article className="panel">
            <div className="panel-title">
              <div>
                <small>
                  ARBITRATION
                </small>

                <h2>
                  Arbiter Eligibility
                </h2>
              </div>

              <b>
                ⚖
              </b>
            </div>

            <p>
              Complete the simple eligibility
              information below. This prototype
              does not use OAuth or external
              verification.
            </p>

            <div className="eligibility-form">
              <label>
                Expertise domain

                <select
                  value={arbiterDomain}
                  onChange={(e) =>
                    setArbiterDomain(
                      e.target.value
                    )
                  }
                >
                  {DOMAINS.map(
                    (item) => (
                      <option key={item}>
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>

              <div className="form-grid">
                <label>
                  Years of experience

                  <input
                    type="number"
                    min="0"
                    value={yearsExperience}
                    onChange={(e) =>
                      setYearsExperience(
                        e.target.value
                      )
                    }
                    placeholder="Minimum 2"
                  />
                </label>

                <label>
                  Relevant projects

                  <input
                    type="number"
                    min="0"
                    value={relevantProjects}
                    onChange={(e) =>
                      setRelevantProjects(
                        e.target.value
                      )
                    }
                    placeholder="Minimum 3"
                  />
                </label>
              </div>

              <label>
                GitHub / Portfolio URL

                <input
                  value={portfolioUrl}
                  onChange={(e) =>
                    setPortfolioUrl(
                      e.target.value
                    )
                  }
                  placeholder="https://github.com/username"
                />
              </label>

              <div className="checklist">
                <label className="check-item">
                  <input
                    type="checkbox"
                    checked={checks.independent}
                    onChange={() =>
                      toggleCheck(
                        "independent"
                      )
                    }
                  />

                  <span>
                    I can make independent and fair decisions.
                  </span>
                </label>

                <label className="check-item">
                  <input
                    type="checkbox"
                    checked={checks.noConflict}
                    onChange={() =>
                      toggleCheck(
                        "noConflict"
                      )
                    }
                  />

                  <span>
                    I will not arbitrate projects with a conflict of interest.
                  </span>
                </label>

                <label className="check-item">
                  <input
                    type="checkbox"
                    checked={checks.truthful}
                    onChange={() =>
                      toggleCheck(
                        "truthful"
                      )
                    }
                  />

                  <span>
                    The information provided is truthful.
                  </span>
                </label>

                <label className="check-item">
                  <input
                    type="checkbox"
                    checked={checks.available}
                    onChange={() =>
                      toggleCheck(
                        "available"
                      )
                    }
                  />

                  <span>
                    I am available to participate in dispute resolution.
                  </span>
                </label>
              </div>

              <div
                className={
                  arbiterEligible
                    ? "eligibility-status eligible"
                    : "eligibility-status not-eligible"
                }
              >
                <b>
                  {arbiterEligible
                    ? "✓ ELIGIBLE"
                    : "✕ NOT ELIGIBLE"}
                </b>

                <span>
                  {arbiterEligible
                    ? "All frontend eligibility requirements are satisfied."
                    : eligibilityReasons.join(" ")}
                </span>
              </div>

              <button
                className="wide secondary-wide"
                disabled={
                  busy ||
                  chainId !== HARDHAT_CHAIN_ID ||
                  !arbiterEligible ||
                  arbiterRegistered
                }
                onClick={registerArbiter}
              >
                {arbiterRegistered
                  ? "Already Registered"
                  : "Register Arbiter On-Chain"}
              </button>
            </div>
          </article>
        </section>

        {/* ARBITER PROFILE */}

        <section className="profile-section">
          <div className="section-head profile-heading">
            <div>
              <small>
                ARBITER PROFILE
              </small>

              <h2>
                Profile & On-Chain Status
              </h2>
            </div>
          </div>

          <div className="profile-grid">
            <div className="profile-card">
              <small>
                DOMAIN
              </small>

              <b>
                {arbiterDomain}
              </b>
            </div>

            <div className="profile-card">
              <small>
                EXPERIENCE
              </small>

              <b>
                {yearsExperience || "0"} years
              </b>
            </div>

            <div className="profile-card">
              <small>
                PROJECT COUNT
              </small>

              <b>
                {relevantProjects || "0"}
              </b>
            </div>

            <div className="profile-card">
              <small>
                PORTFOLIO
              </small>

              {validPortfolio ? (
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Profile ↗
                </a>
              ) : (
                <b>
                  Not provided
                </b>
              )}
            </div>

            <div className="profile-card reputation-card">
              <small>
                ON-CHAIN REPUTATION
              </small>

              <b>
                {arbiterReputation.toString()}
              </b>

              <span>
                {arbiterRegistered
                  ? "Registered for selected domain"
                  : "Not registered on-chain"}
              </span>
            </div>

            <div
              className={
                arbiterRegistered
                  ? "profile-card registration-ok"
                  : "profile-card registration-pending"
              }
            >
              <small>
                REGISTRATION STATUS
              </small>

              <b>
                {arbiterRegistered
                  ? "Registered"
                  : "Not Registered"}
              </b>

              <span>
                {arbiterEligible
                  ? "Frontend requirements satisfied"
                  : "Complete eligibility requirements"}
              </span>
            </div>
          </div>
        </section>

        {/* PROJECTS */}

        <section className="section-head">
          <div>
            <small>
              PROJECT LEDGER
            </small>

            <h2>
              Active projects
            </h2>
          </div>

          <button
            className="ghost-button"
            onClick={() =>
              setRefresh(
                (value) => value + 1
              )
            }
          >
            Refresh Blockchain
          </button>
        </section>

        {active.length === 0 ? (
          <div className="empty">
            <h3>
              No active projects
            </h3>

            <p>
              Create one or connect a wallet
              involved in an existing project.
            </p>
          </div>
        ) : (
          <div className="projects">
            {active.map(
              (project) => (
                <article
                  className="project"
                  key={project.id.toString()}
                >
                  <div className="project-top">
                    <div>
                      <small>
                        PROJECT #
                        {project.id.toString()}
                      </small>

                      <h3>
                        {project.domain}
                      </h3>
                    </div>

                    <span className="state">
                      {
                        STATES[
                          Number(
                            project.state
                          )
                        ]
                      }
                    </span>
                  </div>

                  <p>
                    {project.description}
                  </p>

                  <div className="steps">
                    {STATES.map(
                      (state, index) => (
                        <div
                          className={
                            Number(
                              project.state
                            ) >= index
                              ? "done"
                              : ""
                          }
                          key={state}
                        >
                          <b>
                            {index + 1}
                          </b>

                          <small>
                            {state}
                          </small>
                        </div>
                      )
                    )}
                  </div>

                  <div className="metrics">
                    <div>
                      <small>
                        BUDGET
                      </small>

                      <b>
                        {formatEther(
                          project.budget
                        )} ETH
                      </b>
                    </div>

                    <div>
                      <small>
                        CLIENT
                      </small>

                      <b>
                        {shortAddress(
                          project.client
                        )}
                      </b>
                    </div>

                    <div>
                      <small>
                        FREELANCER
                      </small>

                      <b>
                        {shortAddress(
                          project.freelancer
                        )}
                      </b>
                    </div>
                  </div>

                  <div className="deadlines">
                    <div>
                      <small>
                        ACCEPTANCE
                      </small>

                      <b>
                        {dateText(
                          project.acceptanceDeadline
                        )}
                      </b>
                    </div>

                    <div>
                      <small>
                        DELIVERY
                      </small>

                      <b>
                        {dateText(
                          project.deliveryDeadline
                        )}
                      </b>
                    </div>

                    <div>
                      <small>
                        REVIEW
                      </small>

                      <b>
                        {dateText(
                          project.reviewDeadline
                        )}
                      </b>
                    </div>
                  </div>

                  {project.deliverableCid && (
                    <div className="cid">
                      <small>
                        IPFS CID
                      </small>

                      <code>
                        {
                          project.deliverableCid
                        }
                      </code>

                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${project.deliverableCid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View ↗
                      </a>
                    </div>
                  )}

                  {project.state === 5n && (
                    <div className="arb-box">
                      <b>
                        ARBITRATION PANEL
                      </b>

                      <span>
                        {
                          project.arbiters.length
                        }
                        /3 arbiters
                      </span>

                      <div>
                        {project.arbiters.map(
                          (arbiter) => (
                            <code key={arbiter}>
                              {shortAddress(
                                arbiter
                              )}
                            </code>
                          )
                        )}
                      </div>

                      <small>
                        Freelancer votes:{" "}
                        {
                          project
                            .freelancerVotes
                            .toString()
                        }
                        {" • "}
                        Client votes:{" "}
                        {
                          project
                            .clientVotes
                            .toString()
                        }
                      </small>
                    </div>
                  )}

                  <div className="actions">
                    {actions(project)}
                  </div>
                </article>
              )
            )}
          </div>
        )}

        {settled.length > 0 && (
          <>
            <section className="section-head">
              <div>
                <small>
                  SETTLED
                </small>

                <h2>
                  Completed / resolved
                </h2>
              </div>
            </section>

            <div className="settled">
              {settled.map(
                (project) => (
                  <div
                    key={project.id.toString()}
                  >
                    <b>
                      #{project.id.toString()}{" "}
                      {project.domain}
                    </b>

                    <span>
                      {
                        STATES[
                          Number(
                            project.state
                          )
                        ]
                      }
                    </span>

                    <strong>
                      {formatEther(
                        project.budget
                      )} ETH
                    </strong>
                  </div>
                )
              )}
            </div>
          </>
        )}
      </main>

      {busy && (
        <div className="overlay">
          <div>
            <i />

            <b>
              Waiting for blockchain confirmation...
            </b>

            <small>
              Confirm the transaction in MetaMask if prompted.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}