use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_program::system_program;
use solana_sdk::{
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, TransactionError},
};
use rand::Rng;

fn assert_instruction_error(result: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>) {
    let err = result.expect_err("Expected transaction to fail");
    assert!(
        matches!(&err.err, TransactionError::InstructionError(_, _)),
        "Expected InstructionError, got: {:?}", err.err
    );
}

const HOOK_ID: Pubkey = solana_sdk::pubkey!("84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6");

const CONFIG_SEED: &[u8] = b"config";
const BLACKLIST_SEED: &[u8] = b"blacklist";
const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

fn ix_disc(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

fn find_config_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED, mint.as_ref()], &HOOK_ID)
}

fn find_blacklist_pda(mint: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BLACKLIST_SEED, mint.as_ref(), wallet.as_ref()],
        &HOOK_ID,
    )
}

#[allow(dead_code)]
fn find_extra_account_metas_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[EXTRA_ACCOUNT_METAS_SEED, mint.as_ref()], &HOOK_ID)
}

fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &HOOK_ID).0
}

fn event_cpi_metas() -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(event_authority(), false),
        AccountMeta::new_readonly(HOOK_ID, false),
    ]
}

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let program_bytes =
        include_bytes!("../../transfer_hooks/blacklist/target/deploy/blacklist_hook.so");
    svm.add_program(HOOK_ID, program_bytes);
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    (svm, admin)
}

fn build_initialize_config_ix(admin: &Pubkey, mint: &Pubkey, config: &Pubkey) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*config, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data: ix_disc("initialize_config").to_vec(),
    }
}

fn build_add_to_blacklist_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    config: &Pubkey,
    blacklist_entry: &Pubkey,
    wallet: &Pubkey,
    reason: &str,
) -> Instruction {
    let disc = ix_disc("add_to_blacklist");
    let mut data = disc.to_vec();
    data.extend_from_slice(&wallet.to_bytes());
    let reason_bytes = reason.as_bytes();
    data.extend_from_slice(&(reason_bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(reason_bytes);
    data.extend_from_slice(&[0u8; 32]); // evidence_hash
    data.extend_from_slice(&0u32.to_le_bytes()); // evidence_uri (empty string)

    let mut accounts = vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new_readonly(*config, false),
        AccountMeta::new(*blacklist_entry, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data,
    }
}

fn build_remove_from_blacklist_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    config: &Pubkey,
    blacklist_entry: &Pubkey,
    wallet: &Pubkey,
) -> Instruction {
    let disc = ix_disc("remove_from_blacklist");
    let mut data = disc.to_vec();
    data.extend_from_slice(&wallet.to_bytes());

    let mut accounts = vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new_readonly(*config, false),
        AccountMeta::new(*blacklist_entry, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data,
    }
}

fn build_pause_hook_ix(admin: &Pubkey, mint: &Pubkey, config: &Pubkey) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*config, false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data: ix_disc("pause_hook").to_vec(),
    }
}

fn build_unpause_hook_ix(admin: &Pubkey, mint: &Pubkey, config: &Pubkey) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*config, false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data: ix_disc("unpause_hook").to_vec(),
    }
}

fn build_transfer_admin_ix(admin: &Pubkey, mint: &Pubkey, config: &Pubkey, new_admin: &Pubkey) -> Instruction {
    let disc = ix_disc("transfer_admin");
    let mut data = disc.to_vec();
    data.extend_from_slice(&new_admin.to_bytes());

    let mut accounts = vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*config, false),
    ];
    accounts.extend(event_cpi_metas());

    Instruction {
        program_id: HOOK_ID,
        accounts,
        data,
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[test]
fn test_initialize_config_invalid_mint_no_crash() {
    let (mut svm, admin) = setup();
    let fake_mint = Pubkey::new_unique();
    let (config, _) = find_config_pda(&fake_mint);

    let ix = build_initialize_config_ix(&admin.pubkey(), &fake_mint, &config);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&admin.pubkey()),
        &[&admin],
        blockhash,
    );

    let _result = svm.send_transaction(tx);
}

#[test]
fn test_blacklist_without_config_rejected() {
    let (mut svm, admin) = setup();
    let mint = Pubkey::new_unique();
    let (config, _) = find_config_pda(&mint);
    let wallet = Pubkey::new_unique();
    let (bl_entry, _) = find_blacklist_pda(&mint, &wallet);

    let ix = build_add_to_blacklist_ix(
        &admin.pubkey(),
        &mint,
        &config,
        &bl_entry,
        &wallet,
        "OFAC sanctions",
    );
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&admin.pubkey()),
        &[&admin],
        blockhash,
    );

    let result = svm.send_transaction(tx);
    assert_instruction_error(result);
}

#[test]
fn test_pause_without_config_rejected() {
    let (mut svm, admin) = setup();
    let mint = Pubkey::new_unique();
    let (config, _) = find_config_pda(&mint);

    let ix = build_pause_hook_ix(&admin.pubkey(), &mint, &config);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&admin.pubkey()),
        &[&admin],
        blockhash,
    );

    let result = svm.send_transaction(tx);
    assert_instruction_error(result);
}

#[test]
fn test_transfer_admin_without_config_rejected() {
    let (mut svm, admin) = setup();
    let mint = Pubkey::new_unique();
    let (config, _) = find_config_pda(&mint);
    let new_admin = Pubkey::new_unique();

    let ix = build_transfer_admin_ix(&admin.pubkey(), &mint, &config, &new_admin);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&admin.pubkey()),
        &[&admin],
        blockhash,
    );

    let result = svm.send_transaction(tx);
    assert_instruction_error(result);
}

/// Fuzz: random instruction discriminators don't crash the hook program
#[test]
fn fuzz_random_discriminators() {
    let (mut svm, admin) = setup();
    let mut rng = rand::thread_rng();

    for _ in 0..100 {
        let mut data = vec![0u8; rng.gen_range(8..64)];
        rng.fill(&mut data[..]);

        let ix = Instruction {
            program_id: HOOK_ID,
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(Pubkey::new_unique(), false),
            ],
            data,
        };

        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&admin.pubkey()),
            &[&admin],
            blockhash,
        );

        let _result = svm.send_transaction(tx);
    }
}

/// Fuzz: random operations on the hook program
#[test]
fn fuzz_random_hook_operations() {
    let (mut svm, admin) = setup();
    let mut rng = rand::thread_rng();

    let mint = Pubkey::new_unique();
    let (config, _) = find_config_pda(&mint);

    let mut total_ops = 0u32;
    let mut errors = 0u32;

    for _ in 0..80 {
        total_ops += 1;
        let op: u8 = rng.gen_range(0..6);

        let ix = match op {
            0 => build_initialize_config_ix(&admin.pubkey(), &mint, &config),
            1 => {
                let wallet = Pubkey::new_unique();
                let (bl_entry, _) = find_blacklist_pda(&mint, &wallet);
                build_add_to_blacklist_ix(&admin.pubkey(), &mint, &config, &bl_entry, &wallet, "fuzz test")
            }
            2 => {
                let wallet = Pubkey::new_unique();
                let (bl_entry, _) = find_blacklist_pda(&mint, &wallet);
                build_remove_from_blacklist_ix(&admin.pubkey(), &mint, &config, &bl_entry, &wallet)
            }
            3 => build_pause_hook_ix(&admin.pubkey(), &mint, &config),
            4 => build_unpause_hook_ix(&admin.pubkey(), &mint, &config),
            5 => {
                let new_admin = Pubkey::new_unique();
                build_transfer_admin_ix(&admin.pubkey(), &mint, &config, &new_admin)
            }
            _ => unreachable!(),
        };

        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&admin.pubkey()),
            &[&admin],
            blockhash,
        );

        match svm.send_transaction(tx) {
            Ok(_) => {}
            Err(_) => errors += 1,
        }
    }

    assert_eq!(total_ops, 80);
    assert!(errors > 0, "Expected some operations to fail gracefully");
}

/// Fuzz: random account combinations per instruction
#[test]
fn fuzz_random_account_counts_hook() {
    let (mut svm, admin) = setup();
    let mut rng = rand::thread_rng();

    let known_discs = [
        ix_disc("initialize_config"),
        ix_disc("add_to_blacklist"),
        ix_disc("remove_from_blacklist"),
        ix_disc("pause_hook"),
        ix_disc("unpause_hook"),
        ix_disc("transfer_admin"),
        ix_disc("accept_admin"),
        ix_disc("transfer_hook"),
    ];

    for disc in &known_discs {
        for num_accounts in 0..5 {
            let mut accounts: Vec<AccountMeta> = vec![AccountMeta::new(admin.pubkey(), true)];
            for _ in 0..num_accounts {
                accounts.push(AccountMeta::new(Pubkey::new_unique(), false));
            }

            let mut data = disc.to_vec();
            let extra: Vec<u8> = (0..rng.gen_range(0..48)).map(|_| rng.gen()).collect();
            data.extend(extra);

            let ix = Instruction {
                program_id: HOOK_ID,
                accounts,
                data,
            };

            let blockhash = svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(
                &[ix],
                Some(&admin.pubkey()),
                &[&admin],
                blockhash,
            );

            let _result = svm.send_transaction(tx);
        }
    }
}
