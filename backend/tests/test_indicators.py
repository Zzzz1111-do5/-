import numpy as np
import pandas as pd

from app import indicators as ind


def test_sma_and_ema():
    s = pd.Series([1, 2, 3, 4, 5], dtype=float)
    assert ind.sma(s, 3).tolist()[2:] == [2.0, 3.0, 4.0]
    assert np.isnan(ind.sma(s, 3).iloc[1])
    e = ind.ema(s, 3)
    assert np.isnan(e.iloc[1])
    # span=3 -> alpha=0.5, 从第一个值开始递推
    assert e.iloc[2] == 2.25


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1, 40, dtype=float))
    assert ind.rsi(up, 14).dropna().eq(100).all()
    rng = np.random.default_rng(0)
    s = pd.Series(100 + rng.normal(0, 1, 500).cumsum())
    r = ind.rsi(s, 14).dropna()
    assert ((r >= 0) & (r <= 100)).all()
    assert len(r) == 500 - 14


def test_donchian_excludes_current_bar():
    high = pd.Series([1, 2, 3, 10, 4], dtype=float)
    low = pd.Series([0, 1, 2, 3, 1], dtype=float)
    up, dn = ind.donchian(high, low, 2)
    assert up.iloc[3] == 3  # 第 3 根的最高价 10 不应计入自身的通道
    assert up.iloc[4] == 10
    assert dn.iloc[4] == 2


def test_bollinger_and_supertrend_shapes():
    rng = np.random.default_rng(1)
    c = pd.Series(100 + rng.normal(0, 1, 300).cumsum())
    upper, mid, lower = ind.bollinger(c, 20, 2)
    valid = mid.notna()
    assert (upper[valid] >= mid[valid]).all() and (mid[valid] >= lower[valid]).all()
    line, direction = ind.supertrend(c + 0.5, c - 0.5, c, 10, 3)
    assert set(direction.iloc[20:].unique()) <= {1.0, -1.0}
