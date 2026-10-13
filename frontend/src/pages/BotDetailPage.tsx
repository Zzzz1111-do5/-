import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { PriceChart, SeriesChart, type TradeMarker } from "../components/charts";
import { Card, ErrorBox, OrdersTable, Segmented, Spinner, Stat, TradesTable } from "../components/ui";
import { useApp } from "../context";
import { INTERVAL_LABEL, REASON_LABEL, SERIES_COLORS, fmtAgo, fmtNum, fmtPct, fmtPrice, fmtTime, tone } from "../format";
import { usePolling } from "../hooks";
import type { BotDetail, Candle, Point } from "../types";
import { StatusBadge, positionText } from "./BotsPage";

export default function BotDetailPage() {
  const { id } = useParams();
  const botId = Number(id);
  const navigate = useNavigate();
  const { meta } = useApp();
  const [detail, setDetail] = useState<BotDetail | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"trades" | "orders" | "logs">("logs");

  const bot = detail?.bot;

  const refresh = async () => {
    try {
      setDetail(await api.bot(botId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  usePolling(refresh, [botId], 5000);

  usePolling(
    async (token) => {
      if (!bot) return;
      try {
        const r = await api.klines(bot.source, bot.symbol, bot.interval, 300);
        if (!token.cancelled) setCandles(r.candles);
      } catch {
        // 行情失败时保留旧数据
      }
    },
    [bot?.source, bot?.symbol, bot?.interval],
    15_000,
  );

  const markers = useMemo<TradeMarker[]>(() => {
    if (!detail || !candles.length) return [];
    const first = candles[0][0];
    return detail.orders
      .filter((o) => o.ts >= first)
      .map((o) => ({ ts: o.ts, side: o.side, text: o.reason === "signal" ? undefined : REASON_LABEL[o.reason] }));
  }, [detail, candles]);

  const equityLines = useMemo(() => {
    if (!detail) return [];
    const eq: Point[] = detail.equity.map(([t, e]) => [t, e]);
    return [{ name: "账户权益", data: eq, color: SERIES_COLORS[0], type: "area" as const }];
  }, [detail]);

  const act = async (action: "start" | "stop" | "close" | "delete") => {
    if (!bot) return;
    if (action === "delete" && !window.confirm(`确定删除机器人「${bot.name}」及其全部交易记录？`)) return;
    if (action === "close" && !window.confirm("确定停止机器人并按最新价平掉当前持仓？")) return;
    setBusy(true);
    try {
      if (action === "start") await api.startBot(botId);
      else if (action === "stop") await api.stopBot(botId);
      else if (action === "close") await api.stopBot(botId, true);
      else {
        await api.deleteBot(botId);
        navigate("/bots");
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!detail) {
    return (
      <div className="page">
        <ErrorBox error={error} onRetry={refresh} />
        {!error && <Spinner />}
      </div>
    );
  }
  const b = detail.bot;
  const strategy = meta?.strategies.find((s) => s.id === b.strategy);
  const wins = b.trade_count ? b.win_count / b.trade_count : 0;

  return (
    <div className="page stack">
      <div className="row gap wrap">
        <Link to="/bots" className="btn btn-ghost btn-sm">
          ← 返回列表
        </Link>
      </div>
      <Card
        title={
          <span className="row gap wrap">
            {b.name} <StatusBadge bot={b} />
          </span>
        }
        extra={
          <div className="row gap wrap">
            {b.status === "running" ? (
              <>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("stop")}>
                  停止
                </button>
                {b.units !== 0 && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("close")}>
                    停止并平仓
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act("start")}>
                  启动
                </button>
                {b.units !== 0 && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("close")}>
                    平仓
                  </button>
                )}
              </>
            )}
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act("delete")}>
              删除
            </button>
          </div>
        }
      >
        <ErrorBox error={error} />
        {b.last_error && <div className="warn small">⚠ 最近一次运行出错：{b.last_error}</div>}
        <div className="muted small bot-config">
          {b.symbol} · {INTERVAL_LABEL[b.interval]} · {meta?.sources.find((s) => s.id === b.source)?.label ?? b.source} · {strategy?.name ?? b.strategy}
          （{Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(", ") || "无参数"}）· 手续费 {fmtPct(b.fee_rate, 3, false)} · 滑点{" "}
          {fmtPct(b.slippage, 3, false)}
          {b.allow_short ? " · 允许做空" : ""}
          {b.stop_loss ? ` · 止损 ${fmtPct(b.stop_loss, 1, false)}` : ""}
          {b.take_profit ? ` · 止盈 ${fmtPct(b.take_profit, 1, false)}` : ""} · 创建于 {fmtTime(b.created_at)}
        </div>
        <div className="stat-grid">
          <Stat label="账户权益" value={fmtNum(b.equity)} sub={`初始 ${fmtNum(b.initial_capital)}`} />
          <Stat label="收益率" value={fmtPct(b.return_pct)} toneValue={b.return_pct} sub={<span className={tone(b.pnl)}>{fmtNum(b.pnl)} USDT</span>} />
          <Stat
            label="持仓"
            value={<span className={b.units > 0 ? "up" : b.units < 0 ? "down" : ""}>{positionText(b)}</span>}
            sub={b.units ? `均价 ${fmtPrice(b.avg_price)} · 仓位 ${fmtPct(b.exposure, 1, false)}` : "等待信号"}
          />
          <Stat label="浮动盈亏" value={fmtNum(b.unrealized_pnl)} toneValue={b.unrealized_pnl} />
          <Stat label="可用现金" value={fmtNum(b.cash)} />
          <Stat label="最新价" value={fmtPrice(b.last_price)} sub={`更新于 ${fmtAgo(b.last_run_at)}`} />
          <Stat label="当前信号" value={b.last_signal == null ? "等待中" : fmtPct(b.last_signal, 0)} sub={b.last_bar_ts ? `K 线 ${fmtTime(b.last_bar_ts)}` : "等待首根 K 线"} />
          <Stat label="交易 / 胜率" value={`${b.trade_count} 笔`} sub={`胜率 ${fmtPct(wins, 1, false)} · 手续费 ${fmtNum(b.fees_paid)}`} />
        </div>
      </Card>

      <Card title="实时行情与成交点">
        <PriceChart candles={candles} interval={b.interval} markers={markers} resetKey={`${b.id}|${candles.length > 0}`} height={400} />
      </Card>

      <Card title="权益曲线">
        {equityLines[0]?.data.length > 1 ? (
          <SeriesChart lines={equityLines} format="money" resetKey={String(b.id)} height={240} />
        ) : (
          <div className="muted small pad">运行一段时间后显示权益曲线</div>
        )}
      </Card>

      <Card
        title="记录"
        extra={
          <Segmented
            options={[
              { value: "logs", label: "运行日志" },
              { value: "trades", label: `交易 (${detail.trades.length})` },
              { value: "orders", label: `成交 (${detail.orders.length})` },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      >
        {tab === "trades" && <TradesTable trades={detail.trades} />}
        {tab === "orders" && <OrdersTable orders={detail.orders} />}
        {tab === "logs" && (
          <div className="logs">
            {detail.logs.map((l, i) => (
              <div key={i} className={`log log-${l.level}`}>
                <span className="muted mono">{fmtTime(l.ts, true)}</span>
                <span>{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
