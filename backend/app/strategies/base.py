"""策略框架：策略输出每根 K 线收盘后的目标仓位（-1 ~ 1，正为多，负为空）。"""

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd


@dataclass
class Param:
    name: str
    label: str
    type: str  # "int" | "float"
    default: float
    min: float
    max: float
    step: float
    help: str = ""

    def cast(self, value) -> float | int:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"参数 {self.label}({self.name}) 必须是数字") from None
        if self.type == "int":
            if v != int(v):
                raise ValueError(f"参数 {self.label}({self.name}) 必须是整数")
            v = int(v)
        if not (self.min <= v <= self.max):
            raise ValueError(f"参数 {self.label}({self.name}) 取值范围 {self.min} ~ {self.max}，当前 {v}")
        return v


@dataclass
class StrategyOutput:
    target: pd.Series
    overlays: dict[str, pd.Series] = field(default_factory=dict)  # 画在主图上的指标线
    oscillators: dict[str, pd.Series] = field(default_factory=dict)  # 副图指标
    levels: list[float] = field(default_factory=list)  # 副图参考线（如 RSI 30/70）


@dataclass
class Strategy:
    id: str
    name: str
    category: str
    description: str
    params: list[Param]
    fn: Callable[[pd.DataFrame, dict], StrategyOutput]
    long_only: bool = False
    validate: Callable[[dict], None] | None = None

    def resolve_params(self, raw: dict | None) -> dict:
        raw = raw or {}
        unknown = set(raw) - {p.name for p in self.params}
        if unknown:
            raise ValueError(f"策略 {self.name} 不支持参数: {', '.join(sorted(unknown))}")
        out = {p.name: p.cast(raw.get(p.name, p.default)) for p in self.params}
        if self.validate:
            self.validate(out)
        return out

    def run(self, df: pd.DataFrame, raw_params: dict | None = None) -> StrategyOutput:
        params = self.resolve_params(raw_params)
        out = self.fn(df, params)
        out.target = out.target.astype(float).fillna(0.0).clip(-1.0, 1.0)
        return out

    def warmup_bars(self, raw_params: dict | None = None) -> int:
        """模拟盘需要的历史 K 线数量（指标预热）。"""
        params = self.resolve_params(raw_params)
        longest = max([int(v) for p, v in zip(self.params, params.values()) if p.type == "int"] or [1])
        return int(min(1000, max(200, longest * 4 + 50)))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "long_only": self.long_only,
            "params": [p.__dict__.copy() for p in self.params],
        }
