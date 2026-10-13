import pytest

from app.engine import BacktestConfig
from app.optimizer import expand_values, optimize
from app.strategies import get_strategy


def test_expand_values():
    p = get_strategy("sma_cross").params[0]
    assert expand_values({"min": 5, "max": 20, "step": 5}, p) == [5, 10, 15, 20]
    assert expand_values([3, 3, 7], p) == [3, 7]
    k = get_strategy("bollinger").params[1]
    assert expand_values({"min": 1.5, "max": 2.0, "step": 0.25}, k) == [1.5, 1.75, 2.0]


def test_optimize_with_oos(synthetic_df):
    res = optimize(
        synthetic_df,
        get_strategy("sma_cross"),
        {"fast": {"min": 5, "max": 25, "step": 10}, "slow": {"min": 20, "max": 60, "step": 20}},
        {},
        BacktestConfig(),
        3_600_000,
        metric="sharpe",
        oos_ratio=0.3,
        top=50,
    )
    assert res["total_combos"] == 9
    assert res["skipped"] == 1  # fast=25, slow=20 不合法
    assert res["evaluated"] == 8
    sharpes = [r["in_sample"]["sharpe"] for r in res["results"]]
    assert sharpes == sorted(sharpes, reverse=True)
    assert all(r["out_sample"] is not None for r in res["results"])
    assert res["in_sample_bars"] + res["out_sample_bars"] == len(synthetic_df)


def test_optimize_limits(synthetic_df):
    with pytest.raises(ValueError, match="超过上限"):
        optimize(
            synthetic_df,
            get_strategy("sma_cross"),
            {"fast": {"min": 2, "max": 200, "step": 1}, "slow": {"min": 5, "max": 500, "step": 1}},
            {},
            BacktestConfig(),
            3_600_000,
        )
    with pytest.raises(ValueError, match="优化目标"):
        optimize(synthetic_df, get_strategy("rsi"), {"period": [10, 14]}, {}, BacktestConfig(), 3_600_000, metric="foo")
