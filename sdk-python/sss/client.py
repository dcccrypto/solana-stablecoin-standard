from __future__ import annotations

import json
from typing import Any, Callable, Awaitable

import httpx

from .exceptions import SSSAuthError, SSSNetworkError, SSSValidationError
from .models import (
    CDPPosition,
    PegDeviation,
    ReserveComposition,
    ReserveRatio,
    StabilityScore,
    SupplyResponse,
    SupplySnapshot,
)


class SSSClient:
    def __init__(
        self,
        backend_url: str = "http://127.0.0.1:18801",
        rpc_url: str = "https://api.devnet.solana.com",
        keypair_path: str | None = None,
    ):
        self.backend_url = backend_url.rstrip("/")
        self.rpc_url = rpc_url
        self.keypair_path = keypair_path
        self._http = httpx.AsyncClient(base_url=self.backend_url, timeout=30.0)

    async def __aenter__(self) -> "SSSClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code == 401 or response.status_code == 403:
            raise SSSAuthError("Authentication failed", status_code=response.status_code)
        if response.status_code == 422:
            raise SSSValidationError("Validation error", status_code=response.status_code)
        if response.status_code >= 500:
            raise SSSNetworkError(
                f"Server error {response.status_code}", status_code=response.status_code
            )
        response.raise_for_status()

    async def _get(self, path: str, params: dict | None = None) -> Any:
        try:
            resp = await self._http.get(path, params=params)
        except httpx.TransportError as exc:
            raise SSSNetworkError(str(exc)) from exc
        self._raise_for_status(resp)
        return resp.json()

    async def _post(self, path: str, body: dict) -> Any:
        try:
            resp = await self._http.post(path, json=body)
        except httpx.TransportError as exc:
            raise SSSNetworkError(str(exc)) from exc
        self._raise_for_status(resp)
        return resp.json()

    async def get_supply(self, token_mint: str | None = None) -> SupplyResponse:
        params = {"mint": token_mint} if token_mint else {}
        data = await self._get("/v1/supply", params=params)
        return SupplyResponse(
            total_supply=data["total_supply"],
            circulating_supply=data["circulating_supply"],
            token_mint=data["token_mint"],
            slot=data["slot"],
            timestamp=data["timestamp"],
        )

    async def get_reserve_ratio(self, token_mint: str | None = None) -> ReserveRatio:
        params = {"mint": token_mint} if token_mint else {}
        data = await self._get("/v1/reserve/ratio", params=params)
        return ReserveRatio(
            ratio=data["ratio"],
            token_mint=data["token_mint"],
            slot=data["slot"],
            is_healthy=data["is_healthy"],
        )

    async def get_cdp_positions(
        self, owner: str | None = None, liquidatable: bool = False
    ) -> list[CDPPosition]:
        params: dict = {}
        if owner:
            params["owner"] = owner
        if liquidatable:
            params["liquidatable"] = "true"
        data = await self._get("/v1/cdp/positions", params=params)
        return [
            CDPPosition(
                position_id=p["position_id"],
                owner=p["owner"],
                collateral_amount=p["collateral_amount"],
                debt_amount=p["debt_amount"],
                collateral_token=p["collateral_token"],
                health_factor=p["health_factor"],
                is_liquidatable=p["is_liquidatable"],
            )
            for p in data
        ]

    async def get_peg_deviation(self, token_mint: str | None = None) -> PegDeviation:
        params = {"mint": token_mint} if token_mint else {}
        data = await self._get("/v1/peg/deviation", params=params)
        return PegDeviation(
            token_mint=data["token_mint"],
            current_price=data["current_price"],
            target_price=data["target_price"],
            deviation_bps=data["deviation_bps"],
            slot=data["slot"],
        )

    async def get_reserve_composition(self) -> list[ReserveComposition]:
        data = await self._get("/v1/reserve/composition")
        return [
            ReserveComposition(
                asset=r["asset"],
                amount=r["amount"],
                weight_bps=r["weight_bps"],
                usd_value=r["usd_value"],
            )
            for r in data
        ]

    async def get_historical_supply(
        self, from_slot: int, to_slot: int
    ) -> list[SupplySnapshot]:
        data = await self._get(
            "/v1/supply/history", params={"from_slot": from_slot, "to_slot": to_slot}
        )
        return [
            SupplySnapshot(
                slot=s["slot"],
                timestamp=s["timestamp"],
                total_supply=s["total_supply"],
                circulating_supply=s["circulating_supply"],
            )
            for s in data
        ]

    async def compute_stability_score(self) -> float:
        data = await self._get("/v1/stability/score")
        return float(data["score"])

    async def mint(self, amount: int, recipient: str, token_mint: str) -> dict:
        return await self._post(
            "/v1/tx/mint",
            {"amount": amount, "recipient": recipient, "token_mint": token_mint},
        )

    async def burn(self, amount: int, token_mint: str) -> dict:
        return await self._post(
            "/v1/tx/burn",
            {"amount": amount, "token_mint": token_mint},
        )

    async def subscribe_to_events(
        self,
        event_types: list[str],
        callback: Callable[[dict], Awaitable[None]],
    ) -> None:
        import websockets

        ws_url = self.backend_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/v1/events/ws"
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({"subscribe": event_types}))
            async for message in ws:
                event = json.loads(message)
                await callback(event)

    def export_to_dataframe(self, data: list) -> "pd.DataFrame":
        try:
            import pandas as pd
        except ImportError as exc:
            raise ImportError(
                "pandas is required for export_to_dataframe. "
                "Install with: pip install 'solana-stablecoin-standard[analytics]'"
            ) from exc
        return pd.DataFrame([vars(item) if hasattr(item, "__dict__") else item for item in data])
