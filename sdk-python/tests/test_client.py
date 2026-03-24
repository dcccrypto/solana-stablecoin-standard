import pytest
import respx
import httpx
from click.testing import CliRunner

from sss.client import SSSClient
from sss.exceptions import SSSAuthError, SSSNetworkError, SSSValidationError
from sss.flags import FeatureFlags
from sss import __version__


FAKE_BACKEND = "http://fake-backend.test"
FAKE_MINT = "So11111111111111111111111111111111111111112"
FAKE_OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
FAKE_PROGRAM = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"


# -- 1. get_supply success ------------------------------------------------------
@pytest.mark.asyncio
async def test_get_supply_success(mock_client):
    payload = {
        "total_supply": 1_000_000,
        "circulating_supply": 900_000,
        "token_mint": FAKE_MINT,
        "slot": 100,
        "timestamp": 1711000000,
    }
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_supply()
    assert result.total_supply == 1_000_000
    assert result.circulating_supply == 900_000
    assert result.token_mint == FAKE_MINT


# -- 2. get_supply with mint param ---------------------------------------------
@pytest.mark.asyncio
async def test_get_supply_with_mint_param(mock_client):
    payload = {
        "total_supply": 500_000,
        "circulating_supply": 480_000,
        "token_mint": FAKE_MINT,
        "slot": 200,
        "timestamp": 1711000001,
    }
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        route = rx.get("/v1/supply").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_supply(token_mint=FAKE_MINT)
    assert result.total_supply == 500_000
    assert route.called


# -- 3. get_supply network error -----------------------------------------------
@pytest.mark.asyncio
async def test_get_supply_network_error(mock_client):
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply").mock(side_effect=httpx.ConnectError("connection refused"))
        with pytest.raises(SSSNetworkError):
            await mock_client.get_supply()


# -- 4. get_reserve_ratio success ----------------------------------------------
@pytest.mark.asyncio
async def test_get_reserve_ratio_success(mock_client):
    payload = {"ratio": 1.05, "token_mint": FAKE_MINT, "slot": 300, "is_healthy": True}
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/reserve/ratio").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_reserve_ratio()
    assert result.ratio == 1.05
    assert result.is_healthy is True


# -- 5. get_cdp_positions success ----------------------------------------------
@pytest.mark.asyncio
async def test_get_cdp_positions_success(mock_client):
    payload = [
        {
            "position_id": "pos1",
            "owner": FAKE_OWNER,
            "collateral_amount": 1000,
            "debt_amount": 800,
            "collateral_token": FAKE_MINT,
            "health_factor": 1.25,
            "is_liquidatable": False,
        }
    ]
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/cdp/positions").mock(return_value=httpx.Response(200, json=payload))
        positions = await mock_client.get_cdp_positions()
    assert len(positions) == 1
    assert positions[0].position_id == "pos1"
    assert positions[0].health_factor == 1.25


# -- 6. get_cdp_positions liquidatable filter ----------------------------------
@pytest.mark.asyncio
async def test_get_cdp_positions_liquidatable_filter(mock_client):
    payload = [
        {
            "position_id": "pos2",
            "owner": FAKE_OWNER,
            "collateral_amount": 500,
            "debt_amount": 490,
            "collateral_token": FAKE_MINT,
            "health_factor": 1.02,
            "is_liquidatable": True,
        }
    ]
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        route = rx.get("/v1/cdp/positions").mock(return_value=httpx.Response(200, json=payload))
        positions = await mock_client.get_cdp_positions(liquidatable=True)
    assert positions[0].is_liquidatable is True
    # Verify the liquidatable=true param was sent
    assert "liquidatable" in str(route.calls[0].request.url)


# -- 7. get_peg_deviation success ----------------------------------------------
@pytest.mark.asyncio
async def test_get_peg_deviation_success(mock_client):
    payload = {
        "token_mint": FAKE_MINT,
        "current_price": 0.9985,
        "target_price": 1.0,
        "deviation_bps": 15,
        "slot": 400,
    }
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/peg/deviation").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_peg_deviation()
    assert result.deviation_bps == 15
    assert result.current_price == pytest.approx(0.9985)


# -- 8. get_reserve_composition success ----------------------------------------
@pytest.mark.asyncio
async def test_get_reserve_composition_success(mock_client):
    payload = [
        {"asset": "USDC", "amount": 5_000_000, "weight_bps": 6000, "usd_value": 5_000_000.0},
        {"asset": "SOL", "amount": 10_000, "weight_bps": 4000, "usd_value": 1_500_000.0},
    ]
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/reserve/composition").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_reserve_composition()
    assert len(result) == 2
    assert result[0].asset == "USDC"
    assert result[1].weight_bps == 4000


# -- 9. get_historical_supply success ------------------------------------------
@pytest.mark.asyncio
async def test_get_historical_supply_success(mock_client):
    payload = [
        {"slot": 100, "timestamp": 1711000000, "total_supply": 1_000_000, "circulating_supply": 900_000},
        {"slot": 200, "timestamp": 1711001000, "total_supply": 1_100_000, "circulating_supply": 1_000_000},
    ]
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply/history").mock(return_value=httpx.Response(200, json=payload))
        result = await mock_client.get_historical_supply(from_slot=100, to_slot=200)
    assert len(result) == 2
    assert result[0].slot == 100
    assert result[1].total_supply == 1_100_000


# -- 10. compute_stability_score success ----------------------------------------
@pytest.mark.asyncio
async def test_compute_stability_score_success(mock_client):
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/stability/score").mock(return_value=httpx.Response(200, json={"score": 0.87}))
        score = await mock_client.compute_stability_score()
    assert score == pytest.approx(0.87)


# -- 11. mint returns unsigned tx -----------------------------------------------
@pytest.mark.asyncio
async def test_mint_returns_unsigned_tx(mock_client):
    tx_payload = {"transaction": "base64encodedtx==", "requires_signature": True}
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.post("/v1/tx/mint").mock(return_value=httpx.Response(200, json=tx_payload))
        result = await mock_client.mint(amount=1000, recipient=FAKE_OWNER, token_mint=FAKE_MINT)
    assert result["transaction"] == "base64encodedtx=="
    assert result["requires_signature"] is True


# -- 12. burn returns unsigned tx -----------------------------------------------
@pytest.mark.asyncio
async def test_burn_returns_unsigned_tx(mock_client):
    tx_payload = {"transaction": "base64burntx==", "requires_signature": True}
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.post("/v1/tx/burn").mock(return_value=httpx.Response(200, json=tx_payload))
        result = await mock_client.burn(amount=500, token_mint=FAKE_MINT)
    assert result["transaction"] == "base64burntx=="


# -- 13. HTTP 401 raises SSSAuthError -------------------------------------------
@pytest.mark.asyncio
async def test_http_401_raises_sss_auth_error(mock_client):
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply").mock(return_value=httpx.Response(401))
        with pytest.raises(SSSAuthError) as exc_info:
            await mock_client.get_supply()
    assert exc_info.value.status_code == 401


# -- 14. HTTP 422 raises SSSValidationError -------------------------------------
@pytest.mark.asyncio
async def test_http_422_raises_sss_validation_error(mock_client):
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/reserve/ratio").mock(return_value=httpx.Response(422))
        with pytest.raises(SSSValidationError) as exc_info:
            await mock_client.get_reserve_ratio()
    assert exc_info.value.status_code == 422


# -- 15. HTTP 500 raises SSSNetworkError ----------------------------------------
@pytest.mark.asyncio
async def test_http_500_raises_sss_network_error(mock_client):
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply").mock(return_value=httpx.Response(500))
        with pytest.raises(SSSNetworkError) as exc_info:
            await mock_client.get_supply()
    assert exc_info.value.status_code == 500


# -- 16. context manager closes client ------------------------------------------
@pytest.mark.asyncio
async def test_context_manager():
    payload = {
        "total_supply": 42,
        "circulating_supply": 42,
        "token_mint": FAKE_MINT,
        "slot": 1,
        "timestamp": 0,
    }
    with respx.mock(base_url=FAKE_BACKEND) as rx:
        rx.get("/v1/supply").mock(return_value=httpx.Response(200, json=payload))
        async with SSSClient(backend_url=FAKE_BACKEND) as client:
            result = await client.get_supply()
    assert result.total_supply == 42
    # After context exit, the httpx client is closed
    assert client._http.is_closed


# -- 17. FeatureFlags circuit breaker bit ----------------------------------------
def test_feature_flags_circuit_breaker_bit():
    flag = FeatureFlags.CIRCUIT_BREAKER
    assert int(flag) == 1
    assert flag & FeatureFlags.CIRCUIT_BREAKER


# -- 18. FeatureFlags combination ------------------------------------------------
def test_feature_flags_combination():
    combined = FeatureFlags.CIRCUIT_BREAKER | FeatureFlags.ZK_COMPLIANCE | FeatureFlags.BRIDGE_ENABLED
    assert combined & FeatureFlags.CIRCUIT_BREAKER
    assert combined & FeatureFlags.ZK_COMPLIANCE
    assert combined & FeatureFlags.BRIDGE_ENABLED
    assert not (combined & FeatureFlags.DAO_COMMITTEE)
    assert int(FeatureFlags.BRIDGE_ENABLED) == 1 << 13
    assert int(FeatureFlags.POR_HALT_ON_BREACH) == 1 << 14
    assert int(FeatureFlags.CONFIDENTIAL_TRANSFERS) == 1 << 5


# -- 19. PDA find_stablecoin_config ----------------------------------------------
def test_pda_find_stablecoin_config():
    from sss.pda import find_stablecoin_config
    pda, bump = find_stablecoin_config(FAKE_PROGRAM, FAKE_MINT)
    assert isinstance(pda, str)
    assert len(pda) >= 32
    assert 0 <= bump <= 255
    # Deterministic: same inputs give same output
    pda2, bump2 = find_stablecoin_config(FAKE_PROGRAM, FAKE_MINT)
    assert pda == pda2
    assert bump == bump2


# -- 20. PDA find_cdp_position ---------------------------------------------------
def test_pda_find_cdp_position():
    from sss.pda import find_cdp_position
    pda, bump = find_cdp_position(FAKE_PROGRAM, FAKE_MINT, FAKE_OWNER)
    assert isinstance(pda, str)
    assert 0 <= bump <= 255
    # Different owner -> different PDA
    other_owner = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKD"
    pda2, _ = find_cdp_position(FAKE_PROGRAM, FAKE_MINT, other_owner)
    assert pda != pda2


# -- 21. export_to_dataframe -----------------------------------------------------
def test_export_to_dataframe(mock_client, sample_supply_response):
    try:
        import pandas as pd
        df = mock_client.export_to_dataframe([sample_supply_response])
        assert isinstance(df, pd.DataFrame)
        assert "total_supply" in df.columns
        assert df.iloc[0]["total_supply"] == 1_000_000_000_000
    except ImportError:
        pytest.skip("pandas not installed")


# -- 22. CLI supply command ------------------------------------------------------
def test_cli_supply_command():
    from sss.cli import cli
    import respx
    import httpx
    import asyncio

    payload = {
        "total_supply": 999,
        "circulating_supply": 888,
        "token_mint": FAKE_MINT,
        "slot": 42,
        "timestamp": 1711111111,
    }
    runner = CliRunner()
    with respx.mock(base_url="http://fake-cli.test") as rx:
        rx.get("/v1/supply").mock(return_value=httpx.Response(200, json=payload))
        result = runner.invoke(cli, ["supply", "--backend", "http://fake-cli.test"])
    assert result.exit_code == 0
    assert "999" in result.output
    assert "888" in result.output
