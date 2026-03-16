# Confidential Transfers (SSS-106 / SSS-107)

> **Status:** Foundation complete. `FLAG_CONFIDENTIAL_TRANSFERS` (bit 5) is live
> in the Anchor program (SSS-106). The TypeScript SDK module (`ConfidentialTransferModule`)
> shipped in **SSS-107** and is available in `@sss/sdk`.

---

## What FLAG_CONFIDENTIAL_TRANSFERS Enables

Setting bit 5 (`FLAG_CONFIDENTIAL_TRANSFERS = 1 << 5`) in `feature_flags` at
initialization time signals that this stablecoin supports confidential
transfers via the Token-2022 `ConfidentialTransferMint` extension.

When enabled:

1. The issuer provides an **auditor ElGamal public key** at init time.
2. The key is stored in a `ConfidentialTransferConfig` PDA (`["ct-config", mint]`).
3. Transfer amounts are encrypted for observers on-chain — only the holder of
   the corresponding **ElGamal private key** (the issuer/auditor) can decrypt them.
4. The `StablecoinConfig.auditor_elgamal_pubkey` field mirrors the key for
   quick on-chain reads without deriving the CT config PDA.

---

## How the Auditor Key Works

Confidential transfers use **ElGamal encryption** on the Ristretto255 curve
(same primitive as Token-2022's `ConfidentialTransferMint`):

| Party | Can see amount? |
|-------|----------------|
| Sender / Receiver | Yes (they hold their own decryption key) |
| Auditor (issuer) | **Yes** — amounts are also encrypted to the auditor pubkey |
| External observer (chain scanner, MEV) | **No** — sees only ciphertext |

The auditor key enables regulatory compliance: the issuer can produce a
full transaction log for auditors without exposing individual balances to the
public.

> **Key management:** The ElGamal private key must be stored securely by the
> issuer. Loss of the private key means the issuer can no longer audit historical
> transfers. Rotation is a protocol-level operation (SSS-future).

---

## How to Enable at Initialization

Pass `feature_flags` and `auditor_elgamal_pubkey` in `InitializeParams`:

```typescript
// TypeScript (anchor client)
const auditorElGamalPubkey = new Uint8Array(32); // replace with real key bytes

await program.methods
  .initialize({
    preset: 1,
    decimals: 6,
    name: "My Stablecoin",
    symbol: "MYS",
    uri: "https://example.com/metadata.json",
    transferHookProgram: null,
    collateralMint: null,
    reserveVault: null,
    maxSupply: null,
    featureFlags: new BN(1 << 5),           // FLAG_CONFIDENTIAL_TRANSFERS
    auditorElgamalPubkey: Array.from(auditorElGamalPubkey),
  })
  .accounts({
    payer: wallet.publicKey,
    mint: mintKeypair.publicKey,
    config: configPda,
    ctConfig: ctConfigPda,                  // ["ct-config", mint]
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([mintKeypair])
  .rpc();
```

Derive the CT config PDA:

```typescript
const [ctConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("ct-config"), mintKeypair.publicKey.toBuffer()],
  program.programId,
);
```

If `FLAG_CONFIDENTIAL_TRANSFERS` is **not** set, pass `ctConfig: null` and
omit `auditorElgamalPubkey` (or pass `null`).

---

## SDK Usage (SSS-107)

`ConfidentialTransferModule` is the official TypeScript SDK client for all
confidential transfer operations. Import it from `@sss/sdk`:

```typescript
import { ConfidentialTransferModule, FLAG_CONFIDENTIAL_TRANSFERS } from '@sss/sdk';
```

### Instantiation

```typescript
const ct = new ConfidentialTransferModule(provider, programId);
```

- `provider` — Anchor `AnchorProvider`. Wallet must be the admin authority
  for write operations (`enableConfidentialTransfers`).
- `programId` — SSS token program `PublicKey`.

---

### `enableConfidentialTransfers`

Sets `FLAG_CONFIDENTIAL_TRANSFERS` and writes the `ConfidentialTransferConfig`
PDA. Admin authority only.

```typescript
await ct.enableConfidentialTransfers({
  mint,
  auditorElGamalPubkey: myElGamalPubkeyBytes, // Uint8Array, 32 bytes
  autoApproveNewAccounts: true,               // optional, default false
});
```

| Param | Type | Description |
|-------|------|-------------|
| `mint` | `PublicKey` | The stablecoin mint |
| `auditorElGamalPubkey` | `Uint8Array` (32 bytes) | Issuer/auditor ElGamal pubkey (Ristretto255) |
| `autoApproveNewAccounts` | `boolean` | Auto-approve new token accounts for CT (default `false`) |

**Returns:** `TransactionSignature`

---

### `depositConfidential`

Moves tokens from the public balance into the **pending encrypted balance**
(Token-2022 `Deposit` instruction). Called by the token account owner.

```typescript
await ct.depositConfidential({
  mint,
  amount: 1_000_000n,       // bigint, base units (e.g. 1 USDS at 6 decimals)
  tokenAccount?: myATA,     // optional, defaults to provider wallet's ATA
});
```

After a deposit, balances appear as "pending" until `applyPendingBalance` is called.

---

### `applyPendingBalance`

Moves the **pending encrypted balance** into the available encrypted balance
(Token-2022 `ApplyPendingBalance` instruction). Must be called by the token
account owner after each deposit.

```typescript
await ct.applyPendingBalance({
  mint,
  tokenAccount?: myATA,  // optional
});
```

---

### `withdrawConfidential`

Converts the **available encrypted balance** back into the public token
balance (Token-2022 `Withdraw` instruction). A ZK proof is auto-generated
client-side.

```typescript
await ct.withdrawConfidential({
  mint,
  amount: 500_000n,       // must not exceed available encrypted balance
  tokenAccount?: myATA,
});
```

---

### `auditTransfer`

Client-side ElGamal decryption of an encrypted transfer amount. Uses the
auditor's secret key to recover the plaintext amount. **No RPC call.**

```typescript
const { amount } = await ct.auditTransfer({
  mint,
  auditorElGamalSecretKey: auditorSecret,   // Uint8Array, 32 bytes
  encryptedAmount: ciphertextBytes,          // Uint8Array, 64 bytes
});
console.log('Transfer amount:', amount, 'base units');
```

> **Note:** The current implementation uses a placeholder decryption stub.
> Production integration requires replacing `_decryptElGamal` with the real
> BSGS implementation from `@solana/spl-token`:
> ```typescript
> import { ElGamalSecretKey, ElGamalCiphertext } from '@solana/spl-token';
> const sk = ElGamalSecretKey.fromBytes(secretKey);
> const ct = ElGamalCiphertext.fromBytes(encryptedAmount);
> return BigInt(sk.decrypt(ct));
> ```

---

### Read Helpers

```typescript
// Derive PDA address (pure computation, no RPC)
const [pda, bump] = ct.getConfigPda(mint);

// Fetch full ConfidentialTransferConfig account
const config = await ct.getConfig(mint);
// → { mint, auditorElGamalPubkey: Uint8Array, autoApproveNewAccounts: boolean } | null

// Quick flag check (PDA existence only)
const enabled = await ct.isEnabled(mint);
// → boolean
```

---

### Full Usage Example

```typescript
import { ConfidentialTransferModule, FLAG_CONFIDENTIAL_TRANSFERS } from '@sss/sdk';
import { AnchorProvider } from '@coral-xyz/anchor';

const ct = new ConfidentialTransferModule(provider, programId);

// 1. Enable on a mint (admin only)
await ct.enableConfidentialTransfers({
  mint,
  auditorElGamalPubkey: auditorKeyBytes,
  autoApproveNewAccounts: false,
});

// 2. Deposit 1 USDS into pending encrypted balance
await ct.depositConfidential({ mint, amount: 1_000_000n });

// 3. Apply pending credits → available encrypted balance
await ct.applyPendingBalance({ mint });

// 4. Withdraw 500k base units back to public balance
await ct.withdrawConfidential({ mint, amount: 500_000n });

// 5. Audit a transfer (auditor only, offline)
const { amount } = await ct.auditTransfer({
  mint,
  auditorElGamalSecretKey: auditorSecretKeyBytes,
  encryptedAmount: ciphertextFrom transaction log,
});
```

---

## Compliance Model

Confidential transfers are **privacy-preserving but fully auditable**:

| Property | Value |
|----------|-------|
| Transfer amounts visible on-chain | ❌ No (encrypted) |
| Sender/receiver addresses visible | ✅ Yes (Solana account model) |
| Auditor can decrypt all amounts | ✅ Yes (ElGamal dual encryption) |
| Blacklisting / freeze still works | ✅ Yes (Token-2022 freeze authority) |
| ZK compliance proofs compatible | ✅ Yes (FLAG_ZK_COMPLIANCE composable) |

This model satisfies the **FATF Travel Rule** requirement for VASPs to share
transaction data on request, while protecting user privacy against public
chain surveillance.

---

## On-Chain Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `ConfidentialTransferConfig` | `["ct-config", mint]` | Auditor key + auto-approve flag |
| `StablecoinConfig.auditor_elgamal_pubkey` | — | Mirror field for fast on-chain reads |

### `ConfidentialTransferConfig` Layout

```
[0..8]    discriminator               (8 bytes, Anchor)
[8..40]   mint                        (Pubkey, 32 bytes)
[40..72]  auditor_elgamal_pubkey      (32 bytes, Ristretto255 compressed)
[72]      auto_approve_new_accounts   (bool, 1 byte)
[73]      bump                        (u8, 1 byte)
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| `ConfidentialTransferNotEnabled` | FLAG not set; CT operation rejected |
| `MissingAuditorKey` | FLAG set but no auditor key provided at init |

---

## See Also

- [`docs/feature-flags.md`](./feature-flags.md) — full FLAG_* reference
- [`docs/on-chain-sdk-zk.md`](./on-chain-sdk-zk.md) — ZK compliance (FLAG_ZK_COMPLIANCE, bit 4)
- [Token-2022 Confidential Transfers spec](https://spl.solana.com/confidential-token/deep-dive/overview)
- SSS-106 — Anchor program: FLAG_CONFIDENTIAL_TRANSFERS flag + ConfidentialTransferConfig PDA
- SSS-107 — TypeScript SDK: ConfidentialTransferModule
