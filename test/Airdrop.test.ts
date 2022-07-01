/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { utils } from "ethers";
import { getAddress, parseUnits } from "ethers/lib/utils";
import { ethers, network, waffle } from "hardhat";
import { MockERC20, MockERC20__factory, Erc20Airdrop, Erc20Airdrop__factory } from "../typechain";
import Generator, { MerkleTreeData, Reward } from "./generator"; // Generator
import { generateLeaf } from "./utils";

describe("Erc20Airdrop", () => {
    const decimals = 18;

    let owner: SignerWithAddress;
    let other: SignerWithAddress;
    let guest: SignerWithAddress;
    let fakeToken: SignerWithAddress;
    let busdFake: MockERC20;
    let airdrop: Erc20Airdrop;
    let merkleTreeData: MerkleTreeData;
    let generator: Generator;
    const provider = waffle.provider;

    const BUSD_NAME = "busdERC20";
    const BUSD_SYMBOL = "BUSD";
    const BUSD_INITIAL_MINT = ethers.utils.parseEther("100");
    const BNB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    const BNB_AMOUNT = ethers.utils.parseEther("1");

    const ownerAmount = 10;
    const otherAmount = 100;

    const ownerRewardId = "1";
    const otherRewardId = "2";

    const otherFormatedAmount = utils.parseEther(otherAmount.toString());

    const campaignUri = "http://";

    beforeEach(async () => {
        [owner, other, guest, fakeToken] = await ethers.getSigners();

        const airdropData: Reward[] = [];
        airdropData.push({
            address: owner.address,
            rewardId: ownerRewardId,
            value: parseUnits(ownerAmount.toString(), decimals).toString(),
        });
        airdropData.push({
            address: other.address,
            rewardId: otherRewardId,
            value: parseUnits(otherAmount.toString(), decimals).toString(),
        });
        generator = new Generator(airdropData);
        merkleTreeData = await generator.process();
        busdFake = await new MockERC20__factory(owner).deploy(BUSD_NAME, BUSD_SYMBOL);
        await busdFake.mint(owner.address, BUSD_INITIAL_MINT);

        airdrop = await new Erc20Airdrop__factory(owner).deploy();
    });

    describe("createCampaign & updateCampaign", () => {
        it("only done By Owner", () => {
            const now = Date.now();
            expect(
                airdrop
                    .connect(other)
                    .createCampaign(busdFake.address, now, merkleTreeData.root, campaignUri)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should create correctlly", async () => {
            const now = Date.now();
            const createCampaignTx = await airdrop.createCampaign(
                busdFake.address,
                now,
                merkleTreeData.root,
                campaignUri
            );
            await createCampaignTx.wait();

            const campaign = await airdrop.campaigns(0);
            expect(campaign.token).to.be.eq(busdFake.address);
            expect(campaign.redeemableAt).to.be.eq(now);
            expect(campaign.paused).to.be.eq(false);
            expect(campaign.merkleRoot).to.be.eq(merkleTreeData.root, campaignUri);
            expect(createCampaignTx.value).to.be.eq("0");
        });

        it("should update exist campaign by only owner", async () => {
            const now = Date.now();
            const createCampaignTx = await airdrop.createCampaign(
                busdFake.address,
                now,
                merkleTreeData.root,
                campaignUri
            );
            await createCampaignTx.wait();
            const newRedeemableAt = Date.now() + 1000;
            const newCampaignUri = "https://";
            const newPaused = true;

            const updateCampaignTx = await airdrop.updateCampain(
                "0",
                fakeToken.address,
                newRedeemableAt,
                newPaused,
                merkleTreeData.root,
                newCampaignUri
            );
            await updateCampaignTx.wait();

            const campaign = await airdrop.campaigns(0);
            expect(campaign.token).to.be.eq(fakeToken.address);
            expect(campaign.redeemableAt).to.be.eq(newRedeemableAt);
            expect(campaign.paused).to.be.eq(newPaused);
            expect(campaign.merkleRoot).to.be.eq(merkleTreeData.root, newCampaignUri);

            expect(
                airdrop
                    .connect(other)
                    .updateCampain(
                        "0",
                        fakeToken.address,
                        newRedeemableAt,
                        newPaused,
                        merkleTreeData.root,
                        newCampaignUri
                    )
            ).to.be.revertedWith("Ownable: caller is not the owner");

            expect(
                airdrop.updateCampain(
                    "1",
                    fakeToken.address,
                    newRedeemableAt,
                    newPaused,
                    merkleTreeData.root,
                    newCampaignUri
                )
            ).to.be.revertedWith("Campaign does not exist");
        });
    });

    describe("getCurrentCounter", () => {
        beforeEach(async () => {
            const now = Date.now();
            await airdrop.createCampaign(busdFake.address, now, merkleTreeData.root, campaignUri);
        });

        it("should be correctlly", async () => {
            expect((await airdrop.getCurrentCounter()).toNumber()).to.be.eq(1);
        });
    });

    describe("withdraw", () => {
        beforeEach(async () => {
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            await owner.sendTransaction({
                to: airdrop.address,
                value: BNB_AMOUNT, // Sends exactly 100 ethers
            });
        });

        it("only done By Owner", async () => {
            await expect(
                airdrop.connect(other).withdraw(busdFake.address, BUSD_INITIAL_MINT)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should be done correctlly", async () => {
            await expect(await busdFake.balanceOf(owner.address)).to.be.eq(0);

            await airdrop.withdraw(busdFake.address, BUSD_INITIAL_MINT);
            await expect(await busdFake.balanceOf(owner.address)).to.be.eq(BUSD_INITIAL_MINT);

            const bnbBalanceBefore = await provider.getBalance(owner.address);
            const withdraw = await airdrop.withdraw(BNB, BNB_AMOUNT);
            const withdrawTx = await withdraw.wait();
            const gasUsed = withdrawTx.cumulativeGasUsed.mul(withdrawTx.effectiveGasPrice);
            await expect(await provider.getBalance(owner.address)).to.be.eq(
                bnbBalanceBefore.add(BNB_AMOUNT).sub(gasUsed)
            );
            await expect(airdrop.withdraw(BNB, "0")).to.be.revertedWith("Invalid withdraw amount");
        });
    });

    describe("pause and unpause", () => {
        it("should work", async () => {
            await airdrop.pause();
            await expect(await airdrop.paused()).to.be.eq(true);
            await airdrop.unpause();
            await expect(await airdrop.paused()).to.be.eq(false);
        });
    });

    describe("redeem", () => {
        const now = Date.now();
        const redeemableAt = now;

        beforeEach(async () => {
            await airdrop.createCampaign(
                busdFake.address,
                redeemableAt,
                merkleTreeData.root,
                campaignUri
            );
        });

        it("can not redeem when paused", async () => {
            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await airdrop.pause();
            await expect(
                airdrop
                    .connect(other)
                    .redeem(0, other.address, otherFormatedAmount, otherRewardId, proof)
            ).to.be.revertedWith("Pausable: paused");
        });

        it("only redeem when campaign not pause", async () => {
            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            const campaign = await airdrop.campaigns(0);

            const updateCampaignTx = await airdrop.updateCampain(
                "0",
                campaign.token,
                campaign.redeemableAt,
                true,
                campaign.merkleRoot,
                campaign.uri
            );
            await updateCampaignTx.wait();

            await expect(
                airdrop
                    .connect(other)
                    .redeem(0, other.address, otherFormatedAmount, otherRewardId, proof)
            ).to.be.revertedWith("Campaign is not active");
        });

        it("only redeem when campaign is running: redeem before start time", async () => {
            // airdrop.connect(guest).redeem(0);
            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt - 100]);
            await network.provider.send("evm_mine");
            await expect(
                airdrop
                    .connect(other)
                    .redeem(0, other.address, otherRewardId, otherFormatedAmount, proof)
            ).to.be.revertedWith("campaign is not started yet");
        });

        it("cannot reddem with invalid proof", async () => {
            const leaf: Buffer = generateLeaf(
                guest.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            // first stage
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 100]);
            await network.provider.send("evm_mine");
            expect(
                airdrop
                    .connect(other)
                    .redeem(0, guest.address, otherFormatedAmount, otherRewardId, proof)
            ).to.be.revertedWith("leaf not in merkle tree");
        });

        it("cannot claim twice for one campaign one reward", async () => {
            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            // first stage
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 200]);
            await network.provider.send("evm_mine");
            await airdrop
                .connect(other)
                .redeem(0, other.address, otherFormatedAmount, otherRewardId, proof);

            await expect(
                airdrop
                    .connect(other)
                    .redeem(0, other.address, otherFormatedAmount, otherRewardId, proof)
            ).to.be.revertedWith("already claimed");
        });

        it("user can claim correctlly", async () => {
            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            await airdrop
                .connect(other)
                .redeem(0, other.address, otherFormatedAmount, otherRewardId, proof);

            const [campaign, hasClaimed, verify, verifyNotExistCampaign] = await Promise.all([
                airdrop.campaigns(0),
                airdrop.hasClaimed(0, other.address, otherRewardId),
                airdrop.verify(0, other.address),
                airdrop.verify(1, other.address),
            ]);
            expect(campaign.redeemedAmount).to.be.eq(otherFormatedAmount);
            expect(hasClaimed).to.be.eq(true);
            expect(verify).to.be.eq(true);
            expect(verifyNotExistCampaign).to.be.eq(false);
        });

        it("user can claim with BNB campaign", async () => {
            await owner.sendTransaction({
                to: airdrop.address,
                value: ethers.utils.parseEther("100"), // Sends exactly 100 ethers
            });

            await airdrop.createCampaign(BNB, now, merkleTreeData.root, campaignUri);

            const leaf: Buffer = generateLeaf(
                other.address,
                otherRewardId,
                otherFormatedAmount.toString()
            );
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);

            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 500]);
            await network.provider.send("evm_mine");
            const otherETHBalanceBefore = await provider.getBalance(other.address);
            await airdrop.redeem(1, other.address, otherFormatedAmount, otherRewardId, proof);

            const otherETHBalanceAfter = await provider.getBalance(other.address);

            expect(otherETHBalanceAfter).to.be.eq(otherETHBalanceBefore.add(otherFormatedAmount));
        });
    });
});
