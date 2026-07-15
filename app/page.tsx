"use client";

import { useCallback, useEffect, useState } from "react";

type Holding = {
  code: string;
  name: string;
  bucket: "ANCHOR" | "FUTURE";
  industry: string;
  weight: number;
  price: number;
  distribution: {
    skewness: number;
    excessKurtosis: number;
    skewLabel: string;
    kurtosisLabel: string;
    observations: number;
  };
};

type NavPoint = { date: string; nav: number; dailyReturn: number; priceCoverage: number };
type PortfolioData = {
  asOf: string;
  summary: { anchorWeight: number; futureWeight: number; cashWeight: number };
  holdings: Holding[];
  navHistory: NavPoint[];
  distributionSummary: Holding["distribution"] & {
    periodStart: string;
    periodEnd: string;
    method: string;
  };
};

type RangeKey = "TODAY" | "5D" | "1M" | "6M" | "1Y";
const ranges: { key: RangeKey; cn: string; en: string; days: number }[] = [
  { key: "TODAY", cn: "今日", en: "Today", days: 1 },
  { key: "5D", cn: "5日", en: "5 Days", days: 5 },
  { key: "1M", cn: "1个月", en: "1 Month", days: 22 },
  { key: "6M", cn: "6个月", en: "6 Months", days: 126 },
  { key: "1Y", cn: "1年", en: "1 Year", days: 252 },
];

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${pct(value, 2)}`;
const decimal = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "—";
const money = (value: number) => `¥${value.toFixed(2)}`;
const distributionEnglish: Record<string, string> = {
  "右尾机会型": "Right-tail opportunity", "左尾风险型": "Left-tail risk",
  "近对称分布": "Near-symmetric", "高厚尾跳跃型": "High fat-tail jumps",
  "厚尾波动型": "Fat-tail volatility", "平尾均衡型": "Thin-tail balance",
  "常态尾部": "Normal tails", "数据不足": "Insufficient data",
};

function trailingReturn(history: NavPoint[], tradingDays: number) {
  if (history.length <= tradingDays) return null;
  return history.at(-1)!.nav / history.at(-1 - tradingDays)!.nav - 1;
}

function PerformanceChart({ history, range }: { history: NavPoint[]; range: RangeKey }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const rangeDays = ranges.find((item) => item.key === range)!.days;
  const needed = range === "TODAY" ? 2 : rangeDays + 1;
  const points = history.slice(-needed);
  const width = 900;
  const height = 330;
  const left = 62;
  const right = 24;
  const top = 24;
  const bottom = 274;
  const base = points.at(0)?.nav ?? 1;
  const returns = points.map((point) => point.nav / base - 1);
  const rawMin = Math.min(...returns, 0);
  const rawMax = Math.max(...returns, 0);
  const pad = Math.max((rawMax - rawMin) * 0.16, 0.0015);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const x = (index: number) => points.length <= 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (points.length - 1);
  const y = (value: number) => top + (max - value) * (bottom - top) / (max - min);
  const coordinates = points.map((point, index) => ({ x: x(index), y: y(returns[index]), point, value: returns[index] }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = coordinates.length > 1 ? `${line} L${coordinates.at(-1)!.x.toFixed(1)},${y(0).toFixed(1)} L${coordinates[0].x.toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const activeIndex = hovered ?? Math.max(coordinates.length - 1, 0);
  const active = coordinates[activeIndex];
  const yTicks = [max, (max + min) / 2, min];

  return (
    <div className="performance-chart" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="performance-chart-title performance-chart-desc">
        <title id="performance-chart-title">组合收益曲线 / Portfolio return curve</title>
        <desc id="performance-chart-desc">根据已记录的每日组合单位净值绘制，可用上方周期按钮切换观察区间。</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text className="axis-label" x={left - 10} y={y(tick) + 4}>{signedPct(tick)}</text>
          </g>
        ))}
        <line className="chart-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {area && <path className="chart-area" d={area} />}
        {line && <path className="chart-line" d={line} />}
        {coordinates.map((point, index) => (
          <circle key={point.point.date} className="chart-hit" cx={point.x} cy={point.y} r="13" onMouseEnter={() => setHovered(index)} onTouchStart={() => setHovered(index)} />
        ))}
        {active && <circle className="chart-point" cx={active.x} cy={active.y} r="5" />}
        <text className="axis-label axis-start" x={left} y={height - 18}>{points.at(0)?.date ?? "—"}</text>
        <text className="axis-label axis-end" x={width - right} y={height - 18}>{points.at(-1)?.date ?? "—"}</text>
      </svg>
      {active && (
        <div className="chart-tooltip" style={{ left: `${active.x / width * 100}%`, top: `${active.y / height * 100}%` }}>
          <span>{active.point.date}</span><strong>{signedPct(active.value)}</strong><small>NAV {active.point.nav.toFixed(4)}</small>
        </div>
      )}
      {points.length < needed && <p className="chart-building">正在积累该周期记录 · Building this range</p>}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRange, setSelectedRange] = useState<RangeKey>("1Y");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/data/portfolio.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("组合数据暂时不可用");
      setData(await response.json());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "组合数据暂时不可用");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data && !error) return <main className="status"><p>正在读取护城河价值策略…<small>Loading the Moat Value Strategy…</small></p></main>;
  if (!data) return <main className="status"><p>{error}<small>Portfolio data is temporarily unavailable.</small></p><button onClick={load}>重新读取<small>Retry</small></button></main>;

  const latest = data.navHistory.at(-1);
  const periods = ranges.map((item) => ({
    ...item,
    value: item.key === "TODAY" ? latest?.dailyReturn ?? 0 : trailingReturn(data.navHistory, item.days),
  }));

  return (
    <main className="canvas">
      <section className="sheet" aria-label="护城河价值策略总览">
        <header className="topbar">
          <div><p className="kicker">FORWARD BARBELL · {data.asOf}</p><h1>护城河价值策略<small>Moat Value Strategy</small></h1></div>
          <div className="top-actions">
            <span>单位净值 {latest?.nav.toFixed(4) ?? "1.0000"}<small>Portfolio Unit NAV</small></span>
            <button className="text-button" onClick={load} disabled={refreshing}>{refreshing ? "读取中" : "刷新"}<small>{refreshing ? "Loading" : "Refresh"}</small></button>
          </div>
        </header>

        <div className="period-summary" aria-label="组合周期收益">
          {periods.map((period) => (
            <button key={period.key} className={selectedRange === period.key ? "is-active" : ""} aria-pressed={selectedRange === period.key} onClick={() => setSelectedRange(period.key)}>
              <span>{period.cn}<small>{period.en}</small></span>
              <strong className={period.value == null ? "pending" : period.value >= 0 ? "up" : "down"}>{period.value == null ? "—" : signedPct(period.value)}</strong>
              <em>{period.value == null ? "记录积累中 · Building" : "点击查看曲线 · View chart"}</em>
            </button>
          ))}
        </div>

        <div className="main-grid">
          <section className="chart-section" aria-labelledby="chart-heading">
            <div className="section-heading">
              <div><p className="kicker">PORTFOLIO PERFORMANCE</p><h2 id="chart-heading">组合收益曲线<small>Portfolio Return Curve</small></h2></div>
              <p>{ranges.find((item) => item.key === selectedRange)?.cn}视图<small>{ranges.find((item) => item.key === selectedRange)?.en} view</small></p>
            </div>
            <PerformanceChart history={data.navHistory} range={selectedRange} />
            <div className="chart-caption">
              <span><i className="line-key" />每日单位净值收益 · Daily unit-NAV return</span>
              <span>自 {data.navHistory.at(0)?.date ?? data.asOf} 开始真实记录 · Live record since {data.navHistory.at(0)?.date ?? data.asOf}</span>
            </div>
          </section>

          <aside className="portfolio-panel" aria-labelledby="positions-heading">
            <div><p className="kicker">CURRENT ALLOCATION</p><h2 id="positions-heading">当前仓位<small>Current Positions</small></h2></div>
            <div className="holding-list">
              <div className="holding-list-head"><span>标的<small>Stock</small></span><span>价格 / 仓位<small>Price / Weight</small></span></div>
              {data.holdings.map((holding) => (
                <div key={holding.code}>
                  <span><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><b>{holding.name}</b><small>{holding.code}</small></span>
                  <div className="holding-values"><em>{money(holding.price)}</em><strong>{pct(holding.weight)}</strong></div>
                </div>
              ))}
              <div className="cash-line"><span><i className="cash-dot" /><b>现金</b><small>Cash</small></span><div className="holding-values"><em>—</em><strong>{pct(data.summary.cashWeight)}</strong></div></div>
            </div>

            <div className="portfolio-distribution">
              <p className="kicker">PORTFOLIO DISTRIBUTION</p>
              <div><span>偏度判断<small>Skewness</small></span><strong>{data.distributionSummary.skewLabel}</strong><b>{decimal(data.distributionSummary.skewness)}</b><em>{distributionEnglish[data.distributionSummary.skewLabel]}</em></div>
              <div><span>峰度判断<small>Kurtosis</small></span><strong>{data.distributionSummary.kurtosisLabel}</strong><b>{decimal(data.distributionSummary.excessKurtosis)}</b><em>{distributionEnglish[data.distributionSummary.kurtosisLabel]}</em></div>
            </div>
          </aside>
        </div>

        <footer>
          <span>系统每个交易日自动追加 · Updated each trading day</span>
          <span>研究用途，不构成投资建议 · Research only, not investment advice</span>
        </footer>
      </section>
    </main>
  );
}
