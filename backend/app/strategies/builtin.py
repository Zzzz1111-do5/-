"""内置策略库。"""

import math

import numpy as np
import pandas as pd

from .. import indicators as ind
from .base import Param, Strategy, StrategyOutput


def _sign_target(a: pd.Series, b: pd.Series) -> pd.Series:
    t = pd.Series(np.where(a > b, 1.0, np.where(a < b, -1.0, 0.0)), index=a.index)
    return t.where(a.notna() & b.notna(), 0.0)


def _fast_lt_slow(p: dict) -> None:
    if p["fast"] >= p["slow"]:
        raise ValueError("快线周期必须小于慢线周期")


# ---------------------------------------------------------------- 趋势类


def buy_hold(df: pd.DataFrame, p: dict) -> StrategyOutput:
    return StrategyOutput(target=pd.Series(1.0, index=df.index))


def sma_cross(df: pd.DataFrame, p: dict) -> StrategyOutput:
    fast, slow = ind.sma(df["close"], p["fast"]), ind.sma(df["close"], p["slow"])
    return StrategyOutput(
        target=_sign_target(fast, slow),
        overlays={f"MA{p['fast']}": fast, f"MA{p['slow']}": slow},
    )


def ema_cross(df: pd.DataFrame, p: dict) -> StrategyOutput:
    fast, slow = ind.ema(df["close"], p["fast"]), ind.ema(df["close"], p["slow"])
    return StrategyOutput(
        target=_sign_target(fast, slow),
        overlays={f"EMA{p['fast']}": fast, f"EMA{p['slow']}": slow},
    )


def macd_cross(df: pd.DataFrame, p: dict) -> StrategyOutput:
    line, sig, _ = ind.macd(df["close"], p["fast"], p["slow"], p["signal"])
    return StrategyOutput(
        target=_sign_target(line, sig),
        oscillators={"MACD": line, "Signal": sig},
        levels=[0.0],
    )


def donchian_breakout(df: pd.DataFrame, p: dict) -> StrategyOutput:
    up_n, dn_n = ind.donchian(df["high"], df["low"], p["entry"])
    up_m, dn_m = ind.donchian(df["high"], df["low"], p["exit"])
    c, un, dn, um, dm = (x.to_numpy() for x in (df["close"], up_n, dn_n, up_m, dn_m))
    target = np.zeros(len(c))
    pos = 0.0
    for i in range(len(c)):
        if math.isnan(un[i]) or math.isnan(dm[i]):
            continue
        if pos > 0 and c[i] < dm[i]:
            pos = 0.0
        elif pos < 0 and c[i] > um[i]:
            pos = 0.0
        if pos == 0:
            if c[i] > un[i]:
                pos = 1.0
            elif c[i] < dn[i]:
                pos = -1.0
        target[i] = pos
    return StrategyOutput(
        target=pd.Series(target, index=df.index),
        overlays={f"上轨{p['entry']}": up_n, f"下轨{p['entry']}": dn_n},
    )


def supertrend(df: pd.DataFrame, p: dict) -> StrategyOutput:
    line, direction = ind.supertrend(df["high"], df["low"], df["close"], p["period"], p["multiplier"])
    return StrategyOutput(target=direction, overlays={"SuperTrend": line})


# ---------------------------------------------------------------- 震荡/均值回归类


def rsi_reversion(df: pd.DataFrame, p: dict) -> StrategyOutput:
    r = ind.rsi(df["close"], p["period"])
    rv = r.to_numpy()
    target = np.zeros(len(rv))
    pos = 0.0
    for i in range(len(rv)):
        if math.isnan(rv[i]):
            continue
        if rv[i] < p["oversold"]:
            pos = 1.0
        elif rv[i] > p["overbought"]:
            pos = -1.0
        target[i] = pos
    return StrategyOutput(
        target=pd.Series(target, index=df.index),
        oscillators={f"RSI{p['period']}": r},
        levels=[p["oversold"], p["overbought"]],
    )


def bollinger_reversion(df: pd.DataFrame, p: dict) -> StrategyOutput:
    upper, mid, lower = ind.bollinger(df["close"], p["period"], p["k"])
    c, u, m, lo = (x.to_numpy() for x in (df["close"], upper, mid, lower))
    target = np.zeros(len(c))
    pos = 0.0
    for i in range(len(c)):
        if math.isnan(m[i]):
            continue
        if pos > 0 and c[i] >= m[i]:
            pos = 0.0
        elif pos < 0 and c[i] <= m[i]:
            pos = 0.0
        if pos == 0:
            if c[i] < lo[i]:
                pos = 1.0
            elif c[i] > u[i]:
                pos = -1.0
        target[i] = pos
    return StrategyOutput(
        target=pd.Series(target, index=df.index),
        overlays={"布林上轨": upper, "布林中轨": mid, "布林下轨": lower},
    )


def dynamic_grid(df: pd.DataFrame, p: dict) -> StrategyOutput:
    """以均线为中枢的网格：价格每下跌一格加仓 1/levels，每上涨一格减仓 1/levels。"""
    center = ind.sma(df["close"], p["center_period"])
    width = p["width"]
    levels = p["levels"]
    c, m = df["close"].to_numpy(), center.to_numpy()
    target = np.zeros(len(c))
    q = None
    for i in range(len(c)):
        if math.isnan(m[i]):
            continue
        x = (m[i] - c[i]) / (width * m[i])  # 价格低于中枢为正
        level = min(max((0.5 + 0.5 * x) * levels, 0.0), float(levels))
        if q is None:
            q = round(level)
        elif level >= q + 1:
            q = math.floor(level)
        elif level <= q - 1:
            q = math.ceil(level)
        target[i] = q / levels
    return StrategyOutput(
        target=pd.Series(target, index=df.index),
        overlays={
            "网格中枢": center,
            "网格上沿": center * (1 + width),
            "网格下沿": center * (1 - width),
        },
    )


STRATEGIES: list[Strategy] = [
    Strategy(
        id="sma_cross",
        name="双均线交叉",
        category="趋势跟踪",
        description="快速均线上穿慢速均线做多，下穿时平多（允许做空时反手做空）。经典趋势跟踪策略，适合单边行情。",
        params=[
            Param("fast", "快线周期", "int", 10, 2, 200, 1),
            Param("slow", "慢线周期", "int", 30, 5, 500, 1),
        ],
        fn=sma_cross,
        validate=_fast_lt_slow,
    ),
    Strategy(
        id="ema_cross",
        name="EMA 均线交叉",
        category="趋势跟踪",
        description="使用指数移动平均线的金叉/死叉，对价格变化反应比简单均线更快。",
        params=[
            Param("fast", "快线周期", "int", 12, 2, 200, 1),
            Param("slow", "慢线周期", "int", 26, 5, 500, 1),
        ],
        fn=ema_cross,
        validate=_fast_lt_slow,
    ),
    Strategy(
        id="macd",
        name="MACD 金叉死叉",
        category="趋势跟踪",
        description="MACD 线上穿信号线做多，下穿平多/做空。兼顾趋势与动量。",
        params=[
            Param("fast", "快线 EMA", "int", 12, 2, 100, 1),
            Param("slow", "慢线 EMA", "int", 26, 5, 300, 1),
            Param("signal", "信号线", "int", 9, 2, 100, 1),
        ],
        fn=macd_cross,
        validate=_fast_lt_slow,
    ),
    Strategy(
        id="donchian",
        name="海龟通道突破",
        category="趋势跟踪",
        description="收盘价突破过去 N 根 K 线最高价开多，跌破过去 M 根最低价平仓（唐奇安通道 / 海龟交易法则）。",
        params=[
            Param("entry", "入场通道周期 N", "int", 20, 5, 300, 1),
            Param("exit", "出场通道周期 M", "int", 10, 2, 300, 1),
        ],
        fn=donchian_breakout,
    ),
    Strategy(
        id="supertrend",
        name="SuperTrend 超级趋势",
        category="趋势跟踪",
        description="基于 ATR 波动率的动态止损线，价格站上趋势线做多，跌破做空/平仓。",
        params=[
            Param("period", "ATR 周期", "int", 10, 2, 200, 1),
            Param("multiplier", "ATR 倍数", "float", 3.0, 0.5, 10.0, 0.1),
        ],
        fn=supertrend,
    ),
    Strategy(
        id="rsi",
        name="RSI 超买超卖",
        category="均值回归",
        description="RSI 低于超卖线买入，高于超买线卖出（允许做空时反手）。适合震荡行情。",
        params=[
            Param("period", "RSI 周期", "int", 14, 2, 100, 1),
            Param("oversold", "超卖线", "float", 30, 1, 50, 1),
            Param("overbought", "超买线", "float", 70, 50, 99, 1),
        ],
        fn=rsi_reversion,
    ),
    Strategy(
        id="bollinger",
        name="布林带均值回归",
        category="均值回归",
        description="价格跌破布林下轨买入，回归中轨平仓；突破上轨做空，回归中轨平仓。",
        params=[
            Param("period", "均线周期", "int", 20, 5, 200, 1),
            Param("k", "标准差倍数", "float", 2.0, 0.5, 5.0, 0.1),
        ],
        fn=bollinger_reversion,
    ),
    Strategy(
        id="grid",
        name="动态网格交易",
        category="网格",
        description="以均线为网格中枢，在中枢上下各 width 范围内划分网格：每下跌一格买入一份，每上涨一格卖出一份。仅做多。",
        params=[
            Param("center_period", "中枢均线周期", "int", 100, 10, 1000, 1),
            Param("width", "网格半宽（比例）", "float", 0.1, 0.01, 0.5, 0.01, "0.1 表示中枢上下 10%"),
            Param("levels", "网格数量", "int", 10, 2, 50, 1),
        ],
        fn=dynamic_grid,
        long_only=True,
    ),
    Strategy(
        id="buy_hold",
        name="买入持有（基准）",
        category="基准",
        description="第一根 K 线买入并一直持有，用作对比基准。",
        params=[],
        fn=buy_hold,
        long_only=True,
    ),
]
