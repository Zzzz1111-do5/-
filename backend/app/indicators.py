"""技术指标（只使用当前及历史数据，无未来函数）。"""

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    out = s.ewm(span=n, adjust=False).mean()
    out.iloc[: n - 1] = np.nan
    return out


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    delta = s.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    avg_loss = loss.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    out = out.where(avg_loss != 0, 100.0)
    out.iloc[:n] = np.nan
    return out


def macd(s: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[pd.Series, pd.Series, pd.Series]:
    line = s.ewm(span=fast, adjust=False).mean() - s.ewm(span=slow, adjust=False).mean()
    sig = line.ewm(span=signal, adjust=False).mean()
    warmup = slow + signal - 2
    line.iloc[:warmup] = np.nan
    sig.iloc[:warmup] = np.nan
    return line, sig, line - sig


def bollinger(s: pd.Series, n: int = 20, k: float = 2.0) -> tuple[pd.Series, pd.Series, pd.Series]:
    mid = sma(s, n)
    std = s.rolling(n, min_periods=n).std(ddof=0)
    return mid + k * std, mid, mid - k * std


def atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    prev = close.shift(1)
    tr = pd.concat([high - low, (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def donchian(high: pd.Series, low: pd.Series, n: int) -> tuple[pd.Series, pd.Series]:
    """前 n 根 K 线（不含当前）的最高价/最低价。"""
    return high.rolling(n, min_periods=n).max().shift(1), low.rolling(n, min_periods=n).min().shift(1)


def supertrend(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 10, mult: float = 3.0) -> tuple[pd.Series, pd.Series]:
    """返回 (supertrend 线, 方向 1/-1)。"""
    a = atr(high, low, close, n).to_numpy()
    hl2 = ((high + low) / 2).to_numpy()
    c = close.to_numpy()
    size = len(c)
    upper = hl2 + mult * a
    lower = hl2 - mult * a
    line = np.full(size, np.nan)
    direction = np.zeros(size)
    fu, fl = np.nan, np.nan
    d = 1
    for i in range(size):
        if np.isnan(a[i]):
            continue
        if np.isnan(fu):
            fu, fl = upper[i], lower[i]
        else:
            fu = upper[i] if (upper[i] < fu or c[i - 1] > fu) else fu
            fl = lower[i] if (lower[i] > fl or c[i - 1] < fl) else fl
            if d == 1 and c[i] < fl:
                d = -1
            elif d == -1 and c[i] > fu:
                d = 1
        line[i] = fl if d == 1 else fu
        direction[i] = d
    return pd.Series(line, index=close.index), pd.Series(direction, index=close.index)
