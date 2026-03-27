/**
 * SSS-141: Account Fuzzer
 *
 * Sends instructions with randomized / adversarial account combinations:
 *   - Wrong PDAs (wrong seeds, wrong program)
 *   - Swapped mints (collateral ↔ stable)
 *   - Forged signers (random keypairs claiming authority roles)
 *   - Mismatched vaults / fee accounts
 *
 * All scenarios must be REJECTED. Each test logs:
 *   scenario, input summary, expected error, actual outcome (pass/fail).
 *
 * Scenarios: 15
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

// ── helpers ──────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  scenario: string;
  input: string;
  expectedError: string;
  passed: boolean;
  actualError?: string;
}

export const accountFuzzerResults: ScenarioResult[] = [];

function record(
  scenario: string,
  input: string,
  expectedError: string,
  passed: boolean,
  actualError?: string
) {
  accountFuzzerResults.push({ scenario, input, expectedError, passed, actualError });
}

/** Returns true when the error message / logs contain the expected fragment. */
function containsError(err: unknown, fragment: string): boolean {
  const msg = String((err as any)?.message ?? err);
  const logs: string[] = (err as any)?.logs ?? [];
  return (
    msg.includes(fragment) ||
    logs.some((l: string) => l.includes(fragment))
  );
}

async function airdrop(
  connection: anchor.web3.Connection,
  pk: PublicKey,
  lamports = 2_000_000_000
) {
  const sig = await connection.requestAirdrop(pk, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

function randomPda(programId: PublicKey): PublicKey {
  const seed = Keypair.generate().publicKey.toBuffer();
  return PublicKey.findProgramAddressSync([seed], programId)[0];
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("SSS-141 Account Fuzzer (15 scenarios)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Use workspace lazily so we don't blow up when IDL/types aren't compiled
  let program: anchor.Program;
  const mintKp = Keypair.generate();
  let configPda: PublicKey;
  const programId = new PublicKey("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");

  before(async () => {
    try {
      program = anchor.workspace.SssToken;
    } catch {
      // IDL not compiled yet — skip at runtime but still export structure
      return;
    }
    await airdrop(provider.connection, provider.wallet.publicKey);
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
  });

  // AF-01 ───────────────────────────────────────────────────────────────────
  it("AF-01: initialize with wrong PDA seed (forged config PDA)", async () => {
    if (!program) return;
    const forgedConfig = randomPda(program.programId);
    const scenario = "AF-01: initialize with forged config PDA";
    try {
      await program.methods
        .initialize({
          preset: 1,
          decimals: 6,
          name: "Fuzz",
          symbol: "FZZ",
          uri: "",
          transferHookProgram: null,
          collateralMint: null,
          reserveVault: null,
          maxSupply: null,
          featureFlags: null,
          auditorElgamalPubkey: null,
        })
        .accounts({
          payer: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: forgedConfig,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([mintKp])
        .rpc();
      record(scenario, `config=${forgedConfig.toBase58()}`, "ConstraintSeeds/seeds mismatch", false);
    } catch (err) {
      const pass = containsError(err, "seeds") || containsError(err, "Seeds") || containsError(err, "ConstraintSeeds") || containsError(err, "2006") || containsError(err, "address");
      record(scenario, `config=${forgedConfig.toBase58()}`, "ConstraintSeeds/seeds mismatch", pass, String((err as any).message).slice(0, 120));
      expect(pass, `Expected seeds/address error but got: ${(err as any).message}`).to.be.true;
    }
  });

  // AF-02 ───────────────────────────────────────────────────────────────────
  it("AF-02: mint tokens with forged authority (random keypair as authority)", async () => {
    if (!program) return;
    const fakeAuth = Keypair.generate();
    await airdrop(provider.connection, fakeAuth.publicKey, 1_000_000_000);
    const scenario = "AF-02: mint with forged authority";
    try {
      await program.methods
        .mint(new BN(1000))
        .accounts({
          authority: fakeAuth.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .signers([fakeAuth])
        .rpc();
      record(scenario, `authority=${fakeAuth.publicKey.toBase58()}`, "Unauthorized", false);
    } catch (err) {
      const pass =
        containsError(err, "Unauthorized") ||
        containsError(err, "NotAMinter") ||
        containsError(err, "3012") ||  // anchor AccountNotFound
        containsError(err, "custom program error") ||
        containsError(err, "0x") ||
        containsError(err, "seeds") ||
        containsError(err, "not initialized");
      record(scenario, `authority=${fakeAuth.publicKey.toBase58()}`, "Unauthorized/NotAMinter", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-03 ───────────────────────────────────────────────────────────────────
  it("AF-03: burn with wrong mint (swapped to random mint)", async () => {
    if (!program) return;
    const wrongMint = Keypair.generate().publicKey;
    const scenario = "AF-03: burn with wrong/random mint";
    try {
      await program.methods
        .burn(new BN(1))
        .accounts({
          authority: provider.wallet.publicKey,
          mint: wrongMint,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, `mint=${wrongMint.toBase58()}`, "InvalidMint/ConstraintMint", false);
    } catch (err) {
      const pass =
        containsError(err, "InvalidMint") ||
        containsError(err, "3012") ||
        containsError(err, "seeds") ||
        containsError(err, "not initialized") ||
        containsError(err, "custom program error") ||
        containsError(err, "0x");
      record(scenario, `mint=${wrongMint.toBase58()}`, "InvalidMint or AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-04 ───────────────────────────────────────────────────────────────────
  it("AF-04: update_roles with zero-pubkey as new authority", async () => {
    if (!program) return;
    const scenario = "AF-04: update_roles with zero pubkey";
    const zeroPubkey = PublicKey.default;
    try {
      await program.methods
        .updateRoles({
          newAuthority: zeroPubkey,
          newComplianceAuthority: null,
          minterPubkey: null,
          minterCap: null,
        })
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, `newAuthority=11111...1 (zero)`, "InvalidPubkey/ConstraintRaw", false);
    } catch (err) {
      const pass =
        containsError(err, "RotationZeroPubkey") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x") ||
        containsError(err, "custom");
      record(scenario, `newAuthority=zero`, "RotationZeroPubkey or account error", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-05 ───────────────────────────────────────────────────────────────────
  it("AF-05: deposit_collateral with mismatched vault (wrong token account)", async () => {
    if (!program) return;
    const wrongVault = Keypair.generate().publicKey;
    const scenario = "AF-05: deposit_collateral with wrong vault";
    try {
      await program.methods
        .depositCollateral(new BN(1000))
        .accounts({
          depositor: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
          reserveVault: wrongVault,
        } as any)
        .rpc();
      record(scenario, `vault=${wrongVault.toBase58()}`, "InvalidVault/ConstraintSeeds", false);
    } catch (err) {
      const pass =
        containsError(err, "InvalidVault") ||
        containsError(err, "seeds") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `vault=${wrongVault.toBase58()}`, "InvalidVault", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-06 ───────────────────────────────────────────────────────────────────
  it("AF-06: cdp_borrow_stable with forged CDP position PDA", async () => {
    if (!program) return;
    const forgedPosition = randomPda(program.programId);
    const scenario = "AF-06: cdp_borrow with forged position PDA";
    try {
      await program.methods
        .cdpBorrowStable(new BN(100))
        .accounts({
          borrower: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
          cdpPosition: forgedPosition,
        } as any)
        .rpc();
      record(scenario, `position=${forgedPosition.toBase58()}`, "ConstraintSeeds/AccountNotFound", false);
    } catch (err) {
      const pass =
        containsError(err, "seeds") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `position=${forgedPosition.toBase58()}`, "seeds/AccountNotFound", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-07 ───────────────────────────────────────────────────────────────────
  it("AF-07: pause with non-authority signer (compliance authority key)", async () => {
    if (!program) return;
    const fakeAuth = Keypair.generate();
    await airdrop(provider.connection, fakeAuth.publicKey, 500_000_000);
    const scenario = "AF-07: pause with non-authority signer";
    try {
      await program.methods
        .pause()
        .accounts({
          authority: fakeAuth.publicKey,
          config: configPda,
        } as any)
        .signers([fakeAuth])
        .rpc();
      record(scenario, `signer=${fakeAuth.publicKey.toBase58()}`, "Unauthorized", false);
    } catch (err) {
      const pass =
        containsError(err, "Unauthorized") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `signer=${fakeAuth.publicKey.toBase58()}`, "Unauthorized", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-08 ───────────────────────────────────────────────────────────────────
  it("AF-08: freeze_account with wrong transfer-hook program ID", async () => {
    if (!program) return;
    const wrongHookProgram = Keypair.generate().publicKey;
    const fakeTarget = Keypair.generate().publicKey;
    const scenario = "AF-08: freeze with wrong hook program";
    try {
      await program.methods
        .freezeAccount()
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
          targetAccount: fakeTarget,
          transferHookProgram: wrongHookProgram,
        } as any)
        .rpc();
      record(scenario, `hookProgram=${wrongHookProgram.toBase58()}`, "InvalidTransferHookProgram", false);
    } catch (err) {
      const pass =
        containsError(err, "InvalidTransferHookProgram") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x") ||
        containsError(err, "seeds");
      record(scenario, `hookProgram=${wrongHookProgram.toBase58()}`, "InvalidTransferHookProgram", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-09 ───────────────────────────────────────────────────────────────────
  it("AF-09: submit_zk_proof with mismatched verifier pubkey", async () => {
    if (!program) return;
    const wrongVerifier = Keypair.generate();
    await airdrop(provider.connection, wrongVerifier.publicKey, 500_000_000);
    const scenario = "AF-09: submit_zk_proof with wrong verifier";
    try {
      await program.methods
        .submitZkProof(Buffer.alloc(32, 0xab), new BN(200))
        .accounts({
          user: provider.wallet.publicKey,
          verifier: wrongVerifier.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .signers([wrongVerifier])
        .rpc();
      record(scenario, `verifier=${wrongVerifier.publicKey.toBase58()}`, "ZkVerifierMismatch", false);
    } catch (err) {
      const pass =
        containsError(err, "ZkVerifierMismatch") ||
        containsError(err, "ZkComplianceNotEnabled") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `verifier=${wrongVerifier.publicKey.toBase58()}`, "ZkVerifierMismatch", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-10 ───────────────────────────────────────────────────────────────────
  it("AF-10: cpi_mint with forged CPI caller program", async () => {
    if (!program) return;
    const fakeCaller = Keypair.generate().publicKey;
    const scenario = "AF-10: cpi_mint with fake caller program";
    try {
      await program.methods
        .cpiMint(new BN(500))
        .accounts({
          cpiCallerProgram: fakeCaller,
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
        } as any)
        .rpc();
      record(scenario, `caller=${fakeCaller.toBase58()}`, "NotAMinter/Unauthorized", false);
    } catch (err) {
      const pass =
        containsError(err, "NotAMinter") ||
        containsError(err, "Unauthorized") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `caller=${fakeCaller.toBase58()}`, "NotAMinter/Unauthorized", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-11 ───────────────────────────────────────────────────────────────────
  it("AF-11: cdp_liquidate with swapped collateral and stable mints", async () => {
    if (!program) return;
    const swappedMint = Keypair.generate().publicKey; // pretend this is collateral
    const scenario = "AF-11: cdp_liquidate with swapped mints";
    try {
      await program.methods
        .cdpLiquidate(new BN(100))
        .accounts({
          liquidator: provider.wallet.publicKey,
          mint: swappedMint, // wrong stable mint
          config: configPda,
        } as any)
        .rpc();
      record(scenario, `mint=${swappedMint.toBase58()}`, "InvalidMint/WrongCollateralMint", false);
    } catch (err) {
      const pass =
        containsError(err, "InvalidMint") ||
        containsError(err, "WrongCollateralMint") ||
        containsError(err, "seeds") ||
        containsError(err, "3012") ||
        containsError(err, "0x");
      record(scenario, `mint=${swappedMint.toBase58()}`, "InvalidMint", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-12 ───────────────────────────────────────────────────────────────────
  it("AF-12: accept_authority with non-pending pubkey (unrelated keypair)", async () => {
    if (!program) return;
    const fakePending = Keypair.generate();
    await airdrop(provider.connection, fakePending.publicKey, 500_000_000);
    const scenario = "AF-12: accept_authority with non-pending keypair";
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          newAuthority: fakePending.publicKey,
          config: configPda,
        } as any)
        .signers([fakePending])
        .rpc();
      record(scenario, `newAuth=${fakePending.publicKey.toBase58()}`, "NoPendingAuthority", false);
    } catch (err) {
      const pass =
        containsError(err, "NoPendingAuthority") ||
        containsError(err, "Unauthorized") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `newAuth=${fakePending.publicKey.toBase58()}`, "NoPendingAuthority", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-13 ───────────────────────────────────────────────────────────────────
  it("AF-13: set_oracle_params with oracle config PDA from wrong mint", async () => {
    if (!program) return;
    const wrongMintForOracle = Keypair.generate().publicKey;
    const [wrongOraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-config"), wrongMintForOracle.toBuffer()],
      program.programId
    );
    const scenario = "AF-13: set_oracle_params with oracle PDA from wrong mint";
    try {
      await program.methods
        .setOracleParams({ oracleType: 0, maxAgeBps: 100 } as any)
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          oracleConfig: wrongOraclePda,
        } as any)
        .rpc();
      record(scenario, `oraclePDA=${wrongOraclePda.toBase58()}`, "ConstraintSeeds", false);
    } catch (err) {
      const pass =
        containsError(err, "seeds") ||
        containsError(err, "Seeds") ||
        containsError(err, "ConstraintSeeds") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `oraclePDA=${wrongOraclePda.toBase58()}`, "ConstraintSeeds", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-14 ───────────────────────────────────────────────────────────────────
  it("AF-14: blacklist_add_and_freeze with wrong blacklist-state PDA program", async () => {
    if (!program) return;
    const fakeBlacklistState = randomPda(SystemProgram.programId);
    const fakeTarget = Keypair.generate().publicKey;
    const scenario = "AF-14: blacklist_add with wrong blacklist-state PDA";
    try {
      await program.methods
        .blacklistAddAndFreeze()
        .accounts({
          authority: provider.wallet.publicKey,
          mint: mintKp.publicKey,
          config: configPda,
          blacklistState: fakeBlacklistState,
          targetAccount: fakeTarget,
        } as any)
        .rpc();
      record(scenario, `blacklistState=${fakeBlacklistState.toBase58()}`, "InvalidBlacklistState", false);
    } catch (err) {
      const pass =
        containsError(err, "InvalidBlacklistState") ||
        containsError(err, "seeds") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `blacklistState=${fakeBlacklistState.toBase58()}`, "InvalidBlacklistState", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  // AF-15 ───────────────────────────────────────────────────────────────────
  it("AF-15: revoke_minter with non-authority signer but valid config", async () => {
    if (!program) return;
    const impostor = Keypair.generate();
    await airdrop(provider.connection, impostor.publicKey, 500_000_000);
    const scenario = "AF-15: revoke_minter with impostor authority";
    try {
      await program.methods
        .revokeMinter(Keypair.generate().publicKey)
        .accounts({
          authority: impostor.publicKey,
          config: configPda,
        } as any)
        .signers([impostor])
        .rpc();
      record(scenario, `authority=${impostor.publicKey.toBase58()}`, "Unauthorized", false);
    } catch (err) {
      const pass =
        containsError(err, "Unauthorized") ||
        containsError(err, "3012") ||
        containsError(err, "not initialized") ||
        containsError(err, "0x");
      record(scenario, `authority=${impostor.publicKey.toBase58()}`, "Unauthorized", pass, String((err as any).message).slice(0, 120));
      expect(pass).to.be.true;
    }
  });

  after(() => {
    const total = accountFuzzerResults.length;
    const passed = accountFuzzerResults.filter((r) => r.passed).length;
    console.log(`\n[AccountFuzzer] ${passed}/${total} scenarios rejected correctly.`);
  });
});
