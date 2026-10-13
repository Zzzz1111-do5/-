import os
import sys
from pathlib import Path

os.environ.setdefault("RESUME_BOTS", "0")
os.environ.setdefault("BOT_POLL_SECONDS", "0.05")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

from app.db import Database, set_db  # noqa: E402


@pytest.fixture(autouse=True)
def memory_db():
    db = Database(":memory:")
    set_db(db)
    yield db
    db.close()


def make_df(closes, opens=None, highs=None, lows=None, step=3_600_000):
    closes = np.asarray(closes, dtype=float)
    opens = np.asarray(opens if opens is not None else np.concatenate([[closes[0]], closes[:-1]]), dtype=float)
    highs = np.asarray(highs if highs is not None else np.maximum(opens, closes), dtype=float)
    lows = np.asarray(lows if lows is not None else np.minimum(opens, closes), dtype=float)
    ts = np.arange(len(closes), dtype=np.int64) * step + 1_700_000_000_000 // step * step
    return pd.DataFrame({"ts": ts, "open": opens, "high": highs, "low": lows, "close": closes, "volume": 1.0})


@pytest.fixture
def synthetic_df():
    from app.data import to_frame
    from app.data.synthetic import SyntheticSource

    end = 1_780_000_000_000
    bars = SyntheticSource().generate("BTC/USDT", "1h", end - 3_000 * 3_600_000, end, now_ms=end)
    return to_frame(bars)
