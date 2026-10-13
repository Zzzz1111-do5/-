"""行情服务：统一数据源入口 + SQLite K 线缓存。"""

import time

import pandas as pd

from .. import config
from ..db import get_db
from .base import DataSource, DataSourceError, Kline, Ticker, normalize_symbol
from .binance import BinanceSource
from .okx import OkxSource
from .synthetic import SyntheticSource

__all__ = [
    "DataSourceError",
    "Kline",
    "Ticker",
    "SOURCES",
    "get_source",
    "get_klines",
    "get_recent_klines",
    "get_tickers",
    "normalize_symbol",
    "to_frame",
    "now_ms",
]

SOURCES: dict[str, DataSource] = {
    s.name: s for s in (BinanceSource(), OkxSource(), SyntheticSource())
}


def now_ms() -> int:
    return int(time.time() * 1000)


def get_source(name: str) -> DataSource:
    try:
        return SOURCES[name]
    except KeyError:
        raise ValueError(f"未知的数据源: {name}，可选: {', '.join(SOURCES)}") from None


def _check_interval(interval: str) -> int:
    if interval not in config.INTERVALS:
        raise ValueError(f"不支持的周期: {interval}，可选: {', '.join(config.INTERVALS)}")
    return config.INTERVALS[interval]


def _upsert(source: str, symbol: str, interval: str, bars: list[Kline]) -> None:
    get_db().executemany(
        "INSERT OR REPLACE INTO klines (source, symbol, interval, ts, open, high, low, close, volume)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(source, symbol, interval, *b) for b in bars],
    )


async def get_klines(source: str, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Kline]:
    """获取 [start_ms, end_ms] 区间 K 线，优先读取缓存，只向交易所请求缺失部分。"""
    src = get_source(source)
    symbol = normalize_symbol(symbol)
    step = _check_interval(interval)
    now = now_ms()
    end_ms = min(end_ms, now)
    start_ms = -(-start_ms // step) * step
    if end_ms < start_ms:
        raise ValueError("结束时间必须晚于开始时间")
    expected = (end_ms - start_ms) // step + 1
    if expected > config.MAX_BARS:
        raise ValueError(f"K 线数量 {expected} 超过上限 {config.MAX_BARS}，请缩短时间区间或使用更大的周期")

    if not src.cacheable:
        return await src.fetch_klines(symbol, interval, start_ms, end_ms)

    db = get_db()
    key = (src.name, symbol, interval)
    stat = db.query_one(
        "SELECT MIN(ts) AS mn, MAX(ts) AS mx, COUNT(*) AS n FROM klines"
        " WHERE source=? AND symbol=? AND interval=? AND ts BETWEEN ? AND ?",
        (*key, start_ms, end_ms),
    )
    ranges: list[tuple[int, int]] = []
    if not stat or not stat["n"]:
        ranges.append((start_ms, end_ms))
    else:
        mn, mx, n = stat["mn"], stat["mx"], stat["n"]
        span = (mx - mn) // step + 1
        if n < span - max(2, span * 0.005):
            ranges.append((start_ms, end_ms))  # 缓存内部有缺口，整体重取
        else:
            if mn > start_ms:
                ranges.append((start_ms, mn - step))
            end_aligned = end_ms // step * step
            # 最后一根可能是缓存时尚未收盘的 K 线，触及当前时间时总是刷新
            if mx < end_aligned or end_ms >= now - step:
                ranges.append((mx, end_ms))

    for a, b in ranges:
        if b >= a:
            bars = await src.fetch_klines(symbol, interval, a, b)
            _upsert(src.name, symbol, interval, bars)

    rows = db.query(
        "SELECT ts, open, high, low, close, volume FROM klines"
        " WHERE source=? AND symbol=? AND interval=? AND ts BETWEEN ? AND ? ORDER BY ts",
        (*key, start_ms, end_ms),
    )
    return [(r["ts"], r["open"], r["high"], r["low"], r["close"], r["volume"]) for r in rows]


async def get_recent_klines(source: str, symbol: str, interval: str, limit: int = 500) -> list[Kline]:
    step = _check_interval(interval)
    limit = max(1, min(limit, config.MAX_BARS))
    now = now_ms()
    start = (now // step - (limit - 1)) * step
    return await get_klines(source, symbol, interval, start, now)


async def get_tickers(source: str, symbols: list[str]) -> list[Ticker]:
    src = get_source(source)
    return await src.fetch_tickers([normalize_symbol(s) for s in symbols])


def to_frame(bars: list[Kline]) -> pd.DataFrame:
    return pd.DataFrame(bars, columns=["ts", "open", "high", "low", "close", "volume"])
