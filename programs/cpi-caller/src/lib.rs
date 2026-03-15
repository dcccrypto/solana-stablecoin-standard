/// SSS-055 — CPI Composability Standard — Integration Test Program
///
/// An external Solana program that demonstrates calling SSS's standardized
/// CPI mint/burn interface. This proves the composability contract works:
///   1. Check InterfaceVersion PDA before invoking.
///   2. Call `cpi_mint` / `cpi_burn` with required_version pinned.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use sss_token::cpi as sss_cpi;
use sss_token::program::SssToken;
use sss_token::state::{InterfaceVersion, MinterInfo, StablecoinConfig};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod cpi_caller {
    use super::*;

    /// Calls SSS `cpi_mint` via CPI.
    /// `required_version` is the interface version the caller was compiled against.
    pub fn call_sss_mint(
        ctx: Context<CallSssMint>,
        amount: u64,
        required_version: u8,
    ) -> Result<()> {
        // Caller reads InterfaceVersion before invoking (on-chain safety check)
        let iv = &ctx.accounts.interface_version;
        require!(
            iv.active,
            CpiCallerError::SssInterfaceDeprecated
        );
        require!(
            iv.version == required_version,
            CpiCallerError::SssVersionMismatch
        );

        // CPI into SSS cpi_mint
        sss_cpi::cpi_mint(
            CpiContext::new(
                ctx.accounts.sss_program.to_account_info(),
                sss_cpi::accounts::CpiMint {
                    minter: ctx.accounts.minter.to_account_info(),
                    config: ctx.accounts.config.to_account_info(),
                    minter_info: ctx.accounts.minter_info.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    recipient_token_account: ctx.accounts.recipient_token_account.to_account_info(),
                    interface_version: ctx.accounts.interface_version.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ),
            amount,
            required_version,
        )?;

        msg!("cpi_caller: minted {} via SSS cpi_mint (v{})", amount, required_version);
        Ok(())
    }

    /// Calls SSS `cpi_burn` via CPI.
    pub fn call_sss_burn(
        ctx: Context<CallSssBurn>,
        amount: u64,
        required_version: u8,
    ) -> Result<()> {
        let iv = &ctx.accounts.interface_version;
        require!(iv.active, CpiCallerError::SssInterfaceDeprecated);
        require!(iv.version == required_version, CpiCallerError::SssVersionMismatch);

        sss_cpi::cpi_burn(
            CpiContext::new(
                ctx.accounts.sss_program.to_account_info(),
                sss_cpi::accounts::CpiBurn {
                    minter: ctx.accounts.minter.to_account_info(),
                    config: ctx.accounts.config.to_account_info(),
                    minter_info: ctx.accounts.minter_info.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    source_token_account: ctx.accounts.source_token_account.to_account_info(),
                    interface_version: ctx.accounts.interface_version.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ),
            amount,
            required_version,
        )?;

        msg!("cpi_caller: burned {} via SSS cpi_burn (v{})", amount, required_version);
        Ok(())
    }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CallSssMint<'info> {
    pub minter: Signer<'info>,

    #[account(mut)]
    pub config: Account<'info, StablecoinConfig>,

    #[account(mut)]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub interface_version: Account<'info, InterfaceVersion>,

    pub token_program: Interface<'info, TokenInterface>,

    pub sss_program: Program<'info, SssToken>,
}

#[derive(Accounts)]
pub struct CallSssBurn<'info> {
    pub minter: Signer<'info>,

    #[account(mut)]
    pub config: Account<'info, StablecoinConfig>,

    #[account(mut)]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    pub interface_version: Account<'info, InterfaceVersion>,

    pub token_program: Interface<'info, TokenInterface>,

    pub sss_program: Program<'info, SssToken>,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum CpiCallerError {
    #[msg("SSS interface has been deprecated")]
    SssInterfaceDeprecated,
    #[msg("SSS interface version mismatch — recompile against current IDL")]
    SssVersionMismatch,
}
