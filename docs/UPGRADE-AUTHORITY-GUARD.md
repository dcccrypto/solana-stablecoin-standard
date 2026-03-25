# SSS-150: BPF Upgrade Authority Guard

> **Audit finding H-1 (no on-chain upgrade timelock)** — Solana's BPF loader does not enforce a timelock on program upgrades. The SSS admin timelock applies only to `admin` instructions — it does **not** block a BPF program replacement once a multisig threshold is reached. This document describes the SSS-150 mitigations.

---

## Overview

Before accepting real TVL, the `sss_token` and `sss_transfer_hook` program upgrade authorities **must** be transferred from the deployer keypair to a Squads v4 multisig. A single compromised deployer key gives an attacker full program replacement capability.

SSS-150 ships three deliverables that harden this surface:

| Deliverable | Purpose |
|---|---|
| `scripts/transfer-upgrade-authority.ts` | Automates authority transfer with on-chain validation and dry-run support |
| `set_upgrade_authority_guard` instruction | Records expected upgrade authority in config PDA — irreversible |
| `verify_upgrade_authority` instruction | Asserts current authority matches recorded guard — callable by anyone |

---

## Instruction Reference

### `set_upgrade_authority_guard(upgrade_authority: Pubkey)`

Records the expected BPF upgrade authority in the `StablecoinConfig` PDA. **Irreversible** — cannot be updated once set.

**Prerequisites:**
- `FLAG_SQUADS_AUTHORITY` must be set (call `init_squads_authority` first)
- `upgrade_authority` must equal `config.squads_multisig`
- Must be signed by the current `config.authority`

**Emits:** `UpgradeAuthorityGuardSet { mint, expected_upgrade_authority, slot }`

**Errors:**

| Error | Cause |
|---|---|
| `UpgradeAuthorityGuardAlreadySet` | Guard already recorded — cannot overwrite |
| `UpgradeAuthorityGuardInvalidKey` | Supplied key ≠ `config.squads_multisig`, or is `Pubkey::default()` |
| `Unauthorized` | Signer is not `config.authority`, or `FLAG_SQUADS_AUTHORITY` not set |

---

### `verify_upgrade_authority(current_upgrade_authority: Pubkey)`

Asserts that the supplied key matches the recorded guard. **No signer required** — intended for CI pipelines, deployment scripts, and monitoring.

**Emits:** `UpgradeAuthorityVerified { mint, expected_upgrade_authority, slot }`

**Errors:**

| Error | Cause |
|---|---|
| `UpgradeAuthorityGuardNotSet` | Guard has not been set — call `set_upgrade_authority_guard` first |
| `UpgradeAuthorityMismatch` | BPF upgrade authority has drifted from the recorded guard |

---

## Setup Runbook

### Step 1: Create Squads v4 Upgrade Multisig

Create a **dedicated upgrade multisig** (separate from the operational multisig):

1. Use [Squads v4 app](https://v4.squads.so) or Squads CLI
2. Set threshold at 4-of-5 or 5-of-5 for upgrade vault members
3. **Set Squads execution delay ≥ 7 days (604 800 seconds)** for upgrade proposals — this is the primary timelock mitigation for the BPF loader limitation

### Step 2: Transfer BPF Upgrade Authority

```bash
# Dry-run first (no on-chain writes)
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <SSS_TOKEN_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair <DEPLOYER_KEYPAIR.json> \
  --cluster mainnet-beta \
  --dry-run

# Live transfer
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <SSS_TOKEN_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair <DEPLOYER_KEYPAIR.json> \
  --cluster mainnet-beta

# Repeat for transfer hook program
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <SSS_TRANSFER_HOOK_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair <DEPLOYER_KEYPAIR.json> \
  --cluster mainnet-beta
```

The script:
1. Verifies the Squads multisig PDA exists on-chain
2. Reads the current upgrade authority via `solana program show`
3. Prompts for confirmation
4. Calls `solana program set-upgrade-authority`
5. Verifies the transfer succeeded by re-reading the program account

### Step 3: Configure Squads Authority on SSS Program

```bash
# Call init_squads_authority (sets FLAG_SQUADS_AUTHORITY in config)
# This is a prerequisite for set_upgrade_authority_guard
```

See [SSS-4 Institutional Preset](SSS-4-INSTITUTIONAL.md) for full Squads configuration.

### Step 4: Record the On-Chain Guard

```typescript
// Call set_upgrade_authority_guard — authority must sign
// upgrade_authority must equal config.squads_multisig
await program.methods
  .setUpgradeAuthorityGuard(new PublicKey("<SQUADS_MULTISIG_PUBKEY>"))
  .accounts({ authority: wallet.publicKey, config: configPda })
  .rpc();
```

Once set, `config.expected_upgrade_authority` is immutable.

### Step 5: Verify

```typescript
// Verify on-chain — no signer needed
await program.methods
  .verifyUpgradeAuthority(new PublicKey("<CURRENT_BPF_UPGRADE_AUTHORITY>"))
  .accounts({ config: configPda })
  .rpc();

// Returns Ok(()) → guard matches
// Returns UpgradeAuthorityMismatch → drift detected — investigate immediately
```

---

## Monitoring

Set up continuous monitoring against drift:

```typescript
// Poll every epoch (or every block for high-security deployments)
async function checkUpgradeAuthority(configPda: PublicKey, connection: Connection) {
  const currentAuthority = await getBpfUpgradeAuthority(connection, programId);
  try {
    await program.methods
      .verifyUpgradeAuthority(currentAuthority)
      .accounts({ config: configPda })
      .simulate();
    // OK — no drift
  } catch (e) {
    if (e.toString().includes("UpgradeAuthorityMismatch")) {
      alert("🚨 CRITICAL: BPF upgrade authority has drifted from guard!");
    }
  }
}
```

Also alert on-chain on any `UpgradeAuthorityGuardSet` event not initiated by your deployment pipeline.

---

## State Change

`StablecoinConfig` gains one new field (SSS-150):

```rust
pub expected_upgrade_authority: Pubkey,  // default: Pubkey::default() (zero)
```

No migration required — new accounts initialize this field to `Pubkey::default()`. The guard is `unset` until `set_upgrade_authority_guard` is called.

---

## Security Properties

| Property | Details |
|---|---|
| **Irreversibility** | Guard cannot be cleared or updated — prevents an attacker who compromises the authority key from removing monitoring |
| **Guard = Squads only** | `upgrade_authority` must equal `config.squads_multisig` — prevents setting a guard to an unrelated key |
| **No authority for verify** | `verify_upgrade_authority` is permissionless — anyone can assert the guard from CI, scripts, or on-chain CPI |
| **Drift detection** | `UpgradeAuthorityMismatch` surfaces any unauthorized key rotation before an upgrade can be deployed |

---

## MAINNET-CHECKLIST.md Requirements (BLOCKING)

The following items in [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md) are **BLOCKING** and must be checked off before mainnet launch:

- [ ] `sss_token` upgrade authority → Squads multisig (`transfer-upgrade-authority.ts`)
- [ ] `sss_transfer_hook` upgrade authority → Squads multisig
- [ ] Deployer keypair upgrade authority revoked
- [ ] Squads execution delay ≥ 7 days (604 800 s) for upgrade vault
- [ ] `set_upgrade_authority_guard` called — guard recorded in config PDA
- [ ] `verify_upgrade_authority` passes for both programs post-deploy

---

## Immutability Recommendation

For regulated issuers (e.g. MiCA e-money token, payment token, SSS-4), consider making the program **immutable** at mainnet launch:

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

This eliminates upgrade risk entirely at the cost of requiring a program migration if critical bugs are found. Document this decision explicitly in your issuer disclosures and [TRUST-MODEL.md](TRUST-MODEL.md).

---

## Related

- [DEPLOYMENT-GUIDE.md § 6](DEPLOYMENT-GUIDE.md#6-program-upgrade-authority-transfer-to-dao-multisig) — full deployment runbook
- [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md) — BLOCKING checklist items
- [SSS-4 Institutional Preset](SSS-4-INSTITUTIONAL.md) — Squads multisig configuration
- [TRUST-MODEL.md](TRUST-MODEL.md) — upgrade authority in the trust model
- [on-chain-sdk-admin-timelock.md](on-chain-sdk-admin-timelock.md) — admin instruction timelock (separate from BPF upgrade)
- `scripts/transfer-upgrade-authority.ts` — automated transfer script
