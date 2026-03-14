# `sss-token` CLI

A command-line tool for **stablecoin managers** on Solana. Use it to deploy and operate SPL tokens that follow the [Solana Stablecoin Standard](https://superteam.fun/earn/listing/build-the-solana-stablecoin-standard-bounty) (SSS), with support for Token-2022 and extensions (metadata, freeze, pause, transfer-hook blacklist, etc.).

---

## Table of contents

- [Install & build](#install--build)
- [Two ways to use the CLI](#two-ways-to-use-the-cli)
- [SSS-1 vs SSS-2](#sss-1-vs-sss-2)
- [Tutorial: Deploy a new stablecoin (SSS-1)](#tutorial-deploy-a-new-stablecoin-sss-1)
- [Tutorial: Deploy with blacklist (SSS-2)](#tutorial-deploy-with-blacklist-sss-2)
- [Tutorial: Manage an existing stablecoin](#tutorial-manage-an-existing-stablecoin)
- [Configuration reference](#configuration-reference)
- [Commands reference](#commands-reference)
- [Updating authorities](#updating-authorities)

---

## Install & build

From the `cli/` directory:

```bash
npm install
npm run build
```

Run the CLI:

```bash
npx sss-token --help
```

For development (no build step):

```bash
npm run dev -- <command> [options]
```

Example:

```bash
npm run dev -- init --preset sss-1
```

---

## Two ways to use the CLI

1. **You don't have a stablecoin yet**
   Create a config (or use a preset), then deploy a new Token-2022 mint with the CLI. The config's `mint` field is left empty and is filled after deployment.

2. **You already have a stablecoin**
   Point the CLI at your existing mint by setting `[stablecoin] mint = "<your-mint-address>"` in the config. Use the same config to run operations (mint, burn, freeze, blacklist, status, etc.).

All commands are **config-driven**: by default the CLI looks for `sss-token.config.toml` in the current directory. Override with `--config <path>` when needed.

---

## SSS-1 vs SSS-2

| Feature | SSS-1 | SSS-2 |
|---------|-------|-------|
| On-chain metadata (name, symbol, URI) | Required | Required |
| Mint / freeze / metadata authorities | Required | Required |
| Token-2022 (SPL Token Extensions) | Required | Required |
| Transfer hook (blacklist program) | - | Required |
| Blacklist add / remove / check | - | Yes |
| Pausable extension | Optional | Optional |
| Permanent delegate extension | Optional | Optional |

**SSS-2** is SSS-1 plus an on-chain **blacklist transfer hook**. The hook is an Anchor program (see `transfer_hooks/blacklist/`) that blocks transfers to or from blacklisted wallets. The CLI provides commands to manage the blacklist without writing any code.

---

## Tutorial: Deploy a new stablecoin (SSS-1)

This walkthrough creates a new Token-2022 mint with metadata (name, symbol, URI) on devnet.

### Step 1: Create a config from a preset

```bash
sss-token init --preset sss-1
```

This creates `sss-token.config.toml` in the current directory with:

- `standard = "sss-1"`
- `cluster = "devnet"`
- `[stablecoin]` with name/symbol/decimals and `tokenProgram = "spl-token-2022"`
- `mint = ""` (to be filled after deploy)
- `[authorities]` paths for mint, freeze, and metadata (default: `~/.config/solana/id.json`)
- `[extensions.metadata] enabled = true`

### Step 2: Edit the config (optional)

Open `sss-token.config.toml` and adjust:

- **`[stablecoin]`**
  - `name`, `symbol`, `decimals`
  - `uri` (optional; for metadata, e.g. a JSON or info URL)
- **`[authorities]`**
  - Paths to keypair JSON files for mint, freeze, and metadata.
  - The **mint authority** keypair is used as the transaction payer and mint signer.
  - Ensure these files exist and correspond to wallets with devnet SOL if you use devnet.

For a full list of options, see `example.config.toml`.

### Step 3: Deploy the mint

```bash
sss-token init --custom sss-token.config.toml
```

The CLI will:

1. Create a new Token-2022 mint account (with MetadataPointer extension).
2. Initialize the base mint (decimals, mint authority, freeze authority).
3. Call `tokenMetadataInitialize` to add name, symbol, and URI on-chain.
4. Write the new mint address into the config's `[stablecoin] mint` field.

Example output:

```
=== SSS deploy ===
Standard: sss-1
Cluster: devnet
Token program: spl-token-2022
Name / symbol / decimals: MyUSD MUSD 6
Metadata extension: enabled (on-mint name, symbol, uri)

Created mint: 7NDkaMubatXw8fHQ2zNU4eid8Nkh5vG9SxQMSzUyE9SM
Updated config with mint address: /path/to/sss-token.config.toml
Deployment complete.
```

After this, the same config file is ready for all management commands.

---

## Tutorial: Deploy with blacklist (SSS-2)

SSS-2 adds a **transfer-hook blacklist** to the mint. Every transfer passes through an on-chain Anchor program that checks whether the sender or recipient is blacklisted.

### Prerequisites

You need a deployed instance of the `blacklist_hook` program (see `transfer_hooks/blacklist/`). Build and deploy it with Anchor:

```bash
cd transfer_hooks/blacklist
anchor build
anchor deploy          # note the program ID printed
```

### Step 1: Create a config

```bash
sss-token init --preset sss-2
```

### Step 2: Fill in the hook program ID

Open `sss-token.config.toml` and set:

```toml
[extensions.transferHook]
enabled = true
programId = "<your-deployed-blacklist_hook-program-id>"
```

Also verify that `[authorities] blacklist` points to the keypair that should act as the blacklist admin.

### Step 3: Deploy

```bash
sss-token init --custom sss-token.config.toml
```

The CLI will:

1. Create the Token-2022 mint with **MetadataPointer** and **TransferHook** extensions.
2. Initialize on-mint metadata (name, symbol, URI).
3. Initialize the blacklist hook's **Config PDA** (sets the admin authority).
4. Initialize the **ExtraAccountMetaList PDA** (tells Token-2022 which extra accounts the hook needs at transfer time).
5. Write the new mint address into the config.

Example output:

```
=== SSS deploy ===
Standard: sss-2
Cluster: devnet
Token program: spl-token-2022
Name / symbol / decimals: MyUSD MUSD 6
Metadata extension: enabled (on-mint name, symbol, uri)
Transfer hook extension: enabled (program: 84rPjkmm...)

Created mint: 9Xz...abc
Initializing blacklist hook on-chain...
Initialized blacklist config PDA: Cfg...xyz
Initialized extra-account-metas PDA: Ext...xyz
Updated config with mint address: /path/to/sss-token.config.toml
Deployment complete.
```

### Step 4: Use blacklist commands

```bash
# Block a wallet from sending or receiving the stablecoin
sss-token blacklist add <wallet-address>

# Unblock a wallet
sss-token blacklist remove <wallet-address>

# Check if a wallet is blacklisted
sss-token blacklist check <wallet-address>
```

All other operations (`mint`, `burn`, `freeze`, `thaw`, `status`, etc.) work exactly like SSS-1.

---

## Tutorial: Manage an existing stablecoin

If the stablecoin is already deployed, you only need a config that points at it.

1. **Create or copy a config** (e.g. from `example.config.toml`).
2. Set **`[stablecoin] mint = "<your-mint-address>"`**.
3. Set **`[authorities]`** to the keypair paths that hold:
   - **mint** authority (for minting, and often as payer)
   - **freeze** authority (for freeze/thaw)
   - **metadata** authority (for metadata updates; Token-2022 MetadataPointer)
   - **blacklist** authority (SSS-2 only; for managing the blacklist)
4. Set **`cluster`** and optionally **`rpcUrl`** to match the mint's network.
5. If using SSS-2, set **`[extensions.transferHook] enabled = true`** and the **`programId`**.

No need to run `init --custom` again; use the operations below.

---

## Configuration reference

The CLI expects a TOML file with the following structure.

### Top-level

| Field      | Description |
|-----------|-------------|
| `standard` | `"sss-1"` or `"sss-2"` (SSS profile). |
| `cluster`  | `"devnet"`, `"testnet"`, `"mainnet-beta"`, or a custom label. |
| `rpcUrl`   | Optional. Overrides the default RPC for the cluster. |

### `[stablecoin]`

| Field           | Description |
|----------------|-------------|
| `name`         | Human-readable token name. |
| `symbol`       | Ticker symbol. |
| `decimals`     | Number of decimals (e.g. `6`). |
| `tokenProgram` | `"spl-token-2022"` (recommended) or `"spl-token"`. |
| `uri`          | Optional. URI for Token-2022 metadata (e.g. JSON URL). |
| `mint`         | Mint address. Empty before deploy; filled by `sss-token init --custom`. |

### `[authorities]`

Paths to keypair JSON files (Solana keypair format). `~` is expanded.

| Field                | Description |
|----------------------|-------------|
| `mint`               | Mint authority (required for minting). |
| `freeze`             | Freeze authority (required for freeze/thaw). |
| `metadata`           | Metadata (MetadataPointer) update authority. |
| `permanentDelegate`  | Optional. Permanent delegate authority. |
| `pause`              | Optional. Pause authority (Pausable extension). |
| `blacklist`          | Optional. Blacklist admin authority (SSS-2 / transfer hook). |

### `[extensions.*]`

Which Token-2022 extensions are enabled (used at deploy time for new mints).

- **`[extensions.metadata]`** -- `enabled = true/false`. SSS-1 and SSS-2 both use on-mint metadata.
- **`[extensions.pausable]`** -- `enabled = true/false`.
- **`[extensions.permanentDelegate]`** -- `enabled = true/false`.
- **`[extensions.transferHook]`** -- `enabled = true/false`, `programId = "<id>"`. Required for SSS-2.

See `example.config.toml` for a full sample.

---

## Commands reference

### `init` -- Create config or deploy mint

```bash
sss-token init --preset sss-1
sss-token init --preset sss-2
sss-token init --custom <path-to-config.toml>
```

- **`--preset sss-1`** / **`--preset sss-2`**
  Writes a new `sss-token.config.toml` with that preset. Does not deploy.
- **`--custom <path>`**
  Deploys a new mint from the given config. Requires `mint = ""`. Writes the new mint address back into the config. For SSS-2, also initializes the blacklist hook's Config and ExtraAccountMetas PDAs.

---

### `mint` -- Mint tokens to a recipient

```bash
sss-token mint <recipient> <amount> [--config <path>]
```

- **`<recipient>`** -- Solana wallet address (base58). The CLI creates the associated token account (ATA) for the mint if it does not exist.
- **`<amount>`** -- Amount in **raw units** (smallest decimals). For 6 decimals, `1000000` = 1 token.

---

### `burn` -- Burn tokens

```bash
sss-token burn <amount> [--config <path>]
```

Burns `<amount>` (raw units) from the **mint authority's** token account for this mint.

---

### `freeze` / `thaw` -- Freeze or unfreeze a token account

```bash
sss-token freeze <address> [--config <path>]
sss-token thaw <address> [--config <path>]
```

- **`<address>`** -- The **token account** (not the wallet) to freeze or thaw.

---

### `pause` / `unpause` -- Pause or resume mint activity (Token-2022 Pausable)

```bash
sss-token pause [--config <path>]
sss-token unpause [--config <path>]
```

Only applies to mints with the Token-2022 **Pausable** extension.

---

### `blacklist` -- Manage the transfer-hook blacklist (SSS-2)

These commands interact with the on-chain blacklist Anchor program. They require:
- `[extensions.transferHook] enabled = true` and a valid `programId` in the config.
- `[authorities] blacklist` pointing to the blacklist admin keypair.

#### `blacklist add` -- Block a wallet

```bash
sss-token blacklist add <wallet> [--config <path>]
```

Adds the wallet to the blacklist. Future transfers to or from this wallet will be rejected by the transfer hook. If the wallet has never been blacklisted before, a new on-chain PDA is created. If it was previously unblacklisted, the existing PDA is updated.

#### `blacklist remove` -- Unblock a wallet

```bash
sss-token blacklist remove <wallet> [--config <path>]
```

Sets the wallet's blacklist entry to `blocked = false`. The PDA remains on-chain so the transfer hook can still resolve it, but transfers are allowed again.

#### `blacklist check` -- Query blacklist status

```bash
sss-token blacklist check <wallet> [--config <path>]
```

Reads the wallet's blacklist PDA and prints whether it is currently blocked. This is a **read-only** operation (no transaction, no authority needed).

Example output:

```
Wallet: 9abc...xyz
Blacklist PDA: BLk...pda
Blacklisted: true
```

#### `blacklist close` -- Reclaim rent for an unblocked entry

```bash
sss-token blacklist close <wallet> [--config <path>]
```

Closes the BlacklistEntry PDA for a wallet that has `blocked = false`, reclaiming rent to the admin. Fails if the entry is still blocked — you must `blacklist remove` first.

#### `blacklist transfer-admin` -- Nominate a new admin

```bash
sss-token blacklist transfer-admin <new-admin-pubkey> [--config <path>]
```

Initiates a two-step admin transfer. The nominated admin must call `accept-admin` to finalize. The current admin remains active until the transfer is accepted.

#### `blacklist accept-admin` -- Accept admin role

```bash
sss-token blacklist accept-admin <keypair-path> [--config <path>]
```

Accepts a pending admin nomination. `<keypair-path>` is the path to the nominated admin's keypair JSON file. After acceptance, update your config's `[authorities] blacklist` to the new keypair path.

---

### `status` -- Token and supply snapshot

```bash
sss-token status [--config <path>]
```

Prints config (standard, cluster, mint) and on-chain info: supply, decimals, and current mint/freeze authorities.

---

### `supply` -- Total supply only

```bash
sss-token supply [--config <path>]
```

Prints the current total supply (raw and human-readable) for the configured mint.

---

### `balance` -- Balance of an address

```bash
sss-token balance <address> [--config <path>]
```

- **`<address>`** -- Wallet address (base58). The CLI resolves the **associated token account** for the configured mint and prints its balance. If the ATA does not exist, the balance is 0.

---

### `set-authority` -- Update an authority

```bash
sss-token set-authority <type> <new-authority> [--config <path>]
```

- **`<type>`** -- One of: `mint`, `freeze`, `metadata`, `metadata-pointer`, `pause`, `permanent-delegate`, `transfer-fee-config`, `close-mint`, `interest-rate`.
- **`<new-authority>`** -- New authority public key (base58), or `none` to remove.

Examples:

```bash
sss-token set-authority mint 9abc...xyz
sss-token set-authority freeze none
```

---

### `audit-log` -- Recent transactions for the mint

```bash
sss-token audit-log [--limit <n>] [--config <path>] [--action <type>]
```

- **`--limit <n>`** -- How many recent signatures to fetch (default `20`, max `1000`).
- **`--action <type>`** -- Reserved for future filtering. Currently informational only.

---

## Updating authorities

After deployment, you can change who can mint, freeze, update metadata, or pause:

1. Ensure the **current** authority keypair for that type is in your config.
2. Run:
   ```bash
   sss-token set-authority <type> <new-pubkey>
   ```
3. Update your config to point to the new keypair path for future CLI commands. The on-chain mint already has the new authority; the config only tells the CLI which keypair to use when signing.

> **Note:** The blacklist admin authority is stored in the hook program's Config PDA, not the mint itself. Use `blacklist transfer-admin` and `blacklist accept-admin` for a secure two-step admin transfer.
