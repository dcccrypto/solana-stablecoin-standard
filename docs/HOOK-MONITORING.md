# Transfer Hook Program Monitoring

_Author: sss-anchor | BUG-023 | Date: 2026-03-26_

---

## Overview

The SSS transfer hook program (`sss-transfer-hook`) enforces all compliance checks
(blacklist, sanctions oracle, ZK credentials, wallet rate limits) on every Token-2022
transfer. If this program is absent or non-functional, Token-2022 silently skips the
hook and all compliance checks stop firing.

This document describes the monitoring alert strategy for hook program liveness.

> **See also:** [SECURITY.md § 9](./SECURITY.md#9-transfer-hook-fail-open-risk-bug-023)
> for the full risk analysis and incident response procedure.

---

## Alert: Hook Program Existence

### What to check

Every monitoring interval, verify that the hook program account:

1. Exists on-chain (`getAccountInfo` returns non-null)
2. Has `executable: true`
3. Has non-zero data length (not a closed account with zero lamports)

### Program ID

```
phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp
```

### Recommended check interval

| Environment | Interval |
|-------------|----------|
| Mainnet | Every 10 seconds (one slot) |
| Devnet / staging | Every 60 seconds |
| CI smoke test | On every deployment |

---

## Implementation: Off-Chain Monitor (TypeScript)

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

const HOOK_PROGRAM_ID = new PublicKey(
  "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp"
);

async function checkHookProgramLive(
  connection: Connection
): Promise<{ live: boolean; reason?: string }> {
  const accountInfo = await connection.getAccountInfo(HOOK_PROGRAM_ID);

  if (!accountInfo) {
    return { live: false, reason: "Hook program account does not exist" };
  }
  if (!accountInfo.executable) {
    return {
      live: false,
      reason: "Hook program account is not executable (bad upgrade?)",
    };
  }
  if (accountInfo.data.length === 0) {
    return {
      live: false,
      reason: "Hook program account has zero data length (closed?)",
    };
  }

  return { live: true };
}

async function monitorLoop(rpcUrl: string, alertWebhook: string) {
  const connection = new Connection(rpcUrl, "confirmed");

  while (true) {
    const result = await checkHookProgramLive(connection);
    if (!result.live) {
      console.error(`[ALERT] Hook program fail-open: ${result.reason}`);
      // POST to alerting webhook (PagerDuty, Slack, etc.)
      await fetch(alertWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          severity: "critical",
          summary: `SSS transfer hook program fail-open: ${result.reason}`,
          details: {
            programId: HOOK_PROGRAM_ID.toBase58(),
            timestamp: new Date().toISOString(),
            action:
              "Pause mint immediately via Squads, then redeploy hook program",
          },
        }),
      });
    } else {
      console.log(
        `[OK] Hook program live at slot ${await connection.getSlot()}`
      );
    }

    await new Promise((r) => setTimeout(r, 10_000)); // 10 second interval
  }
}

// Usage: node monitor.js <RPC_URL> <ALERT_WEBHOOK_URL>
const [, , rpcUrl, alertWebhook] = process.argv;
monitorLoop(rpcUrl, alertWebhook).catch(console.error);
```

---

## Implementation: On-Chain Self-Check (Future Work)

A `verify_hook_live` instruction can be added to `sss-token` that:

1. Reads the hook program account info via a `remaining_accounts` UncheckedAccount
2. Asserts `account.executable == true` and `account.data.len() > 0`
3. Returns `HookProgramMissing` error if the check fails

This allows monitoring bots to call the instruction on-chain and trigger an alert if
the hook is absent — without requiring off-chain RPC access.

**Interface (planned):**
```rust
pub fn verify_hook_live(ctx: Context<VerifyHookLive>) -> Result<()>;

#[derive(Accounts)]
pub struct VerifyHookLive<'info> {
    /// CHECK: The sss-transfer-hook program account. We verify it is executable.
    pub hook_program: UncheckedAccount<'info>,
    pub config: Account<'info, StablecoinConfig>,
}
```

---

## ExtraAccountMetaList Integrity Check

In addition to hook program liveness, verify that the `ExtraAccountMetaList` PDA is
intact for each active mint:

```typescript
import {
  getExtraAccountMetaAddress,
  getExtraAccountMetas,
} from "@solana/spl-token";

async function checkExtraAccountMetaList(
  connection: Connection,
  mintAddress: PublicKey,
  hookProgramId: PublicKey
): Promise<boolean> {
  const extraMetaAddress = getExtraAccountMetaAddress(
    mintAddress,
    hookProgramId
  );
  const accountInfo = await connection.getAccountInfo(extraMetaAddress);
  if (!accountInfo) {
    console.error(
      `ExtraAccountMetaList missing for mint ${mintAddress.toBase58()}`
    );
    return false;
  }
  // Parse and verify the meta list is non-empty
  const metas = getExtraAccountMetas(accountInfo);
  if (metas.length === 0) {
    console.error(
      `ExtraAccountMetaList is empty for mint ${mintAddress.toBase58()}`
    );
    return false;
  }
  return true;
}
```

---

## Monitoring Runbook

### On alert trigger

1. **Confirm** the alert is not a false positive (RPC node issue):
   ```bash
   solana account phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp \
     --url mainnet-beta --output json
   ```
   Retry with a different RPC endpoint.

2. **Pause the mint** immediately via Squads:
   - Squads proposal: `authority.pause()` on all active SSS-2/3 mints
   - Required signers: ≥ 3-of-5 multisig

3. **Investigate** root cause:
   - Was the program intentionally closed? (check Squads proposal history)
   - Was the upgrade authority key compromised?
   - Is this an RPC anomaly? (check block explorers)

4. **Redeploy** the hook program:
   ```bash
   anchor build --verifiable
   anchor deploy \
     --program-keypair <keypair.json> \
     --program-name sss-transfer-hook \
     --provider.cluster mainnet-beta
   ```
   Squads upgrade authority required.

5. **Verify** the redeployment:
   ```bash
   # Run integration tests against the deployed ID
   ANCHOR_PROVIDER_URL=mainnet-beta anchor test --skip-local-validator
   ```

6. **Unpause** only after tests pass.

7. **Audit** all transfers that occurred during the outage window.

---

## References

- [SECURITY.md § 9](./SECURITY.md#9-transfer-hook-fail-open-risk-bug-023) — full risk analysis
- [INCIDENT-RESPONSE.md](./INCIDENT-RESPONSE.md) — incident response playbook
- Token-2022 transfer hook spec: https://spl.solana.com/transfer-hook
