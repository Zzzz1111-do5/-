import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CostFields, MarketFields, StrategyFields } from "../components/forms";
import { Card, Empty, ErrorBox, Field, NumberInput, Spinner } from "../components/ui";
import { loadLocal, saveLocal, useApp } from "../context";
import { fmtNum, fmtPct, fmtTime, tone } from "../format";
import type { OptimizeResult, OptimizeRow, ParamSpec, RunSettings, StrategySpec, SummaryMetrics } from "../types";
import { defaultSettings, sanitize, type NavState } from "./BacktestPage";

interface Range {
  enabled: boolean;
  min: number;
  max: number;
  step: number;
}

function defaultRange(p: ParamSpec, enabled: boolean): Range {
  const min = Math.max(p.min, p.type === "int" ? Math.round(p.default / 2) : +(p.default / 2).toFixed(4));
  const max = Math.min(p.max, p.type === "int" ? Math.round(p.default * 2) : +(p.default * 2).toFixed(4));
  let step = (max - min) / 5;
  step = p.type === "int" ? Math.max(1, Math.round(step)) : Math.max(p.step, +step.toFixed(4));
  return { enabled, min, max, step };
}

function countValues(r: Range): number {
  if (!r.enabled) return 1;
  if (r.step <= 0 || r.max < r.min) return 0;
  return Math.floor((r.max - r.min) / r.step + 1e-9) + 1;
}

const METRIC_IS_PCT: Record<string, boolean> = {
  total_return: true,
  annual_return: true,
  max_drawdown: true,
  win_rate: true,
  excess_return: true,
};

function fmtMetric(key: string, v: number | null | undefined) {
  if (v == null) return key === "profit_factor" ? "∞" : "—";
  return METRIC_IS_PCT[key] ? fmtPct(v) : fmtNum(v);
}

export default function OptimizePage() {
  const { meta, source } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = (location.state ?? {}) as NavState;
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const [metric, setMetric] = useState("sharpe");
  const [oos, setOos] = useState(0.3);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const strategy: StrategySpec | undefined = meta?.strategies.find((s) => s.id === settings?.strategy);

  useEffect(() => {
    if (!meta || !source || settings) return;
    let s = loadLocal<RunSettings>("cq.optimize", defaultSettings(source));
    if (nav.settings) s = { ...s, ...nav.settings };
    const clean = sanitize(s, meta);
    setSettings(clean);
    if (location.state) {
      saveLocal("cq.optimize", clean);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, source, settings]);

  useEffect(() => {
    if (!strategy) return;
    setRanges(Object.fromEntries(strategy.params.map((p, i) => [p.name, defaultRange(p, i < 2)])));
    setResult(null);
  }, [strategy]);

  const update = (p: Partial<RunSettings>) =>
    setSettings((old) => {
      const next = { ...(old as RunSettings), ...p };
      saveLocal("cq.optimize", next);
      return next;
    });

  const combos = useMemo(() => Object.values(ranges).reduce((acc, r) => acc * countValues(r), 1), [ranges]);
  const enabledNames = Object.entries(ranges)
    .filter(([, r]) => r.enabled)
    .map(([n]) => n);
  const maxCombos = meta?.limits.max_combos ?? 500;

  const run = async () => {
    if (!settings) return;
    setRunning(true);
    setError(null);
    setShowAll(false);
    const grid = Object.fromEntries(
      Object.entries(ranges)
        .filter(([, r]) => r.enabled)
        .map(([n, r]) => [n, { min: r.min, max: r.max, step: r.step }]),
    );
    try {
      setResult(await api.optimize({ ...settings, grid, metric, oos_ratio: oos, top: Math.min(Math.max(combos, 1), 500) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const backtestRow = (row: OptimizeRow) =>
    navigate("/backtest", { state: { settings: { ...settings, params: row.params }, autorun: true } });

  if (!meta || !settings) return <Spinner />;

  return (
    <div className="page layout-split">
      <aside className="settings-panel">
        <Card title="优化设置">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <MarketFields value={settings} onChange={update} />
            <hr />
            <StrategyFields value={settings} onChange={update} showParams={false} />
            {strategy && strategy.params.length === 0 && <div className="muted small">该策略没有可优化的参数</div>}
            {strategy && strategy.params.length > 0 && (
              <div className="range-table">
                <div className="range-row range-head">
                  <span>参数</span>
                  <span>最小</span>
                  <span>最大</span>
                  <span>步长</span>
                </div>
                {strategy.params.map((p) => {
                  const r = ranges[p.name];
                  if (!r) return null;
                  const set = (patch: Partial<Range>) => setRanges((old) => ({ ...old, [p.name]: { ...old[p.name], ...patch } }));
                  return (
                    <div className={`range-row ${r.enabled ? "" : "disabled"}`} key={p.name}>
                      <label className="range-name">
                        <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                        {p.label}
                      </label>
                      <NumberInput value={r.min} min={p.min} max={p.max} onChange={(v) => set({ min: v ?? p.min })} />
                      <NumberInput value={r.max} min={p.min} max={p.max} onChange={(v) => set({ max: v ?? p.max })} />
                      <NumberInput value={r.step} min={p.step} onChange={(v) => set({ step: v ?? p.step })} />
                    </div>
                  );
                })}
                <div className="muted small">未勾选的参数使用默认值：{strategy.params.filter((p) => !ranges[p.name]?.enabled).map((p) => `${p.label}=${p.default}`).join("，") || "无"}</div>
              </div>
            )}
            <div className="form-grid">
              <Field label="优化目标">
                <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
                  {Object.entries(meta.metrics).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="样本外验证" hint="保留最后一段数据不参与优化，用于检验参数是否过拟合">
                <select className="input" value={oos} onChange={(e) => setOos(Number(e.target.value))}>
                  <option value={0}>不使用</option>
                  <option value={0.2}>最后 20%</option>
                  <option value={0.3}>最后 30%</option>
                  <option value={0.4}>最后 40%</option>
                </select>
              </Field>
            </div>
            <hr />
            <CostFields value={settings} onChange={update} longOnly={strategy?.long_only} />
            <div className={`small ${combos > maxCombos ? "warn" : "muted"}`}>
              参数组合数：{combos}
              {combos > maxCombos ? `（超过上限 ${maxCombos}，请增大步长）` : ""}
            </div>
            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={running || combos > maxCombos || combos < 1 || enabledNames.length === 0}
            >
              {running ? "优化中…" : "开始优化"}
            </button>
          </form>
        </Card>
      </aside>

      <div className="results">
        <ErrorBox error={error} />
        {running && <Spinner text={`正在评估 ${combos} 组参数…`} />}
        {!result && !running && !error && (
          <Card>
            <Empty>
              <div className="hero-empty">
                <h2>参数优化</h2>
                <p>在参数网格上批量回测，寻找表现最好的参数组合。</p>
                <p className="muted small">
                  提示：历史最优参数不代表未来表现。建议开启“样本外验证”，优先选择样本内外表现都稳定、且相邻参数表现也不差的组合。
                </p>
              </div>
            </Empty>
          </Card>
        )}
        {result && !running && (
          <div className="stack">
            <Card title={`${result.strategy_name} · 优化结果`}>
              <div className="muted small">
                共 {result.total_combos} 组参数，有效 {result.evaluated} 组{result.skipped ? `（${result.skipped} 组参数不合法已跳过）` : ""}；
                样本内 {result.in_sample_bars} 根 K 线
                {result.split_ts ? `，样本外 ${result.out_sample_bars} 根（${fmtTime(result.split_ts)} 之后）` : ""}；
                按样本内「{meta.metrics[result.metric]}」排序。
              </div>
            </Card>
            {enabledNames.length === 2 && result.results.length > 1 && (
              <Heatmap result={result} xName={enabledNames[0]} yName={enabledNames[1]} strategy={strategy} onPick={backtestRow} />
            )}
            <Card title="参数排名">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>参数</th>
                      <th className="num">收益率</th>
                      <th className="num">夏普</th>
                      <th className="num">最大回撤</th>
                      <th className="num">胜率</th>
                      <th className="num">交易数</th>
                      {result.split_ts && (
                        <>
                          <th className="num oos">样本外收益</th>
                          <th className="num oos">样本外夏普</th>
                          <th className="num oos">样本外回撤</th>
                        </>
                      )}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? result.results : result.results.slice(0, 30)).map((row, i) => (
                      <ResultRow key={i} rank={i + 1} row={row} oos={!!result.split_ts} onBacktest={() => backtestRow(row)} />
                    ))}
                  </tbody>
                </table>
              </div>
              {result.results.length > 30 && !showAll && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(true)}>
                  显示全部 {result.results.length} 条
                </button>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCell({ m, k }: { m: SummaryMetrics; k: keyof SummaryMetrics }) {
  const v = m[k] as number | null;
  return <td className={`num ${k === "trades" || k === "win_rate" ? "" : tone(v)}`}>{k === "trades" ? v : fmtMetric(k, v)}</td>;
}

function ResultRow({ rank, row, oos, onBacktest }: { rank: number; row: OptimizeRow; oos: boolean; onBacktest: () => void }) {
  return (
    <tr>
      <td className="muted">{rank}</td>
      <td className="mono">
        {Object.entries(row.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}
      </td>
      <MetricCell m={row.in_sample} k="total_return" />
      <MetricCell m={row.in_sample} k="sharpe" />
      <MetricCell m={row.in_sample} k="max_drawdown" />
      <MetricCell m={row.in_sample} k="win_rate" />
      <MetricCell m={row.in_sample} k="trades" />
      {oos && row.out_sample && (
        <>
          <MetricCell m={row.out_sample} k="total_return" />
          <MetricCell m={row.out_sample} k="sharpe" />
          <MetricCell m={row.out_sample} k="max_drawdown" />
        </>
      )}
      <td>
        <button className="btn btn-ghost btn-sm" onClick={onBacktest}>
          回测
        </button>
      </td>
    </tr>
  );
}

function Heatmap({
  result,
  xName,
  yName,
  strategy,
  onPick,
}: {
  result: OptimizeResult;
  xName: string;
  yName: string;
  strategy?: StrategySpec;
  onPick: (row: OptimizeRow) => void;
}) {
  const key = result.metric as keyof SummaryMetrics;
  const xs = [...new Set(result.results.map((r) => r.params[xName]))].sort((a, b) => a - b);
  const ys = [...new Set(result.results.map((r) => r.params[yName]))].sort((a, b) => a - b);
  const cell = new Map(result.results.map((r) => [`${r.params[xName]}|${r.params[yName]}`, r]));
  const vals = result.results.map((r) => r.in_sample[key] as number | null).filter((v): v is number => v != null && Number.isFinite(v));
  const maxAbs = Math.max(1e-9, ...vals.map(Math.abs));
  const label = (n: string) => strategy?.params.find((p) => p.name === n)?.label ?? n;
  return (
    <Card title={`参数热力图（样本内）`} extra={<span className="muted small">横轴 {label(xName)} · 纵轴 {label(yName)}</span>}>
      <div className="heatmap-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th />
              {xs.map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ys.map((y) => (
              <tr key={y}>
                <th>{y}</th>
                {xs.map((x) => {
                  const r = cell.get(`${x}|${y}`);
                  const v = r ? (r.in_sample[key] as number | null) : null;
                  const alpha = v == null ? 0 : Math.min(1, Math.abs(v) / maxAbs) * 0.85 + 0.1;
                  const color = v == null ? "transparent" : v >= 0 ? "var(--up)" : "var(--down)";
                  return (
                    <td
                      key={x}
                      className={r ? "clickable" : "empty-cell"}
                      onClick={() => r && onPick(r)}
                      title={r ? `${xName}=${x}, ${yName}=${y}\n点击回测` : "参数不合法"}
                    >
                      {r && <span className="heat-bg" style={{ background: color, opacity: alpha }} />}
                      <span className="heat-val">{r ? fmtMetric(key, v) : "×"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
