"""币安现货公开行情（无需 API Key）。"""

import json

import httpx

from .. import config
from .base import DataSourceError, Kline, Ticker

PAGE_LIMIT = 1000


def _to_exchange_symbol(symbol: str) -> str:
    return symbol.replace("/", "")


class BinanceSource:
    name = "binance"
    label = "币安 Binance"
    cacheable = True

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or config.BINANCE_BASE_URL).rstrip("/")

    async def _get(self, client: httpx.AsyncClient, path: str, params: dict):
        try:
            resp = await client.get(path, params=params)
        except httpx.HTTPError as e:
            raise DataSourceError(f"连接币安失败: {e.__class__.__name__}: {e}") from e
        if resp.status_code != 200:
            try:
                msg = resp.json().get("msg", resp.text)
            except ValueError:
                msg = resp.text
            raise DataSourceError(f"币安接口返回错误 ({resp.status_code}): {msg[:200]}")
        return resp.json()

    async def fetch_klines(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Kline]:
        step = config.INTERVALS[interval]
        out: list[Kline] = []
        cur = start_ms
        async with httpx.AsyncClient(base_url=self.base_url, timeout=config.HTTP_TIMEOUT) as client:
            while cur <= end_ms:
                rows = await self._get(
                    client,
                    "/api/v3/klines",
                    {
                        "symbol": _to_exchange_symbol(symbol),
                        "interval": interval,
                        "startTime": cur,
                        "endTime": end_ms,
                        "limit": PAGE_LIMIT,
                    },
                )
                if not rows:
                    break
                for r in rows:
                    out.append((int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])))
                if len(rows) < PAGE_LIMIT:
                    break
                cur = int(rows[-1][0]) + step
        return out

    async def fetch_tickers(self, symbols: list[str]) -> list[Ticker]:
        mapping = {_to_exchange_symbol(s): s for s in symbols}
        async with httpx.AsyncClient(base_url=self.base_url, timeout=config.HTTP_TIMEOUT) as client:
            rows = await self._get(
                client,
                "/api/v3/ticker/24hr",
                {"symbols": json.dumps(list(mapping.keys()), separators=(",", ":"))},
            )
        result = []
        for r in rows:
            result.append(
                Ticker(
                    symbol=mapping.get(r["symbol"], r["symbol"]),
                    last=float(r["lastPrice"]),
                    change_pct=float(r["priceChangePercent"]),
                    high=float(r["highPrice"]),
                    low=float(r["lowPrice"]),
                    volume=float(r["volume"]),
                    quote_volume=float(r["quoteVolume"]),
                )
            )
        order = {s: i for i, s in enumerate(symbols)}
        result.sort(key=lambda t: order.get(t.symbol, 1_000_000))
        return result
