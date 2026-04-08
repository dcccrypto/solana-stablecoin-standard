# sss-token CLI

**Command-line interface for the Solana Stablecoin Standard backend.**

Interact with the SSS REST API from your terminal — record mints/burns, manage compliance, check supply, and more.

---

## Installation

```bash
# From the monorepo root
npm run build

# Or directly
cd cli && npm install && npm run build
```

---

## Usage

```bash
sss-token <command> [options]
```

### Commands

| Command | Description |
|---|---|
| `mint` | Record a mint event |
| `burn` | Record a burn event |
| `supply` | Get current token supply |
| `events` | List mint/burn events |
| `blacklist add <address>` | Add address to blacklist |
| `blacklist remove <address>` | Remove from blacklist |
| `blacklist list` | List blacklisted addresses |
| `health` | Check backend health |

### Options

| Flag | Description |
|---|---|
| `--api-url` | Backend URL (default: `http://localhost:3000`) |
| `--api-key` | API key for authentication |
| `--format` | Output format: `json` or `table` |

### Examples

```bash
# Record a mint
sss-token mint --amount 1000000 --recipient <PUBKEY> --tx-sig <SIG>

# Check supply
sss-token supply

# List recent events
sss-token events --limit 20

# Manage blacklist
sss-token blacklist add <PUBKEY>
sss-token blacklist list
```

---

## Configuration

Set environment variables to avoid repeating flags:

```bash
export SSS_API_URL=http://localhost:3000
export SSS_API_KEY=your-key-here
```

---

## License

Apache 2.0
