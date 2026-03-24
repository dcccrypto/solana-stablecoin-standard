import asyncio
import json

import click

from .client import SSSClient


@click.group()
def cli() -> None:
    """Solana Stablecoin Standard CLI."""


@cli.command("balance")
@click.argument("address")
@click.option("--rpc", default="https://api.devnet.solana.com", show_default=True, help="Solana RPC URL")
def balance_cmd(address: str, rpc: str) -> None:
    """Fetch SOL balance for ADDRESS."""
    from solana.rpc.api import Client as SolanaClient

    client = SolanaClient(rpc)
    resp = client.get_balance(address)
    lamports = resp.value
    sol = lamports / 1_000_000_000
    click.echo(f"Balance: {sol:.9f} SOL ({lamports} lamports)")


@cli.command("supply")
@click.option("--mint", default=None, help="Token mint address")
@click.option("--backend", default="http://127.0.0.1:18801", show_default=True, help="Backend URL")
def supply_cmd(mint: str | None, backend: str) -> None:
    """Fetch current stablecoin supply."""

    async def _run() -> None:
        async with SSSClient(backend_url=backend) as client:
            result = await client.get_supply(token_mint=mint)
            click.echo(json.dumps({
                "token_mint": result.token_mint,
                "total_supply": result.total_supply,
                "circulating_supply": result.circulating_supply,
                "slot": result.slot,
                "timestamp": result.timestamp,
            }, indent=2))

    asyncio.run(_run())


@cli.command("reserve")
@click.option("--mint", default=None, help="Token mint address")
@click.option("--backend", default="http://127.0.0.1:18801", show_default=True, help="Backend URL")
def reserve_cmd(mint: str | None, backend: str) -> None:
    """Fetch current reserve ratio."""

    async def _run() -> None:
        async with SSSClient(backend_url=backend) as client:
            result = await client.get_reserve_ratio(token_mint=mint)
            click.echo(json.dumps({
                "token_mint": result.token_mint,
                "ratio": result.ratio,
                "is_healthy": result.is_healthy,
                "slot": result.slot,
            }, indent=2))

    asyncio.run(_run())


@cli.command("cdps")
@click.option("--owner", default=None, help="Filter by owner address")
@click.option("--liquidatable", is_flag=True, default=False, help="Show only liquidatable positions")
@click.option("--backend", default="http://127.0.0.1:18801", show_default=True, help="Backend URL")
def cdps_cmd(owner: str | None, liquidatable: bool, backend: str) -> None:
    """List CDP positions."""

    async def _run() -> None:
        async with SSSClient(backend_url=backend) as client:
            positions = await client.get_cdp_positions(owner=owner, liquidatable=liquidatable)
            output = [
                {
                    "position_id": p.position_id,
                    "owner": p.owner,
                    "collateral_amount": p.collateral_amount,
                    "debt_amount": p.debt_amount,
                    "collateral_token": p.collateral_token,
                    "health_factor": p.health_factor,
                    "is_liquidatable": p.is_liquidatable,
                }
                for p in positions
            ]
            click.echo(json.dumps(output, indent=2))

    asyncio.run(_run())
