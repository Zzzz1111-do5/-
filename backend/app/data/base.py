"""行情数据源的公共定义。"""

from dataclasses import dataclass
from typing import Protocol

# (开盘时间毫秒, 开, 高, 低, 收, 成交量)
Kline = tuple[int, float, float, float, float, float]


class DataSourceError(Exception):
    """行情获取失败（网络、限流、交易对不存在等）。"""


@dataclass
class Ticker:
    symbol: str
    last: float
    change_pct: float
    high: float
    low: float
    volume: float
    quote_volume: float

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class DataSource(Protocol):
    name: str
    label: str
    cacheable: bool

    async def fetch_klines(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Kline]:
        """返回 [start_ms, end_ms] 内按时间升序的 K 线。"""
        ...

    async def fetch_tickers(self, symbols: list[str]) -> list[Ticker]: ...


def normalize_symbol(symbol: str) -> str:
    """统一成 BASE/QUOTE 形式，如 btcusdt / BTC-USDT -> BTC/USDT。"""
    s = symbol.strip().upper().replace("-", "/").replace("_", "/")
    if "/" in s:
        base, quote = s.split("/", 1)
        if base and quote:
            return f"{base}/{quote}"
        raise ValueError(f"无效的交易对: {symbol}")
    for quote in ("USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH"):
        if s.endswith(quote) and len(s) > len(quote):
            return f"{s[: -len(quote)]}/{quote}"
    raise ValueError(f"无效的交易对: {symbol}，请使用 BTC/USDT 格式")
