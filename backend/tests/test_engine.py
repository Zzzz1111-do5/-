import numpy as np
import pytest

from app.engine import BacktestConfig, Portfolio, compute_metrics, simulate
from tests.conftest import make_df


def cfg(**kw):
    return BacktestConfig(**{"initial_capital": 1000.0, "fee_rate": 0.0, "slippage": 0.0, **kw})


def test_buy_and_hold_tracks_price_without_costs():
    df = make_df([100, 110, 121, 133.1])
    sim = simulate(df, np.ones(4), cfg())
    # 第 0 根收盘发出信号，第 1 根开盘（=100）买入
    assert sim.portfolio.orders[0].ts == df["ts"][1]
    assert sim.portfolio.orders[0].price == 100
    assert sim.equity[-1] == pytest.approx(1331.0)


def test_signal_executes_next_bar_open_no_lookahead():
    df = make_df([100, 100, 200, 200], opens=[100, 100, 150, 200])
    target = np.array([0, 1, 1, 1])
    sim = simulate(df, target, cfg())
    order = sim.portfolio.orders[0]
    assert order.ts == df["ts"][2]
    assert order.price == 150  # 第 1 根收盘出信号 -> 第 2 根开盘价成交


def test_fees_and_slippage_are_charged():
    df = make_df([100] * 5)
    sim = simulate(df, np.array([1, 0, 0, 0, 0]), cfg(fee_rate=0.001, slippage=0.001))
    pf = sim.portfolio
    assert len(pf.orders) == 2
    assert pf.orders[0].price == pytest.approx(100.1)
    assert pf.orders[1].price == pytest.approx(99.9)
    assert pf.cash < 1000 * (1 - 0.003)
    assert len(pf.trades) == 1 and pf.trades[0].pnl < 0
    # 买入不超过可用现金
    assert pf.orders[0].notional + pf.orders[0].fee == pytest.approx(1000.0)


def test_short_profit_when_price_falls():
    df = make_df([100, 100, 80, 80])
    sim = simulate(df, np.array([-1, -1, -1, 0]), cfg(allow_short=True))
    t = sim.portfolio.trades[0]
    assert t.side == "short"
    assert t.pnl == pytest.approx(200.0)
    assert sim.equity[-1] == pytest.approx(1200.0)


def test_long_only_clamps_short_signals():
    df = make_df([100, 90, 80, 70])
    sim = simulate(df, np.array([-1, -1, -1, -1]), cfg(allow_short=False))
    assert not sim.portfolio.orders
    assert sim.equity[-1] == 1000


def test_stop_loss_triggers_and_blocks_reentry():
    closes = [100, 100, 95, 85, 85, 85, 90]
    lows = [100, 100, 94, 80, 85, 85, 85]
    df = make_df(closes, lows=lows)
    target = np.array([1, 1, 1, 1, 1, 0, 1])
    sim = simulate(df, target, cfg(stop_loss=0.1))
    reasons = [o.reason for o in sim.portfolio.orders]
    assert reasons[:2] == ["signal", "stop_loss"]
    assert sim.portfolio.orders[1].price == pytest.approx(90.0)
    # 止损后信号保持为 1 时不应重新入场，信号变为 0 再变 1 后才入场（最后一根之后无 K 线可成交）
    assert len(sim.portfolio.orders) == 2
    assert sim.portfolio.trades[0].exit_reason == "stop_loss"


def test_take_profit_with_gap_fills_at_open():
    df = make_df([100, 100, 130, 130], opens=[100, 100, 125, 130], highs=[100, 100, 131, 130])
    sim = simulate(df, np.array([1, 1, 1, 1]), cfg(take_profit=0.2))
    tp = [o for o in sim.portfolio.orders if o.reason == "take_profit"][0]
    assert tp.price == 125  # 跳空高开超过止盈价，按开盘价成交


def test_partial_positions_round_trip_accounting():
    pf = Portfolio(1000, fee_rate=0.0)
    pf.rebalance(0.5, 100, 1)  # 5 个单位 @100
    pf.rebalance(1.0, 80, 2)  # 权益 900 -> 再买 6.25 @80
    assert pf.units == pytest.approx(11.25)
    assert pf.avg_price == pytest.approx(1000 / 11.25)
    assert pf.cash == pytest.approx(0.0)
    pf.rebalance(0.0, 120, 3)
    assert len(pf.trades) == 1
    t = pf.trades[0]
    assert t.qty == pytest.approx(11.25)
    assert t.entry_price == pytest.approx(1000 / 11.25)
    assert t.exit_price == pytest.approx(120)
    assert t.pnl == pytest.approx(350)
    assert pf.cash == pytest.approx(1350)


def test_flip_long_to_short_creates_two_trades():
    pf = Portfolio(1000, fee_rate=0.0)
    pf.rebalance(1, 100, 1)
    pf.rebalance(-1, 110, 2)
    assert len(pf.trades) == 1 and pf.trades[0].pnl == pytest.approx(100)
    assert pf.units < 0 and pf.open_trade["side"] == "short"
    pf.rebalance(0, 100, 3)
    assert len(pf.trades) == 2 and pf.trades[1].pnl == pytest.approx(100)  # 权益 1100 -> 空 10 个单位
    assert pf.equity(100) == pytest.approx(1200)


def test_metrics_basic():
    df = make_df(np.linspace(100, 200, 200))
    sim = simulate(df, np.ones(200), cfg())
    m = compute_metrics(sim, 3_600_000, 1000, df["close"].to_numpy(), df["open"][0])
    assert m["total_return"] > 0.9
    assert m["max_drawdown"] == 0
    assert m["sharpe"] > 0
    assert m["trades"] == 1 and m["win_rate"] == 1
