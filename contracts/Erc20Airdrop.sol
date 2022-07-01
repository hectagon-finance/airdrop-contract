// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract Erc20Airdrop is Ownable, Pausable {
    using SafeERC20 for IERC20;

    /* ======== STATE VARIABLES ======== */
    using Counters for Counters.Counter;
    Counters.Counter private _campaignIdCounter;

    struct Campaign {
        IERC20 token;
        uint256 redeemableAt;
        bool paused;
        bytes32 merkleRoot;
        uint256 redeemedAmount;
        string uri;
    }

    mapping(uint256 => Campaign) public campaigns;

    /// @notice Mapping of addresses who have claimed tokens from campaign
    mapping(uint256 => mapping(address => uint256[])) public rewards;

    address public constant BNB = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    modifier hasCampaign(uint256 _id) {
        require(_id < _campaignIdCounter.current(), "Campaign does not exist");
        _;
    }

    modifier whenCampaignUnpaused(uint256 _id) {
        require(!campaigns[_id].paused, "Campaign is not active");
        _;
    }

    function hasClaimed(uint256 _campaignId, address _to, uint256 _rewardId) public view returns (bool exist_) {
        uint256[] memory userRewards = rewards[_campaignId][_to];

        for(uint i = 0; i < userRewards.length; i++) {
            if(userRewards[i] == _rewardId) exist_ = true;
        }

        return exist_;
    }

    function verify(uint256 _campaignId, address _to) public view returns(bool) {
        if(rewards[_campaignId][_to].length > 0) return true;
        return false;
    }

    function createCampaign(
        IERC20 _token,
        uint256 _redeemableAt,
        bytes32 _merkleRoot,
        string memory _uri
    ) external onlyOwner returns (uint256 campaignId_) {
        campaignId_ = _campaignIdCounter.current();

        _campaignIdCounter.increment();
        Campaign storage newCampaign = campaigns[campaignId_];
        newCampaign.token = _token;
        newCampaign.redeemableAt = _redeemableAt;
        newCampaign.paused = false;
        newCampaign.merkleRoot = _merkleRoot;
        newCampaign.uri = _uri;
    }

    function updateCampain(
        uint256 _campaignId, 
        IERC20 _token, 
        uint256 _redeemableAt, 
        bool _paused, 
        bytes32 _merkleRoot, 
        string memory _uri
    ) public onlyOwner hasCampaign(_campaignId) {
        Campaign storage campaign = campaigns[_campaignId];
        campaign.token = _token;
        campaign.redeemableAt = _redeemableAt;
        campaign.paused = _paused;
        campaign.merkleRoot = _merkleRoot;
        campaign.uri = _uri;
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

    function redeem(
        uint256 _campaignId,
        address _to,
        uint256 _amount,
        uint256 _rewardId,
        bytes32[] calldata _proof
    ) external whenNotPaused whenCampaignUnpaused(_campaignId) {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.redeemableAt < block.timestamp, "campaign is not started yet");

        require(!hasClaimed(_campaignId, _to, _rewardId), "already claimed");

        // Verify merkle proof, or revert if not in tree
        bytes32 leaf = keccak256(abi.encodePacked(_to, _rewardId, _amount));
        bool isValidLeaf = MerkleProof.verify(_proof, campaign.merkleRoot, leaf);
        require(isValidLeaf, "leaf not in merkle tree");
        campaign.redeemedAmount += _amount;
        // Set address to claimed
        rewards[_campaignId][_to].push(_rewardId);

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
