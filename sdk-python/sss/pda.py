from solders.pubkey import Pubkey


def find_stablecoin_config(program_id: str, mint: str) -> tuple[str, int]:
    """Derives the StablecoinConfig PDA for a given mint."""
    program = Pubkey.from_string(program_id)
    mint_key = Pubkey.from_string(mint)
    pda, bump = Pubkey.find_program_address(
        [b"stablecoin_config", bytes(mint_key)],
        program,
    )
    return str(pda), bump


def find_cdp_position(program_id: str, mint: str, owner: str) -> tuple[str, int]:
    """Derives the CDPPosition PDA for a given mint + owner."""
    program = Pubkey.from_string(program_id)
    mint_key = Pubkey.from_string(mint)
    owner_key = Pubkey.from_string(owner)
    pda, bump = Pubkey.find_program_address(
        [b"cdp_position", bytes(mint_key), bytes(owner_key)],
        program,
    )
    return str(pda), bump


def find_wallet_rate_limit(program_id: str, wallet: str) -> tuple[str, int]:
    """Derives the WalletRateLimit PDA for a given wallet."""
    program = Pubkey.from_string(program_id)
    wallet_key = Pubkey.from_string(wallet)
    pda, bump = Pubkey.find_program_address(
        [b"wallet_rate_limit", bytes(wallet_key)],
        program,
    )
    return str(pda), bump


def find_zk_compliance_record(program_id: str, mint: str, wallet: str) -> tuple[str, int]:
    """Derives the ZkComplianceRecord PDA for a given mint + wallet."""
    program = Pubkey.from_string(program_id)
    mint_key = Pubkey.from_string(mint)
    wallet_key = Pubkey.from_string(wallet)
    pda, bump = Pubkey.find_program_address(
        [b"zk_compliance", bytes(mint_key), bytes(wallet_key)],
        program,
    )
    return str(pda), bump
