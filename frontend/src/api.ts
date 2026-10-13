import type { BacktestResult, Bot, BotDetail, Candle, Meta, OptimizeResult, RunSettings, Ticker } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("无法连接后台程序：请确认启动时打开的命令行窗口（start.bat / start.sh）仍在运行；如已关闭，请重新启动", 0);
  }
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应
  }
  if (!resp.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : `请求失败 (${resp.status})`;
    throw new ApiError(message, resp.status);
  }
  return data as T;
}

/** 交易所行情接口失败（后端返回 502），可提示用户切换行情源 */
export const isSourceError = (e: unknown) => e instanceof ApiError && e.status === 502;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const api = {
  meta: () => request<Meta>("/api/meta"),
  klines: (source: string, symbol: string, interval: string, limit = 500) =>
    request<{ candles: Candle[] }>(`/api/klines?${qs({ source, symbol, interval, limit })}`),
  tickers: (source: string, symbols: string[]) =>
    request<{ tickers: Ticker[] }>(`/api/tickers?${qs({ source, symbols: symbols.join(",") })}`),
  backtest: (body: RunSettings) =>
    request<BacktestResult>("/api/backtest", { method: "POST", body: JSON.stringify(body) }),
  optimize: (
    body: RunSettings & {
      grid: Record<string, { min: number; max: number; step: number }>;
      metric: string;
      oos_ratio: number;
      top: number;
    },
  ) => request<OptimizeResult>("/api/optimize", { method: "POST", body: JSON.stringify(body) }),
  bots: () => request<{ bots: Bot[] }>("/api/bots"),
  bot: (id: number) => request<BotDetail>(`/api/bots/${id}`),
  createBot: (body: Omit<RunSettings, "start" | "end"> & { name?: string; start: boolean }) =>
    request<Bot>("/api/bots", { method: "POST", body: JSON.stringify(body) }),
  startBot: (id: number) => request<Bot>(`/api/bots/${id}/start`, { method: "POST" }),
  stopBot: (id: number, closePosition = false) =>
    request<Bot>(`/api/bots/${id}/stop?close_position=${closePosition}`, { method: "POST" }),
  deleteBot: (id: number) => request<{ ok: boolean }>(`/api/bots/${id}`, { method: "DELETE" }),
};
