"""CoinQuant 量化交易平台 - API 服务。"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, paper
from .data import SOURCES, DataSourceError, get_klines, get_recent_klines, get_tickers, now_ms, to_frame
from .db import get_db
from .engine import BacktestConfig, run_backtest
from .optimizer import METRIC_KEYS, optimize
from .strategies import STRATEGIES, get_strategy

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_db()
    if config.RESUME_BOTS:
        await paper.manager.resume_all()
    yield
    await paper.manager.shutdown()


app = FastAPI(title="CoinQuant 量化交易平台", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(DataSourceError)
async def _source_error(_: Request, exc: DataSourceError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    parts = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
        parts.append(f"{loc}: {err.get('msg')}")
    return JSONResponse(status_code=422, content={"detail": "参数校验失败 - " + "; ".join(parts)})


# ------------------------------------------------------------------ 模型


class RunConfig(BaseModel):
    source: str = config.DEFAULT_SOURCE
    symbol: str = "BTC/USDT"
    interval: str = "1h"
    start: str | int
    end: str | int | None = None
    strategy: str
    params: dict[str, float] = Field(default_factory=dict)
    initial_capital: float = Field(10_000, gt=0, le=1e12)
    fee_rate: float = Field(0.001, ge=0, le=0.05)
    slippage: float = Field(0.0005, ge=0, le=0.05)
    allow_short: bool = False
    stop_loss: float | None = Field(None, gt=0, lt=1)
    take_profit: float | None = Field(None, gt=0, le=100)

    def engine_config(self) -> BacktestConfig:
        return BacktestConfig(
            initial_capital=self.initial_capital,
            fee_rate=self.fee_rate,
            slippage=self.slippage,
            allow_short=self.allow_short,
            stop_loss=self.stop_loss,
            take_profit=self.take_profit,
        )


class OptimizeRequest(RunConfig):
    grid: dict[str, dict[str, float] | list[float]]
    metric: str = "sharpe"
    oos_ratio: float = Field(0.0, ge=0, lt=0.9)
    top: int = Field(20, ge=1, le=200)


class BotCreate(BaseModel):
    name: str | None = Field(None, max_length=80)
    source: str = config.DEFAULT_SOURCE
    symbol: str = "BTC/USDT"
    interval: str = "1h"
    strategy: str
    params: dict[str, float] = Field(default_factory=dict)
    initial_capital: float = Field(10_000, gt=0, le=1e12)
    fee_rate: float = Field(0.001, ge=0, le=0.05)
    slippage: float = Field(0.0005, ge=0, le=0.05)
    allow_short: bool = False
    stop_loss: float | None = Field(None, gt=0, lt=1)
    take_profit: float | None = Field(None, gt=0, le=100)
    start: bool = True


def parse_time(value: str | int, end_of_day: bool = False) -> int:
    """支持毫秒时间戳、YYYY-MM-DD、ISO 8601。日期按 UTC 解析。"""
    if isinstance(value, int):
        return value
    v = value.strip()
    if v.isdigit():
        return int(v)
    try:
        if len(v) == 10:
            dt = datetime.strptime(v, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            ms = int(dt.timestamp() * 1000)
            return ms + 86_400_000 - 1 if end_of_day else ms
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        raise ValueError(f"无法解析时间: {value}，请使用 YYYY-MM-DD 格式") from None


async def load_frame(req: RunConfig):
    start = parse_time(req.start)
    end = parse_time(req.end, end_of_day=True) if req.end not in (None, "") else now_ms()
    bars = await get_klines(req.source, req.symbol, req.interval, start, end)
    if len(bars) < 50:
        raise ValueError(f"该区间仅有 {len(bars)} 根 K 线（至少需要 50 根），请调整时间范围或周期")
    return to_frame(bars), config.INTERVALS[req.interval]


# ------------------------------------------------------------------ 行情 & 元数据


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "coinquant", "time": now_ms()}


@app.get("/api/meta")
async def meta():
    return {
        "sources": [{"id": s.name, "label": s.label} for s in SOURCES.values()],
        "default_source": config.DEFAULT_SOURCE,
        "intervals": list(config.INTERVALS),
        "symbols": config.DEFAULT_SYMBOLS,
        "strategies": [s.to_dict() for s in STRATEGIES],
        "metrics": METRIC_KEYS,
        "limits": {"max_bars": config.MAX_BARS, "max_combos": config.MAX_OPT_COMBOS},
    }


@app.get("/api/klines")
async def klines(
    symbol: str,
    source: str = config.DEFAULT_SOURCE,
    interval: str = "1h",
    limit: int = Query(500, ge=1, le=5000),
    start: str | None = None,
    end: str | None = None,
):
    if start:
        e = parse_time(end, end_of_day=True) if end else now_ms()
        bars = await get_klines(source, symbol, interval, parse_time(start), e)
    else:
        bars = await get_recent_klines(source, symbol, interval, limit)
    return {"symbol": symbol, "interval": interval, "source": source, "candles": [list(b) for b in bars]}


@app.get("/api/tickers")
async def tickers(symbols: str = ",".join(config.DEFAULT_SYMBOLS), source: str = config.DEFAULT_SOURCE):
    items = [s for s in symbols.split(",") if s.strip()][:50]
    return {"source": source, "tickers": [t.to_dict() for t in await get_tickers(source, items)]}


# ------------------------------------------------------------------ 回测 & 优化


@app.post("/api/backtest")
async def backtest(req: RunConfig):
    strategy = get_strategy(req.strategy)
    strategy.resolve_params(req.params)
    df, interval_ms = await load_frame(req)
    result = await run_in_threadpool(run_backtest, df, strategy, req.params, req.engine_config(), interval_ms)
    result.update(
        {
            "symbol": req.symbol.upper(),
            "interval": req.interval,
            "source": req.source,
            "strategy": strategy.id,
            "strategy_name": strategy.name,
            "allow_short": req.allow_short and not strategy.long_only,
        }
    )
    return JSONResponse(result)


@app.post("/api/optimize")
async def optimize_endpoint(req: OptimizeRequest):
    strategy = get_strategy(req.strategy)
    df, interval_ms = await load_frame(req)
    fixed = {k: v for k, v in req.params.items() if k not in req.grid}
    result = await run_in_threadpool(
        optimize,
        df,
        strategy,
        req.grid,
        fixed,
        req.engine_config(),
        interval_ms,
        req.metric,
        req.oos_ratio,
        req.top,
    )
    result.update({"strategy": strategy.id, "strategy_name": strategy.name, "bars": len(df)})
    return JSONResponse(result)


# ------------------------------------------------------------------ 模拟交易机器人


def _bot_or_404(bot_id: int) -> dict:
    bot = paper.get_bot(bot_id)
    if not bot:
        raise HTTPException(404, "机器人不存在")
    return bot


@app.get("/api/bots")
async def list_bots():
    return {"bots": paper.list_bots()}


@app.post("/api/bots")
async def create_bot(req: BotCreate):
    data: dict[str, Any] = req.model_dump()
    start = data.pop("start")
    bot = paper.create_bot(data)
    if start:
        bot = await paper.manager.start(bot["id"])
    return bot


@app.get("/api/bots/{bot_id}")
async def bot_detail(bot_id: int):
    bot = _bot_or_404(bot_id)
    return {
        "bot": bot,
        "orders": paper.bot_orders(bot_id),
        "trades": paper.bot_trades(bot_id),
        "equity": paper.bot_equity(bot_id),
        "logs": paper.bot_logs(bot_id),
    }


@app.post("/api/bots/{bot_id}/start")
async def start_bot(bot_id: int):
    _bot_or_404(bot_id)
    return await paper.manager.start(bot_id)


@app.post("/api/bots/{bot_id}/stop")
async def stop_bot(bot_id: int, close_position: bool = False):
    _bot_or_404(bot_id)
    return await paper.manager.stop(bot_id, close_position)


@app.delete("/api/bots/{bot_id}")
async def delete_bot(bot_id: int):
    _bot_or_404(bot_id)
    await paper.manager.delete(bot_id)
    return {"ok": True}


# ------------------------------------------------------------------ 前端静态文件（生产环境）


class SPAStaticFiles(StaticFiles):
    """找不到的路径回退到 index.html，支持前端路由。"""

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code != 404 or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)
        if response.status_code == 404 and not path.startswith("api"):
            return await super().get_response("index.html", scope)
        return response


if config.FRONTEND_DIST.is_dir():
    app.mount("/", SPAStaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
