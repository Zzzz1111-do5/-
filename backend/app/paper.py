"""模拟交易（Paper Trading）：使用实时行情驱动策略，虚拟资金撮合成交。"""

import asyncio
import json
import logging

from . import config
from .data import get_recent_klines, get_source, normalize_symbol, now_ms, to_frame
from .db import get_db
from .engine import Portfolio, SignalGate, clamp_target, stop_trigger
from .strategies import get_strategy

log = logging.getLogger("quant.paper")

REASONS = {"signal": "策略信号", "stop_loss": "止损", "take_profit": "止盈", "liquidation": "爆仓强平", "manual": "手动平仓"}


def _initial_state(capital: float) -> dict:
    return {
        "portfolio": Portfolio(capital).to_state(),
        "current_target": 0.0,
        "blocked_signal": None,
        "last_bar_ts": None,
        "last_signal": None,
    }


def add_log(bot_id: int, message: str, level: str = "info") -> None:
    db = get_db()
    db.execute("INSERT INTO bot_logs (bot_id, ts, level, message) VALUES (?, ?, ?, ?)", (bot_id, now_ms(), level, message))
    db.execute(
        "DELETE FROM bot_logs WHERE bot_id=? AND id NOT IN (SELECT id FROM bot_logs WHERE bot_id=? ORDER BY id DESC LIMIT 300)",
        (bot_id, bot_id),
    )


def create_bot(data: dict) -> dict:
    strategy = get_strategy(data["strategy"])
    params = strategy.resolve_params(data.get("params"))
    get_source(data["source"])
    interval = data["interval"]
    if interval not in config.INTERVALS:
        raise ValueError(f"不支持的周期: {interval}")
    symbol = normalize_symbol(data["symbol"])
    capital = float(data["initial_capital"])
    allow_short = bool(data.get("allow_short")) and not strategy.long_only
    now = now_ms()
    name = (data.get("name") or "").strip() or f"{strategy.name} · {symbol} · {interval}"
    db = get_db()
    bot_id = db.execute(
        "INSERT INTO bots (name, source, symbol, interval, strategy, params, initial_capital, fee_rate, slippage,"
        " allow_short, stop_loss, take_profit, status, state, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?, ?)",
        (
            name,
            data["source"],
            symbol,
            interval,
            strategy.id,
            json.dumps(params),
            capital,
            float(data.get("fee_rate", 0.001)),
            float(data.get("slippage", 0.0005)),
            int(allow_short),
            data.get("stop_loss") or None,
            data.get("take_profit") or None,
            json.dumps(_initial_state(capital)),
            now,
            now,
        ),
    )
    db.execute("INSERT OR REPLACE INTO bot_equity (bot_id, ts, equity, price) VALUES (?, ?, ?, 0)", (bot_id, now // 60_000 * 60_000, capital))
    add_log(bot_id, f"机器人已创建：{strategy.name} {json.dumps(params, ensure_ascii=False)}，初始资金 {capital:g} USDT")
    return get_bot(bot_id)


def _bot_row(bot_id: int) -> dict | None:
    return get_db().query_one("SELECT * FROM bots WHERE id=?", (bot_id,))


def _serialize(row: dict) -> dict:
    state = json.loads(row["state"])
    pf = state["portfolio"]
    price = row["last_price"] or 0.0
    units = pf["units"]
    equity = pf["cash"] + units * price if price else pf["cash"] + units * pf["avg_price"]
    strategy = get_strategy(row["strategy"])
    trades = get_db().query_one("SELECT COUNT(*) AS n, SUM(pnl > 0) AS wins FROM bot_trades WHERE bot_id=?", (row["id"],))
    return {
        "id": row["id"],
        "name": row["name"],
        "source": row["source"],
        "symbol": row["symbol"],
        "interval": row["interval"],
        "strategy": row["strategy"],
        "strategy_name": strategy.name,
        "params": json.loads(row["params"]),
        "initial_capital": row["initial_capital"],
        "fee_rate": row["fee_rate"],
        "slippage": row["slippage"],
        "allow_short": bool(row["allow_short"]),
        "stop_loss": row["stop_loss"],
        "take_profit": row["take_profit"],
        "status": row["status"],
        "last_price": row["last_price"],
        "last_error": row["last_error"],
        "last_run_at": row["last_run_at"],
        "created_at": row["created_at"],
        "cash": pf["cash"],
        "units": units,
        "avg_price": pf["avg_price"],
        "equity": equity,
        "pnl": equity - row["initial_capital"],
        "return_pct": equity / row["initial_capital"] - 1,
        "unrealized_pnl": units * (price - pf["avg_price"]) if price and units else 0.0,
        "exposure": units * price / equity if equity > 0 and price else 0.0,
        "fees_paid": pf["fees_paid"],
        "trade_count": trades["n"] if trades else 0,
        "win_count": int(trades["wins"] or 0) if trades else 0,
        "last_signal": state.get("last_signal"),
        "last_bar_ts": state.get("last_bar_ts"),
    }


def get_bot(bot_id: int) -> dict | None:
    row = _bot_row(bot_id)
    return _serialize(row) if row else None


def list_bots() -> list[dict]:
    return [_serialize(r) for r in get_db().query("SELECT * FROM bots ORDER BY id DESC")]


def _persist_fills(bot_id: int, pf: Portfolio) -> None:
    db = get_db()
    db.executemany(
        "INSERT INTO bot_orders (bot_id, ts, side, price, qty, notional, fee, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(bot_id, o.ts, o.side, o.price, o.qty, o.notional, o.fee, o.reason) for o in pf.orders],
    )
    db.executemany(
        "INSERT INTO bot_trades (bot_id, side, entry_time, entry_price, exit_time, exit_price, qty, pnl, return_pct, exit_reason)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (bot_id, t.side, t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.qty, t.pnl, t.return_pct, t.exit_reason)
            for t in pf.trades
        ],
    )
    for o in pf.orders:
        add_log(
            bot_id,
            f"{'买入' if o.side == 'buy' else '卖出'} {o.qty:.6g} @ {o.price:.6g}（{REASONS.get(o.reason, o.reason)}，"
            f"成交额 {o.notional:.2f}，手续费 {o.fee:.4f}）",
            "trade",
        )
    pf.orders.clear()
    pf.trades.clear()


def _save_state(bot_id: int, state: dict, pf: Portfolio, gate: SignalGate, **fields) -> None:
    state["portfolio"] = pf.to_state()
    state["current_target"] = gate.current_target
    state["blocked_signal"] = gate.blocked_signal
    sets = ["state=?", "updated_at=?"] + [f"{k}=?" for k in fields]
    get_db().execute(
        f"UPDATE bots SET {', '.join(sets)} WHERE id=?",
        (json.dumps(state), now_ms(), *fields.values(), bot_id),
    )


async def step_bot(bot_id: int) -> None:
    """执行一次：拉取行情 → 检查止损止盈 → 新 K 线收盘时计算信号并调仓 → 记录权益。"""
    row = _bot_row(bot_id)
    if not row or row["status"] != "running":
        return
    strategy = get_strategy(row["strategy"])
    params = json.loads(row["params"])
    step_ms = config.INTERVALS[row["interval"]]
    bars = await get_recent_klines(row["source"], row["symbol"], row["interval"], strategy.warmup_bars(params))
    if len(bars) < 2:
        raise RuntimeError("行情数据不足")
    # 拉取期间机器人可能已被停止/删除
    row = _bot_row(bot_id)
    if not row or row["status"] != "running":
        return

    now = now_ms()
    price = bars[-1][4]
    closed = [b for b in bars if b[0] + step_ms <= now]
    state = json.loads(row["state"])
    pf = Portfolio.from_state(state["portfolio"], row["fee_rate"], row["slippage"])
    gate = SignalGate(state.get("current_target", 0.0), state.get("blocked_signal"))

    if pf.units != 0 and (row["stop_loss"] or row["take_profit"]):
        hit = stop_trigger(pf.units, pf.avg_price, row["stop_loss"], row["take_profit"], price, price, price)
        if hit:
            pf.rebalance(0.0, hit[0], now, hit[1])
            gate.on_stop(state.get("last_signal") or 0.0)

    if closed and (state.get("last_bar_ts") is None or closed[-1][0] > state["last_bar_ts"]):
        out = strategy.run(to_frame(closed), params)
        signal = float(clamp_target(out.target.to_numpy()[-1:], bool(row["allow_short"]))[0])
        desired = gate.desired(signal)
        if abs(desired - gate.current_target) > 1e-9:
            pf.rebalance(desired, price, now, "signal")
            gate.current_target = desired
        if state.get("last_signal") is None or abs(signal - state["last_signal"]) > 1e-9:
            add_log(bot_id, f"K 线收盘 {closed[-1][4]:.6g}，策略目标仓位 {signal:+.0%}")
        state["last_bar_ts"] = closed[-1][0]
        state["last_signal"] = signal

    equity = pf.equity(price)
    status = row["status"]
    error = None
    if equity <= 0:
        if pf.units:
            pf.rebalance(0.0, price, now, "liquidation", slip=False)
        status, error = "stopped", "账户权益归零，机器人已停止"
        equity = pf.equity(price)
    _persist_fills(bot_id, pf)
    get_db().execute(
        "INSERT OR REPLACE INTO bot_equity (bot_id, ts, equity, price) VALUES (?, ?, ?, ?)",
        (bot_id, now // 60_000 * 60_000, equity, price),
    )
    _save_state(bot_id, state, pf, gate, last_price=price, last_run_at=now, last_error=error, status=status)


class BotManager:
    """管理所有运行中机器人的后台协程。"""

    def __init__(self):
        self.tasks: dict[int, asyncio.Task] = {}

    async def _loop(self, bot_id: int) -> None:
        while True:
            try:
                await step_bot(bot_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # 网络等异常不终止机器人，记录后重试
                msg = f"{e.__class__.__name__}: {e}"
                log.warning("bot %s step failed: %s", bot_id, msg)
                row = _bot_row(bot_id)
                if row and row["last_error"] != msg:
                    add_log(bot_id, f"运行出错（将自动重试）：{msg}", "error")
                get_db().execute("UPDATE bots SET last_error=?, last_run_at=? WHERE id=?", (msg, now_ms(), bot_id))
            row = _bot_row(bot_id)
            if not row or row["status"] != "running":
                self.tasks.pop(bot_id, None)
                return
            await asyncio.sleep(config.BOT_POLL_SECONDS)

    def _spawn(self, bot_id: int) -> None:
        task = self.tasks.get(bot_id)
        if task and not task.done():
            return
        self.tasks[bot_id] = asyncio.create_task(self._loop(bot_id), name=f"bot-{bot_id}")

    async def start(self, bot_id: int) -> dict:
        row = _bot_row(bot_id)
        if not row:
            raise KeyError(bot_id)
        if row["status"] != "running":
            get_db().execute("UPDATE bots SET status='running', last_error=NULL, updated_at=? WHERE id=?", (now_ms(), bot_id))
            add_log(bot_id, "机器人已启动")
        self._spawn(bot_id)
        return get_bot(bot_id)

    async def stop(self, bot_id: int, close_position: bool = False) -> dict:
        row = _bot_row(bot_id)
        if not row:
            raise KeyError(bot_id)
        await self._cancel(bot_id)
        row = _bot_row(bot_id)
        if close_position:
            self._close_position(row)
        if row["status"] == "running":
            get_db().execute("UPDATE bots SET status='stopped', updated_at=? WHERE id=?", (now_ms(), bot_id))
            add_log(bot_id, "机器人已停止" + ("并平仓" if close_position else ""))
        return get_bot(bot_id)

    def _close_position(self, row: dict) -> None:
        state = json.loads(row["state"])
        pf = Portfolio.from_state(state["portfolio"], row["fee_rate"], row["slippage"])
        price = row["last_price"]
        if not pf.units or not price:
            return
        gate = SignalGate(state.get("current_target", 0.0), state.get("blocked_signal"))
        pf.rebalance(0.0, price, now_ms(), "manual")
        gate.on_stop(state.get("last_signal") or 0.0)
        _persist_fills(row["id"], pf)
        _save_state(row["id"], state, pf, gate)

    async def delete(self, bot_id: int) -> None:
        await self._cancel(bot_id)
        db = get_db()
        for table in ("bot_orders", "bot_trades", "bot_equity", "bot_logs"):
            db.execute(f"DELETE FROM {table} WHERE bot_id=?", (bot_id,))
        db.execute("DELETE FROM bots WHERE id=?", (bot_id,))

    async def _cancel(self, bot_id: int) -> None:
        task = self.tasks.pop(bot_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def resume_all(self) -> None:
        for row in get_db().query("SELECT id FROM bots WHERE status='running'"):
            self._spawn(row["id"])

    async def shutdown(self) -> None:
        for bot_id in list(self.tasks):
            await self._cancel(bot_id)


manager = BotManager()


def bot_orders(bot_id: int, limit: int = 500) -> list[dict]:
    return get_db().query("SELECT * FROM bot_orders WHERE bot_id=? ORDER BY ts DESC, id DESC LIMIT ?", (bot_id, limit))


def bot_trades(bot_id: int, limit: int = 500) -> list[dict]:
    return get_db().query("SELECT * FROM bot_trades WHERE bot_id=? ORDER BY exit_time DESC, id DESC LIMIT ?", (bot_id, limit))


def bot_equity(bot_id: int, limit: int = 5000) -> list[list]:
    rows = get_db().query(
        "SELECT ts, equity, price FROM (SELECT * FROM bot_equity WHERE bot_id=? ORDER BY ts DESC LIMIT ?) ORDER BY ts",
        (bot_id, limit),
    )
    return [[r["ts"], r["equity"], r["price"]] for r in rows]


def bot_logs(bot_id: int, limit: int = 200) -> list[dict]:
    return get_db().query("SELECT ts, level, message FROM bot_logs WHERE bot_id=? ORDER BY id DESC LIMIT ?", (bot_id, limit))


__all__ = ["manager", "create_bot", "get_bot", "list_bots", "step_bot", "bot_orders", "bot_trades", "bot_equity", "bot_logs"]
