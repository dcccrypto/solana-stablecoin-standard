# SSS — Error Handling & Troubleshooting Guide

> **Scope:** On-chain program errors (Anchor), TypeScript SDK errors, REST backend HTTP errors, CLI exit codes, and common failure patterns with fixes.

---

## Overview

Errors in the SSS stack originate from three layers:

| Layer | Error type | Transport |
|---|---|---|
| Anchor program (`programs/sss-token`) | `SssError` enum → `AnchorError` | Transaction log / simulation response |
| TypeScript SDK (`@stbr/sss-token`) | `AnchorError`, `Error` | Thrown exception |
| REST backend (`backend/`) | `SSSError` (HTTP status) | JSON response body |
| CLI (`cli/`) | `SSSError` → stderr + exit 1 | stderr |

Understanding which layer the error came from is the first step toward fixing it.

---

## 1. On-Chain Program Errors (`SssError`)

Every instruction in the SSS Anchor program enforces pre-conditions via `require!` macros and `#[account(constraint = …)]` attributes. Violations surface as `AnchorError` with a human-readable message and a numeric error code.

### Full error table

| Code | Name | Message | Common cause |
|------|------|---------|--------------|
| 6000 | `Unauthorized` | `Unauthorized: caller is not the authority` | Wrong signer for admin instructions (`pause`, `updateRoles`, `proposeAuthority`, `revokeMinter`) |
| 6001 | `UnauthorizedCompliance` | `Unauthorized: caller is not the compliance authority` | Wrong signer for `freeze` / `thaw` |
| 6002 | `NotAMinter` | `Unauthorized: caller is not a registered minter` | `mint` / `burn` called without prior `updateRoles` to register the minter, or wrong `minterInfo` PDA passed |
| 6003 | `MintPaused` | `Mint is paused` | `mint` or `burn` attempted while the stablecoin is paused (`pause()` was called and `unpause()` has not been called) |
| 6004 | `MinterCapExceeded` | `Minter cap exceeded` | Minting more than the cap registered in `MinterInfo` for this minter |
| 6005 | `WrongPreset` | `SSS-2 feature not available on SSS-1 preset` | Calling an SSS-2 instruction (`freeze`, `thaw`, `blacklist`) on an SSS-1 mint |
| 6006 | `MissingTransferHook` | `Transfer hook program required for SSS-2` | Creating an SSS-2 stablecoin without providing `transfer_hook_program` |
| 6007 | `InvalidPreset` | `Invalid preset: must be 1, 2, or 3` | `preset` parameter outside the range `[1, 2, 3]` |
| 6008 | `ZeroAmount` | `Amount must be greater than zero` | `amount: 0` passed to `mint`, `burn`, `depositCollateral`, or `redeem` |
| 6009 | `InsufficientReserves` | `Insufficient collateral in reserve vault to mint` | SSS-3 `mint` attempted when collateral in the reserve vault is less than requested mint amount |
| 6010 | `InvalidCollateralMint` | `Invalid collateral mint for this stablecoin` | `collateral_mint` account does not match `config.collateral_mint` stored at init time |
| 6011 | `InvalidVault` | `Invalid reserve vault account` | `reserve_vault` account does not match `config.reserve_vault` stored at init time |
| 6012 | `MaxSupplyExceeded` | `Max supply would be exceeded` | Minting would push total supply over the optional `max_supply` set at initialisation |
| 6013 | `NoPendingAuthority` | `No pending authority transfer to accept` | `acceptAuthority()` called when no transfer has been proposed via `proposeAuthority()` |
| 6014 | `NoPendingComplianceAuthority` | `No pending compliance authority transfer to accept` | `acceptComplianceAuthority()` called without a prior `proposeAuthority` for compliance |
| 6015 | `ReserveVaultRequired` | `Reserve vault is required for SSS-3` | SSS-3 initialisation called without providing a `reserve_vault` account |

### Reading on-chain errors in the SDK

When an Anchor instruction fails, the TypeScript SDK surfaces it as an `AnchorError`. Catch and inspect it:

```typescript
import { AnchorError } from "@coral-xyz/anchor";
import { SolanaStablecoin } from "@stbr/sss-token";

try {
  await stablecoin.mint({ minter, recipient, amount: 0n });
} catch (err) {
  if (err instanceof AnchorError) {
    console.error("Program error:", err.error.errorCode.code);   // "ZeroAmount"
    console.error("Error number:", err.error.errorCode.number);  // 6008
    console.error("Message:", err.error.errorMessage);           // "Amount must be greater than zero"
    console.error("Origin:", err.program.toString());            // program id
  } else {
    throw err; // unexpected
  }
}
```

### Reading on-chain errors in the CLI

```
$ sss-token mint --url http://localhost:3000 --amount 0
Error: Amount must be greater than zero (6008)
$ echo $?
1
```

---

## 2. SDK-Level Errors

Beyond Anchor errors, the SDK throws plain `Error` objects for client-side problems.

| Message (contains) | Cause | Fix |
|---|---|---|
| `Mint <pubkey> not found` | `getMintInfo()` called before the mint account exists on-chain | Ensure `create()` succeeded and you're querying the correct cluster |
| `ATA not found for <pubkey>` | A recipient's associated token account doesn't exist | Create the ATA before minting, or pass `createAta: true` if the SDK method supports it |
| `Provider wallet is not set` | `SolanaStablecoin` constructed without a valid `AnchorProvider` | Pass a wallet-backed provider: `new AnchorProvider(connection, wallet, opts)` |
| `IDL not found` | Program address mismatch or wrong cluster | Verify `programId` matches the deployed program and the `connection` RPC points to the right cluster |

---

## 3. REST Backend HTTP Errors (`SSSError`)

All backend errors are returned as JSON:

```json
{ "error": "human-readable message" }
```

### HTTP status codes

| Status | Meaning | Common cause |
|--------|---------|--------------|
| `400 Bad Request` | Invalid request body or parameters | Missing required JSON fields; invalid pubkey strings; `amount` ≤ 0 |
| `401 Unauthorized` | Missing or invalid `X-Api-Key` header | Key not created, key rotated, or header typo |
| `404 Not Found` | Route or resource not found | Webhook ID or key ID doesn't exist; check the `/api/…` path |
| `409 Conflict` | Duplicate resource | Webhook URL already registered; API key name already exists |
| `422 Unprocessable Entity` | Semantically invalid request | Pubkey format correct but fails on-chain validation |
| `429 Too Many Requests` | Rate limit exceeded | Slow request cadence or increase `rate_limit.capacity` / `refill_rate` in config |
| `500 Internal Server Error` | Unexpected backend failure | Check server logs; database write failure |

### `429 Too Many Requests` — handling the `Retry-After` header

The backend sets a `Retry-After` header (seconds) on every 429. Respect it:

```typescript
const response = await fetch("http://localhost:3000/api/events");
if (response.status === 429) {
  const retryAfter = parseInt(response.headers.get("Retry-After") ?? "1", 10);
  await new Promise(r => setTimeout(r, retryAfter * 1000));
  // retry...
}
```

### `401 Unauthorized` — quick checklist

1. Have you created a key? `POST /api/admin/keys` or `sss-token key create --name dev`.
2. Is the key being sent in `X-Api-Key`, not `Authorization`?
3. Has the key been deleted? `sss-token key list` to verify.
4. Is the server `SSS_ADMIN_KEY` environment variable set? Without it the admin endpoints reject all requests.

---

## 4. CLI Exit Codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Success |
| `1` | Any error (backend HTTP error, network failure, argument validation) |

Error details are always printed to **stderr**; stdout is reserved for JSON output.

```bash
# Capture JSON output and check for errors separately
output=$(sss-token supply 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "Command failed"
fi
```

---

## 5. Common Failure Patterns

### "I called `freeze` but got `WrongPreset`"

`freeze` and `thaw` are SSS-2 compliance features. They are only available on mints initialised with `preset: 2`. Check:

```typescript
const info = await stablecoin.getMintInfo();
console.log(info.preset); // must be 2
```

If the preset is `1`, you need to create a new stablecoin with `preset: 2`.

---

### "I called `mint` but got `NotAMinter`"

The keypair you are signing with hasn't been registered as a minter:

```typescript
// Register minter first
await stablecoin.updateRoles({
  minter: minterKeypair.publicKey,
  cap: 1_000_000n,
});

// Now mint works
await stablecoin.mint({
  minter: minterKeypair,
  recipient: recipientPublicKey,
  amount: 100n,
});
```

Also verify you are passing the same `minterInfo` PDA used when `updateRoles` was called. The SDK derives this automatically from `(config, minter)`.

---

### "My `mint` succeeds but balance doesn't change"

1. Check the recipient's ATA exists and belongs to the correct mint.
2. Confirm the `mint` transaction is confirmed (use `commitment: "confirmed"` or `"finalized"`).
3. Query the token account balance directly:

```typescript
const balance = await connection.getTokenAccountBalance(recipientAta);
console.log(balance.value.uiAmount);
```

---

### "I called `acceptAuthority` but got `NoPendingAuthority`"

Authority transfers are two-step:

```typescript
// Step 1 — done by current authority
await stablecoin.proposeAuthority({ newAuthority: candidate.publicKey });

// Step 2 — done by the candidate (different signer!)
await stablecoin.acceptAuthority({ signer: candidate });
```

If you call `acceptAuthority` without `proposeAuthority` first (or after it has already been accepted), you get `NoPendingAuthority`.

---

### "Backend returns `500` on startup"

Check that the required environment variables are set:

```bash
SSS_ADMIN_KEY=your-admin-key   # required for admin routes
DATABASE_URL=sss.db            # SQLite path (default: sss.db in cwd)
PORT=3000                      # optional, defaults to 3000
```

Run with verbose logs:

```bash
RUST_LOG=debug cargo run --release
```

---

### "Devnet transaction fails with `insufficient funds`"

Fund the payer wallet:

```bash
solana airdrop 2 <PUBKEY> --url devnet
```

For the collateral vault (SSS-3), the reserve vault ATA must be funded with the collateral token before `depositCollateral` can succeed.

---

### "IDL mismatch — method not found"

If you see `TypeError: stablecoin.someMethod is not a function`, the SDK IDL may be out of sync with the deployed program. Rebuild and regenerate:

```bash
anchor build
# IDL is written to programs/sss-token/target/idl/sss_token.json
# The SDK bundles this at build time
npm run build --workspace=sdk
```

---

## 6. Getting Help

1. **Logs first.** Run the backend with `RUST_LOG=debug`. Run Anchor tests with `RUST_BACKTRACE=1`.
2. **Simulate.** Use `anchor test --skip-deploy` to exercise the program locally without spending SOL.
3. **Explorer.** Paste a failed transaction signature into [Solana Explorer](https://explorer.solana.com/?cluster=devnet) to see the full program log, including the `AnchorError` message.
4. **Error codes.** Every `SssError` variant maps to a code in the range `6000–6015`. The Anchor error code is always displayed in the transaction log.
