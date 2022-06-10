import { ethers } from "hardhat";

export function generateLeaf(address: string, rewardId: string, value: string): Buffer {
    return Buffer.from(
        // Hash in appropriate Merkle format
        ethers.utils
            .solidityKeccak256(["address", "uint256", "uint256"], [address, rewardId, value])
            .slice(2),
        "hex"
    );
}
