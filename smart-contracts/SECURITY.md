# TrustEscrow+ Security Testing and Development Notes

## 1. Unauthorized Voting

The `castVote()` function checks that the caller is one of the arbiters assigned to the dispute panel.

```solidity
require(assigned, "Not assigned as arbiter");