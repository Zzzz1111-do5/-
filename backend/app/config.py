"""全局配置，均可通过环境变量覆盖。"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("QUANT_DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.getenv("QUANT_DB_PATH", DATA_DIR / "quant.db"))
FRONTEND_DIST = Path(os.getenv("QUANT_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))

# data-api.binance.vision 是币安官方的公开行情镜像，可在更多地区访问
BINANCE_BASE_URL = os.getenv("BINANCE_BASE_URL", "https://data-api.binance.vision")
OKX_BASE_URL = os.getenv("OKX_BASE_URL", "https://www.okx.com")
DEFAULT_SOURCE = os.getenv("DEFAULT_SOURCE", "binance")
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "15"))

# 单次回测/优化允许的最大 K 线数量
MAX_BARS = int(os.getenv("MAX_BARS", "30000"))
# 参数优化允许的最大参数组合数
MAX_OPT_COMBOS = int(os.getenv("MAX_OPT_COMBOS", "500"))
# 模拟交易机器人轮询间隔（秒）
BOT_POLL_SECONDS = float(os.getenv("BOT_POLL_SECONDS", "10"))
# 是否在启动时恢复运行中的机器人（测试时关闭）
RESUME_BOTS = os.getenv("RESUME_BOTS", "1") == "1"

INTERVALS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

DEFAULT_SYMBOLS = [
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "BNB/USDT",
    "XRP/USDT",
    "DOGE/USDT",
    "ADA/USDT",
    "AVAX/USDT",
]
