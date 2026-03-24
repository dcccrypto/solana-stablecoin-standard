# SSS Authority Rotation

Introduced in **SSS-120**. Provides a time-locked, two-party handoff for
transferring stablecoin config authority, with a backup recovery path if the
incoming authority is unresponsive.

---

## Overview

Changing the authority of a `StablecoinConfig` is high-risk: a single bad
transaction can lock out the protocol operator permanently.  SSS-120
replaces the old one-step `accept_authority` flow with a three-party,
time-locked protocol:

```
Current authority  ──propose──►  AuthorityRotationRequest PDA (48 hr timelock)
                                        │
                    ◄──accept──  New authority  (within 48 hr window)
                                        │
                    ◄──emergency──  Backup authority  (after 7-day window)
```

| Phase | Who | Condition |
|---|---|---|
| Propose | Current authority | Any time (no pending rotation) |
| Accept | New authority | After `proposed_slot + ROTATION_TIMELOCK_SLOTS` (≥ 48 h) |
| Emergency recover | Backup authority | After `proposed_slot + EMERGENCY_RECOVERY_SLOTS` (≥ 7 days) |
| Cancel | Current authority | Any time before accept/emergency |

**Constants (slot-based)**

| Constant | Slots | Approximate time |
|---|---|---|
| `ROTATION_TIMELOCK_SLOTS` | 432 000 | 48 hours @ 400 ms/slot |
| `EMERGENCY_RECOVERY_SLOTS` | 3 024 000 | 7 days @ 400 ms/slot |

---

## PDA

### `AuthorityRotationRequest`

Seeds: `[b"authority-rotation-request", sss_mint]`

One per stablecoin mint; created by `propose_authority_rotation`,
closed (rent reclaimed) by accept, emergency recover, or cancel.

| Field | Type | Description |
|---|---|---|
| `config_mint` | `Pubkey` | Stablecoin mint this rotation applies to |
| `current_authority` | `Pubkey` | Authority at proposal time |
| `new_authority` | `Pubkey` | Proposed incoming authority |
| `backup_authority` | `Pubkey` | Fallback if new authority is unresponsive |
| `proposed_slot` | `u64` | Slot at which the proposal was created |
| `timelock_slots` | `u64` | Minimum slots before accept is permitted |
| `bump` | `u8` | PDA bump seed |

**Space:** 8 (discriminator) + 145 bytes = 153 bytes total.

---

## Instruction Reference

### `propose_authority_rotation`

Creates the `AuthorityRotationRequest` PDA. Current authority only.
A stablecoin can have at most one pending rotation at a time (re-init
is blocked while the PDA exists).

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | ✓ | ✓ | Current authority (payer for PDA) |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `rotation_request` | ✓ (init) | — | New `AuthorityRotationRequest` PDA |
| `mint` | — | — | Token-2022 mint |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `new_authority` | `Pubkey` | Proposed incoming authority |
| `backup_authority` | `Pubkey` | Fallback authority (must differ from both current and new) |

```typescript
await client.proposeAuthorityRotation({
  configPda,
  newAuthority: newKeypair.publicKey,
  backupAuthority: backupKeypair.publicKey,
});
// Emits AuthorityRotationProposed
```

**Errors**

| Error | Condition |
|---|---|
| `RotationNewAuthorityIsCurrent` | `new_authority == config.authority` |
| `RotationBackupIsCurrent` | `backup_authority == config.authority` |
| `RotationBackupEqualsNew` | `backup_authority == new_authority` |
| `RotationZeroPubkey` | Either pubkey is `Pubkey::default()` |
| `Unauthorized` | Caller is not `config.authority` |

---

### `accept_authority_rotation`

Called by the *new* authority after the 48-hour timelock.  Transfers
`config.authority` to `new_authority` and closes the rotation request PDA
(returning rent to the original authority).

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `new_authority` | — | ✓ | Must be `rotation_request.new_authority` |
| `current_authority` | ✓ | — | Rent recipient (must match `rotation_request.current_authority`) |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `rotation_request` | ✓ (close) | — | Closed on success |
| `mint` | — | — | Token-2022 mint |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

```typescript
// Called by the new authority after the 48-hr window
await client.acceptAuthorityRotation({ configPda, mint }, newKeypair);
// Emits AuthorityRotationCompleted
```

**Errors**

| Error | Condition |
|---|---|
| `Unauthorized` | Caller is not `rotation_request.new_authority` |

---

### `emergency_recover_authority`

Called by the *backup* authority after the 7-day window if the new authority
never accepted.  Sets `config.authority` to `backup_authority` and closes
the request PDA.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `backup_authority` | — | ✓ | Must be `rotation_request.backup_authority` |
| `current_authority` | ✓ | — | Rent recipient |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `rotation_request` | ✓ (close) | — | Closed on success |
| `mint` | — | — | Token-2022 mint |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

```typescript
// Called by backup authority after 7-day window
await client.emergencyRecoverAuthority({ configPda, mint }, backupKeypair);
// Emits AuthorityRotationEmergencyRecovered
```

**Errors**

| Error | Condition |
|---|---|
| `EmergencyRecoveryNotReady` | `current_slot < proposed_slot + EMERGENCY_RECOVERY_SLOTS` |
| `Unauthorized` | Caller is not `rotation_request.backup_authority` |

---

### `cancel_authority_rotation`

Cancels a pending rotation and closes the request PDA.  Only the
**current** authority may cancel (the proposed new authority cannot).

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | ✓ | ✓ | Current authority (must match `rotation_request.current_authority`) |
| `config` | — | — | `StablecoinConfig` PDA |
| `rotation_request` | ✓ (close) | — | Closed on success |
| `mint` | — | — | Token-2022 mint |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

```typescript
await client.cancelAuthorityRotation({ configPda, mint });
// Emits AuthorityRotationCancelled
```

**Errors**

| Error | Condition |
|---|---|
| `Unauthorized` | Caller is not `config.authority` |

---

## Events

| Event | Emitted by | Key fields |
|---|---|---|
| `AuthorityRotationProposed` | `propose_authority_rotation` | `mint`, `current_authority`, `new_authority`, `backup_authority`, `proposed_slot`, `timelock_slots` |
| `AuthorityRotationCompleted` | `accept_authority_rotation` | `mint`, `prev_authority`, `new_authority` |
| `AuthorityRotationEmergencyRecovered` | `emergency_recover_authority` | `mint`, `prev_authority`, `backup_authority` |
| `AuthorityRotationCancelled` | `cancel_authority_rotation` | `mint`, `authority`, `cancelled_new_authority` |

---

## Operational Guide

### Normal rotation (planned key migration)

1. Derive `new_authority` keypair in your new HSM / multisig.
2. Call `propose_authority_rotation` from the current key.
3. After 48 hours, call `accept_authority_rotation` from the new key.
4. Verify `config.authority` on-chain matches the new pubkey.
5. Securely retire the old key.

### Emergency recovery (new authority unresponsive)

1. Wait for the 7-day window (`proposed_slot + 3_024_000` slots).
2. Call `emergency_recover_authority` from the backup key.
3. Consider immediately proposing a fresh rotation to a known-good key.

### Cancellation

If you proposed a rotation in error, call `cancel_authority_rotation`
from the current key before the new authority accepts.

---

## Error Reference

| Error | Description |
|---|---|
| `RotationNewAuthorityIsCurrent` | `new_authority` matches existing authority |
| `RotationBackupIsCurrent` | `backup_authority` matches existing authority |
| `RotationBackupEqualsNew` | `backup_authority` must differ from `new_authority` |
| `RotationZeroPubkey` | Zero pubkey not allowed for either role |
| `EmergencyRecoveryNotReady` | 7-day window has not elapsed |
| `Unauthorized` | Signer does not match the required role |
