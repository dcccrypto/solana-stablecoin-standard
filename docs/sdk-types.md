# SDK TypeScript Types Reference

This document is the authoritative reference for every public type, interface, and enum exported by `@stbr/sss-token`.

---

## Table of Contents

- [Core Configuration](#core-configuration)
  - [Preset](#preset)
  - [SssConfig](#sssconfig)
  - [SdkOptions](#sdkoptions)
- [On-Chain Operation Parameters](#on-chain-operation-parameters)
  - [MintParams](#mintparams)
  - [BurnParams](#burnparams)
  - [FreezeParams](#freezeparams)
  - [MinterConfig](#minterconfig)
  - [UpdateMinterParams](#updateminterparams)
  - [RevokeMinterParams](#revokeminterparams)
  - [UpdateRolesParams](#updaterolesparams)
  - [ProposeAuthorityParams](#proposeauthorityparams)
  - [DepositCollateralParams](#depositcollateralparams)
  - [RedeemParams](#redeemparams)
- [On-Chain State](#on-chain-state)
  - [StablecoinInfo](#stablecoininfo)
- [REST API Types](#rest-api-types)
  - [ApiResponse](#apiresponse)
  - [HealthData](#healthdata)
  - [MintRequest / MintEvent](#mintrequest--mintevent)
  - [BurnRequest / BurnEvent](#burnrequest--burnevent)
  - [SupplyResponse](#supplyresponse)
  - [EventsResponse](#eventsresponse)
  - [BlacklistRequest / BlacklistEntry](#blacklistrequest--blacklistentry)
  - [AuditEntry / AuditQuery](#auditentry--auditquery)
  - [EventKind](#eventkind)
  - [WebhookRequest / WebhookEntry](#webhookrequest--webhookentry)
  - [ApiKeyListEntry / ApiKeyEntry](#apikeylistentry--apikeyentry)
- [Error Handling](#error-handling)
  - [SSSError](#ssserror)
- [Preset Helpers](#preset-helpers)
  - [SSS1_PRESET / SSS2_PRESET](#sss1_preset--sss2_preset)
  - [sss1Config / sss2Config](#sss1config--sss2config)

---

## Core Configuration

### `Preset`

```ts
type Preset = 'SSS-1' | 'SSS-2' | 'SSS-3';
```

Identifies the Solana Stablecoin Standard compliance level of a token:

| Value   | Description                                            |
|---------|--------------------------------------------------------|
| `SSS-1` | Minimal — Token-2022 mint + freeze + metadata          |
| `SSS-2` | Compliant — SSS-1 + permanent delegate + transfer hook |
| `SSS-3` | Reserve-backed — SSS-2 + collateral vault              |

---

### `SssConfig`

Full configuration for creating a new stablecoin on-chain.

```ts
interface SssConfig {
  preset: Preset;
  decimals?: number;
  name: string;
  symbol: string;
  uri?: string;
  transferHookProgram?: PublicKey;
  collateralMint?: PublicKey;
  reserveVault?: PublicKey;
  maxSupply?: bigint;
}
```

| Field                | Required for       | Description                                                  |
|----------------------|--------------------|--------------------------------------------------------------|
| `preset`             | All                | SSS compliance level                                         |
| `name`               | All                | Human-readable token name (stored in on-chain metadata)      |
| `symbol`             | All                | Token ticker symbol (e.g. `"USDX"`)                          |
| `decimals`           | —                  | Token decimal places. Default: `6`                           |
| `uri`                | —                  | Off-chain metadata URI (JSON). Default: `""`                 |
| `transferHookProgram`| SSS-2, SSS-3       | Program enforcing blacklist checks on every transfer         |
| `collateralMint`     | SSS-3              | Collateral token mint (e.g. devnet USDC)                     |
| `reserveVault`       | SSS-3              | Token account holding the collateral reserve                 |
| `maxSupply`          | —                  | Hard cap in base units. `0n` or `undefined` = unlimited      |

**Example:**
```ts
const config: SssConfig = {
  preset: 'SSS-1',
  name: 'USD Example',
  symbol: 'USDX',
  decimals: 6,
  maxSupply: 1_000_000_000n * 1_000_000n, // 1 billion tokens
};
```

---

### `SdkOptions`

Options passed to the `SolanaStablecoin` or `ComplianceModule` constructor.

```ts
interface SdkOptions {
  connection: Connection;
  provider: AnchorProvider;
  programId?: PublicKey;
}
```

| Field       | Description                                                              |
|-------------|--------------------------------------------------------------------------|
| `connection`| `@solana/web3.js` `Connection` to the cluster                           |
| `provider`  | Anchor provider wrapping the wallet and connection                       |
| `programId` | Override for the SSS token program address. Defaults to `SSS_TOKEN_PROGRAM_ID` |

---

## On-Chain Operation Parameters

### `MintParams`

Parameters for minting new tokens to a recipient account.

```ts
interface MintParams {
  mint: PublicKey;
  amount: bigint;
  recipient: PublicKey;
}
```

| Field       | Description                                        |
|-------------|----------------------------------------------------|
| `mint`      | The stablecoin mint address                        |
| `amount`    | Number of tokens to mint in base units             |
| `recipient` | Destination wallet (ATA is derived automatically)  |

---

### `BurnParams`

Parameters for burning tokens from a source account.

```ts
interface BurnParams {
  mint: PublicKey;
  amount: bigint;
  source: PublicKey;
}
```

| Field    | Description                                              |
|----------|----------------------------------------------------------|
| `mint`   | The stablecoin mint address                              |
| `amount` | Number of tokens to burn in base units                   |
| `source` | Token account to burn from (must be owned by the signer) |

---

### `FreezeParams`

Parameters for freezing or thawing a token account (compliance enforcement).

```ts
interface FreezeParams {
  mint: PublicKey;
  targetTokenAccount: PublicKey;
}
```

Used by both `SolanaStablecoin.freeze()` and `SolanaStablecoin.thaw()`.

---

### `MinterConfig`

Describes a registered minter and its optional cap.

```ts
interface MinterConfig {
  minter: PublicKey;
  cap?: bigint;
}
```

| Field    | Description                                   |
|----------|-----------------------------------------------|
| `minter` | Minter wallet address                         |
| `cap`    | Maximum mintable amount. `0n` = unlimited      |

---

### `UpdateMinterParams`

Register or update a minter's mint cap.

```ts
interface UpdateMinterParams {
  minter: PublicKey;
  cap: bigint;
}
```

Pass `cap: 0n` to grant unlimited minting rights.

---

### `RevokeMinterParams`

Remove a minter's on-chain permission.

```ts
interface RevokeMinterParams {
  minter: PublicKey;
}
```

---

### `UpdateRolesParams`

Update the admin or compliance authority. Omit a field to leave it unchanged.

```ts
interface UpdateRolesParams {
  newAuthority?: PublicKey;
  newComplianceAuthority?: PublicKey;
}
```

> **Note:** Use `ProposeAuthorityParams` + `acceptAuthority()` for a safer two-step authority handoff.

---

### `ProposeAuthorityParams`

Initiate a two-step admin authority transfer (SSS-019).

```ts
interface ProposeAuthorityParams {
  proposed: PublicKey;
}
```

The proposed address must call `acceptAuthority()` to complete the transfer. Until then, the current authority remains in control.

---

### `DepositCollateralParams`

Deposit collateral tokens into the SSS-3 reserve vault.

```ts
interface DepositCollateralParams {
  amount: bigint;
  depositorCollateral: PublicKey;
  reserveVault: PublicKey;
  collateralMint: PublicKey;
}
```

| Field                | Description                                           |
|----------------------|-------------------------------------------------------|
| `amount`             | Collateral amount in base units                       |
| `depositorCollateral`| Signer's collateral token account (source)            |
| `reserveVault`       | Reserve vault token account (destination)             |
| `collateralMint`     | Collateral token mint (e.g. USDC)                     |

---

### `RedeemParams`

Burn SSS tokens in exchange for collateral from the reserve vault (SSS-3).

```ts
interface RedeemParams {
  amount: bigint;
  redeemerSssAccount: PublicKey;
  collateralMint: PublicKey;
  reserveVault: PublicKey;
  redeemerCollateral: PublicKey;
  collateralTokenProgram?: PublicKey;
}
```

| Field                  | Description                                              |
|------------------------|----------------------------------------------------------|
| `amount`               | SSS tokens to burn in base units                         |
| `redeemerSssAccount`   | Redeemer's SSS token account (source of tokens to burn)  |
| `collateralMint`       | Collateral token mint                                    |
| `reserveVault`         | Reserve vault (source of collateral)                     |
| `redeemerCollateral`   | Redeemer's collateral token account (receives collateral)|
| `collateralTokenProgram`| Token program for collateral. Default: `TOKEN_PROGRAM_ID`|

---

## On-Chain State

### `StablecoinInfo`

Decoded on-chain state for a stablecoin account. Returned by `SolanaStablecoin.getInfo()`.

```ts
interface StablecoinInfo {
  mint: PublicKey;
  authority: PublicKey;
  complianceAuthority: PublicKey;
  pendingAuthority?: PublicKey;
  pendingComplianceAuthority?: PublicKey;
  preset: number;
  paused: boolean;
  totalMinted: bigint;
  totalBurned: bigint;
  circulatingSupply: bigint;
  maxSupply?: bigint;
  collateralMint?: PublicKey;
  totalCollateral?: bigint;
}
```

| Field                        | Description                                                       |
|------------------------------|-------------------------------------------------------------------|
| `mint`                       | Token-2022 mint address                                           |
| `authority`                  | Current admin authority                                           |
| `complianceAuthority`        | Current compliance authority                                      |
| `pendingAuthority`           | Proposed new admin (two-step transfer in progress)               |
| `pendingComplianceAuthority` | Proposed new compliance authority (two-step transfer in progress)|
| `preset`                     | Numeric preset: `1` = SSS-1, `2` = SSS-2, `3` = SSS-3           |
| `paused`                     | `true` if all minting/burning is halted                          |
| `totalMinted`                | Cumulative tokens ever minted (base units)                        |
| `totalBurned`                | Cumulative tokens ever burned (base units)                        |
| `circulatingSupply`          | `totalMinted - totalBurned`                                       |
| `maxSupply`                  | Hard cap; `0n` = unlimited                                        |
| `collateralMint`             | SSS-3 only — collateral token mint                                |
| `totalCollateral`            | SSS-3 only — collateral held in the reserve vault (base units)   |

---

## REST API Types

These types model the JSON payloads for the Rust/Axum REST backend (`/api/...`).

### `ApiResponse<T>`

Generic envelope wrapping all API responses.

```ts
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}
```

On success: `success: true`, `data: T`, `error: null`.  
On failure: `success: false`, `data: null`, `error: "<message>"`.

---

### `HealthData`

Response body for `GET /health`.

```ts
interface HealthData {
  status: string;    // e.g. "ok"
  version: string;   // e.g. "0.1.0"
  timestamp: string; // ISO 8601
}
```

---

### `MintRequest / MintEvent`

```ts
interface MintRequest {
  token_mint: string;
  amount: number;
  recipient: string;
  tx_signature?: string;
}

interface MintEvent {
  id: string;
  token_mint: string;
  amount: number;
  recipient: string;
  tx_signature: string | null;
  created_at: string; // ISO 8601
}
```

`MintRequest` is the POST body for `POST /api/mint`.  
`MintEvent` is returned by `GET /api/events` and webhook deliveries.

---

### `BurnRequest / BurnEvent`

```ts
interface BurnRequest {
  token_mint: string;
  amount: number;
  source: string;
  tx_signature?: string;
}

interface BurnEvent {
  id: string;
  token_mint: string;
  amount: number;
  source: string;
  tx_signature: string | null;
  created_at: string; // ISO 8601
}
```

`BurnRequest` is the POST body for `POST /api/burn`.  
`BurnEvent` is returned by `GET /api/events` and webhook deliveries.

---

### `SupplyResponse`

Response body for `GET /api/supply`.

```ts
interface SupplyResponse {
  token_mint: string;
  total_minted: number;
  total_burned: number;
  circulating_supply: number;
}
```

> All amounts are in base units (accounting for decimals).

---

### `EventsResponse`

Response body for `GET /api/events`.

```ts
interface EventsResponse {
  mint_events: MintEvent[];
  burn_events: BurnEvent[];
}
```

Supports offset-based pagination via `?limit=<n>&offset=<n>` query parameters (SSS-011).

---

### `BlacklistRequest / BlacklistEntry`

```ts
interface BlacklistRequest {
  address: string;
  reason: string;
}

interface BlacklistEntry {
  id: string;
  address: string;
  reason: string;
  created_at: string; // ISO 8601
}
```

`BlacklistRequest` is the POST body for `POST /api/compliance/blacklist`.  
`BlacklistEntry` is returned in `GET /api/compliance/blacklist` listings.

---

### `AuditEntry / AuditQuery`

```ts
interface AuditEntry {
  id: string;
  action: string;   // e.g. "BLACKLIST_ADD", "BLACKLIST_REMOVE"
  address: string;
  details: string;
  created_at: string; // ISO 8601
}

interface AuditQuery {
  address?: string; // Filter by wallet address (exact match)
  action?: string;  // Filter by action type
  limit?: number;   // Default: 100, max: 1000
}
```

`AuditQuery` maps to query parameters for `GET /api/compliance/audit`.

---

### `EventKind`

```ts
type EventKind = 'mint' | 'burn' | 'all';
```

Used in `WebhookRequest.events` to subscribe a webhook to specific event types.

---

### `WebhookRequest / WebhookEntry`

```ts
interface WebhookRequest {
  url: string;
  events: EventKind[];
}

interface WebhookEntry {
  id: string;
  url: string;
  events: EventKind[];
  created_at: string; // ISO 8601
}
```

`WebhookRequest` is the POST body for `POST /api/webhooks`.  
`WebhookEntry` is returned in `GET /api/webhooks` listings.

---

### `ApiKeyListEntry / ApiKeyEntry`

```ts
// Returned by GET /api/keys (never reveals the full key)
interface ApiKeyListEntry {
  id: string;
  label: string;
  key_prefix: string; // e.g. "sss_abc123..."
  created_at: string;
}

// Returned once by POST /api/keys (full key, shown only at creation)
interface ApiKeyEntry {
  id: string;
  key: string;   // Full API key — store securely, not retrievable later
  label: string;
  created_at: string;
}
```

---

## Error Handling

### `SSSError`

Thrown by `SSSClient` when the REST API returns a non-2xx response.

```ts
class SSSError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number);
}
```

| Property     | Description                        |
|--------------|------------------------------------|
| `message`    | Human-readable error description   |
| `name`       | Always `"SSSError"`                |
| `statusCode` | HTTP status code (e.g. `401`, `429`)|

**Example:**
```ts
import { SSSClient, SSSError } from '@stbr/sss-token';

try {
  await client.mint({ token_mint: mintAddr, amount: 1000, recipient: wallet });
} catch (err) {
  if (err instanceof SSSError) {
    console.error(`API error ${err.statusCode}: ${err.message}`);
    if (err.statusCode === 429) {
      // Read Retry-After header and back off
    }
  }
}
```

On-chain errors from `SolanaStablecoin` are thrown as standard Anchor `ProgramError` objects (not `SSSError`).

---

## Preset Helpers

### `SSS1_PRESET / SSS2_PRESET`

Constant partial configs with sensible defaults for each preset.

```ts
const SSS1_PRESET = {
  preset: 'SSS-1' as const,
  decimals: 6,
  uri: '',
};

const SSS2_PRESET = {
  preset: 'SSS-2' as const,
  decimals: 6,
  uri: '',
};
```

---

### `sss1Config / sss2Config`

Factory functions that merge your overrides with the preset defaults.

```ts
function sss1Config(overrides: Omit<SssConfig, 'preset'>): SssConfig;
function sss2Config(overrides: Omit<SssConfig, 'preset'>): SssConfig;
```

`sss2Config` validates that `transferHookProgram` is provided and throws if it is missing.

**Examples:**
```ts
import { sss1Config, sss2Config } from '@stbr/sss-token';
import { PublicKey } from '@solana/web3.js';

// SSS-1: minimal
const config1 = sss1Config({ name: 'USD Example', symbol: 'USDX' });

// SSS-2: compliant (transfer hook required)
const config2 = sss2Config({
  name: 'Regulated USD',
  symbol: 'RUSD',
  transferHookProgram: new PublicKey('Hook1111...'),
});
```

---

## Constants

| Constant                      | Description                             |
|-------------------------------|-----------------------------------------|
| `SSS_TOKEN_PROGRAM_ID`        | Default on-chain SSS token program ID   |
| `SSS_TRANSFER_HOOK_PROGRAM_ID`| Default transfer hook program ID        |

Both are re-exported from the package root and can be overridden via `SdkOptions.programId`.
