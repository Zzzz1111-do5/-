import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CostFields, MarketFields, StrategyFields } from "../components/forms";
import { Card, Empty, ErrorBox, Field, Spinner, Stat, Toggle } from "../components/ui";
import { loadLocal, saveLocal, useApp } from "../context";
import { INTERVAL_LABEL, fmtAgo, fmtNum, fmtPct, fmtPrice, fmtQty, tone } from "../format";
import { usePolling } from "../hooks";
import type { Bot, RunSettings } from "../types";
import { defaultSettings, sanitize, type NavState } from "./BacktestPage";

export function StatusBadge({ bot }: { bot: Bot }) {
  if (bot.status === "running")
    return (
      <span className={`status ${bot.last_error ? "status-warn" : "status-on"}`}>
        <i />
        {bot.last_error ? "运行异常" : "运行中"}
      </span>
    );
  return (
    <span className="status status-off">
      <i />
      已停止
    </span>
  );
}

export function positionText(bot: Bot) {
  if (!bot.units) return "空仓";
  return `${bot.units > 0 ? "多" : "空"} ${fmtQty(Math.abs(bot.units))}`;
}

export default function BotsPage() {
  const { meta, source } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = (location.state ?? {}) as NavState;
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<RunSettings | null>(null);
  const [name, setName] = useState("");
  const [startNow, setStartNow] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = async () => {
    try {
      const r = await api.bots();
      setBots(r.bots);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  usePolling(refresh, [], 5000);

  useEffect(() => {
    if (!meta || !source) return;
    if (nav.create || !form) {
      let s = loadLocal<RunSettings>("cq.botform", { ...defaultSettings(source), interval: "15m" });
      if (nav.symbol) s = { ...s, symbol: nav.symbol };
      if (nav.settings) s = { ...s, ...nav.settings };
      setForm(sanitize(s, meta));
      if (nav.create) {
        setShowCreate(true);
        navigate(location.pathname, { replace: true, state: null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, source, nav.create]);

  const update = (p: Partial<RunSettings>) =>
    setForm((old) => {
      const next = { ...(old as RunSettings), ...p };
      saveLocal("cq.botform", next);
      return next;
    });

  const create = async () => {
    if (!form) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { start: _s, end: _e, ...rest } = form;
      void _s;
      void _e;
      const bot = await api.createBot({ ...rest, name: name || undefined, start: startNow });
      setShowCreate(false);
      setName("");
      navigate(`/bots/${bot.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const act = async (bot: Bot, action: "start" | "stop" | "delete") => {
    if (action === "delete" && !window.confirm(`确定删除机器人「${bot.name}」及其全部交易记录？`)) return;
    setBusy(bot.id);
    try {
      if (action === "start") await api.startBot(bot.id);
      else if (action === "stop") await api.stopBot(bot.id);
      else await api.deleteBot(bot.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const strategy = meta?.strategies.find((s) => s.id === form?.strategy);
  const running = bots?.filter((b) => b.status === "running").length ?? 0;
  const totalEquity = bots?.reduce((a, b) => a + b.equity, 0) ?? 0;
  const totalPnl = bots?.reduce((a, b) => a + b.pnl, 0) ?? 0;
  const totalCapital = bots?.reduce((a, b) => a + b.initial_capital, 0) ?? 0;

  return (
    <div className="page stack">
      <Card
        title="模拟交易"
        extra={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "收起" : "+ 新建机器人"}
          </button>
        }
      >
        <div className="stat-grid">
          <Stat label="机器人" value={bots?.length ?? "—"} sub={`运行中 ${running}`} />
          <Stat label="总权益 (USDT)" value={fmtNum(totalEquity)} sub={`初始 ${fmtNum(totalCapital)}`} />
          <Stat label="总盈亏 (USDT)" value={fmtNum(totalPnl)} toneValue={totalPnl} sub={totalCapital ? fmtPct(totalPnl / totalCapital) : undefined} />
        </div>
        <p className="muted small">
          模拟交易使用交易所实时行情驱动策略，以虚拟资金撮合成交，不会产生真实订单。机器人在后端持续运行，关闭网页不影响运行。
        </p>
      </Card>

      {showCreate && form && meta && (
        <Card title="新建模拟交易机器人">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field label="名称（可选）">
              <input className="input" value={name} maxLength={80} placeholder="默认：策略 · 交易对 · 周期" onChange={(e) => setName(e.target.value)} />
            </Field>
            <MarketFields value={form} onChange={update} dates={false} />
            <StrategyFields value={form} onChange={update} />
            <CostFields value={form} onChange={update} longOnly={strategy?.long_only} />
            <Toggle checked={startNow} onChange={setStartNow} label="创建后立即启动" />
            <ErrorBox error={createError} />
            <div className="row gap">
              <button className="btn btn-primary" type="submit" disabled={creating}>
                {creating ? "创建中…" : "创建机器人"}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setShowCreate(false)}>
                取消
              </button>
            </div>
          </form>
        </Card>
      )}

      <ErrorBox error={error} onRetry={refresh} />
      {bots === null && !error && <Spinner />}
      {bots && bots.length === 0 && (
        <Card>
          <Empty>
            还没有模拟交易机器人。
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              新建机器人
            </button>
          </Empty>
        </Card>
      )}
      <div className="bot-grid">
        {bots?.map((bot) => (
          <div className="bot-card card" key={bot.id}>
            <div className="bot-head">
              <Link to={`/bots/${bot.id}`} className="bot-name">
                {bot.name}
              </Link>
              <StatusBadge bot={bot} />
            </div>
            <div className="bot-meta muted small">
              {bot.symbol} · {INTERVAL_LABEL[bot.interval]} · {bot.strategy_name} · {meta?.sources.find((s) => s.id === bot.source)?.label ?? bot.source}
            </div>
            <div className="bot-numbers">
              <div>
                <div className="muted small">权益</div>
                <div className="big">{fmtNum(bot.equity)}</div>
              </div>
              <div>
                <div className="muted small">收益率</div>
                <div className={`big ${tone(bot.return_pct)}`}>{fmtPct(bot.return_pct)}</div>
              </div>
              <div>
                <div className="muted small">持仓</div>
                <div className={bot.units > 0 ? "up" : bot.units < 0 ? "down" : ""}>{positionText(bot)}</div>
                {bot.units !== 0 && <div className="muted small">均价 {fmtPrice(bot.avg_price)}</div>}
              </div>
            </div>
            <div className="muted small">
              最新价 {fmtPrice(bot.last_price)} · 交易 {bot.trade_count} 笔 · 更新于 {fmtAgo(bot.last_run_at)}
            </div>
            {bot.last_error && <div className="warn small ellipsis" title={bot.last_error}>⚠ {bot.last_error}</div>}
            <div className="row gap">
              {bot.status === "running" ? (
                <button className="btn btn-ghost btn-sm" disabled={busy === bot.id} onClick={() => act(bot, "stop")}>
                  停止
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" disabled={busy === bot.id} onClick={() => act(bot, "start")}>
                  启动
                </button>
              )}
              <Link className="btn btn-ghost btn-sm" to={`/bots/${bot.id}`}>
                详情
              </Link>
              <button className="btn btn-danger btn-sm" disabled={busy === bot.id} onClick={() => act(bot, "delete")}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
