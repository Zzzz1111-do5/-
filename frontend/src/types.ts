export type Candle = [number, number, number, number, number, number]; // ts, o, h, l, c, v
export type Point = [number, number]; // ts, value

export interface ParamSpec {
  name: string;
  label: string;
  type: "int" | "float";
  default: number;
  min: number;
  max: number;
  step: number;
  help: string;
}

export interface StrategySpec {
  id: string;
  name: string;
  category: string;
  description: string;
  long_only: boolean;
  params: ParamSpec[];
}

export interface Meta {
  sources: { id: string; label: string }[];
  default_source: string;
  intervals: string[];
  symbols: string[];
  strategies: StrategySpec[];
  metrics: Record<string, string>;
  limits: { max_bars: number; max_combos: number };
}

export interface Ticker {
  symbol: string;
  last: number;
  change_pct: number;
  high: number;
  low: number;
  volume: number;
  quote_volume: number;
}

export interface Order {
  id?: number;
  ts: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  notional: number;
  fee: number;
  reason: string;
}

export interface Trade {
  id?: number;
  side: "long" | "short";
  entry_time: number;
  entry_price: number;
  exit_time: number;
  exit_price: number;
  qty: number;
  pnl: number;
  return_pct: number;
  exit_reason: string;
}

export interface Metrics {
  initial_capital: number;
  final_equity: number;
  total_return: number;
  annual_return: number | null;
  max_drawdown: number;
  max_drawdown_days: number;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  trades: number;
  win_rate: number;
  profit_factor: number | null;
  avg_trade_return: number;
  best_trade: number;
  worst_trade: number;
  avg_holding_hours: number;
  exposure: number;
  total_fees: number;
  benchmark_return: number;
  excess_return: number;
}

export interface RunSettings {
  source: string;
  symbol: string;
  interval: string;
  start: string;
  end: string;
  strategy: string;
  params: Record<string, number>;
  initial_capital: number;
  fee_rate: number;
  slippage: number;
  allow_short: boolean;
  stop_loss: number | null;
  take_profit: number | null;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  source: string;
  strategy: string;
  strategy_name: string;
  allow_short: boolean;
  params: Record<string, number>;
  metrics: Metrics;
  candles: Candle[];
  equity: Point[];
  benchmark: Point[];
  drawdown: Point[];
  position: Point[];
  overlays: Record<string, Point[]>;
  oscillators: Record<string, Point[]>;
  levels: number[];
  orders: Order[];
  trades: Trade[];
}

export type SummaryMetrics = Pick<
  Metrics,
  | "total_return"
  | "annual_return"
  | "max_drawdown"
  | "sharpe"
  | "sortino"
  | "calmar"
  | "win_rate"
  | "profit_factor"
  | "trades"
  | "excess_return"
>;

export interface OptimizeRow {
  params: Record<string, number>;
  in_sample: SummaryMetrics;
  out_sample: SummaryMetrics | null;
}

export interface OptimizeResult {
  metric: string;
  total_combos: number;
  evaluated: number;
  skipped: number;
  split_ts: number | null;
  in_sample_bars: number;
  out_sample_bars: number;
  bars: number;
  strategy: string;
  strategy_name: string;
  results: OptimizeRow[];
}

export interface Bot {
  id: number;
  name: string;
  source: string;
  symbol: string;
  interval: string;
  strategy: string;
  strategy_name: string;
  params: Record<string, number>;
  initial_capital: number;
  fee_rate: number;
  slippage: number;
  allow_short: boolean;
  stop_loss: number | null;
  take_profit: number | null;
  status: "running" | "stopped";
  last_price: number | null;
  last_error: string | null;
  last_run_at: number | null;
  created_at: number;
  cash: number;
  units: number;
  avg_price: number;
  equity: number;
  pnl: number;
  return_pct: number;
  unrealized_pnl: number;
  exposure: number;
  fees_paid: number;
  trade_count: number;
  win_count: number;
  last_signal: number | null;
  last_bar_ts: number | null;
}

export interface BotDetail {
  bot: Bot;
  orders: Order[];
  trades: Trade[];
  equity: [number, number, number][];
  logs: { ts: number; level: string; message: string }[];
}
