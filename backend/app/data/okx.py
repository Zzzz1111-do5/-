"""OKX 现货公开行情（无需 API Key）。"""

import asyncio

import httpx

from .. import config
from .base import DataSourceError, Kline, Ticker

PAGE_LIMIT = 100
BAR_MAP = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1Dutc"}


def _to_inst_id(symbol: str) -> str:
    return symbol.replace("/", "-")


class OkxSource:
    name = "okx"
    label = "欧易 OKX"
    cacheable = True

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or config.OKX_BASE_URL).rstrip("/")

    async def _get(self, client: httpx.AsyncClient, path: str, params: dict):
        try:
            resp = await client.get(path, params=params)
        except httpx.HTTPError as e:
            raise DataSourceError(f"连接 OKX 失败: {e.__class__.__name__}: {e}") from e
        try:
            payload = resp.json()
        except ValueError:
            raise DataSourceError(f"OKX 接口返回异常 ({resp.status_code}): {resp.text[:200]}")
        if resp.status_code != 200 or str(payload.get("code")) != "0":
            raise DataSourceError(f"OKX 接口返回错误 ({resp.status_code}): {payload.get('msg') or resp.text[:200]}")
        return payload["data"]

    async def fetch_klines(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Kline]:
        out: dict[int, Kline] = {}
        after = end_ms + 1  # 返回早于 after 的数据，按时间倒序
        async with httpx.AsyncClient(base_url=self.base_url, timeout=config.HTTP_TIMEOUT) as client:
            while True:
                rows = await self._get(
                    client,
                    "/api/v5/market/history-candles",
                    {"instId": _to_inst_id(symbol), "bar": BAR_MAP[interval], "after": after, "limit": PAGE_LIMIT},
                )
                if not rows:
                    break
                for r in rows:
                    ts = int(r[0])
                    if start_ms <= ts <= end_ms:
                        out[ts] = (ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]))
                oldest = int(rows[-1][0])
                if oldest <= start_ms or len(rows) < PAGE_LIMIT:
                    break
                after = oldest
                await asyncio.sleep(0.11)  # 遵守 20 次/2 秒 的限频
        return [out[k] for k in sorted(out)]

    async def fetch_tickers(self, symbols: list[str]) -> list[Ticker]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=config.HTTP_TIMEOUT) as client:
            rows = await self._get(client, "/api/v5/market/tickers", {"instType": "SPOT"})
        by_id = {r["instId"]: r for r in rows}
        result = []
        for s in symbols:
            r = by_id.get(_to_inst_id(s))
            if not r:
                continue
            last = float(r["last"])
            open24 = float(r["open24h"]) or last
            result.append(
                Ticker(
                    symbol=s,
                    last=last,
                    change_pct=(last / open24 - 1) * 100 if open24 else 0.0,
                    high=float(r["high24h"]),
                    low=float(r["low24h"]),
                    volume=float(r["vol24h"]),
                    quote_volume=float(r["volCcy24h"]),
                )
            )
        return result
