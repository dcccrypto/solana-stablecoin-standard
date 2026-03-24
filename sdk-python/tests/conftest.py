import pytest
from sss.client import SSSClient
from sss.models import SupplyResponse, CDPPosition


@pytest.fixture
def mock_client():
    """SSSClient pointed at a fake backend URL (no real HTTP)."""
    return SSSClient(backend_url="http://fake-backend.test", rpc_url="https://api.devnet.solana.com")


@pytest.fixture
def sample_supply_response():
    return SupplyResponse(
        total_supply=1_000_000_000_000,
        circulating_supply=950_000_000_000,
        token_mint="So11111111111111111111111111111111111111112",
        slot=123456789,
        timestamp=1711234567,
    )


@pytest.fixture
def sample_cdp_positions():
    return [
        CDPPosition(
            position_id="pos_abc123",
            owner="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            collateral_amount=5_000_000_000,
            debt_amount=3_000_000_000,
            collateral_token="So11111111111111111111111111111111111111112",
            health_factor=1.67,
            is_liquidatable=False,
        ),
        CDPPosition(
            position_id="pos_def456",
            owner="DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKD",
            collateral_amount=1_000_000_000,
            debt_amount=950_000_000,
            collateral_token="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            health_factor=1.05,
            is_liquidatable=True,
        ),
    ]
