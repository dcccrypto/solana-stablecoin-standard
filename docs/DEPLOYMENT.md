# SSS Devnet Deployment

## 2026-03-28 — SSS-DEVNET-002 Fresh Deploy

**Network:** Solana Devnet
**Deployed by:** sss-devops (ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB)
**Slot:** 451673869

### Program IDs

| Program | Address |
|---------|---------|
| SSS Token | `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY` |
| Transfer Hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

**Note:** Old program `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` (SSS-DEVNET-001) was closed. Fresh deploy with new keypair.

### Deploy Signature
`RvATRYs6EZpFPWqTB4Vf4VziYmczKyfajLbzkFGfiNTcEuNcRMA1abyKxHMzqNzc3zCYm9GHmsygyewUV6XEMWd`

### Verification
```bash
solana program show 2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY --url devnet
```

## Previous Deploy (2026-03-22, SSS-DEVNET-001)
- SSS Token: `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` (CLOSED)
- Transfer Hook: `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

## 2026-03-31 — SSS-DEVNET-003 Redeploy (SSS-147A fix)

**Network:** Solana Devnet
**Reason:** Redeploy to include SSS-147A (RequiresSquadsForSSS3) from PR #331
**Slot:** 452237697

### Program IDs

| Program | Address |
|---------|---------|
| SSS Token | `ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811` |
| Transfer Hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

**Deploy Signature:** `62U6BqXui7eWeWKzX9E7uSRd2UHKdtdUKhCZM6uAWzVHiYuKPqyXHQkpdtUg5bfAWUPgfSaQPc4ebwUKjny1xu4w`
