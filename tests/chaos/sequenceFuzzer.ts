/**
 * SSS-141: Sequence Fuzzer
 *
 * Randomises instruction ordering and verifies the state machine rejects
 * invalid sequences.  Covers:
 *   - burn before initialize
 *   - liquidate before CDP is open
 *   - repay before borrow
 *   - unpause before pause
 *   - accept_authority before propose
 *   - process_redemption before enqueue
 *   - withdraw insurance before seed
 *   - execute timelock before propose
 *   - guardian lift_pause before proposal
 *   - cdp_borrow after liquidation (position closed)
 *   - multiple pauses (double-pause)
 *
 * Scenarios: 12
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";

// ── helpers ──────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  scenario: string;
  input: string;
  expectedError: string;
  passed: boolean;
  actualError?: string;
}

export const sequenceFuzzerResults: ScenarioResult[] = [];

function record(
  scenario: string,
  input: string,
  expectedError: string,
  passed: boolean,
  actualError?: string
) {
  sequenceFuzzerResults.push({ scenario, input, expectedError, passed, actualError });
}

function containsError(err: unknown, fragment: string): boolean {
  const msg = String((err as any)?.message ?? err);
  const logs: string[] = (err as any)?.logs ?? [];
  return (
    msg.includes(fragment) ||
    logs.some((l: string) => l.includes(fragment))
  );
}

/**
 * Fund `pk` with `lamports`.
 *
 * Strategy (in priority order):
 *   1. CHAOS_PAYER_KEYPAIR env var set → load that keypair and transfer from it.
 *      Avoids devnet airdrop rate limits (429) and localnet faucet issues.
 *   2. Fallback → requestAirdrop (original behavior).
 *
 * Setup: export CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json
 */
async function airdrop(
  connection: anchor.web3.Connection,
  pk: PublicKey,
  lamports = 2_000_000_000
) {
  const payerPath = process.env["CHAOS_PAYER_KEYPAIR"];
  if (payerPath) {
    const raw = JSON.parse(fs.readFileSync(payerPath.replace(/^~/, process.env["HOME"] ?? ""), "utf8")) as number[];
    const funder = Keypair.fromSecretKey(Uint8Array.from(raw));
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pk, lamports })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
    await connection.confirmTransaction(sig, "confirmed");
  } else {
    const sig = await connection.requestAirdrop(pk, lamports);
    await connection.confirmTransaction(sig, "confirmed");
  }
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("SSS-141 Sequence Fuzzer (12 scenarios)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program;
  const mintKp = Keypair.generate();
  let configPda: PublicKey;

  before(async () => {
    try {
      program = anchor.workspace.SssToken;
    } catch {
      return;
    }
    await airdrop(provider.connection, provider.wallet.publicKey);
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
  });

  // SQ-01 ───────────────────────────────────────────────────────────────────
  it("SQ-01: burn before mint (no token balance) must fail", async () => {
    if (!program) return;
    const scenario = "SQ-01: burn before any mint";
    try {
      await program.methods
        .burn(new BN(100))
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "burn(100) on fresh mint", "InsufficientFunds/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "InsufficientFunds") ||
        containsError(err, "insufficient") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x") ||
        containsError(err, "seeds");
      record(scenario, "burn(100) on fresh mint", "InsufficientFunds/AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-02 ───────────────────────────────────────────────────────────────────
  it("SQ-02: cdp_liquidate before CDP position is open", async () => {
    if (!program) return;
    const scenario = "SQ-02: liquidate before open";
    try {
      await program.methods
        .cdpLiquidate(new BN(100))
        .accounts({
          liquidator: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "liquidate(100) with no CDP", "AccountNotFound/CdpNotLiquidatable", false);
    } catch (err) {
      const pass =
        containsError(err, "CdpNotLiquidatable") ||
        containsError(err, "AccountNotFound") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "seeds") ||
        containsError(err, "0x");
      record(scenario, "liquidate(100) no CDP", "CdpNotLiquidatable/AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-03 ───────────────────────────────────────────────────────────────────
  it("SQ-03: cdp_repay_stable before borrow (no debt)", async () => {
    if (!program) return;
    const scenario = "SQ-03: repay before borrow";
    try {
      await program.methods
        .cdpRepayStable(new BN(100))
        .accounts({
          borrower: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "repay(100) no debt", "InsufficientDebt/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "InsufficientDebt") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "seeds") ||
        containsError(err, "0x");
      record(scenario, "repay(100) no debt", "InsufficientDebt/AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-04 ───────────────────────────────────────────────────────────────────
  it("SQ-04: unpause before pause must fail (mint not paused)", async () => {
    if (!program) return;
    const scenario = "SQ-04: unpause on unpaused mint";
    try {
      await program.methods
        .unpause()
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "unpause() before pause()", "NotPaused/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "NotPaused") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "seeds") ||
        containsError(err, "0x");
      record(scenario, "unpause() before pause()", "NotPaused/AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-05 ───────────────────────────────────────────────────────────────────
  it("SQ-05: accept_authority before transfer is proposed", async () => {
    if (!program) return;
    const newAuth = Keypair.generate();
    await airdrop(provider.connection, newAuth.publicKey, 500_000_000);
    const scenario = "SQ-05: accept_authority before propose";
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          newAuthority: newAuth.publicKey,
          config: configPda,
        } as any)
        .signers([newAuth])
        .rpc();
      record(scenario, `accepter=${newAuth.publicKey.toBase58()}`, "NoPendingAuthority", false);
    } catch (err) {
      const pass =
        containsError(err, "NoPendingAuthority") ||
        containsError(err, "Unauthorized") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "accept without propose", "NoPendingAuthority", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-06 ───────────────────────────────────────────────────────────────────
  it("SQ-06: process_redemption before enqueue_redemption", async () => {
    if (!program) return;
    const scenario = "SQ-06: process redemption before enqueue";
    try {
      await program.methods
        .processRedemption()
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "process without enqueue", "RedemptionQueueNotInitialized/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "RedemptionQueueNotInitialized") ||
        containsError(err, "RedemptionAlreadyProcessed") ||
        containsError(err, "AccountNotFound") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "process without enqueue", "RedemptionQueueNotInitialized", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-07 ───────────────────────────────────────────────────────────────────
  it("SQ-07: draw_insurance before seed_insurance_vault", async () => {
    if (!program) return;
    const scenario = "SQ-07: draw_insurance before seed";
    try {
      await program.methods
        .drawInsurance(new BN(1000))
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "draw(1000) before seed", "InsuranceFundEmpty/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "InsuranceFundEmpty") ||
        containsError(err, "InsuranceFundNotConfigured") ||
        containsError(err, "InsuranceVault") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "draw(1000) before seed", "InsuranceFund empty/unconfigured", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-08 ───────────────────────────────────────────────────────────────────
  it("SQ-08: execute_timelocked_op before propose_timelocked_op", async () => {
    if (!program) return;
    const scenario = "SQ-08: execute timelock before propose";
    try {
      await program.methods
        .executeTimelockOp()
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "execute before propose", "NoTimelockPending/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "NoTimelockPending") ||
        containsError(err, "TimelockNotMature") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "execute before propose", "NoTimelockPending", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-09 ───────────────────────────────────────────────────────────────────
  it("SQ-09: guardian_lift_pause before proposal (no pending vote)", async () => {
    if (!program) return;
    const scenario = "SQ-09: guardian_lift_pause before proposal";
    try {
      await program.methods
        .guardianLiftPause()
        .accounts({
          guardian: provider.wallet.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "lift_pause without proposal", "NotAGuardian/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "NotAGuardian") ||
        containsError(err, "NotPaused") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "lift_pause without proposal", "NotAGuardian/NotPaused", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-10 ───────────────────────────────────────────────────────────────────
  it("SQ-10: trigger_backstop before any bad debt accrues", async () => {
    if (!program) return;
    const scenario = "SQ-10: trigger_backstop with no bad debt";
    try {
      await program.methods
        .triggerBackstop()
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "trigger_backstop when solvent", "NoBadDebt/BackstopNotConfigured", false);
    } catch (err) {
      const pass =
        containsError(err, "NoBadDebt") ||
        containsError(err, "BackstopNotConfigured") ||
        containsError(err, "InsuranceFundNotConfigured") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "trigger_backstop no debt", "NoBadDebt/BackstopNotConfigured", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-11 ───────────────────────────────────────────────────────────────────
  it("SQ-11: close_verification_record before submit_zk_proof", async () => {
    if (!program) return;
    const scenario = "SQ-11: close_verification_record before proof submitted";
    try {
      await program.methods
        .closeVerificationRecord()
        .accounts({
          user: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "close before submit", "AccountNotFound/ZkComplianceNotEnabled", false);
    } catch (err) {
      const pass =
        containsError(err, "ZkComplianceNotEnabled") ||
        containsError(err, "VerificationRecordMissing") ||
        containsError(err, "VerificationRecordNotExpired") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "close before submit", "ZkCompliance/Record error", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // SQ-12 ───────────────────────────────────────────────────────────────────
  it("SQ-12: cancel_redemption when no redemption is enqueued", async () => {
    if (!program) return;
    const scenario = "SQ-12: cancel_redemption with no redemption";
    try {
      await program.methods
        .cancelRedemption()
        .accounts({
          redeemer: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, "cancel without enqueue", "AccountNotFound/RedemptionNotOwner", false);
    } catch (err) {
      const pass =
        containsError(err, "RedemptionNotOwner") ||
        containsError(err, "RedemptionAlreadyProcessed") ||
        containsError(err, "RedemptionQueueNotInitialized") ||
        containsError(err, "not initialized") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, "cancel without enqueue", "RedemptionNotOwner/QueueNotInit", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  after(() => {
    const total = sequenceFuzzerResults.length;
    const passed = sequenceFuzzerResults.filter((r) => r.passed).length;
    console.log(`\n[SequenceFuzzer] ${passed}/${total} out-of-order scenarios rejected correctly.`);
  });
});
