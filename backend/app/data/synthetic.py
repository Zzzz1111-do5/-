"""离线模拟行情：确定性生成，任意时间区间结果一致，用于演示与测试。"""

import hashlib
import math
import time

import numpy as np

from .. import config
from .base import Kline, Ticker

DAY_MS = 86_400_000
BASE_PRICES = {
    "BTC": 60000.0,
    "ETH": 3000.0,
    "SOL": 150.0,
    "BNB": 550.0,
    "XRP": 0.6,
    "DOGE": 0.12,
    "ADA": 0.45,
    "AVAX": 30.0,
}
MINUTE_MS = 60_000
# 多尺度值噪声叠加（1 分钟 ~ 约 2 年），幅度 ∝ sqrt(尺度)，近似布朗运动；
# 尺度为绝对时间，因此不同周期的 K 线在同一时刻价格一致。
OCTAVES = [MINUTE_MS * 2**k for k in range(21)]
DAILY_VOL = 0.035
_C = DAILY_VOL / math.sqrt(6.0)

_M1 = np.uint64(0xBF58476D1CE4E5B9)
_M2 = np.uint64(0x94D049BB133111EB)
_GOLD = np.uint64(0x9E3779B97F4A7C15)


def _seed(*parts: str) -> int:
    return int.from_bytes(hashlib.md5("|".join(parts).encode()).digest()[:8], "little")


def _splitmix(x: np.ndarray) -> np.ndarray:
    with np.errstate(over="ignore"):
        z = x + _GOLD
        z = (z ^ (z >> np.uint64(30))) * _M1
        z = (z ^ (z >> np.uint64(27))) * _M2
        return z ^ (z >> np.uint64(31))


def _uniform(ts: np.ndarray, seed: int) -> np.ndarray:
    z = _splitmix(ts.astype(np.uint64) ^ np.uint64(seed))
    return ((z >> np.uint64(11)).astype(np.float64) + 0.5) * (1.0 / 9007199254740992.0)


def _normal(ts: np.ndarray, seed: int) -> np.ndarray:
    u1 = _uniform(ts, seed)
    u2 = _uniform(ts, seed ^ 0x5DEECE66D)
    return np.sqrt(-2.0 * np.log(u1)) * np.cos(2.0 * math.pi * u2)


def _r(x: float) -> float:
    """保留 7 位有效数字，减小数据体积。"""
    return float(f"{x:.7g}")


class _Model:
    def __init__(self, symbol: str):
        base = symbol.split("/")[0]
        rng = np.random.default_rng(_seed("model", symbol))
        self.base_price = BASE_PRICES.get(base, float(rng.uniform(1, 100)))
        self.seeds = [_seed("octave", symbol, str(k)) for k in range(len(OCTAVES))]
        self.vol_scale = float(rng.uniform(0.8, 1.3)) * (0.8 if base == "BTC" else 1.0)

    def log_price(self, t_ms: np.ndarray) -> np.ndarray:
        lp = np.full(t_ms.shape, math.log(self.base_price))
        t = t_ms.astype(np.int64)
        for scale, seed in zip(OCTAVES, self.seeds):
            g = t // scale
            frac = (t % scale).astype(np.float64) / scale
            v0 = _normal(g, seed)
            v1 = _normal(g + 1, seed)
            amp = _C * self.vol_scale * math.sqrt(scale / DAY_MS)
            lp += amp * (v0 + (v1 - v0) * frac)
        return lp


class SyntheticSource:
    name = "synthetic"
    label = "模拟数据（离线）"
    cacheable = False

    def generate(self, symbol: str, interval: str, start_ms: int, end_ms: int, now_ms: int | None = None) -> list[Kline]:
        step = config.INTERVALS[interval]
        now = int(time.time() * 1000) if now_ms is None else now_ms
        first = -(-start_ms // step) * step
        last = min(end_ms, now) // step * step
        if last < first:
            return []
        ts = np.arange(first, last + step, step, dtype=np.int64)
        model = _Model(symbol)
        minutes = step / 60_000
        sigma = DAILY_VOL / math.sqrt(1440) * math.sqrt(minutes) * model.vol_scale
        seed = _seed("wick", symbol, interval)

        close = np.exp(model.log_price(np.minimum(ts + step, now)))
        open_ = np.exp(model.log_price(ts))
        hi_n = np.abs(_normal(ts, seed ^ 0xA5A5))
        lo_n = np.abs(_normal(ts, seed ^ 0x5A5A))
        high = np.maximum(open_, close) * np.exp(hi_n * sigma * 0.6)
        low = np.minimum(open_, close) * np.exp(-lo_n * sigma * 0.6)
        move = np.abs(np.log(close / open_))
        vol_base = 2e6 / model.base_price * minutes
        volume = vol_base * (0.5 + _uniform(ts, seed ^ 0x77)) * (1 + 40 * move)
        return [
            (int(t), _r(o), _r(h), _r(lw), _r(c), round(float(v), 4))
            for t, o, h, lw, c, v in zip(ts, open_, high, low, close, volume)
        ]

    async def fetch_klines(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Kline]:
        return self.generate(symbol, interval, start_ms, end_ms)

    async def fetch_tickers(self, symbols: list[str]) -> list[Ticker]:
        now = int(time.time() * 1000)
        out = []
        for s in symbols:
            bars = self.generate(s, "15m", now - DAY_MS, now, now)
            if not bars:
                continue
            last = bars[-1][4]
            first_open = bars[0][1]
            out.append(
                Ticker(
                    symbol=s,
                    last=last,
                    change_pct=(last / first_open - 1) * 100,
                    high=max(b[2] for b in bars),
                    low=min(b[3] for b in bars),
                    volume=sum(b[5] for b in bars),
                    quote_volume=sum(b[5] * b[4] for b in bars),
                )
            )
        return out
