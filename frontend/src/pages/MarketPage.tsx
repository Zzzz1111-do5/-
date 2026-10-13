import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { PriceChart } from "../components/charts";
import { Card, ErrorBox, Segmented, Spinner, Toggle } from "../components/ui";
import { loadLocal, saveLocal, useApp } from "../context";
import { INTERVAL_LABEL, fmtCompact, fmtPrice, tone } from "../format";
import { usePolling } from "../hooks";
import type { Candle, Point, Ticker } from "../types";

function sma(candles: Candle[], n: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i][4];
    if (i >= n) sum -= candles[i - n][4];
    if (i >= n - 1) out.push([candles[i][0], sum / n]);
  }
  return out;
}

function boll(candles: Candle[], n = 20, k = 2): Record<string, Point[]> {
  const up: Point[] = [];
  const mid: Point[] = [];
  const low: Point[] = [];
  for (let i = n - 1; i < candles.length; i++) {
    const win = candles.slice(i - n + 1, i + 1).map((c) => c[4]);
    const m = win.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    const t = candles[i][0];
    up.push([t, m + k * sd]);
    mid.push([t, m]);
    low.push([t, m - k * sd]);
  }
  return { "BOLL上轨": up, "BOLL中轨": mid, "BOLL下轨": low };
}

interface MarketPrefs {
  symbol: string;
  interval: string;
  ma: boolean;
  boll: boolean;
  volume: boolean;
}

const QUICK_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function MarketPage() {
  const { meta, source } = useApp();
  const navigate = useNavigate();
  const [prefs, setPrefsState] = useState<MarketPrefs>(() =>
    loadLocal("cq.market", { symbol: "BTC/USDT", interval: "1h", ma: true, boll: false, volume: true }),
  );
  const setPrefs = (p: Partial<MarketPrefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p };
      saveLocal("cq.market", next);
      return next;
    });

  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [tickerError, setTickerError] = useState<string | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartKey, setChartKey] = useState("");
  const [chartError, setChartError] = useState<string | null>(null);
  const [loadingChart, setLoadingChart] = useState(true);

  const symbols = useMemo(() => {
    const list = meta?.symbols ?? [];
    return list.includes(prefs.symbol) ? list : [...list, prefs.symbol];
  }, [meta, prefs.symbol]);

  usePolling(
    async (token) => {
      if (!source || !symbols.length) return;
      try {
        const r = await api.tickers(source, symbols);
        if (token.cancelled) return;
        setTickers(r.tickers);
        setTickerError(null);
      } catch (e) {
        if (!token.cancelled) setTickerError((e as Error).message);
      }
    },
    [source, symbols.join(",")],
    10_000,
  );

  usePolling(
    async (token) => {
      if (!source) return;
      const key = `${source}|${prefs.symbol}|${prefs.interval}`;
      try {
        const r = await api.klines(source, prefs.symbol, prefs.interval, 500);
        if (token.cancelled) return;
        setCandles(r.candles);
        setChartKey(key);
        setChartError(null);
      } catch (e) {
        if (!token.cancelled) setChartError((e as Error).message);
      } finally {
        if (!token.cancelled) setLoadingChart(false);
      }
    },
    [source, prefs.symbol, prefs.interval],
    10_000,
  );

  const overlays = useMemo(() => {
    const o: Record<string, Point[]> = {};
    if (prefs.ma) {
      o["MA7"] = sma(candles, 7);
      o["MA25"] = sma(candles, 25);
      o["MA99"] = sma(candles, 99);
    }
    if (prefs.boll) Object.assign(o, boll(candles));
    return o;
  }, [candles, prefs.ma, prefs.boll]);

  const current = tickers.find((t) => t.symbol === prefs.symbol);
  const lastClose = candles.length ? candles[candles.length - 1][4] : undefined;

  return (
    <div className="page">
      <div className="ticker-grid">
        {tickers.length === 0 && !tickerError && <Spinner text="正在加载行情…" />}
        {tickers.map((t) => (
          <button
            key={t.symbol}
            className={`ticker ${t.symbol === prefs.symbol ? "active" : ""}`}
            onClick={() => {
              setLoadingChart(true);
              setPrefs({ symbol: t.symbol });
            }}
          >
            <div className="ticker-sym">
              {t.symbol.split("/")[0]}
              <span className="muted">/{t.symbol.split("/")[1]}</span>
            </div>
            <div className={`ticker-price ${tone(t.change_pct)}`}>{fmtPrice(t.last)}</div>
            <div className={`ticker-chg ${tone(t.change_pct)}`}>
              {t.change_pct > 0 ? "+" : ""}
              {t.change_pct.toFixed(2)}%
            </div>
          </button>
        ))}
      </div>
      <ErrorBox error={tickerError} />

      <Card
        className="market-card"
        title={
          <div className="market-title">
            <span className="market-symbol">{prefs.symbol}</span>
            <span className={`market-last ${tone(current?.change_pct)}`}>{fmtPrice(current?.last ?? lastClose)}</span>
            {current && (
              <span className="market-stats">
                <span>
                  24h涨跌 <b className={tone(current.change_pct)}>{current.change_pct.toFixed(2)}%</b>
                </span>
                <span>
                  24h最高 <b>{fmtPrice(current.high)}</b>
                </span>
                <span>
                  24h最低 <b>{fmtPrice(current.low)}</b>
                </span>
                <span>
                  24h成交额 <b>{fmtCompact(current.quote_volume)}</b>
                </span>
              </span>
            )}
          </div>
        }
        extra={
          <div className="row gap">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/backtest", { state: { symbol: prefs.symbol, interval: prefs.interval } })}>
              回测此币种
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/bots", { state: { symbol: prefs.symbol, create: true } })}>
              创建模拟机器人
            </button>
          </div>
        }
      >
        <div className="chart-toolbar">
          <Segmented
            options={QUICK_INTERVALS.map((i) => ({ value: i, label: INTERVAL_LABEL[i] }))}
            value={prefs.interval}
            onChange={(v) => {
              setLoadingChart(true);
              setPrefs({ interval: v });
            }}
          />
          <div className="row gap">
            <Toggle checked={prefs.ma} onChange={(v) => setPrefs({ ma: v })} label="MA" />
            <Toggle checked={prefs.boll} onChange={(v) => setPrefs({ boll: v })} label="BOLL" />
            <Toggle checked={prefs.volume} onChange={(v) => setPrefs({ volume: v })} label="成交量" />
          </div>
        </div>
        <ErrorBox error={chartError} />
        <div className="relative">
          {loadingChart && <div className="chart-loading"><Spinner /></div>}
          <PriceChart
            candles={candles}
            interval={prefs.interval}
            overlays={overlays}
            showVolume={prefs.volume}
            resetKey={chartKey}
            height={480}
          />
        </div>
        <p className="muted small">行情每 10 秒自动刷新 · 数据源：{meta?.sources.find((s) => s.id === source)?.label}</p>
      </Card>
    </div>
  );
}
