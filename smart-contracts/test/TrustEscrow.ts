import { expect } from "chai";
import { ethers } from "hardhat";

describe("TrustEscrow+", function () {
  async function fixture() {
    const [owner, client, freelancer, a1, a2, a3, a4] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("TrustEscrow");
    const escrow = await Factory.deploy();
    await escrow.waitForDeployment();
    return { owner, client, freelancer, a1, a2, a3, a4, escrow };
  }

  async function createDelivered(escrow: any, client: any, freelancer: any) {
    const budget = ethers.parseEther("1");
    await escrow.connect(client).createProject(freelancer.address, "Web Development", "Build a website", budget);
    await escrow.connect(client).depositFunds(1, { value: budget });
    await escrow.connect(freelancer).acceptProject(1);
    await escrow.connect(freelancer).uploadDeliverable(1, "QmTestCID");
    return budget;
  }

  it("creates and funds an escrow project", async function () {
    const { escrow, client, freelancer } = await fixture();
    const budget = ethers.parseEther("1");
    await escrow.connect(client).createProject(freelancer.address, "Web Development", "Build a website", budget);
    const p = await escrow.getProject(1);
    expect(p.client).to.equal(client.address);
    expect(p.freelancer).to.equal(freelancer.address);
    expect(p.budget).to.equal(budget);
    expect(p.state).to.equal(0);
    await expect(escrow.connect(client).depositFunds(1, { value: budget })).to.emit(escrow, "ProjectFunded");
  });

  it("completes and pays the freelancer after approval", async function () {
    const { escrow, client, freelancer } = await fixture();
    const budget = await createDelivered(escrow, client, freelancer);
    await expect(escrow.connect(client).approveProject(1)).to.emit(escrow, "ProjectApproved");
    const p = await escrow.getProject(1);
    expect(p.state).to.equal(4);
    expect(await escrow.getEscrowBalance(1)).to.equal(0);
    expect(await ethers.provider.getBalance(freelancer.address)).to.be.greaterThan(ethers.parseEther("9999"));
    expect(budget).to.equal(ethers.parseEther("1"));
  });

  it("requires three domain-eligible arbiters", async function () {
    const { escrow, client, freelancer, a1, a2, a3 } = await fixture();
    await escrow.connect(a1).registerArbiter("Web Development");
    await escrow.connect(a2).registerArbiter("Web Development");
    await escrow.connect(a3).registerArbiter("UI/UX Design");
    await createDelivered(escrow, client, freelancer);
    await expect(escrow.connect(client).raiseDispute(1)).to.be.revertedWith("Not enough eligible arbiters");
    await escrow.connect(a3).registerArbiter("Web Development");
    await expect(escrow.connect(client).raiseDispute(1)).to.emit(escrow, "DisputeRaised");
    const arbiters = await escrow.getArbiters(1);
    expect(arbiters.length).to.equal(3);
  });

  it("resolves a dispute by majority vote", async function () {
    const { escrow, client, freelancer, a1, a2, a3 } = await fixture();
    await escrow.connect(a1).registerArbiter("Web Development");
    await escrow.connect(a2).registerArbiter("Web Development");
    await escrow.connect(a3).registerArbiter("Web Development");
    await createDelivered(escrow, client, freelancer);
    await escrow.connect(client).raiseDispute(1);
    const panel = await escrow.getArbiters(1);
    await escrow.connect(panel[0] === a1.address ? a1 : panel[0] === a2.address ? a2 : a3).castVote(1, 1);
    await escrow.connect(panel[1] === a1.address ? a1 : panel[1] === a2.address ? a2 : a3).castVote(1, 1);
    await escrow.connect(panel[2] === a1.address ? a1 : panel[2] === a2.address ? a2 : a3).castVote(1, 1);
    const p = await escrow.getProject(1);
    expect(p.state).to.equal(6);
    expect(p.freelancerVotes).to.equal(3);
  });
});
