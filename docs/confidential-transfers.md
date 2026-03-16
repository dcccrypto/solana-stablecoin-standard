# Confidential Transfers (SSS-106)

> **Status:** Foundation complete (flag + config PDA). Full Token-2022
> `ConfidentialTransferMint` extension wiring is tracked in **SSS-107**.

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

## SDK Usage (placeholder — SSS-107)

SSS-107 will deliver:

- `initConfidentialTransferMintExtension(mint, auditorPubkey)` — wires the
  Token-2022 `ConfidentialTransferMint` extension onto the mint after SSS init.
- `configureConfidentialTransferAccount(tokenAccount)` — enables an individual
  token account for confidential transfers.
- `depositConfidential(amount, tokenAccount)` — moves tokens from the public
  balance into the confidential balance.
- `transferConfidential(amount, src, dst, proofContext)` — performs a
  ZK-proven confidential transfer.
- `withdrawConfidential(amount, tokenAccount, proofContext)` — moves tokens
  back to public balance.

Until SSS-107 lands, the `ConfidentialTransferConfig` PDA acts as the
on-chain registry for the auditor key and `auto_approve_new_accounts` setting.

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
- SSS-107 — SDK module for confidential transfer operations (follow-up)
