import numpy as np
import pytest

from app.engine import BacktestConfig, run_backtest
from app.strategies import STRATEGIES, get_strategy


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda s: s.id)
def test_strategy_runs_and_targets_in_range(strategy, synthetic_df):
    out = strategy.run(synthetic_df, {})
    t = out.target.to_numpy()
    assert len(t) == len(synthetic_df)
    assert np.isfinite(t).all()
    assert t.min() >= -1 and t.max() <= 1
    if strategy.long_only:
        assert t.min() >= 0


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda s: s.id)
def test_strategy_has_no_lookahead(strategy, synthetic_df):
    """用截断数据计算出的信号必须与完整数据中同一位置的信号一致。"""
    full = strategy.run(synthetic_df, {}).target.to_numpy()
    for cut in (400, 1234, 2500):
        part = strategy.run(synthetic_df.iloc[:cut].copy(), {}).target.to_numpy()
        np.testing.assert_allclose(part, full[:cut], err_msg=f"{strategy.id} 在第 {cut} 根处使用了未来数据")


def test_param_validation():
    s = get_strategy("sma_cross")
    with pytest.raises(ValueError, match="快线"):
        s.resolve_params({"fast": 50, "slow": 20})
    with pytest.raises(ValueError, match="取值范围"):
        s.resolve_params({"fast": 0})
    with pytest.raises(ValueError, match="整数"):
        s.resolve_params({"fast": 2.5})
    with pytest.raises(ValueError, match="不支持参数"):
        s.resolve_params({"foo": 1})
    assert s.resolve_params({"fast": 5.0}) == {"fast": 5, "slow": 30}
    with pytest.raises(ValueError):
        get_strategy("nope")


def test_run_backtest_payload(synthetic_df):
    res = run_backtest(synthetic_df, get_strategy("bollinger"), {"period": 30}, BacktestConfig(allow_short=True), 3_600_000)
    assert res["params"] == {"period": 30, "k": 2.0}
    assert len(res["candles"]) == len(synthetic_df)
    assert len(res["equity"]) == len(synthetic_df)
    assert set(res["overlays"]) == {"布林上轨", "布林中轨", "布林下轨"}
    assert res["metrics"]["trades"] == len(res["trades"])
    assert any(t["side"] == "short" for t in res["trades"])
    # 最终权益 = 初始资金 + 所有已平仓交易盈亏（期末已强制平仓）
    total_pnl = sum(t["pnl"] for t in res["trades"])
    assert res["metrics"]["final_equity"] == pytest.approx(10_000 + total_pnl, rel=1e-9)


def test_grid_is_long_only_even_if_short_allowed(synthetic_df):
    res = run_backtest(synthetic_df, get_strategy("grid"), {}, BacktestConfig(allow_short=True), 3_600_000)
    assert all(t["side"] == "long" for t in res["trades"])
