# SSS-081: SDK/DX Gaps Analysis
**Comparing our TypeScript SDK against best-in-class Web3 SDKs**
*sss-sdk agent | 2026-03-15*

---

## Summary

Our SDK is functionally complete for a v1 release — 359 tests passing, 5 feature modules, solid type coverage. But when held against production-grade SDKs like **viem**, **Metaplex Umi**, **ethers.js**, and **Anchor client**, significant DX gaps emerge that would frustrate an engineering team trying to build a real stablecoin product. This document is specific and critical.

---

## 1. DX Gaps vs Best-in-Class SDKs

### 1.1 No Fluent Builder / Method Chaining

**Reference:** viem's `publicClient.readContract()`, ethers.js `contract.connect(signer).functionName()`, Metaplex Umi's `umi.use(keypairIdentity(keypair)).rpc().getBalance()`

**Our SDK:**
```ts
// Verbose — user must construct every piece manually
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-2',
  name: 'My USD',
  symbol: 'MUSD',
  decimals: 6,
  transferHookProgram: hookId,
});
const compliance = new ComplianceModule(provider, stablecoin.mint, hookId);
const cb = new CircuitBreakerModule(provider, stablecoin.mint);
// 3 separate objects, no shared lifecycle
```

**Gap:** Modules are disconnected islands. There's no top-level client that composes them. A new developer has to discover module classes individually, construct each with identical arguments, and manage state separately. Metaplex Umi solved this with a plugin system (`umi.use(plugin)`). We have no equivalent.

**Recommendation:** Add a `SSSStablecoinClient` facade:
```ts
const client = SSSStablecoinClient.from(provider, mint);
await client.compliance.addToBlacklist(addr);
await client.circuitBreaker.trip(params);
await client.dao.vote(proposalId, true);
```

---

### 1.2 No Transaction Builder / Simulation Layer

**Reference:** viem's `simulateContract` before `writeContract`, Anchor's `.simulate()`, ethers.js `contract.callStatic.*`

**Our SDK:**
```ts
// Zero ability to preview what a transaction will do
await stablecoin.mintTo(params); // if this fails, you get an anchor error blob
```

**Gap:** None of our 11 modules expose a `.simulate()` or `.estimateFee()` path. Every operation blindly fires `.rpc({ commitment: 'confirmed' })`. On mainnet, a mis-configured instruction wastes SOL on rent and provides no user feedback before signing.

**Recommendation:**
- Add `.simulate(params)` alongside every mutating method
- Return `SimulationResult` with `{ logs, unitsConsumed, error? }` before broadcasting
- Mirror viem's `simulateContract` → `writeContract` pattern

---

### 1.3 No Retry / Confirmation Strategy

**Reference:** viem's `waitForTransactionReceipt`, ethers.js `tx.wait(confirmations)`, Metaplex Umi's `confirmTransaction` plugin

**Our SDK:**
```ts
// Returns raw TransactionSignature — consumer is on their own
const sig: TransactionSignature = await stablecoin.mintTo(params);
// Now what? Poll getTransaction? Wait with what backoff?
```

**Gap:** All 11 modules return `TransactionSignature` directly from Anchor's `.rpc()`. There's no built-in confirmation wait, no retry on `blockhash not found`, no `preflight: false` escape hatch. In practice Solana mainnet requires custom retry logic for dropped transactions — we export none of it.

**Recommendation:**
- Return a `ConfirmableTransaction` wrapper with `.confirm()` and `.confirmed()` 
- Accept `commitment` and `maxRetries` options on every mutating call
- Implement exponential backoff for `BlockhashNotFound`

---

### 1.4 No Chain Abstraction / Network Config

**Reference:** viem's `createPublicClient({ chain: mainnet })`, ethers.js `getDefaultProvider('mainnet')`

**Our SDK:**
```ts
// Hardcoded program IDs for devnet — no mainnet support
export const SSS_TOKEN_PROGRAM_ID = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
// Every module uses this constant — changing it requires forking the SDK
```

**Gap:** Program IDs are hardcoded constants. There's no `SSSNetwork` config type, no `mainnet` / `devnet` / `localnet` presets. A team deploying to mainnet forks the repo or passes `programId` through every module constructor separately.

**Recommendation:**
```ts
export const SSS_NETWORKS = {
  devnet: { tokenProgramId: ..., hookProgramId: ... },
  mainnet: { tokenProgramId: ..., hookProgramId: ... },
};
// All modules accept network config at construction
```

---

### 1.5 Missing Event Subscription / Log Parsing

**Reference:** viem's `watchEvent`, ethers.js `contract.on('Transfer', handler)`, Anchor's `program.addEventListener`

**Our SDK:**
- Zero event listener support
- `SSSClient` (REST) provides `GET /api/events` but no streaming/subscription
- No Anchor event IDL events defined or surfaced in SDK types

**Gap:** Teams building frontends or monitoring tools can't subscribe to mint/burn/freeze events. They're forced to poll the REST API.

**Recommendation:**
- Emit Anchor program events for `Mint`, `Burn`, `Freeze`, `Thaw`, `CircuitTripped`, `ProposalCreated`
- Add `stablecoin.on('mint', handler)` wrappers using Anchor's `addEventListener`
- Add `SSSClient.streamEvents(mint, handler)` via SSE or websocket

---

## 2. Errors That Are Hard to Debug

### 2.1 `SSSError` Carries Almost No Context

```ts
// src/error.ts — the entire error class
export class SSSError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
  }
}
```

**Problems:**
- No `code` field (machine-readable, e.g. `BLACKLIST_FULL`, `CIRCUIT_ALREADY_TRIPPED`)
- No `cause` / `originalError` chain — catching errors from Anchor get swallowed
- `statusCode` only applies to REST errors — meaningless for on-chain errors
- No stack trace capture for async throw sites

**Comparison — viem:**
```ts
class BaseError extends Error {
  code: number;
  shortMessage: string;
  cause?: BaseError | Error;
  details?: string;
  metaMessages?: string[];
  name: string;
}
```

**Recommendation:**
```ts
export class SSSError extends Error {
  readonly code: SSSErrorCode;          // 'BLACKLIST_FULL' | 'PAUSED' | etc.
  readonly statusCode?: number;          // HTTP only
  readonly cause?: Error;               // original anchor/network error
  readonly context?: Record<string, unknown>; // { mint, authority, amount }
}
```

---

### 2.2 On-Chain Errors Not Surfaced

Anchor returns program errors as numbers (`0x1788`). Our SDK passes them through raw:

```ts
// user sees: Error: failed to send transaction: Transaction simulation failed: Error processing...
// custom program error 0x... 
// No mapping to human-readable strings.
```

**Gap:** We have no `parseAnchorError(err)` utility. The IDL error table (when it exists) is never consulted.

**Recommendation:** Parse Anchor error codes into named `SSSError` subclasses. Publish an `SSS_ERROR_CODES` map in the package so integrators can catch by code.

---

### 2.3 Module Misconfiguration Not Caught at Construction

```ts
// No validation — wrong hookProgramId silently accepted
const compliance = new ComplianceModule(provider, mint, wrongHookProgramId);
// Error only appears at runtime, deep in a transaction
```

**Recommendation:** Validate PDA derivation at construction time; `static async validate(provider, mint, hookProgramId)` that fetches and checks the on-chain account exists.

---

## 3. Operations Requiring Too Many Steps

### 3.1 SSS-2 Initialization Requires 3 Separate Calls

```ts
// Step 1: deploy stablecoin
const stablecoin = await SolanaStablecoin.create(provider, sss2Config({...}));
// Step 2: initialize blacklist PDA (easy to forget — no error if skipped until addToBlacklist)
const compliance = new ComplianceModule(provider, stablecoin.mint, hookId);
await compliance.initializeBlacklist();
// Step 3: now you can actually use compliance features
```

**Gap:** `initializeBlacklist()` is a footgun. Forgetting it causes a confusing PDA-not-found error. Metaplex Umi uses a "builder" pattern where initialization steps are composed and executed atomically.

**Recommendation:** `SolanaStablecoin.create()` for SSS-2 should auto-call `initializeBlacklist()` in a bundled transaction, or expose a `SolanaStablecoin.createSSS2()` that handles all setup.

---

### 3.2 Module Attachment Is Verbose

Every module requires passing `provider` and `mint` separately:

```ts
const cb = new CircuitBreakerModule(provider, mint);
const sp = new SpendPolicyModule(provider, mint);
const dao = new DaoCommitteeModule(provider, mint);
// Same two args, 3 times. If mint changes, 3 update sites.
```

**Recommendation:** Factory from `SolanaStablecoin` instance:
```ts
const cb = stablecoin.module(CircuitBreakerModule);
```

---

### 3.3 Token Accounts Must Be Managed by Caller

```ts
// User must call getOrCreateAssociatedTokenAccount before mintTo
// There's no helper — this is on the consumer
```

**Gap:** Unlike ethers.js ERC-20 wrappers where `transfer(to, amount)` works with addresses, our `mintTo` requires a pre-existing `PublicKey` for `recipient` token account. No auto-ATA creation.

**Recommendation:** `mintTo({ recipient: walletAddress })` should auto-derive and create the ATA if needed, matching Metaplex Umi's `findOrCreateATA` pattern.

---

## 4. Wallet Adapter Integration Gaps

### 4.1 Requires `AnchorProvider` — Incompatible with Browser Wallets

```ts
export interface SdkOptions {
  connection: Connection;
  provider: AnchorProvider;  // ← requires full AnchorProvider
  programId?: PublicKey;
}
```

**Gap:** `AnchorProvider` from `@coral-xyz/anchor` bundles `NodeWallet` / `Wallet` interface — it doesn't accept `@solana/wallet-adapter-base`'s `WalletAdapter` directly. Teams using `useWallet()` from `@solana/wallet-adapter-react` must wrap the adapter manually.

**Comparison:** Metaplex Umi has a `walletAdapterIdentity(wallet)` plugin that wraps any `WalletAdapter`.

**Recommendation:**
- Export a `toAnchorWallet(adapter: WalletAdapter): Wallet` helper
- OR accept a `WalletAdapter` directly in `SdkOptions` and wrap internally
- Document the full browser wallet integration flow in README

---

### 4.2 No `useSSS` React Hook

**Reference:** wagmi's `useReadContract`, `useWriteContract`, `useWaitForTransactionReceipt`

**Gap:** Zero React integration. Teams building Next.js frontends start from scratch. Even a minimal `@sss/react` package with:
```ts
useStablecoin(mint: PublicKey)      // => { info, loading, error }
useMint(stablecoin)                 // => { mint, isPending }
useBlacklist(compliance)            // => { add, remove, isPending }
```
…would dramatically reduce integration friction.

**Recommendation:** Publish `@sss/react` or `@sss/wallet-adapter` as a thin React layer. Wagmi did this with Viem — it's the right pattern.

---

### 4.3 No Partial Signing / Hardware Wallet Support

**Gap:** All instructions use `provider.sendAndConfirm` directly. No path for:
- Hardware wallets (Ledger) where transaction must be constructed offline and signed externally
- Multisig flows where authority is a Squads/Goki multisig (transaction must be serialized)
- Versioned transactions (needed for lookup tables on Solana mainnet)

**Recommendation:**
- Add `buildTransaction(params)` methods alongside all mutating calls that return `VersionedTransaction | Transaction` without broadcasting
- Document the sign-then-send flow for hardware wallet users

---

## 5. Production-Readiness Gaps

### 5.1 No Rate Limiting / Compute Unit Optimization

**Gap:** All instructions use default compute budget. On mainnet, priority fees are required during congestion. No module sets `ComputeBudgetProgram.setComputeUnitLimit()` or `setComputeUnitPrice()`.

**Recommendation:** Accept `priorityFee?: number` (micro-lamports) in `SdkOptions` and prepend compute budget instructions automatically.

---

### 5.2 No Logging / Observability

**Gap:** Zero logging hooks. Teams can't instrument SDK calls for Datadog/OpenTelemetry without forking.

**Recommendation:** Accept an optional `logger?: Logger` in `SdkOptions` (compatible with `pino`, `winston`, `console`). Log instruction names, accounts, compute units consumed, and tx signatures.

---

### 5.3 `bigint` vs `number` Inconsistency

**Our SDK:**
- On-chain types use `bigint` correctly (`amount: bigint`)
- REST API types (`MintRequest`, `BurnRequest`) use `number` for `amount`
- `totalMinted`, `totalBurned` in `StablecoinInfo` are `bigint`
- `SupplyResponse` in `api-types.ts` uses `number` for same fields

**Problem:** A stablecoin with 10B+ tokens overflows `number`. JavaScript `number` loses precision above 2^53. At production scale (USDC has 40B+ circulation), `number` is incorrect.

**Recommendation:** Standardize on `bigint` throughout. Convert only at JSON boundary using `JSON.parse` with a revivor.

---

### 5.4 No Package Versioning Strategy / Changelog

**Gap:** No `CHANGELOG.md`, no semver release tagging, no deprecation policy. Any breaking API change silently breaks consumers.

**Recommendation:**
- Use [Conventional Commits](https://www.conventionalcommits.org/) (already in use) + `semantic-release` or `changesets`
- Publish to npm as `@dcccrypto/sss-sdk`
- Add `@deprecated` JSDoc tags before removing anything

---

### 5.5 No `npm pack` / Bundle Size Analysis

**Gap:** `sdk/dist/` exists but no bundle size check in CI. Metaplex Umi is famously tree-shakeable. Our SDK barrel-exports everything from `index.ts` — every consumer pulls 11 modules even if they only use `ComplianceModule`.

**Recommendation:**
- Move to named sub-path exports: `@sss/sdk/compliance`, `@sss/sdk/circuit-breaker`
- Add `bundlesize` or `size-limit` check in CI targeting < 200KB minified

---

## Priority Matrix

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Unified facade client (`SSSStablecoinClient`) | High | Medium | 🔴 P0 |
| Transaction simulation | High | Medium | 🔴 P0 |
| Better error types (codes, cause, context) | High | Low | 🔴 P0 |
| `bigint` standardization across REST types | High | Low | 🔴 P0 |
| Wallet adapter helper / `toAnchorWallet` | High | Low | 🔴 P0 |
| Auto-ATA creation in `mintTo` | Medium | Low | 🟡 P1 |
| SSS-2 atomic init (no footgun) | Medium | Medium | 🟡 P1 |
| `buildTransaction()` for offline signing | Medium | Medium | 🟡 P1 |
| Retry/confirmation strategy | Medium | Medium | 🟡 P1 |
| Compute budget / priority fee support | Medium | Low | 🟡 P1 |
| Event subscription (`stablecoin.on(...)`) | Low | High | 🟢 P2 |
| React hooks (`@sss/react`) | Low | High | 🟢 P2 |
| Tree-shakeable sub-path exports | Low | Medium | 🟢 P2 |
| Logger/observability hook | Low | Low | 🟢 P2 |

---

## Conclusion

The SDK is solid for internal testing and devnet prototyping. To be production-ready for a team building a regulated stablecoin product, the five P0 items must ship before mainnet: a unified facade client, transaction simulation, error quality, bigint consistency, and wallet adapter compatibility. These aren't polish — they're blockers for any serious integration.
