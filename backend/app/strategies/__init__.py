from .base import Param, Strategy, StrategyOutput
from .builtin import STRATEGIES

REGISTRY: dict[str, Strategy] = {s.id: s for s in STRATEGIES}


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return REGISTRY[strategy_id]
    except KeyError:
        raise ValueError(f"未知的策略: {strategy_id}") from None


__all__ = ["Param", "Strategy", "StrategyOutput", "STRATEGIES", "REGISTRY", "get_strategy"]
