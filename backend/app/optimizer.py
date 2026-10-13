"""参数网格搜索优化，支持样本外（OOS）验证以识别过拟合。"""

import itertools
from dataclasses import asdict

import numpy as np
import pandas as pd

from . import config
from .engine import BacktestConfig, compute_metrics, simulate

METRIC_KEYS = {
    "total_return": "总收益率",
    "annual_return": "年化收益",
    "sharpe": "夏普比率",
    "sortino": "索提诺比率",
    "calmar": "卡玛比率",
    "max_drawdown": "最大回撤",
    "win_rate": "胜率",
    "profit_factor": "盈亏比",
}

SUMMARY_KEYS = [
    "total_return",
    "annual_return",
    "max_drawdown",
    "sharpe",
    "sortino",
    "calmar",
    "win_rate",
    "profit_factor",
    "trades",
    "excess_return",
]


def expand_values(spec: dict | list, param) -> list:
    """{"min":5,"max":20,"step":5} 或 [5,10,15] -> 取值列表。"""
    if isinstance(spec, list):
        values = spec
    else:
        lo, hi, step = float(spec["min"]), float(spec["max"]), float(spec.get("step") or param.step)
        if step <= 0:
            raise ValueError(f"参数 {param.label} 的步长必须大于 0")
        if hi < lo:
            raise ValueError(f"参数 {param.label} 的最大值不能小于最小值")
        count = int(np.floor((hi - lo) / step + 1e-9)) + 1
        if count > 1000:
            raise ValueError(f"参数 {param.label} 的取值过多")
        values = [lo + i * step for i in range(count)]
    out = []
    for v in values:
        v = round(float(v), 10)
        out.append(int(round(v)) if param.type == "int" else v)
    return sorted(set(out))


def _summary(metrics: dict) -> dict:
    return {k: metrics.get(k) for k in SUMMARY_KEYS}


def optimize(
    df: pd.DataFrame,
    strategy,
    grid: dict[str, dict | list],
    fixed: dict | None,
    cfg: BacktestConfig,
    interval_ms: int,
    metric: str = "sharpe",
    oos_ratio: float = 0.0,
    top: int = 20,
) -> dict:
    if metric not in METRIC_KEYS:
        raise ValueError(f"不支持的优化目标: {metric}")
    if not 0 <= oos_ratio < 0.9:
        raise ValueError("样本外比例需在 0 ~ 0.9 之间")
    params_by_name = {p.name: p for p in strategy.params}
    unknown = set(grid) - set(params_by_name)
    if unknown:
        raise ValueError(f"策略不支持参数: {', '.join(sorted(unknown))}")
    if not grid:
        raise ValueError("请至少选择一个需要优化的参数")
    names = list(grid)
    value_lists = [expand_values(grid[n], params_by_name[n]) for n in names]
    total = int(np.prod([len(v) for v in value_lists]))
    if total > config.MAX_OPT_COMBOS:
        raise ValueError(f"参数组合数 {total} 超过上限 {config.MAX_OPT_COMBOS}，请增大步长或缩小范围")

    n = len(df)
    split = int(n * (1 - oos_ratio)) if oos_ratio > 0 else n
    if split < 50 or (oos_ratio > 0 and n - split < 20):
        raise ValueError("数据量不足以进行优化（样本内至少 50 根、样本外至少 20 根 K 线）")
    df_in = df.iloc[:split].reset_index(drop=True)
    allow_short = cfg.allow_short and not strategy.long_only
    cfg = BacktestConfig(**{**asdict(cfg), "allow_short": allow_short})
    close = df["close"].to_numpy(dtype=float)
    opens = df["open"].to_numpy(dtype=float)

    results = []
    skipped = 0
    for combo in itertools.product(*value_lists):
        raw = {**(fixed or {}), **dict(zip(names, combo))}
        try:
            params = strategy.resolve_params(raw)
        except ValueError:
            skipped += 1
            continue
        out = strategy.run(df, params)  # 指标只依赖历史数据，整段计算后再切分
        target = out.target.to_numpy()
        sim_in = simulate(df_in, target[:split], cfg)
        m_in = compute_metrics(sim_in, interval_ms, cfg.initial_capital, close[:split], opens[0])
        row = {"params": params, "in_sample": _summary(m_in), "out_sample": None}
        if split < n:
            sim_out = simulate(df, target, cfg, start=split)
            m_out = compute_metrics(sim_out, interval_ms, cfg.initial_capital, close[split:], opens[split])
            row["out_sample"] = _summary(m_out)
        results.append(row)

    def score(r: dict) -> float:
        v = r["in_sample"].get(metric)
        if v is None:
            return float("inf") if metric == "profit_factor" and r["in_sample"]["trades"] else float("-inf")
        return v

    results.sort(key=score, reverse=True)
    return {
        "metric": metric,
        "total_combos": total,
        "evaluated": len(results),
        "skipped": skipped,
        "split_ts": int(df["ts"].iloc[split]) if split < n else None,
        "in_sample_bars": split,
        "out_sample_bars": n - split,
        "results": results[: max(1, top)],
    }
