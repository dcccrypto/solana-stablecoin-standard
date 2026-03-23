# SSS Program Upgrade Guide

This document describes the versioned upgrade path introduced in **SSS-122**
and the step-by-step runbook for migrating a live SSS stablecoin deployment to
a new program version.

---

## Overview

SSS programs use a `version: u8` field on every `StablecoinConfig` PDA to
track which state layout the account was written with.  Each time a breaking
state schema change is deployed, `CURRENT_VERSION` is incremented and
`MIN_SUPPORTED_VERSION` is updated accordingly.

Key design constraints:

| Constraint | How SSS-122 satisfies it |
|---|---|
| Token-2022 mint accounts must NOT be re-initialized | `migrate_config` only writes to the `StablecoinConfig` PDA — never the mint |
| Existing CDPs must migrate without user action | CDP positions carry their own layout; config migration does not touch CDP PDAs |
| Authority-gated | Only the config `authority` may call `migrate_config` |
| Idempotent | Calling `migrate_config` on an already-current config is a no-op |

---

## Version History

| Version | Program Change | SSS Task |
|---|---|---|
| 0 | Original layout (no version field; default-zero in memory) | pre-SSS-122 |
| 1 | Added `version: u8` field; SSS-122 state migration machinery | SSS-122 |

---

## Step-by-Step Upgrade Runbook

### Prerequisites

- You have the config authority keypair.
- You have access to the `sss` CLI or a TypeScript script using `@dcccrypto/sss-sdk`.
- The program has already been upgraded via `anchor upgrade` (or Squads multisig).

### 1. Build and deploy the new program

```bash
# From repo root
anchor build

# Deploy via BPF loader upgrade (authority must match program upgrade authority)
anchor upgrade \
  --program-id <YOUR_PROGRAM_ID> \
  --provider.cluster mainnet \
  target/deploy/sss_token.so
```

> **Tip:** Use Squads Protocol if your upgrade authority is a multisig.
> All existing stablecoin configs, CDPs, and ATAs continue to work while the
> program upgrade is in-flight — no downtime for users.

### 2. Run `migrate_config` for each stablecoin

After the program is upgraded, each `StablecoinConfig` account still has
`version == 0`.  Core instructions (`mint`, `burn`, `cdp_borrow_stable`,
`cdp_liquidate`) will reject transactions with `ConfigVersionTooOld` until
migration is complete.

**Via SDK (TypeScript):**

```typescript
import { SSSClient } from "@dcccrypto/sss-sdk";

const client = new SSSClient({ connection, wallet: authorityWallet });

// Migrate a single config
const txSig = await client.migrateConfig({ configPda: yourConfigPda });
console.log("Migrated:", txSig);
```

**Via anchor CLI:**

```bash
anchor call migrate_config \
  --provider.cluster mainnet \
  --program-id <YOUR_PROGRAM_ID> \
  -- \
  --accounts config=<CONFIG_PDA> \
  --keypair authority.json
```

**Via Rust CPI (from another program):**

```rust
sss_cpi::cpi::migrate_config(
    CpiContext::new(sss_program.to_account_info(), MigrateConfig {
        authority: authority.to_account_info(),
        config: config.to_account_info(),
    }),
)?;
```

### 3. Verify migration

```bash
# Fetch the config and check version == 1
anchor account SssToken.StablecoinConfig <CONFIG_PDA> \
  --provider.cluster mainnet | jq .version
# Expected: 1
```

### 4. Smoke test

After migration, run the standard smoke test to confirm all paths work:

```bash
npx ts-node scripts/smoke-test.ts --cluster mainnet --config <CONFIG_PDA>
```

---

## FAQ

**Q: Do I need to pause the stablecoin before migrating?**

No. `migrate_config` only writes `version` to the config PDA.  It does not
modify the mint, ATA balances, or CDPs.  There is no user-visible downtime.

**Q: What if a user tries to mint/burn during migration?**

They receive `ConfigVersionTooOld` (error code `0x179e`).  This is temporary
and resolves once `migrate_config` is called.  Complete the migration quickly
after program deployment to minimise disruption.

**Q: Can I skip versions?**

No. Migrations are sequential. If you are on v0 and deploying v2, you must run
`migrate_config` twice — once for v0→v1 and once for v1→v2.  Each migration
step is idempotent, so running the same step twice is safe.

**Q: What happens to CDPs and vaults?**

They are unaffected. CDP positions are stored in separate `CdpPosition` PDAs.
Reserve vaults are SPL token accounts. Neither is touched by `migrate_config`.

**Q: What about the Token-2022 mint account?**

Token-2022 mint accounts are never re-initialized.  The `ConfidentialTransferMint`
extension state, `DefaultAccountState` extension, transfer hook config, and all
mint metadata remain exactly as initialized.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ConfigVersionTooOld` | Config not migrated | Run `migrate_config` |
| `Unauthorized` | Wrong signer | Use config authority keypair |
| `AccountNotFound` | Wrong config PDA | Derive PDA with `findProgramAddressSync(["stablecoin-config", mintPubkey], programId)` |

---

## Security Notes

- `migrate_config` is authority-gated. It cannot be called by minters, compliance
  officers, or guardians.
- The instruction only modifies the `version` field. All security invariants
  (pause, circuit breaker, blacklist) remain in effect during migration.
- If your program uses an admin timelock (`admin_timelock_delay > 0`), you may
  wish to propose `migrate_config` via the timelock path for auditability, though
  it is not required since the call does not change financial or security parameters.
