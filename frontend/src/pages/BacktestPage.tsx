import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, isSourceError } from "../api";
import { PriceChart, SeriesChart, type TradeMarker } from "../components/charts";
import { CostFields, MarketFields, StrategyFields, defaultParams } from "../components/forms";
import { Card, Empty, ErrorBox, SourceHint, OrdersTable, Segmented, Spinner, Stat, TradesTable } from "../components/ui";
import { loadLocal, saveLocal, useApp } from "../context";
import { INTERVAL_LABEL, INTERVAL_MS, REASON_LABEL, SERIES_COLORS, daysAgo, fmtDuration, fmtNum, fmtPct } from "../format";
import type { BacktestResult, Meta, RunSettings } from "../types";

export function defaultSettings(source: string): RunSettings {
  return {
    source,
    symbol: "BTC/USDT",
    interval: "1h",
    start: daysAgo(365),
    end: daysAgo(0),
    strategy: "sma_cross",
    params: { fast: 10, slow: 30 },
    initial_capital: 10000,
    fee_rate: 0.001,
    slippage: 0.0005,
    allow_short: false,
    stop_loss: null,
    take_profit: null,
  };
}

/** 修正与当前策略不匹配的参数（如策略列表更新后） */
export function sanitize(s: RunSettings, meta: Meta): RunSettings {
  const strategy = meta.strategies.find((x) => x.id === s.strategy) ?? meta.strategies[0];
  const params = defaultParams(strategy);
  for (const p of strategy.params) {
    const v = s.params?.[p.name];
    if (typeof v === "number" && Number.isFinite(v)) params[p.name] = v;
  }
  const source = meta.sources.some((x) => x.id === s.source) ? s.source : meta.default_source;
  return { ...s, source, strategy: strategy.id, params };
}

export interface NavState {
  symbol?: string;
  interval?: string;
  settings?: Partial<RunSettings>;
  autorun?: boolean;
  create?: boolean;
}

function estimateBars(s: RunSettings): number {
  const span = new Date(s.end).getTime() - new Date(s.start).getTime() + 86_400_000;
  return Math.max(0, Math.round(span / (INTERVAL_MS[s.interval] ?? 3_600_000)));
}

export default function BacktestPage() {
  const { meta, source } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = (location.state ?? {}) as NavState;
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceErr, setSourceErr] = useState(false);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"trades" | "orders">("trades");
  const [runId, setRunId] = useState(0);
  const autoran = useRef(false);

  useEffect(() => {
    if (!meta || !source || settings) return;
    let s = loadLocal<RunSettings>("cq.backtest", defaultSettings(source));
    if (nav.symbol) s = { ...s, symbol: nav.symbol };
    if (nav.interval) s = { ...s, interval: nav.interval };
    if (nav.settings) s = { ...s, ...nav.settings };
    const clean = sanitize(s, meta);
    setSettings(clean);
    if (location.state) {
      // 预设只生效一次，避免刷新页面时覆盖用户之后的修改
      saveLocal("cq.backtest", clean);
      navigate(location.pathname, { replace: true, state: null });
    }
    if (nav.autorun && !autoran.current) {
      autoran.current = true;
      run(clean);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, source, settings]);

  const update = (p: Partial<RunSettings>) =>
    setSettings((old) => {
      const next = { ...(old as RunSettings), ...p };
      saveLocal("cq.backtest", next);
      return next;
    });

  const run = async (s: RunSettings | null = settings) => {
    if (!s) return;
    setRunning(true);
    setError(null);
    setSourceErr(false);
    saveLocal("cq.backtest", s);
    try {
      const r = await api.backtest(s);
      setResult(r);
      setRunId((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
      setSourceErr(isSourceError(e));
    } finally {
      setRunning(false);
    }
  };

  const strategy = meta?.strategies.find((s) => s.id === settings?.strategy);
  const bars = settings ? estimateBars(settings) : 0;
  const tooMany = meta ? bars > meta.limits.max_bars : false;

  if (!meta || !settings) return <Spinner />;

  return (
    <div className="page layout-split">
      <aside className="settings-panel">
        <Card title="回测设置">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <MarketFields value={settings} onChange={update} />
            <div className={`muted small ${tooMany ? "warn" : ""}`}>
              预计约 {bars.toLocaleString()} 根 K 线{tooMany ? `，超过上限 ${meta.limits.max_bars.toLocaleString()}，请缩短区间或加大周期` : ""}
            </div>
            <hr />
            <StrategyFields value={settings} onChange={update} />
            <hr />
            <CostFields value={settings} onChange={update} longOnly={strategy?.long_only} />
            <button className="btn btn-primary btn-block" disabled={running || tooMany} type="submit">
              {running ? "回测中…" : "开始回测"}
            </button>
          </form>
        </Card>
      </aside>

      <div className="results">
        <ErrorBox error={error} />
        <SourceHint show={sourceErr && settings.source !== "synthetic"} onSwitch={() => update({ source: "synthetic" })} />
        {running && !result && <Spinner text="正在获取行情并回测，首次拉取历史数据可能需要数秒…" />}
        {!result && !running && !error && (
          <Card>
            <Empty>
              <div className="hero-empty">
                <h2>策略回测</h2>
                <p>选择交易对、周期和策略，用历史 K 线检验策略表现。</p>
                <p className="muted small">
                  回测规则：K 线收盘产生信号，下一根 K 线开盘价成交；计入手续费与滑点；止损止盈按 K 线内最高/最低价触发。
                </p>
              </div>
            </Empty>
          </Card>
        )}
        {result && <BacktestView result={result} runId={runId} running={running} settings={settings} tab={tab} setTab={setTab} />}
      </div>
    </div>
  );
}

function BacktestView({
  result,
  runId,
  running,
  settings,
  tab,
  setTab,
}: {
  result: BacktestResult;
  runId: number;
  running: boolean;
  settings: RunSettings;
  tab: "trades" | "orders";
  setTab: (t: "trades" | "orders") => void;
}) {
  const navigate = useNavigate();
  const { colors } = useApp();
  const m = result.metrics;
  const key = String(runId);

  const markers = useMemo<TradeMarker[]>(
    () =>
      result.orders.map((o) => ({
        ts: o.ts,
        side: o.side,
        text: o.reason === "signal" ? undefined : REASON_LABEL[o.reason],
      })),
    [result],
  );
  const equityLines = useMemo(
    () => [
      { name: "策略权益", data: result.equity, color: SERIES_COLORS[0] },
      { name: "买入持有", data: result.benchmark, color: "#5e6673", lineWidth: 1 as const },
    ],
    [result],
  );
  const ddLines = useMemo(() => [{ name: "回撤", data: result.drawdown, color: colors.down, type: "area" as const }], [result, colors]);
  const oscLines = useMemo(
    () => Object.entries(result.oscillators).map(([name, data], i) => ({ name, data, color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length], lineWidth: 1 as const })),
    [result],
  );

  const paramText = Object.entries(result.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return (
    <div className={`stack ${running ? "dim" : ""}`}>
      <Card
        title={
          <span>
            {result.strategy_name} · {result.symbol} · {INTERVAL_LABEL[result.interval]}
            {paramText && <span className="muted small"> （{paramText}）</span>}
          </span>
        }
        extra={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              navigate("/bots", {
                state: { create: true, settings: { ...settings, strategy: result.strategy, params: result.params } },
              })
            }
          >
            用此配置模拟交易
          </button>
        }
      >
        <div className="stat-grid">
          <Stat label="总收益率" value={fmtPct(m.total_return)} toneValue={m.total_return} sub={`最终权益 ${fmtNum(m.final_equity)}`} />
          <Stat label="年化收益" value={fmtPct(m.annual_return)} toneValue={m.annual_return} />
          <Stat label="买入持有" value={fmtPct(m.benchmark_return)} toneValue={m.benchmark_return} sub={<>超额 <span className={m.excess_return >= 0 ? "up" : "down"}>{fmtPct(m.excess_return)}</span></>} />
          <Stat label="最大回撤" value={fmtPct(m.max_drawdown)} toneValue={m.max_drawdown} sub={`最长 ${m.max_drawdown_days.toFixed(1)} 天`} />
          <Stat label="夏普比率" value={fmtNum(m.sharpe)} hint="年化收益/年化波动，>1 较好" sub={`波动率 ${fmtPct(m.volatility, 1, false)}`} />
          <Stat label="索提诺比率" value={fmtNum(m.sortino)} hint="只考虑下行波动的夏普比率" />
          <Stat label="卡玛比率" value={fmtNum(m.calmar)} hint="年化收益/最大回撤" />
          <Stat label="交易次数" value={m.trades} sub={`平均持仓 ${fmtDuration(m.avg_holding_hours)}`} />
          <Stat label="胜率" value={fmtPct(m.win_rate, 1, false)} sub={`盈亏比 ${m.profit_factor == null ? (m.trades ? "∞" : "—") : fmtNum(m.profit_factor)}`} />
          <Stat label="平均每笔" value={fmtPct(m.avg_trade_return)} toneValue={m.avg_trade_return} sub={`最好 ${fmtPct(m.best_trade)} / 最差 ${fmtPct(m.worst_trade)}`} />
          <Stat label="持仓时间占比" value={fmtPct(m.exposure, 1, false)} />
          <Stat label="手续费合计" value={fmtNum(m.total_fees)} sub="USDT" />
        </div>
      </Card>

      <Card title="价格与买卖点">
        <PriceChart candles={result.candles} interval={result.interval} overlays={result.overlays} markers={markers} resetKey={key} height={440} />
        {oscLines.length > 0 && <SeriesChart lines={oscLines} levels={result.levels} height={160} resetKey={key} />}
      </Card>

      <div className="grid-2">
        <Card title="权益曲线">
          <SeriesChart lines={equityLines} format="money" resetKey={key} height={260} />
        </Card>
        <Card title="回撤">
          <SeriesChart lines={ddLines} format="percent" resetKey={key} height={260} />
        </Card>
      </div>

      <Card
        title="交易明细"
        extra={
          <Segmented
            options={[
              { value: "trades", label: `交易 (${result.trades.length})` },
              { value: "orders", label: `成交 (${result.orders.length})` },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      >
        {tab === "trades" ? <TradesTable trades={[...result.trades].reverse()} /> : <OrdersTable orders={[...result.orders].reverse()} />}
      </Card>
    </div>
  );
}
