/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { utils } from "ethers";
import { ethers, network, waffle } from "hardhat";
import { MockERC20, MockERC20__factory, Airdrop, Airdrop__factory } from "../typechain";
import Generator, { MerkleTreeData } from "./generator"; // Generator
import { generateLeaf } from "./utils";

describe("Airdrop", () => {
    const decimals = 18;

    let owner: SignerWithAddress;
    let other: SignerWithAddress;
    let guest: SignerWithAddress;
    let busdFake: MockERC20;
    let airdrop: Airdrop;
    let merkleTreeData: MerkleTreeData;
    let generator: Generator;
    const provider = waffle.provider;

    const BUSD_NAME = "busdERC20";
    const BUSD_SYMBOL = "BUSD";
    const BUSD_INITIAL_MINT = ethers.utils.parseEther("10000");
    const BNB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    const ownerAmount = 10;
    const otherAmount = 100;

    const otherFormatedAmount = utils.parseEther(otherAmount.toString());

    beforeEach(async () => {
        [owner, other, guest] = await ethers.getSigners();

        const airdropData: { [key: string]: number } = {};
        airdropData[owner.address] = ownerAmount;
        airdropData[other.address] = otherAmount;
        generator = new Generator(decimals, airdropData);
        merkleTreeData = await generator.process();
        busdFake = await new MockERC20__factory(owner).deploy(BUSD_NAME, BUSD_SYMBOL);
        await busdFake.mint(owner.address, BUSD_INITIAL_MINT);

        airdrop = await new Airdrop__factory(owner).deploy();
    });

    describe("createCampaign", () => {
        it("only done By Owner", () => {
            const now = Date.now();
            expect(
                airdrop.connect(other).createCampaign(busdFake.address, now, merkleTreeData.root)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should create correctlly", async () => {
            const now = Date.now();
            await airdrop.createCampaign(busdFake.address, now, merkleTreeData.root);
            const campaign = await airdrop.campaigns(0);

            expect(campaign.token).to.be.eq(busdFake.address);
            expect(campaign.redeemableAt).to.be.eq(now);
            expect(campaign.isActive).to.be.eq(true);
            expect(campaign.merkleRoot).to.be.eq(merkleTreeData.root);
        });
    });

    describe("activeCampaign and deactiveCampaign", () => {
        beforeEach(async () => {
            const now = Date.now();
            await airdrop.createCampaign(busdFake.address, now, merkleTreeData.root);
        });

        it("only done By Owner", () => {
            expect(airdrop.connect(other).deactiveCampaign(0)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should be correctlly", async () => {
            await airdrop.deactiveCampaign(0);
            let campaign;
            campaign = await airdrop.campaigns(0);
            await expect(campaign.isActive).to.be.eq(false);
            await airdrop.activeCampaign(0);
            campaign = await airdrop.campaigns(0);
            await expect(campaign.isActive).to.be.eq(true);
        });
    });

    describe("getCurrentCounter", () => {
        beforeEach(async () => {
            const now = Date.now();
            await airdrop.createCampaign(busdFake.address, now, merkleTreeData.root);
        });

        it("should be correctlly", async () => {
            expect((await airdrop.getCurrentCounter()).toNumber()).to.be.eq(1);
        });
    });

    describe("withdraw and batchWithdraw", () => {
        beforeEach(async () => {
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            await owner.sendTransaction({
                to: airdrop.address,
                value: ethers.utils.parseEther("100"), // Sends exactly 100 ethers
            });
        });

        it("only done By Owner", async () => {
            await expect(
                airdrop.connect(other).withdraw(busdFake.address, BUSD_INITIAL_MINT.div(2))
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                airdrop.connect(other).batchWithdraw([busdFake.address], [BUSD_INITIAL_MINT.div(2)])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should be done correctlly", async () => {
            await expect(await busdFake.balanceOf(owner.address)).to.be.eq(0);
            await airdrop.withdraw(busdFake.address, BUSD_INITIAL_MINT.div(2));
            await expect(await busdFake.balanceOf(owner.address)).to.be.eq(
                BUSD_INITIAL_MINT.div(2)
            );
            await airdrop.withdraw(BNB, ethers.utils.parseEther("50"));
            await airdrop.batchWithdraw(
                [busdFake.address, BNB],
                [BUSD_INITIAL_MINT.div(2), ethers.utils.parseEther("50")]
            );
            await expect(await busdFake.balanceOf(owner.address)).to.be.eq(BUSD_INITIAL_MINT);
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
            await airdrop.createCampaign(busdFake.address, redeemableAt, merkleTreeData.root);
        });

        it("can not redeem when paused", async () => {
            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await airdrop.pause();
            await expect(
                airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof)
            ).to.be.revertedWith("Pausable: paused");
        });

        it("only redeem when campaign is active", async () => {
            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await airdrop.deactiveCampaign(0);
            await expect(
                airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof)
            ).to.be.revertedWith("campaign is not activated");
        });

        it("only redeem when campaign is running: redeem before start time", async () => {
            // airdrop.connect(guest).redeem(0);
            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt - 100]);
            await network.provider.send("evm_mine");
            await expect(
                airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof)
            ).to.be.revertedWith("campaign is not started yet");
        });

        it("cannot reddem with invalid proof", async () => {
            const leaf: Buffer = generateLeaf(guest.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            // first stage
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 100]);
            await network.provider.send("evm_mine");
            expect(
                airdrop.connect(other).redeem(0, guest.address, otherFormatedAmount, proof)
            ).to.be.revertedWith("Not In Merkle");
        });

        it("cannot claim twice for one campaign", async () => {
            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            // first stage
            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 200]);
            await network.provider.send("evm_mine");
            await airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof);

            await expect(
                airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof)
            ).to.be.revertedWith("already claimed");
        });

        it("user can claim correctlly", async () => {
            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);
            await busdFake.transfer(airdrop.address, BUSD_INITIAL_MINT);
            await airdrop.connect(other).redeem(0, other.address, otherFormatedAmount, proof);
            const [campaign, hasClaimed] = await Promise.all([
                airdrop.campaigns(0),
                airdrop.hasClaimed(0, other.address),
            ]);
            expect(campaign.redeemedAmount).to.be.eq(otherFormatedAmount);
            expect(hasClaimed).to.be.eq(true);
        });

        it("user can claim with BNB campaign", async () => {
            await owner.sendTransaction({
                to: airdrop.address,
                value: ethers.utils.parseEther("100"), // Sends exactly 100 ethers
            });

            await airdrop.createCampaign(BNB, now, merkleTreeData.root);

            const leaf: Buffer = generateLeaf(other.address, otherFormatedAmount.toString());
            // Generate airdrop proof
            const proof: string[] = merkleTreeData.tree.getHexProof(leaf);

            await network.provider.send("evm_setNextBlockTimestamp", [redeemableAt + 500]);
            await network.provider.send("evm_mine");
            const otherETHBalanceBefore = await provider.getBalance(other.address);
            await airdrop.redeem(1, other.address, otherFormatedAmount, proof);

            const otherETHBalanceAfter = await provider.getBalance(other.address);

            expect(otherETHBalanceAfter).to.be.eq(otherETHBalanceBefore.add(otherFormatedAmount));
        });
    });
});
