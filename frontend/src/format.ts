import type { UTCTimestamp } from "lightweight-charts";

export const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const INTERVAL_LABEL: Record<string, string> = {
  "1m": "1分",
  "5m": "5分",
  "15m": "15分",
  "30m": "30分",
  "1h": "1小时",
  "4h": "4小时",
  "1d": "日线",
};

export const REASON_LABEL: Record<string, string> = {
  signal: "策略信号",
  stop_loss: "止损",
  take_profit: "止盈",
  end: "期末平仓",
  liquidation: "爆仓强平",
  manual: "手动平仓",
};

export function pricePrecision(p: number): number {
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 10) return 3;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return 8;
}

export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const d = pricePrecision(p);
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtQty(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return x.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function fmtPct(x: number | null | undefined, digits = 2, sign = true): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = x * 100;
  const s = v.toFixed(digits);
  return `${sign && v > 0 ? "+" : ""}${s}%`;
}

export function fmtCompact(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(x / 1e4).toFixed(2)}万`;
  return x.toFixed(2);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtTime(ms: number | null | undefined, withSeconds = false): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysAgo(n: number): string {
  return fmtDate(new Date(Date.now() - n * 86_400_000));
}

export function fmtDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

export function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/** lightweight-charts 按 UTC 显示时间，这里平移到本地时区。 */
export function toChartTime(ms: number): UTCTimestamp {
  return (Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60) as UTCTimestamp;
}

export function tone(x: number | null | undefined): "up" | "down" | "flat" {
  if (x == null || !Number.isFinite(x) || Math.abs(x) < 1e-12) return "flat";
  return x > 0 ? "up" : "down";
}

export const SERIES_COLORS = ["#f0b90b", "#3b82f6", "#a855f7", "#14b8a6", "#f97316", "#ec4899"];
