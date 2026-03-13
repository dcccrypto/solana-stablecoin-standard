## `sss-token` CLI

CLI for working with Solana Stablecoin Standard tokens.  
Right now it focuses on **SSS‑1** and is wired for local config + dry‑run commands; on‑chain integration will be added next.

### Install & build

From the `cli/` folder:

```bash
npm install
npm run build
```

You can then run the CLI with:

```bash
npx sss-token --help
```

During development you can skip the build step and run:

```bash
npm run dev -- <command> [options]
```

Example:

```bash
npm run dev -- init --preset sss-1
```

You can also inspect a full example config at:

- `example.config.toml`

### Config model

The CLI is config‑driven. It expects a TOML file describing:

- **standard**: `"sss-1"` or `"sss-2"` (which Stablecoin Standard profile you target)
- **cluster**: `"devnet"`, `"testnet"`, `"mainnet-beta"`, or custom RPC label
- **rpcUrl**: optional custom RPC endpoint

Plus nested sections:

- **`[stablecoin]`**:
  - `name`: human name, e.g. `"My Stablecoin"`
  - `symbol`: ticker, e.g. `"MUSD"`
  - `decimals`: number of decimals, e.g. `6`
  - `tokenProgram`: `"spl-token-2022"` (recommended for Token Extensions) or `"spl-token"`
  - `mint`: the mint address of the SPL token – **blank before deploy**, filled after on‑chain deployment
- **`[authorities]`**:
  - `mint`: keypair path for the mint authority
  - `freeze`: keypair path for the freeze authority
  - `metadata`: keypair path for the metadata authority
  - `permanentDelegate` (optional): keypair path for the permanent delegate authority
  - `pause` (optional): keypair path for the pause authority (Pausable extension)
- **`[extensions.*]`**: which Token‑2022 extensions to enable:
  - `[extensions.metadata]`: `{ enabled = true }` – required for SSS‑1
  - `[extensions.pausable]`: `{ enabled = true/false }`
  - `[extensions.permanentDelegate]`: `{ enabled = true/false }`
  - `[extensions.transferHook]`: `{ enabled = true/false, programId = "<hook_program_id>" }`

By default the CLI looks for `sss-token.config.toml` in the current working directory.  
You can override this with `--config <path>` on relevant commands.

If you want to see **all** available options in one place, open `example.config.toml`.

### `init` – configure or deploy

Configure a new stablecoin (via a preset) or deploy from an existing config.

```bash
sss-token init --preset sss-1
sss-token init --preset sss-2
sss-token init --custom path/to/config.toml
```

- **`--preset sss-1`**: writes a starter `sss-token.config.toml` in the current directory, with:
  - `standard = "sss-1"`
  - `cluster = "devnet"`
  - `[stablecoin]` name/symbol/decimals, `tokenProgram = "spl-token-2022"`, `mint = ""`
  - `[authorities]` for `mint`, `freeze`, `metadata` all pointing to `~/.config/solana/id.json`
  - `[extensions.metadata].enabled = true`, other extensions disabled
- **`--preset sss-2`**: same structure but with `standard = "sss-2"` (future profile with additional extensions).
- **`--custom`**: loads an existing TOML file and runs a **deployment dry‑run**:
  - validates the config shape and authorities
  - prints a summary of which extensions and authorities will be used
  - in future iterations, this will:
    - create the mint using the chosen token program,
    - initialize the requested extensions, and
    - write the resulting `stablecoin.mint` back into the TOML file.

### `mint` – SSS‑1 minting

Mint new stablecoins to a given recipient address.

```bash
sss-token mint <recipient> <amount> [--config <path>]
```

- **`<recipient>`**: base58 Solana address to receive tokens.
- **`<amount>`**: amount to mint, parsed as an integer (`BigInt`) in base units.
- **`--config`**: optional path to a config file (defaults to `sss-token.config.toml`).

Current behavior:

- Loads the config and enforces `standard === "sss-1"`.
- Logs a **dry‑run** message describing what would be minted (recipient, amount, mint, cluster).
- Does **not** yet send a transaction; this is where SSS‑1 on‑chain logic will be wired in.

### `burn` – SSS‑1 burn

Burn tokens from the authority’s account.

```bash
sss-token burn <amount> [--config <path>]
```

- **`<amount>`**: amount to burn, parsed as `BigInt` in base units.
- **`--config`**: optional path to a config file (defaults to `sss-token.config.toml`).

Current behavior:

- Loads the config and enforces `standard === "sss-1"`.
- Logs a **dry‑run** message describing what would be burned from the authority.

### `status` – snapshot of the token

Show a quick snapshot of the token configuration.

```bash
sss-token status [--config <path>]
```

Outputs:

- Standard (currently must be `sss-1`).
- Cluster.
- Mint address (or placeholder if not set).
- Authority keypair path.
- A note that on‑chain queries (supply, authorities) are not yet implemented.

### Roadmap (to be implemented)

The CLI is intentionally structured so additional SSS operations can be slotted in:

- **Freeze / thaw / pause / unpause** for SSS‑1.
- **SSS‑2** features like blacklist, seize, audit log, etc.
- A shared SDK layer so the CLI becomes a thin wrapper around reusable TypeScript APIs.

As new commands are added, this README should be kept in sync: each new command should get a short description, usage snippet, and any config implications.

