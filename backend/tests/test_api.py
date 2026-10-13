import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app import paper
from app.db import get_db
from app.main import app, parse_time

BASE = {"source": "synthetic", "symbol": "BTC/USDT", "interval": "1h", "start": "2025-01-01", "end": "2025-06-30"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_parse_time():
    assert parse_time("2025-01-01") == 1735689600000
    assert parse_time("2025-01-01", end_of_day=True) == 1735689600000 + 86_400_000 - 1
    assert parse_time("1735689600000") == 1735689600000
    with pytest.raises(ValueError):
        parse_time("yesterday")


def test_health_identifies_app(client):
    # run.py 依赖 app 字段判断端口上是否已运行 CoinQuant
    assert client.get("/api/health").json()["app"] == "coinquant"


def test_meta_and_market(client):
    meta = client.get("/api/meta").json()
    assert {s["id"] for s in meta["sources"]} >= {"binance", "okx", "synthetic"}
    assert any(s["id"] == "sma_cross" for s in meta["strategies"])
    k = client.get("/api/klines", params={"source": "synthetic", "symbol": "ETH/USDT", "interval": "15m", "limit": 100}).json()
    assert len(k["candles"]) == 100
    t = client.get("/api/tickers", params={"source": "synthetic", "symbols": "BTC/USDT,ETH/USDT"}).json()
    assert [x["symbol"] for x in t["tickers"]] == ["BTC/USDT", "ETH/USDT"]


def test_backtest_endpoint(client):
    r = client.post("/api/backtest", json={**BASE, "strategy": "sma_cross", "params": {"fast": 10, "slow": 40}, "stop_loss": 0.05})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["strategy_name"] == "双均线交叉"
    assert body["metrics"]["trades"] > 0
    assert len(body["candles"]) == len(body["equity"])


@pytest.mark.parametrize(
    "patch,status,fragment",
    [
        ({"strategy": "nope"}, 400, "未知的策略"),
        ({"strategy": "sma_cross", "params": {"fast": 50, "slow": 10}}, 400, "快线"),
        ({"strategy": "sma_cross", "interval": "2h"}, 400, "不支持的周期"),
        ({"strategy": "sma_cross", "start": "2025-06-29"}, 400, "至少需要 50 根"),
        ({"strategy": "sma_cross", "interval": "1m", "start": "2020-01-01"}, 400, "超过上限"),
        ({"strategy": "sma_cross", "fee_rate": 0.5}, 422, "fee_rate"),
        ({"strategy": "sma_cross", "symbol": "???"}, 400, "交易对"),
    ],
)
def test_backtest_errors(client, patch, status, fragment):
    r = client.post("/api/backtest", json={**BASE, **patch})
    assert r.status_code == status
    assert fragment in r.json()["detail"]


def test_optimize_endpoint(client):
    r = client.post(
        "/api/optimize",
        json={**BASE, "strategy": "rsi", "grid": {"period": {"min": 7, "max": 21, "step": 7}, "oversold": [20, 30]}, "oos_ratio": 0.25, "top": 3},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_combos"] == 6
    assert len(body["results"]) == 3
    assert body["results"][0]["out_sample"] is not None


def test_bot_lifecycle_manual_step(client):
    r = client.post(
        "/api/bots",
        json={"source": "synthetic", "symbol": "SOL/USDT", "interval": "1m", "strategy": "buy_hold", "initial_capital": 5000, "start": False},
    )
    assert r.status_code == 200, r.text
    bot = r.json()
    assert bot["status"] == "stopped" and bot["equity"] == 5000
    bot_id = bot["id"]

    get_db().execute("UPDATE bots SET status='running' WHERE id=?", (bot_id,))
    asyncio.run(paper.step_bot(bot_id))
    detail = client.get(f"/api/bots/{bot_id}").json()
    assert detail["bot"]["units"] > 0
    assert detail["bot"]["last_bar_ts"] is not None
    assert len(detail["orders"]) == 1 and detail["orders"][0]["side"] == "buy"
    assert detail["equity"]

    # 再执行一次：没有新 K 线收盘则不会重复下单
    asyncio.run(paper.step_bot(bot_id))
    assert len(client.get(f"/api/bots/{bot_id}").json()["orders"]) == 1

    r = client.post(f"/api/bots/{bot_id}/stop", params={"close_position": True})
    assert r.json()["status"] == "stopped" and r.json()["units"] == 0
    detail = client.get(f"/api/bots/{bot_id}").json()
    assert len(detail["trades"]) == 1 and detail["trades"][0]["exit_reason"] == "manual"
    assert any("手动平仓" in log["message"] for log in detail["logs"])

    assert client.delete(f"/api/bots/{bot_id}").json() == {"ok": True}
    assert client.get(f"/api/bots/{bot_id}").status_code == 404


def test_bot_background_loop(client):
    r = client.post("/api/bots", json={"source": "synthetic", "symbol": "BTC/USDT", "interval": "5m", "strategy": "buy_hold"})
    bot_id = r.json()["id"]
    assert r.json()["status"] == "running"
    deadline = time.time() + 5
    while time.time() < deadline:
        bot = client.get(f"/api/bots/{bot_id}").json()["bot"]
        if bot["last_run_at"]:
            break
        time.sleep(0.05)
    assert bot["last_run_at"] and bot["units"] > 0
    assert client.post(f"/api/bots/{bot_id}/stop").json()["status"] == "stopped"
    assert bot_id not in paper.manager.tasks


def test_bot_validation(client):
    r = client.post("/api/bots", json={"source": "nope", "symbol": "BTC/USDT", "interval": "1h", "strategy": "rsi"})
    assert r.status_code == 400 and "数据源" in r.json()["detail"]
    assert client.post("/api/bots/999/start").status_code == 404
