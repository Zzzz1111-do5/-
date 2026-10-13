import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBox } from "./components/ui";
import { useApp } from "./context";
import BacktestPage from "./pages/BacktestPage";
import BotDetailPage from "./pages/BotDetailPage";
import BotsPage from "./pages/BotsPage";
import MarketPage from "./pages/MarketPage";
import OptimizePage from "./pages/OptimizePage";
import StrategiesPage from "./pages/StrategiesPage";

const NAV = [
  { to: "/market", label: "行情中心", icon: "M3 17l5-6 4 4 8-10" },
  { to: "/backtest", label: "策略回测", icon: "M4 19h16M6 15l4-4 3 3 5-6" },
  { to: "/optimize", label: "参数优化", icon: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" },
  { to: "/bots", label: "模拟交易", icon: "M12 3v3M6 9h12v10H6zM9 13h.01M15 13h.01M10 16h4" },
  { to: "/strategies", label: "策略库", icon: "M5 4h10l4 4v12H5zM9 12h6M9 16h6" },
];

const TITLES: Record<string, string> = {
  "/market": "行情中心",
  "/backtest": "策略回测",
  "/optimize": "参数优化",
  "/bots": "模拟交易",
  "/strategies": "策略库",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function App() {
  const { meta, metaError, source, setSource, colorScheme, setColorScheme, reloadMeta } = useApp();
  const location = useLocation();
  const title = TITLES["/" + location.pathname.split("/")[1]] ?? "";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden>
            <rect width="64" height="64" rx="14" fill="#1e2329" />
            <path d="M14 44l10-12 8 7 18-21" fill="none" stroke="#f0b90b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            Coin<b>Quant</b>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon d={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot muted small">仅供学习研究 · 不构成投资建议</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="topbar-actions">
            <label className="topbar-select">
              <span className="muted small">行情源</span>
              <select className="input input-sm" value={source} onChange={(e) => setSource(e.target.value)} disabled={!meta}>
                {meta?.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-ghost btn-sm"
              title="切换涨跌颜色"
              onClick={() => setColorScheme(colorScheme === "green-up" ? "red-up" : "green-up")}
            >
              {colorScheme === "green-up" ? (
                <>
                  <span className="up">绿涨</span>
                  <span className="down">红跌</span>
                </>
              ) : (
                <>
                  <span className="up">红涨</span>
                  <span className="down">绿跌</span>
                </>
              )}
            </button>
          </div>
        </header>
        <main className="content">
          {metaError && <ErrorBox error={`无法加载平台配置：${metaError}`} onRetry={reloadMeta} />}
          <Routes>
            <Route path="/" element={<Navigate to="/market" replace />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/optimize" element={<OptimizePage />} />
            <Route path="/bots" element={<BotsPage />} />
            <Route path="/bots/:id" element={<BotDetailPage />} />
            <Route path="/strategies" element={<StrategiesPage />} />
            <Route path="*" element={<Navigate to="/market" replace />} />
          </Routes>
        </main>
        <footer className="app-footer muted small">
          <span>CoinQuant · 所有交易均为模拟，仅供学习研究，不构成投资建议</span>
          <span>
            图表由{" "}
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              TradingView Lightweight Charts™
            </a>{" "}
            提供
          </span>
        </footer>
      </div>
    </div>
  );
}
