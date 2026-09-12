import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TrustEscrowModule = buildModule(
  "TrustEscrowModule",
  (m) => {
    const trustEscrow = m.contract(
      "TrustEscrow"
    );

    return {
      trustEscrow
    };
  }
);

export default TrustEscrowModule;