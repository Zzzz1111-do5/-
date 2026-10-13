import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type DeepPartial,
  type ChartOptions,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useApp } from "../context";
import { INTERVAL_MS, SERIES_COLORS, fmtPrice, pricePrecision, toChartTime } from "../format";
import type { Candle, Point } from "../types";

const BASE_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: "#848e9c",
    fontFamily: "Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 11,
    // 版权声明见侧边栏底部链接（Apache-2.0 NOTICE 要求）
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: "rgba(43, 49, 57, 0.6)" },
    horzLines: { color: "rgba(43, 49, 57, 0.6)" },
  },
  rightPriceScale: { borderColor: "#2b3139" },
  // minBarSpacing 调小，保证 fitContent 能显示完整区间
  timeScale: { borderColor: "#2b3139", timeVisible: true, secondsVisible: false, minBarSpacing: 0.01 },
  crosshair: { mode: CrosshairMode.Normal },
  // 不依赖 navigator.language（部分环境下为非法语言标签，如 en-US@posix）
  localization: { locale: "zh-CN", dateFormat: "yyyy-MM-dd" },
};

function useChart(options?: DeepPartial<ChartOptions>) {
  const ref = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, { ...BASE_OPTIONS, ...options });
    setChart(c);
    return () => {
      c.remove();
      setChart(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, chart };
}

export interface TradeMarker {
  ts: number;
  side: "buy" | "sell";
  text?: string;
}

interface PriceChartProps {
  candles: Candle[];
  interval: string;
  overlays?: Record<string, Point[]>;
  markers?: TradeMarker[];
  height?: number;
  showVolume?: boolean;
  /** 改变时重新适配可视范围（切换币种/周期/新回测） */
  resetKey?: string;
}

interface Legend {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  change: number;
  extras: { name: string; value: number; color: string }[];
}

export function PriceChart({ candles, interval, overlays, markers, height = 420, showVolume = true, resetKey }: PriceChartProps) {
  const { colors } = useApp();
  const { ref, chart } = useChart();
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const lastReset = useRef<string | undefined>(undefined);
  const [legend, setLegend] = useState<Legend | null>(null);

  useEffect(() => {
    if (!chart) return;
    candleRef.current = chart.addCandlestickSeries({ borderVisible: false });
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    const overlayMap = overlayRefs.current;
    return () => {
      candleRef.current = null;
      volumeRef.current = null;
      overlayMap.clear();
    };
  }, [chart]);

  useEffect(() => {
    candleRef.current?.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
  }, [chart, colors]);

  // K 线与成交量
  useEffect(() => {
    if (!chart || !candleRef.current || !volumeRef.current) return;
    const last = candles.length ? candles[candles.length - 1][4] : 1;
    const precision = pricePrecision(last);
    candleRef.current.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    candleRef.current.setData(
      candles.map(([t, o, h, l, c]) => ({ time: toChartTime(t), open: o, high: h, low: l, close: c })),
    );
    volumeRef.current.setData(
      showVolume
        ? candles.map(([t, o, , , c, v]) => ({
            time: toChartTime(t),
            value: v,
            color: (c >= o ? colors.up : colors.down) + "66",
          }))
        : [],
    );
    if (resetKey !== lastReset.current && candles.length) {
      lastReset.current = resetKey;
      chart.timeScale().fitContent();
    }
  }, [chart, candles, showVolume, colors, resetKey]);

  // 指标线
  useEffect(() => {
    if (!chart) return;
    const map = overlayRefs.current;
    const names = Object.keys(overlays ?? {});
    for (const [name, series] of map) {
      if (!names.includes(name)) {
        chart.removeSeries(series);
        map.delete(name);
      }
    }
    names.forEach((name, i) => {
      let s = map.get(name);
      if (!s) {
        s = chart.addLineSeries({
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        map.set(name, s);
      }
      s.setData((overlays?.[name] ?? []).map(([t, v]) => ({ time: toChartTime(t), value: v })));
    });
  }, [chart, overlays]);

  // 买卖点
  useEffect(() => {
    if (!candleRef.current) return;
    const step = INTERVAL_MS[interval] ?? 60_000;
    const list = markers ?? [];
    const withText = list.length <= 80;
    const ms: SeriesMarker<Time>[] = list
      .map((m) => ({
        time: toChartTime(Math.floor(m.ts / step) * step),
        position: m.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.side === "buy" ? colors.up : colors.down,
        shape: m.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: withText ? (m.text ?? (m.side === "buy" ? "买" : "卖")) : undefined,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    candleRef.current.setMarkers(ms);
  }, [chart, markers, interval, colors, candles]);

  // 十字光标图例
  useEffect(() => {
    if (!chart) return;
    const handler = (param: { time?: Time; seriesData: Map<ISeriesApi<"Candlestick" | "Line" | "Histogram">, unknown> }) => {
      const cs = candleRef.current;
      if (!cs) return;
      const bar = (param.time ? param.seriesData.get(cs) : undefined) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      let data = bar;
      let vol = 0;
      if (!data) {
        const last = candles[candles.length - 1];
        if (!last) return setLegend(null);
        data = { open: last[1], high: last[2], low: last[3], close: last[4] };
        vol = last[5];
      } else {
        const v = volumeRef.current ? (param.seriesData.get(volumeRef.current) as { value: number } | undefined) : undefined;
        vol = v?.value ?? 0;
      }
      const extras: Legend["extras"] = [];
      let i = 0;
      for (const [name, s] of overlayRefs.current) {
        const p = param.time ? (param.seriesData.get(s) as { value: number } | undefined) : undefined;
        const series = overlays?.[name];
        const value = p?.value ?? (param.time ? undefined : series?.[series.length - 1]?.[1]);
        if (value !== undefined) extras.push({ name, value, color: SERIES_COLORS[i % SERIES_COLORS.length] });
        i++;
      }
      setLegend({
        o: data.open,
        h: data.high,
        l: data.low,
        c: data.close,
        v: vol,
        change: data.open ? data.close / data.open - 1 : 0,
        extras,
      });
    };
    handler({ seriesData: new Map() });
    chart.subscribeCrosshairMove(handler as never);
    return () => chart.unsubscribeCrosshairMove(handler as never);
  }, [chart, candles, overlays]);

  return (
    <div className="chart-wrap" style={{ height }}>
      {legend && (
        <div className="chart-legend">
          <span>开 <b>{fmtPrice(legend.o)}</b></span>
          <span>高 <b>{fmtPrice(legend.h)}</b></span>
          <span>低 <b>{fmtPrice(legend.l)}</b></span>
          <span>
            收 <b className={legend.change >= 0 ? "up" : "down"}>{fmtPrice(legend.c)}</b>
          </span>
          <span className={legend.change >= 0 ? "up" : "down"}>
            {legend.change >= 0 ? "+" : ""}
            {(legend.change * 100).toFixed(2)}%
          </span>
          {legend.extras.map((e) => (
            <span key={e.name} style={{ color: e.color }}>
              {e.name} {fmtPrice(e.value)}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="chart-canvas" />
    </div>
  );
}

export interface LineDef {
  name: string;
  data: Point[];
  color: string;
  type?: "line" | "area" | "histogram";
  lineWidth?: 1 | 2 | 3;
}

interface SeriesChartProps {
  lines: LineDef[];
  height?: number;
  format?: "percent" | "money" | "number";
  levels?: number[];
  resetKey?: string;
}

const formatters = {
  percent: (p: number) => `${(p * 100).toFixed(2)}%`,
  money: (p: number) => p.toLocaleString("en-US", { maximumFractionDigits: 2 }),
  number: (p: number) => p.toLocaleString("en-US", { maximumFractionDigits: 4 }),
};

export function SeriesChart({ lines, height = 220, format = "number", levels, resetKey }: SeriesChartProps) {
  const { ref, chart } = useChart();
  const seriesRefs = useRef<ISeriesApi<"Line" | "Area" | "Histogram">[]>([]);
  const lastReset = useRef<string | undefined>(undefined);

  useEffect(() => {
    chart?.applyOptions({ localization: { locale: "zh-CN", dateFormat: "yyyy-MM-dd", priceFormatter: formatters[format] } });
  }, [chart, format]);

  useEffect(() => {
    if (!chart) return;
    for (const s of seriesRefs.current) chart.removeSeries(s);
    seriesRefs.current = lines.map((line) => {
      const common = { priceLineVisible: false, lastValueVisible: true, title: "" };
      let s: ISeriesApi<"Line" | "Area" | "Histogram">;
      if (line.type === "area") {
        s = chart.addAreaSeries({
          ...common,
          lineColor: line.color,
          topColor: line.color + "55",
          bottomColor: line.color + "05",
          lineWidth: line.lineWidth ?? 2,
        });
      } else if (line.type === "histogram") {
        s = chart.addHistogramSeries({ ...common, color: line.color });
      } else {
        s = chart.addLineSeries({ ...common, color: line.color, lineWidth: line.lineWidth ?? 2 });
      }
      s.setData(line.data.map(([t, v]) => ({ time: toChartTime(t) as UTCTimestamp, value: v })));
      return s;
    });
    const first = seriesRefs.current[0];
    if (first) {
      for (const lv of levels ?? []) {
        first.createPriceLine({
          price: lv,
          color: "#5e6673",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        });
      }
    }
    if (resetKey !== lastReset.current) {
      lastReset.current = resetKey;
      chart.timeScale().fitContent();
    }
  }, [chart, lines, levels, resetKey]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <div className="chart-legend">
        {lines.map((l) => (
          <span key={l.name} style={{ color: l.color }}>
            ● {l.name}
          </span>
        ))}
      </div>
      <div ref={ref} className="chart-canvas" />
    </div>
  );
}
