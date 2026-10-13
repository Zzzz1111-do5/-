import { useNavigate } from "react-router-dom";
import { defaultParams } from "../components/forms";
import { Card, Spinner } from "../components/ui";
import { useApp } from "../context";

export default function StrategiesPage() {
  const { meta } = useApp();
  const navigate = useNavigate();
  if (!meta) return <Spinner />;
  const categories = [...new Set(meta.strategies.map((s) => s.category))];
  return (
    <div className="page stack">
      {categories.map((c) => (
        <section key={c} className="stack">
          <h2 className="section-title">{c}</h2>
          <div className="strategy-grid">
            {meta.strategies
              .filter((s) => s.category === c)
              .map((s) => (
                <Card key={s.id} title={s.name} extra={s.long_only ? <span className="badge">仅做多</span> : <span className="badge">多空</span>}>
                  <p className="strategy-desc">{s.description}</p>
                  {s.params.length > 0 && (
                    <ul className="param-list">
                      {s.params.map((p) => (
                        <li key={p.name}>
                          <span>{p.label}</span>
                          <span className="mono muted">
                            {p.name} = {p.default}
                            <span className="small"> （{p.min} ~ {p.max}）</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row gap wrap">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate("/backtest", { state: { settings: { strategy: s.id, params: defaultParams(s) } } })}
                    >
                      回测
                    </button>
                    {s.params.length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate("/optimize", { state: { settings: { strategy: s.id, params: defaultParams(s) } } })}
                      >
                        参数优化
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate("/bots", { state: { create: true, settings: { strategy: s.id, params: defaultParams(s) } } })}
                    >
                      模拟交易
                    </button>
                  </div>
                </Card>
              ))}
          </div>
        </section>
      ))}
      <Card title="风险提示">
        <ul className="risk-list">
          <li>本平台仅用于量化策略的学习与研究，所有交易均为模拟，不构成任何投资建议。</li>
          <li>历史回测表现不代表未来收益；参数优化容易过拟合，请务必结合样本外验证。</li>
          <li>虚拟货币价格波动剧烈，真实交易还需考虑流动性、资金费率、交易所风险与合规要求。</li>
        </ul>
      </Card>
    </div>
  );
}
