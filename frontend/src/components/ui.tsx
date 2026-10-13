import { useEffect, useState, type ReactNode } from "react";
import { REASON_LABEL, fmtNum, fmtPct, fmtPrice, fmtQty, fmtTime, tone } from "../format";
import type { Order, Trade } from "../types";

export function Card({
  title,
  extra,
  children,
  className = "",
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="card-head">
          <h3>{title}</h3>
          {extra && <div className="card-extra">{extra}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  toneValue,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  toneValue?: number | null;
  hint?: string;
}) {
  const t = toneValue === undefined ? "" : tone(toneValue);
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${t}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <span>⚠ {error}</span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

/** 行情源不可用时的提示，可一键切换到离线模拟数据 */
export function SourceHint({ show, onSwitch }: { show: boolean; onSwitch: () => void }) {
  if (!show) return null;
  return (
    <div className="hint small">
      提示：如果所在地区或网络无法访问该交易所，可在右上角「行情源」切换为其他交易所，或
      <button className="link-btn" type="button" onClick={onSwitch}>
        切换到模拟数据（离线）
      </button>
    </div>
  );
}

export function Spinner({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && (
          <span className="field-hint" title={hint}>
            ?
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

/** 受控数字输入：内部保留字符串，允许输入中间态（如 "0."） */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  allowEmpty = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    if (parsed !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? "any"}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SideBadge({ side }: { side: string }) {
  const buy = side === "buy" || side === "long";
  const label = { buy: "买入", sell: "卖出", long: "做多", short: "做空" }[side] ?? side;
  return <span className={`badge ${buy ? "badge-up" : "badge-down"}`}>{label}</span>;
}

export function TradesTable({ trades, max = 500 }: { trades: Trade[]; max?: number }) {
  if (!trades.length) return <Empty>暂无已平仓交易</Empty>;
  const rows = trades.slice(0, max);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>方向</th>
            <th>开仓时间</th>
            <th className="num">开仓均价</th>
            <th>平仓时间</th>
            <th className="num">平仓均价</th>
            <th className="num">数量</th>
            <th className="num">盈亏</th>
            <th className="num">收益率</th>
            <th>平仓原因</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id ?? i}>
              <td className="muted">{t.id ?? i + 1}</td>
              <td>
                <SideBadge side={t.side} />
              </td>
              <td>{fmtTime(t.entry_time)}</td>
              <td className="num">{fmtPrice(t.entry_price)}</td>
              <td>{fmtTime(t.exit_time)}</td>
              <td className="num">{fmtPrice(t.exit_price)}</td>
              <td className="num">{fmtQty(t.qty)}</td>
              <td className={`num ${tone(t.pnl)}`}>{fmtNum(t.pnl)}</td>
              <td className={`num ${tone(t.return_pct)}`}>{fmtPct(t.return_pct)}</td>
              <td>{REASON_LABEL[t.exit_reason] ?? t.exit_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > max && <div className="muted small pad">仅显示前 {max} 条，共 {trades.length} 条</div>}
    </div>
  );
}

export function OrdersTable({ orders, max = 500 }: { orders: Order[]; max?: number }) {
  if (!orders.length) return <Empty>暂无成交记录</Empty>;
  const rows = orders.slice(0, max);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>方向</th>
            <th className="num">成交价</th>
            <th className="num">数量</th>
            <th className="num">成交额</th>
            <th className="num">手续费</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={o.id ?? i}>
              <td>{fmtTime(o.ts, true)}</td>
              <td>
                <SideBadge side={o.side} />
              </td>
              <td className="num">{fmtPrice(o.price)}</td>
              <td className="num">{fmtQty(o.qty)}</td>
              <td className="num">{fmtNum(o.notional)}</td>
              <td className="num">{fmtNum(o.fee, 4)}</td>
              <td>{REASON_LABEL[o.reason] ?? o.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length > max && <div className="muted small pad">仅显示前 {max} 条，共 {orders.length} 条</div>}
    </div>
  );
}
