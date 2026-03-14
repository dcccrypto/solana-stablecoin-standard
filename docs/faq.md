# Frequently Asked Questions

Answers to common questions about the Solana Stablecoin Standard SDK, programs, and backend.

---

## General

### What is the Solana Stablecoin Standard?

The Solana Stablecoin Standard (SSS) is a modular framework for issuing and managing stablecoins on Solana using Token-2022. It defines three preset levels:

| Preset | Name | Key Extensions |
|--------|------|----------------|
| SSS-1 | Minimal | Freeze authority · Metadata · Minter caps |
| SSS-2 | Compliant | SSS-1 + Permanent delegate · Transfer hook (on-chain blacklist) |
| SSS-3 | Trustless | SSS-2 + On-chain collateral enforcement · ZK confidential transfers |

Each preset is a concrete Anchor program configuration with a matching TypeScript SDK class.

### Which preset should I use?

- **SSS-1** — Internal tokens, DAO treasuries, ecosystem settlement, any use case that does not require regulatory compliance or on-chain blacklisting.
- **SSS-2** — Regulated stablecoins (USDC/USDT-class), DeFi protocols with AML/sanctions obligations, any token that must enforce a blacklist at the chain level.
- **SSS-3** — Fully collateral-backed tokens with on-chain reserve enforcement and optional ZK transfer privacy. Currently a reference design; see [SSS-3.md](./SSS-3.md).

### Is this production-ready?

The SDK, programs, and backend are designed for production use. The programs are deployed on devnet and have passed:
- 19/19 Anchor integration tests (on-chain)
- 102/102 TypeScript unit tests
- 31/31 backend tests
- 7/7 Kani formal verification proofs (mathematical guarantees for all possible inputs)

Mainnet deployment requires a full audit. The programs pass all automated checks and formal proofs, but have not yet been audited by a third party.

---

## Token-2022 & Extensions

### Why Token-2022 instead of the original SPL Token?

Token-2022 supports extension types that enable features impossible on the original SPL Token program:

- **Freeze authority** (also in SPL Token, but with better ergonomics in Token-2022)
- **Metadata extension** — on-chain name/symbol/URI without a separate Metaplex account
- **Permanent delegate** — a fixed authority that can move or burn tokens from any account (required for regulatory reclamation)
- **Transfer hook** — registers an external program that Token-2022 invokes on every transfer (used for the SSS-2 blacklist)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full extension breakdown.

### What is a transfer hook?

A transfer hook is a Token-2022 extension that causes the runtime to call an external Solana program on every token transfer. The hook program receives the sender, recipient, amount, and extra account metadata it registered at initialization.

The SSS-2 transfer hook checks whether the sender or recipient is in the on-chain `BlacklistState` PDA. If either is blacklisted, the hook returns an error and the transfer is rejected — at the chain level, inside the same transaction, before any tokens move.

This means the blacklist cannot be bypassed by any wallet, DEX, bridge, or application. It is enforced by the Solana runtime itself.

### Does the SSS-2 blacklist apply to all transfers, including DEX swaps?

Yes. Because the check is inside the Token-2022 transfer CPI (not in the backend or SDK), every transfer of an SSS-2 token triggers the hook — regardless of what program initiates the transfer. A blacklisted address cannot receive or send SSS-2 tokens through any route.

---

## SDK

### How do I install the SDK?

```bash
npm install @stbr/sss-token
# or
yarn add @stbr/sss-token
```

### How do I create an SSS-1 stablecoin?

```typescript
import { SolanaStablecoin } from '@stbr/sss-token';
import { AnchorProvider } from '@coral-xyz/anchor';

const provider = AnchorProvider.env(); // or your own provider

const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-1',
  name: 'My Stable',
  symbol: 'MST',
  decimals: 6,
});

console.log('Mint:', stablecoin.mint.toBase58());
```

### How do I create an SSS-2 (compliant) stablecoin?

```typescript
import { SolanaStablecoin, SSS_TRANSFER_HOOK_PROGRAM_ID } from '@stbr/sss-token';

const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-2',
  name: 'USD Stable',
  symbol: 'USDS',
  decimals: 6,
  transferHookProgram: SSS_TRANSFER_HOOK_PROGRAM_ID,
});
```

SSS-2 requires `transferHookProgram`. Pass `SSS_TRANSFER_HOOK_PROGRAM_ID` for the deployed devnet program, or your own program ID for a custom hook.

### What is the difference between `SolanaStablecoin` and `ComplianceModule`?

`SolanaStablecoin` manages the on-chain stablecoin program: creating mints, minting/burning, freezing accounts, updating roles, and authority transfer.

`ComplianceModule` manages the transfer-hook blacklist program for SSS-2 mints: initializing the `ExtraAccountMetaList`, adding/removing addresses from the `BlacklistState` PDA, and checking blacklist status.

For SSS-2, you use both classes together. See [ComplianceModule](./compliance-module.md) and [On-Chain SDK: Core Methods](./on-chain-sdk-core.md).

### How do minter caps work?

Each SSS-1/2/3 mint has a set of registered minters stored in `MinterInfo` PDAs. When you call `mintTo`, the program checks:

1. The caller is a registered minter (or the admin authority).
2. If the minter has a non-zero cap, the cumulative minted amount does not exceed it.

```typescript
// Register a minter with a 1,000,000-unit cap
await stablecoin.updateMinter({
  minter: minterKeypair.publicKey,
  cap: BigInt(1_000_000_000_000), // 1,000,000 USDS at 6 decimals
});

// Register an unlimited minter (cap = 0)
await stablecoin.updateMinter({
  minter: minterKeypair.publicKey,
  cap: 0n,
});
```

### How does the two-step authority transfer work?

Direct single-step authority transfers risk locking a mint permanently if the wrong address is provided. SSS uses a two-step proposal/acceptance pattern:

1. Current admin calls `proposeAuthority({ proposed: newAdminPublicKey })` — stores the proposed address on-chain.
2. The proposed address (new admin) calls `acceptAuthority()` — only succeeds if the caller matches the stored proposal.

This ensures the new admin controls the key before the transfer is finalized. The same pattern applies to compliance authority via `proposeComplianceAuthority` / `acceptComplianceAuthority`.

### How do I pause a stablecoin?

```typescript
// Pause all minting (admin only)
await stablecoin.pause({ mint: stablecoin.mint });

// Resume
await stablecoin.unpause({ mint: stablecoin.mint });
```

Pausing sets the `paused` flag in the `StablecoinConfig` PDA. While paused, the program rejects all `mint_to` instructions. Burns, freezes, and authority operations remain available.

---

## Programs & Devnet

### What are the deployed program IDs?

| Program | Program ID |
|---------|-----------|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

Both are deployed on Solana devnet. View on [Solscan (devnet)](https://solscan.io/account/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet).

### How do I run the programs locally?

See [Anchor Program Tests](./anchor-program-testing.md) for the full setup. In short:

```bash
# Start localnet validator
solana-test-validator --reset &

# Run Anchor tests
anchor test --skip-local-validator
```

Requirements: Rust, Solana CLI, Anchor CLI v0.29+.

### Why does `create()` fail with "account already exists"?

The `StablecoinConfig` PDA is derived from the mint public key. If you pass an existing mint keypair, the program finds the config PDA already initialized and returns an error. Use a freshly generated mint keypair for each new stablecoin.

---

## Backend (REST API)

### How do I start the backend?

```bash
# With Docker Compose (recommended)
docker compose up

# Or directly
cargo run --release
```

The backend listens on port `3000` by default. See [API Reference](./api.md) for all endpoints.

### How does API authentication work?

All write endpoints require an `X-Api-Key` header. You can create and manage keys via:

```bash
POST /api/keys          # create a new key
GET  /api/keys          # list all keys
DELETE /api/keys/{id}   # revoke a key
```

Or use the CLI:
```bash
sss-token key create --label "my-key"
sss-token key list
```

See [Authentication](./authentication.md) for details.

### How do I query paginated events?

```bash
# First page (20 results)
GET /api/events?limit=20&offset=0

# Next page
GET /api/events?limit=20&offset=20

# Filter by type
GET /api/events?event_type=mint&limit=20&offset=0
```

The audit log supports the same pagination:
```bash
GET /api/compliance/audit?limit=50&offset=0
```

See [Compliance & Audit Log](./compliance-audit-log.md) for all filter parameters.

### How do I configure webhooks?

```bash
# Register a webhook
POST /api/webhooks
{
  "url": "https://your-server.example.com/webhook",
  "events": ["mint", "burn"]
}

# List webhooks
GET /api/webhooks

# Delete a webhook
DELETE /api/webhooks/{id}
```

Webhooks are delivered with a `X-SSS-Signature` HMAC-SHA256 header for verification. See [API Reference](./api.md#webhooks).

---

## Errors & Troubleshooting

### The SDK throws `SSSError` — what does the status code mean?

`SSSError` wraps REST API errors:

| Status | Meaning |
|--------|---------|
| 400 | Bad request — invalid parameters |
| 401 | Unauthorized — missing or invalid API key |
| 404 | Not found — resource does not exist |
| 429 | Rate limited — wait for `Retry-After` seconds |
| 500 | Internal server error — check backend logs |

### I'm getting `SenderBlacklisted` or `ReceiverBlacklisted` on a transfer

The transfer hook rejected the transfer. The sender or recipient is in the SSS-2 blacklist for this mint. To check:

```bash
GET /api/compliance/blacklist
```

Or via SDK:
```typescript
const isBlocked = await compliance.isBlacklisted(suspectAddress);
```

To remove an address from the blacklist (compliance authority required):
```typescript
await compliance.removeFromBlacklist(suspectAddress);
```

### `initialize_extra_account_meta_list` fails with "account already exists"

The `ExtraAccountMetaList` PDA for this mint is already initialized. You only need to call `initializeBlacklist()` once per SSS-2 mint. This is idempotent at the program level but calling it twice returns an error.

### Anchor build fails with "IDL not found"

Run `anchor build` first to generate the IDL at `target/idl/`:

```bash
cd programs/sss-token
anchor build
```

Then run tests or the smoke test.

### The smoke test fails on devnet

Common causes:
1. **Insufficient SOL** — the smoke test keypair needs ~0.1 SOL. Run `solana airdrop 2 <pubkey> --url devnet`.
2. **Rate limited** — devnet airdrop is rate-limited. Wait a few seconds and retry.
3. **Stale IDL** — run `anchor build` to regenerate the IDL before the smoke test.

See [Devnet Deployment](./devnet-deploy.md) for the full smoke test walkthrough.

---

## Security & Formal Verification

### What does "formally verified" mean here?

The Kani prover (a model checker for Rust) was used to verify 7 mathematical invariants about the core stablecoin logic — for all possible inputs, not just sampled test cases:

1. Mint + burn preserves circulating supply
2. Circulating supply never underflows
3. Cap enforcement: minter can never exceed their registered cap
4. Paused state: mint is rejected when paused
5. Max supply: total minted never exceeds `max_supply` (SSS-3)
6. Blacklist: blacklisted addresses cannot transfer (SSS-2)
7. Authority proposal: only proposed address can accept transfer

See [Formal Verification](./formal-verification.md) for the full proof details.

### Can the admin rug-pull token holders?

The admin authority can:
- Freeze individual token accounts
- Update roles and minter configurations
- Propose authority transfers

The admin **cannot**:
- Mint tokens without being a registered minter
- Bypass the on-chain minter cap
- Move tokens from user accounts directly (only the permanent delegate / compliance authority can, for SSS-2)

For SSS-2, the permanent delegate and compliance authority are the reclamation mechanism required for regulatory compliance. This is by design.

### How do I revoke a minter?

```typescript
await stablecoin.revokeMinter({ minter: compromisedMinterPublicKey });
```

Revocation zeroes the minter's cap and prevents future mints. Tokens already minted are not affected.

---

## Migration

### Migrating from SPL Token (original program)?

See the [Migration Guide](./migration-guide.md) for a full walkthrough, including:
- SPL Token vs Token-2022 differences
- Creating a Token-2022 mint with SSS extensions
- Moving backend state from a vanilla SPL Token setup
- Common pitfalls

### Can I upgrade an existing Token-2022 mint to SSS?

Not directly. SSS stores configuration in a `StablecoinConfig` PDA derived from the mint address. You cannot retroactively initialize this PDA for a mint that was created outside the SSS program.

The recommended migration path is to create a new SSS mint and run a token swap or migration event. See [Migration Guide](./migration-guide.md).

---

## More Resources

| Document | Description |
|----------|-------------|
| [Quickstart](./quickstart.md) | End-to-end walkthrough from zero to live SSS-2 stablecoin |
| [SDK & CLI](./sdk-cli.md) | TypeScript SDK and `sss-token` CLI reference |
| [API Reference](./api.md) | Full REST API endpoint documentation |
| [Architecture](./ARCHITECTURE.md) | Three-layer system architecture |
| [Error Handling](./error-handling.md) | Complete error catalog and troubleshooting guide |
| [Migration Guide](./migration-guide.md) | SPL Token → SSS-1/2/3 migration guide |
| [TypeScript Types Reference](./sdk-types.md) | All exported SDK types and interfaces |
| [Formal Verification](./formal-verification.md) | Kani proof details |
| [Submission](./SUBMISSION.md) | Bounty submission summary |
