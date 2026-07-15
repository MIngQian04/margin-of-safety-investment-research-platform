"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Holding = {
  code: string;
  name: string;
  bucket: "ANCHOR" | "FUTURE";
  theme: string;
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
  generatedAt: string;
  summary: { anchorWeight: number; futureWeight: number; cashWeight: number };
  holdings: Holding[];
  navHistory: NavPoint[];
  distributionSummary: Holding["distribution"] & {
    periodStart: string;
    periodEnd: string;
    method: string;
  };
};
type Lot = { date: string; entryNav: number };

const STORAGE_KEY = "ming-portfolio-units-v1";
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${pct(value, 2)}`;
const money = (value: number) => `¥${value.toFixed(2)}`;
const decimal = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const industryEnglish: Record<string, string> = {
  "家用电器": "Home Appliances", "食品饮料": "Food & Beverage", "机械设备": "Machinery",
  "纺织服饰": "Textiles & Apparel", "通信": "Telecom", "电力设备": "Power Equipment",
  "未分类": "Unclassified",
};
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

function NavChart({ history }: { history: NavPoint[] }) {
  const points = history.slice(-252);
  const width = 320;
  const top = 10;
  const bottom = 78;
  const values = points.map((point) => point.nav);
  const rawMin = Math.min(...values, 1);
  const rawMax = Math.max(...values, 1);
  const padding = Math.max((rawMax - rawMin) * 0.15, 0.002);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) => points.length <= 1 ? width / 2 : 8 + index * (width - 16) / (points.length - 1);
  const y = (value: number) => top + (max - value) * (bottom - top) / (max - min);
  const coordinates = points.map((point, index) => ({ x: x(index), y: y(point.nav), point }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = coordinates.length > 1 ? `${line} L${coordinates.at(-1)!.x.toFixed(1)},${bottom} L${coordinates[0].x.toFixed(1)},${bottom} Z` : "";
  const latest = coordinates.at(-1);

  return (
    <div className="nav-chart">
      <svg viewBox={`0 0 ${width} 102`} role="img" aria-labelledby="nav-chart-title nav-chart-desc">
        <title id="nav-chart-title">每日组合单位净值曲线 / Daily portfolio NAV</title>
        <desc id="nav-chart-desc">从开始记录日起，每个完成交易日追加一个组合单位净值。</desc>
        {[top, (top + bottom) / 2, bottom].map((gridY) => <line className="chart-grid" key={gridY} x1="8" x2={width - 8} y1={gridY} y2={gridY} />)}
        {area && <path className="chart-area" d={area} />}
        {line && <path className="chart-line" d={line} />}
        {latest && <circle className="chart-point" cx={latest.x} cy={latest.y} r="3.5" />}
        <text className="chart-value" x={Math.min(latest?.x ?? 8, width - 40)} y={Math.max((latest?.y ?? top) - 7, 8)}>{latest?.point.nav.toFixed(4) ?? "—"}</text>
        <text className="chart-date" x="8" y="96">{points.at(0)?.date.slice(5) ?? "—"}</text>
        <text className="chart-date chart-date-end" x={width - 8} y="96">{points.at(-1)?.date.slice(5) ?? "—"}</text>
      </svg>
      {points.length < 2 && <p className="chart-building">正在积累每日记录 · Building daily history</p>}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    load();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setLots(JSON.parse(saved));
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, [load]);

  const saveLots = (next: Lot[]) => {
    setLots(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const latest = data?.navHistory.at(-1);
  const currentNav = latest?.nav ?? 1;
  const totalValue = useMemo(
    () => lots.reduce((sum, lot) => sum + currentNav / lot.entryNav, 0),
    [lots, currentNav],
  );
  const personalReturn = lots.length ? totalValue / lots.length - 1 : 0;
  const firstDate = lots.at(0)?.date;

  if (!data && !error) return <main className="status"><p>正在读取今日组合…<small>Loading today&apos;s portfolio…</small></p></main>;
  if (!data) return <main className="status"><p>{error}<small>Portfolio data is temporarily unavailable.</small></p><button onClick={load}>重新读取<small>Retry</small></button></main>;

  const history = data.navHistory.slice(-7);
  const periods = [
    { cn: "今日", en: "Today", value: latest?.dailyReturn ?? 0 },
    { cn: "5日", en: "5 Days", value: trailingReturn(data.navHistory, 5) },
    { cn: "1个月", en: "1 Month", value: trailingReturn(data.navHistory, 22) },
    { cn: "6个月", en: "6 Months", value: trailingReturn(data.navHistory, 126) },
    { cn: "1年", en: "1 Year", value: trailingReturn(data.navHistory, 252) },
  ];

  return (
    <main className="canvas">
      <section className="sheet" aria-label="今日组合总览">
        <header className="topbar">
          <div>
            <p className="kicker">FORWARD BARBELL · {data.asOf}</p>
            <h1>今日组合<small className="title-en">Today&apos;s Portfolio</small></h1>
          </div>
          <div className="top-actions">
            <span>最近完成交易日收盘价<small>Latest completed-session close</small></span>
            <button className="text-button" onClick={load} disabled={refreshing}>{refreshing ? "读取中" : "刷新"}<small>{refreshing ? "Loading" : "Refresh"}</small></button>
          </div>
        </header>

        <div className="summary-grid">
          <article>
            <span>组合单位净值<small>Portfolio Unit NAV</small></span>
            <strong>{currentNav.toFixed(4)}</strong>
            <small>起始价格 1.0000 · Base 1.0000</small>
          </article>
          <article>
            <span>今日涨跌<small>Daily Return</small></span>
            <strong className={(latest?.dailyReturn ?? 0) >= 0 ? "up" : "down"}>{signedPct(latest?.dailyReturn ?? 0)}</strong>
            <small>按上一交易日仓位计算 · Prior weights</small>
          </article>
          <article>
            <span>我的累计收益<small>My Cumulative Return</small></span>
            <strong className={personalReturn >= 0 ? "up" : "down"}>{lots.length ? signedPct(personalReturn) : "—"}</strong>
            <small>{firstDate ? `从 ${firstDate} 开始 · Since ${firstDate}` : "投入1单位后开始记录 · Starts after +1 unit"}</small>
          </article>
          <article>
            <span>我的组合总价值<small>My Portfolio Value</small></span>
            <strong>{lots.length ? totalValue.toFixed(4) : "0.0000"}</strong>
            <small>{lots.length} 个累计单位 · Accumulated units</small>
          </article>
        </div>

        <div className="content-grid">
          <section className="positions" aria-labelledby="positions-title">
            <div className="panel-title">
              <div><p className="kicker">TARGET POSITIONS</p><h2 id="positions-title">买入价与仓位<small className="heading-en">Price & Allocation</small></h2></div>
              <div className="allocation-tags">
                <span className="anchor-tag">锚仓 {pct(data.summary.anchorWeight, 0)}<small>Anchor</small></span>
                <span className="future-tag">期权 {pct(data.summary.futureWeight)}<small>Option</small></span>
                <span className="cash-tag">现金 {pct(data.summary.cashWeight)}<small>Cash</small></span>
              </div>
            </div>
            <div className="positions-table" role="table" aria-label="目标持仓表">
              <div className="table-head" role="row"><span>股票 / 申万行业<small>Stock / SW Industry</small></span><span>参考价<small>Price</small></span><span>仓位<small>Weight</small></span><span>偏度<small>Skew</small></span><span>方向特征<small>Direction</small></span><span>峰度<small>Kurtosis</small></span><span>尾部特征<small>Tail Type</small></span><span>每1单位<small>Per Unit</small></span></div>
              {data.holdings.map((holding) => (
                <div className="stock-row" role="row" key={holding.code}>
                  <span className="stock-name"><b>{holding.name}</b><small>{holding.code} · {holding.industry} / {industryEnglish[holding.industry] ?? holding.industry} · <i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} />{holding.bucket === "ANCHOR" ? "稳定锚 / Stable Anchor" : "未来期权 / Future Option"}</small></span>
                  <span className="price">{money(holding.price)}</span>
                  <strong>{pct(holding.weight)}</strong>
                  <span>{decimal(holding.distribution.skewness)}</span>
                  <span className="distribution-label">{holding.distribution.skewLabel}<small>{distributionEnglish[holding.distribution.skewLabel]}</small></span>
                  <span>{decimal(holding.distribution.excessKurtosis)}</span>
                  <span className="distribution-label">{holding.distribution.kurtosisLabel}<small>{distributionEnglish[holding.distribution.kurtosisLabel]}</small></span>
                  <span className="unit-allocation">{holding.weight.toFixed(4)}</span>
                </div>
              ))}
              <div className="stock-row cash-row" role="row">
                <span className="stock-name"><b>现金</b><small>CASH · <i className="cash-dot" />选择权 / Optionality</small></span>
                <span className="price">—</span><strong>{pct(data.summary.cashWeight)}</strong><span>—</span><span>—</span><span>—</span><span>—</span><span className="unit-allocation">{data.summary.cashWeight.toFixed(4)}</span>
              </div>
            </div>
            <p className="risk-method">近 {data.distributionSummary.observations} 个共同交易日 · 偏度看尾部方向，峰度观察极端行情频率<br />Latest {data.distributionSummary.observations} common sessions · Skew shows tail direction; excess kurtosis shows extreme-move frequency</p>
          </section>

          <aside className="unit-panel" aria-labelledby="unit-title">
            <p className="kicker">DAILY PERFORMANCE</p>
            <h2 id="unit-title">每日收益记录<small className="heading-en">Daily Performance Record</small></h2>
            <NavChart history={data.navHistory} />
            <div className="period-grid" aria-label="不同周期组合收益">
              {periods.map((period) => (
                <div key={period.en}>
                  <span>{period.cn}<small>{period.en}</small></span>
                  <b className={period.value == null ? "pending" : period.value >= 0 ? "up" : "down"}>{period.value == null ? "—" : signedPct(period.value)}</b>
                </div>
              ))}
            </div>
            <div className="unit-composition" aria-label="每单位组成">
              <div><span><i className="anchor-dot" />稳定锚仓<small>Stable Anchor</small></span><b>{data.summary.anchorWeight.toFixed(4)}</b></div>
              <div><span><i className="future-dot" />未来期权<small>Future Option</small></span><b>{data.summary.futureWeight.toFixed(4)}</b></div>
              <div><span><i className="cash-dot" />现金<small>Cash</small></span><b>{data.summary.cashWeight.toFixed(4)}</b></div>
            </div>
            <div className="unit-number"><strong>{lots.length}</strong><span>累计单位 · 单位1，慢慢积累<small>Accumulated units · Build gradually</small></span></div>
            <div className="unit-buttons">
              <button className="primary-button" onClick={() => saveLots([...lots, { date: data.asOf, entryNav: currentNav }])}>+ 投入 1 单位<small>+ Add 1 Unit</small></button>
              <button className="secondary-button" onClick={() => saveLots(lots.slice(0, -1))} disabled={!lots.length}>撤回上一单位<small>Undo Last Unit</small></button>
            </div>
            <button className="reset-button" onClick={() => { if (!lots.length || window.confirm("清零后将从单位0重新开始，确定吗？")) saveLots([]); }}>清零，重新开始<small>Reset & Restart</small></button>
            <p className="unit-note">1单位是归一化记账单位，不代表1元，也不自动下单。参考价为最近收盘价。<br />A unit is normalized bookkeeping, not ¥1 or an automatic order. Prices are latest closes.</p>
          </aside>
        </div>

        <footer className="history-bar">
          <div><p className="kicker">DAILY RECORD</p><h2>组合价格记录<small className="heading-en">Portfolio Price Log</small></h2></div>
          <div className="history-points">
            {history.map((point) => (
              <div key={point.date}><span>{point.date.slice(5)}</span><strong>{point.nav.toFixed(4)}</strong><small className={point.dailyReturn >= 0 ? "up" : "down"}>{signedPct(point.dailyReturn)}</small></div>
            ))}
          </div>
          <p className="disclaimer">系统每个交易日自动追加；研究用途，不构成投资建议。<br />Appended each trading day. Research only, not investment advice.</p>
        </footer>
      </section>
    </main>
  );
}
