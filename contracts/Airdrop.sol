// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract Airdrop is Ownable, Pausable {
    using SafeERC20 for IERC20;

    /* ======== STATE VARIABLES ======== */
    using Counters for Counters.Counter;
    Counters.Counter private _campaignIdCounter;

    struct Campaign {
        IERC20 token;
        uint256 redeemableAt;
        bool isActive;
        bytes32 merkleRoot;
        uint256 redeemedAmount;
    }

    mapping(uint256 => Campaign) public campaigns;

    /// @notice Mapping of addresses who have claimed tokens from campaign
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public hasClaimed;

    address public constant BNB = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function createCampaign(
        IERC20 _token,
        uint256 _redeemableAt,
        bytes32 _merkleRoot
    ) external onlyOwner {
        uint256 campaignId = _campaignIdCounter.current();

        _campaignIdCounter.increment();
        Campaign storage newCampaign = campaigns[campaignId];
        newCampaign.token = _token;
        newCampaign.redeemableAt = _redeemableAt;
        newCampaign.isActive = true;
        newCampaign.merkleRoot = _merkleRoot;
    }

    function activeCampaign(uint256 _id) external onlyOwner {
        campaigns[_id].isActive = true;
    }

    function deactiveCampaign(uint256 _id) external onlyOwner {
        campaigns[_id].isActive = false;
    }

    function getCurrentCounter() public view returns (uint256) {
        return _campaignIdCounter.current();
    }

    function withdraw(IERC20 _quoteToken, uint256 _amount) external onlyOwner {
        require(_amount > 0, "Invalid withdraw amount");
        if (address(_quoteToken) != BNB) {
            _quoteToken.safeTransfer(msg.sender, _amount);
        } else {
            payable(msg.sender).transfer(_amount);
        }
    }

    function batchWithdraw(IERC20[] calldata _quoteTokens, uint256[] calldata _amounts) external onlyOwner {
        require(_quoteTokens.length == _amounts.length, "_quoteTokens length and _amount length mismatch");

        for (uint256 i = 0; i < _quoteTokens.length; i++) {
            if (address(_quoteTokens[i]) != BNB) {
                _quoteTokens[i].safeTransfer(msg.sender, _amounts[i]);
            } else {
                payable(msg.sender).transfer(_amounts[i]);
            }
        }
    }

    function redeem(
        uint256 _campaignId,
        address _to,
        uint256 _amount,
        uint256 _rewardId,
        bytes32[] calldata _proof
    ) external whenNotPaused {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.isActive, "campaign is not activated");
        require(campaign.redeemableAt < block.timestamp, "campaign is not started yet");
        require(!hasClaimed[_campaignId][_to][_rewardId], "already claimed");

        // Verify merkle proof, or revert if not in tree
        bytes32 leaf = keccak256(abi.encodePacked(_to, _amount, _rewardId));
        bool isValidLeaf = MerkleProof.verify(_proof, campaign.merkleRoot, leaf);
        require(isValidLeaf, "leaf not in merkle tree");
        campaign.redeemedAmount += _amount;
        // Set address to claimed
        hasClaimed[_campaignId][_to][_rewardId] = true;

        if (address(campaign.token) != BNB) {
            campaign.token.safeTransfer(_to, _amount);
        } else {
            payable(_to).transfer(_amount);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
