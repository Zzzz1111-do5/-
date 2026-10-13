"""SQLite 持久化：K 线缓存与模拟交易机器人数据。"""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS klines (
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    ts INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (source, symbol, interval, ts)
);

CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    strategy TEXT NOT NULL,
    params TEXT NOT NULL,
    initial_capital REAL NOT NULL,
    fee_rate REAL NOT NULL,
    slippage REAL NOT NULL,
    allow_short INTEGER NOT NULL DEFAULT 0,
    stop_loss REAL,
    take_profit REAL,
    status TEXT NOT NULL DEFAULT 'stopped',
    state TEXT NOT NULL,
    last_price REAL,
    last_error TEXT,
    last_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    qty REAL NOT NULL,
    notional REAL NOT NULL,
    fee REAL NOT NULL,
    reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_orders_bot ON bot_orders(bot_id, ts);

CREATE TABLE IF NOT EXISTS bot_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    side TEXT NOT NULL,
    entry_time INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    exit_time INTEGER NOT NULL,
    exit_price REAL NOT NULL,
    qty REAL NOT NULL,
    pnl REAL NOT NULL,
    return_pct REAL NOT NULL,
    exit_reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_trades_bot ON bot_trades(bot_id, exit_time);

CREATE TABLE IF NOT EXISTS bot_equity (
    bot_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    equity REAL NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (bot_id, ts)
);

CREATE TABLE IF NOT EXISTS bot_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_logs_bot ON bot_logs(bot_id, ts);
"""


class Database:
    """线程安全的轻量 SQLite 封装（单连接 + 锁）。"""

    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def query(self, sql: str, args: tuple | list = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, args).fetchall()]

    def query_one(self, sql: str, args: tuple | list = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, args).fetchone()
            return dict(row) if row else None

    def execute(self, sql: str, args: tuple | list = ()) -> int:
        with self.tx() as conn:
            cur = conn.execute(sql, args)
            return cur.lastrowid or 0

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        if not rows:
            return
        with self.tx() as conn:
            conn.executemany(sql, rows)

    def close(self) -> None:
        with self._lock:
            self._conn.close()


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database(config.DB_PATH)
    return _db


def set_db(db: Database) -> None:
    """测试时注入内存数据库。"""
    global _db
    _db = db
