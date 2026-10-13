import { useApp } from "../context";
import { INTERVAL_LABEL } from "../format";
import type { RunSettings, StrategySpec } from "../types";
import { Field, NumberInput, Toggle } from "./ui";

type Patch = (p: Partial<RunSettings>) => void;

export function defaultParams(s: StrategySpec | undefined): Record<string, number> {
  return Object.fromEntries((s?.params ?? []).map((p) => [p.name, p.default]));
}

export function MarketFields({ value, onChange, dates = true }: { value: RunSettings; onChange: Patch; dates?: boolean }) {
  const { meta } = useApp();
  if (!meta) return null;
  return (
    <div className="form-grid">
      <Field label="数据源">
        <select className="input" value={value.source} onChange={(e) => onChange({ source: e.target.value })}>
          {meta.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="交易对" hint="格式如 BTC/USDT，可输入任意现货交易对">
        <input
          className="input"
          list="symbol-list"
          value={value.symbol}
          onChange={(e) => onChange({ symbol: e.target.value.toUpperCase() })}
        />
        <datalist id="symbol-list">
          {meta.symbols.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="K 线周期">
        <select className="input" value={value.interval} onChange={(e) => onChange({ interval: e.target.value })}>
          {meta.intervals.map((i) => (
            <option key={i} value={i}>
              {INTERVAL_LABEL[i] ?? i}
            </option>
          ))}
        </select>
      </Field>
      {dates && (
        <>
          <Field label="开始日期">
            <input className="input" type="date" value={value.start} onChange={(e) => onChange({ start: e.target.value })} />
          </Field>
          <Field label="结束日期">
            <input className="input" type="date" value={value.end} onChange={(e) => onChange({ end: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

export function StrategyFields({
  value,
  onChange,
  showParams = true,
}: {
  value: RunSettings;
  onChange: Patch;
  showParams?: boolean;
}) {
  const { meta } = useApp();
  if (!meta) return null;
  const strategy = meta.strategies.find((s) => s.id === value.strategy);
  const categories = [...new Set(meta.strategies.map((s) => s.category))];
  return (
    <>
      <Field label="交易策略">
        <select
          className="input"
          value={value.strategy}
          onChange={(e) => {
            const s = meta.strategies.find((x) => x.id === e.target.value);
            onChange({ strategy: e.target.value, params: defaultParams(s) });
          }}
        >
          {categories.map((c) => (
            <optgroup key={c} label={c}>
              {meta.strategies
                .filter((s) => s.category === c)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {strategy && <p className="strategy-desc">{strategy.description}</p>}
      {showParams && strategy && strategy.params.length > 0 && (
        <div className="form-grid">
          {strategy.params.map((p) => (
            <Field key={p.name} label={p.label} hint={p.help || `范围 ${p.min} ~ ${p.max}`}>
              <NumberInput
                value={value.params[p.name] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => onChange({ params: { ...value.params, [p.name]: v ?? p.default } })}
              />
            </Field>
          ))}
        </div>
      )}
    </>
  );
}

const pct = (x: number | null) => (x == null ? null : +(x * 100).toFixed(6));
const frac = (x: number | null) => (x == null ? null : x / 100);

export function CostFields({ value, onChange, longOnly }: { value: RunSettings; onChange: Patch; longOnly?: boolean }) {
  return (
    <>
      <div className="form-grid">
        <Field label="初始资金 (USDT)">
          <NumberInput value={value.initial_capital} min={1} onChange={(v) => onChange({ initial_capital: v ?? 10000 })} />
        </Field>
        <Field label="手续费率 (%)" hint="单边手续费，币安现货默认 0.1%">
          <NumberInput value={pct(value.fee_rate)} min={0} max={5} step={0.01} onChange={(v) => onChange({ fee_rate: frac(v) ?? 0 })} />
        </Field>
        <Field label="滑点 (%)" hint="成交价相对理论价格的偏移">
          <NumberInput value={pct(value.slippage)} min={0} max={5} step={0.01} onChange={(v) => onChange({ slippage: frac(v) ?? 0 })} />
        </Field>
        <Field label="止损 (%)" hint="相对持仓均价，留空表示不设置">
          <NumberInput
            value={pct(value.stop_loss)}
            min={0.1}
            max={99}
            step={0.5}
            allowEmpty
            placeholder="不设置"
            onChange={(v) => onChange({ stop_loss: v ? frac(v) : null })}
          />
        </Field>
        <Field label="止盈 (%)" hint="相对持仓均价，留空表示不设置">
          <NumberInput
            value={pct(value.take_profit)}
            min={0.1}
            step={0.5}
            allowEmpty
            placeholder="不设置"
            onChange={(v) => onChange({ take_profit: v ? frac(v) : null })}
          />
        </Field>
      </div>
      <Toggle
        checked={value.allow_short && !longOnly}
        onChange={(v) => onChange({ allow_short: v })}
        label={longOnly ? "允许做空（该策略仅做多）" : "允许做空（模拟合约，1 倍）"}
      />
    </>
  );
}
