import keccak256 from "keccak256"; // Keccak256 hashing
import MerkleTree from "merkletreejs"; // MerkleTree.js
import { solidityKeccak256 } from "ethers/lib/utils"; // Ethers utils

export type MerkleTreeData = { root: string; tree: MerkleTree };

export type Reward = { address: string; rewardId: string; value: string };

export default class Generator {
    // Airdrop recipients
    rewards: Reward[] = [];

    /**
     * Setup generator
     * @param {number} decimals of token
     * @param {Record<string, number>} airdrop address to token claim mapping
     */
    constructor(_rewards: Reward[]) {
        // For each airdrop entry
        this.rewards = _rewards;
    }

    /**
     * Generate Merkle Tree leaf from address and value
     * @param {string} address of airdrop claimee
     * @param {string} value of airdrop tokens to claimee
     * @returns {Buffer} Merkle Tree node
     */
    generateLeaf(address: string, rewardId: string, value: string): Buffer {
        return Buffer.from(
            // Hash in appropriate Merkle format
            solidityKeccak256(["address", "uint256", "uint256"], [address, rewardId, value]).slice(
                2
            ),
            "hex"
        );
    }

    async process(): Promise<{ root: string; tree: MerkleTree }> {
        // Generate merkle tree
        const merkleTree = new MerkleTree(
            // Generate leafs
            this.rewards.map(({ address, rewardId, value }) =>
                this.generateLeaf(address, rewardId, value)
            ),
            // Hashing function
            keccak256,
            { sortPairs: true }
        );

        // Collect and log merkle root
        const merkleRoot: string = merkleTree.getHexRoot();

        // Collect and save merkle tree + root
        return {
            root: merkleRoot,
            tree: merkleTree,
        };
    }
}
