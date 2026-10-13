"""交易撮合与回测引擎。

约定：
- 策略在第 i 根 K 线收盘后给出目标仓位，在第 i+1 根 K 线开盘价成交（避免未来函数）。
- 目标仓位为权益的比例，-1 ~ 1；现货不加杠杆，买入受可用现金约束。
- 止损/止盈按持仓均价计算，在 K 线内部用最高/最低价触发；同一根 K 线同时触发时保守地按止损处理。
- 止损/止盈出场后，需等待策略信号发生变化才会重新入场。
"""

import math
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

EPS = 1e-12
MS_PER_YEAR = 365.25 * 86_400_000


@dataclass
class Order:
    ts: int
    side: str  # buy / sell
    price: float
    qty: float
    notional: float
    fee: float
    reason: str


@dataclass
class Trade:
    side: str  # long / short
    entry_time: int
    entry_price: float
    exit_time: int
    exit_price: float
    qty: float
    pnl: float
    return_pct: float
    exit_reason: str


@dataclass
class BacktestConfig:
    initial_capital: float = 10_000.0
    fee_rate: float = 0.001
    slippage: float = 0.0005
    allow_short: bool = False
    stop_loss: float | None = None
    take_profit: float | None = None


class Portfolio:
    """现货/简化合约账户：均价法记账，跟踪逐笔成交和完整的开平仓交易。"""

    def __init__(self, cash: float, fee_rate: float = 0.001, slippage: float = 0.0):
        self.cash = float(cash)
        self.fee_rate = fee_rate
        self.slippage = slippage
        self.units = 0.0
        self.avg_price = 0.0
        self.fees_paid = 0.0
        self.open_trade: dict | None = None
        self.orders: list[Order] = []
        self.trades: list[Trade] = []

    # ------------------------------------------------------------ 状态
    def equity(self, price: float) -> float:
        return self.cash + self.units * price

    def exposure(self, price: float) -> float:
        eq = self.equity(price)
        return self.units * price / eq if eq > 0 else 0.0

    def unrealized_pnl(self, price: float) -> float:
        return self.units * (price - self.avg_price)

    def to_state(self) -> dict:
        return {
            "cash": self.cash,
            "units": self.units,
            "avg_price": self.avg_price,
            "fees_paid": self.fees_paid,
            "open_trade": self.open_trade,
        }

    @classmethod
    def from_state(cls, state: dict, fee_rate: float, slippage: float) -> "Portfolio":
        pf = cls(state["cash"], fee_rate, slippage)
        pf.units = state.get("units", 0.0)
        pf.avg_price = state.get("avg_price", 0.0)
        pf.fees_paid = state.get("fees_paid", 0.0)
        pf.open_trade = state.get("open_trade")
        return pf

    # ------------------------------------------------------------ 交易
    def rebalance(self, target: float, price: float, ts: int, reason: str = "signal", slip: bool = True) -> Order | None:
        """把仓位调整到权益的 target 比例，按 price（含滑点）成交。"""
        eq = self.equity(price)
        if eq <= 0:
            target = 0.0
        desired = target * eq / price
        dq = desired - self.units
        if target == 0.0:
            dq = -self.units
        slippage = self.slippage if slip else 0.0
        if dq > 0:
            px = price * (1 + slippage)
            cap = max(self.cash / (px * (1 + self.fee_rate)), max(-self.units, 0.0))
            dq = min(dq, cap)
        else:
            px = price * (1 - slippage)
        if abs(dq) * px <= max(abs(eq), 1.0) * 1e-9:
            return None
        notional = abs(dq) * px
        fee = notional * self.fee_rate
        self.cash -= dq * px + fee
        self.fees_paid += fee
        self._apply_fill(dq, px, fee, ts, reason)
        order = Order(ts, "buy" if dq > 0 else "sell", px, abs(dq), notional, fee, reason)
        self.orders.append(order)
        return order

    def _apply_fill(self, dq: float, px: float, fee: float, ts: int, reason: str) -> None:
        fee_per_unit = fee / abs(dq)
        remaining = dq
        if self.units * dq < 0:  # 先平掉反向持仓
            direction = 1.0 if self.units > 0 else -1.0
            close_qty = min(abs(dq), abs(self.units))
            tr = self.open_trade
            tr["pnl"] += close_qty * (px - self.avg_price) * direction - fee_per_unit * close_qty
            tr["exit_value"] += close_qty * px
            tr["exit_qty"] += close_qty
            self.units -= direction * close_qty
            remaining = dq + direction * close_qty
            if abs(self.units) <= EPS * max(1.0, close_qty):
                self.units = 0.0
                self.avg_price = 0.0
                self._close_trade(ts, reason)
        if abs(remaining) > EPS * max(1.0, abs(dq)):
            if self.units == 0.0:
                self.open_trade = {
                    "side": "long" if remaining > 0 else "short",
                    "entry_time": ts,
                    "entry_value": 0.0,
                    "entry_qty": 0.0,
                    "exit_value": 0.0,
                    "exit_qty": 0.0,
                    "max_qty": 0.0,
                    "pnl": 0.0,
                }
            tr = self.open_trade
            qty = abs(remaining)
            self.avg_price = (abs(self.units) * self.avg_price + qty * px) / (abs(self.units) + qty)
            self.units += remaining
            tr["pnl"] -= fee_per_unit * qty
            tr["entry_value"] += qty * px
            tr["entry_qty"] += qty
            tr["max_qty"] = max(tr["max_qty"], abs(self.units))

    def _close_trade(self, ts: int, reason: str) -> None:
        tr = self.open_trade
        if not tr:
            return
        entry_price = tr["entry_value"] / tr["entry_qty"] if tr["entry_qty"] else 0.0
        exit_price = tr["exit_value"] / tr["exit_qty"] if tr["exit_qty"] else 0.0
        self.trades.append(
            Trade(
                side=tr["side"],
                entry_time=tr["entry_time"],
                entry_price=entry_price,
                exit_time=ts,
                exit_price=exit_price,
                qty=tr["max_qty"],
                pnl=tr["pnl"],
                return_pct=tr["pnl"] / tr["entry_value"] if tr["entry_value"] else 0.0,
                exit_reason=reason,
            )
        )
        self.open_trade = None


def stop_trigger(
    units: float, avg_price: float, stop_loss: float | None, take_profit: float | None, bar_open: float, high: float, low: float
) -> tuple[float, str] | None:
    """检查止损/止盈是否触发，返回 (成交价, 原因)。跳空时按开盘价成交。"""
    if units > 0:
        if stop_loss and low <= avg_price * (1 - stop_loss):
            return min(bar_open, avg_price * (1 - stop_loss)), "stop_loss"
        if take_profit and high >= avg_price * (1 + take_profit):
            return max(bar_open, avg_price * (1 + take_profit)), "take_profit"
    elif units < 0:
        if stop_loss and high >= avg_price * (1 + stop_loss):
            return max(bar_open, avg_price * (1 + stop_loss)), "stop_loss"
        if take_profit and low <= avg_price * (1 - take_profit):
            return min(bar_open, avg_price * (1 - take_profit)), "take_profit"
    return None


class SignalGate:
    """止损后屏蔽原信号，直到信号变化才允许再次入场。模拟盘与回测共用。"""

    def __init__(self, current_target: float = 0.0, blocked_signal: float | None = None):
        self.current_target = current_target
        self.blocked_signal = blocked_signal

    def desired(self, signal: float) -> float:
        if self.blocked_signal is not None:
            if abs(signal - self.blocked_signal) > 1e-9:
                self.blocked_signal = None
            else:
                return 0.0
        return signal

    def on_stop(self, signal: float) -> None:
        self.blocked_signal = signal
        self.current_target = 0.0


def clamp_target(target: np.ndarray, allow_short: bool) -> np.ndarray:
    return np.clip(np.nan_to_num(target.astype(float)), -1.0 if allow_short else 0.0, 1.0)


@dataclass
class SimResult:
    ts: np.ndarray
    equity: np.ndarray
    exposure: np.ndarray
    portfolio: Portfolio
    start: int
    extra: dict = field(default_factory=dict)


def simulate(df: pd.DataFrame, target: np.ndarray, cfg: BacktestConfig, start: int = 0) -> SimResult:
    ts = df["ts"].to_numpy(dtype=np.int64)
    o, h, lo, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    target = clamp_target(np.asarray(target), cfg.allow_short)
    n = len(df)
    pf = Portfolio(cfg.initial_capital, cfg.fee_rate, cfg.slippage)
    gate = SignalGate()
    equity = np.empty(n - start)
    exposure = np.empty(n - start)
    bankrupt = False

    for i in range(start, n):
        if i >= 1 and not bankrupt:
            desired = gate.desired(target[i - 1])
            if abs(desired - gate.current_target) > 1e-9:
                pf.rebalance(desired, o[i], int(ts[i]), "signal")
                gate.current_target = desired
        if pf.units != 0.0 and (cfg.stop_loss or cfg.take_profit):
            hit = stop_trigger(pf.units, pf.avg_price, cfg.stop_loss, cfg.take_profit, o[i], h[i], lo[i])
            if hit:
                pf.rebalance(0.0, hit[0], int(ts[i]), hit[1])
                gate.on_stop(target[i - 1] if i >= 1 else 0.0)
        eq = pf.equity(c[i])
        if eq <= 0 and not bankrupt:
            pf.rebalance(0.0, c[i], int(ts[i]), "liquidation", slip=False)
            bankrupt = True
            eq = pf.equity(c[i])
        equity[i - start] = eq
        exposure[i - start] = pf.exposure(c[i])

    if pf.units != 0.0:
        pf.rebalance(0.0, c[-1], int(ts[-1]), "end")
        equity[-1] = pf.equity(c[-1])
    return SimResult(ts=ts[start:], equity=equity, exposure=exposure, portfolio=pf, start=start)


def _finite(x: float | None) -> float | None:
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def compute_metrics(sim: SimResult, interval_ms: int, initial: float, bench_close: np.ndarray, bench_open: float) -> dict:
    eq = sim.equity
    ts = sim.ts
    trades = sim.portfolio.trades
    final = float(eq[-1]) if len(eq) else initial
    total_return = final / initial - 1
    years = (ts[-1] - ts[0] + interval_ms) / MS_PER_YEAR if len(ts) else 0
    cagr = (final / initial) ** (1 / years) - 1 if years > 0 and final > 0 else (-1.0 if final <= 0 else 0.0)

    prev = np.concatenate([[initial], eq[:-1]])
    rets = np.where(prev > 0, eq / np.where(prev > 0, prev, 1) - 1, 0.0)
    ppy = MS_PER_YEAR / interval_ms
    std = rets.std(ddof=1) if len(rets) > 1 else 0.0
    sharpe = rets.mean() / std * math.sqrt(ppy) if std > 0 else 0.0
    downside = math.sqrt(float(np.mean(np.minimum(rets, 0) ** 2))) if len(rets) else 0.0
    sortino = rets.mean() / downside * math.sqrt(ppy) if downside > 0 else 0.0
    volatility = std * math.sqrt(ppy)

    peak = np.maximum.accumulate(np.concatenate([[initial], eq]))[1:]
    dd = eq / peak - 1
    max_dd = float(dd.min()) if len(dd) else 0.0
    # 最长回撤持续时间（从前高到收复前高）
    longest = cur_start = 0
    in_dd = False
    for i, v in enumerate(dd):
        if v < -1e-12 and not in_dd:
            in_dd, cur_start = True, i
        elif v >= -1e-12 and in_dd:
            in_dd = False
            longest = max(longest, i - cur_start)
    if in_dd:
        longest = max(longest, len(dd) - cur_start)
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_win = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)
    bench_return = float(bench_close[-1] / bench_open - 1) if len(bench_close) and bench_open else 0.0
    holding_hours = [(t.exit_time - t.entry_time) / 3_600_000 for t in trades]

    return {
        "initial_capital": initial,
        "final_equity": final,
        "total_return": total_return,
        "annual_return": _finite(cagr),
        "max_drawdown": max_dd,
        "max_drawdown_days": longest * interval_ms / 86_400_000,
        "volatility": _finite(volatility),
        "sharpe": _finite(sharpe),
        "sortino": _finite(sortino),
        "calmar": _finite(calmar),
        "trades": len(trades),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "profit_factor": _finite(gross_win / gross_loss) if gross_loss > 0 else None,
        "avg_trade_return": float(np.mean([t.return_pct for t in trades])) if trades else 0.0,
        "best_trade": max((t.return_pct for t in trades), default=0.0),
        "worst_trade": min((t.return_pct for t in trades), default=0.0),
        "avg_holding_hours": float(np.mean(holding_hours)) if holding_hours else 0.0,
        "exposure": float(np.mean(np.abs(sim.exposure) > 1e-9)) if len(sim.exposure) else 0.0,
        "total_fees": sim.portfolio.fees_paid,
        "benchmark_return": bench_return,
        "excess_return": total_return - bench_return,
    }


def _series(ts: np.ndarray, values: np.ndarray | pd.Series, digits: int = 8) -> list[list]:
    v = np.asarray(values, dtype=float)
    return [[int(t), round(float(x), digits)] for t, x in zip(ts, v) if math.isfinite(x)]


def run_backtest(df: pd.DataFrame, strategy, params: dict | None, cfg: BacktestConfig, interval_ms: int) -> dict:
    """完整回测，返回指标、权益曲线、成交与图表数据。"""
    if len(df) < 2:
        raise ValueError("K 线数据不足，至少需要 2 根")
    out = strategy.run(df, params)
    allow_short = cfg.allow_short and not strategy.long_only
    cfg = BacktestConfig(**{**asdict(cfg), "allow_short": allow_short})
    sim = simulate(df, out.target.to_numpy(), cfg)
    ts = sim.ts
    close = df["close"].to_numpy(dtype=float)
    first_open = float(df["open"].iloc[0])
    metrics = compute_metrics(sim, interval_ms, cfg.initial_capital, close, first_open)

    peak = np.maximum.accumulate(np.concatenate([[cfg.initial_capital], sim.equity]))[1:]
    return {
        "metrics": metrics,
        "params": strategy.resolve_params(params),
        "candles": [[int(r.ts), r.open, r.high, r.low, r.close, r.volume] for r in df.itertuples(index=False)],
        "equity": _series(ts, sim.equity, 4),
        "benchmark": _series(ts, cfg.initial_capital * close / first_open, 4),
        "drawdown": _series(ts, sim.equity / peak - 1, 6),
        "position": _series(ts, sim.exposure, 4),
        "overlays": {k: _series(ts, v.to_numpy()) for k, v in out.overlays.items()},
        "oscillators": {k: _series(ts, v.to_numpy()) for k, v in out.oscillators.items()},
        "levels": out.levels,
        "orders": [asdict(o) for o in sim.portfolio.orders],
        "trades": [asdict(t) for t in sim.portfolio.trades],
    }
