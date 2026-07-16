"use client";

import { useCallback, useEffect, useState } from "react";

type Holding = {
  code: string;
  name: string;
  bucket: "ANCHOR" | "FUTURE";
  industry: string;
  weight: number;
  price: number;
  dailyReturn: number;
  distribution: {
    skewness: number;
    excessKurtosis: number;
    skewLabel: string;
    kurtosisLabel: string;
    observations: number;
  };
  moat: {
    type: string;
    thesis: string;
    replicationBarrier: string;
    monitoringSignals: string[];
    invalidationSignals: string[];
    status: "DRAFT" | "INTACT" | "WATCH" | "REVIEW_DUE" | "WEAKENED";
    recommendedAction: string;
    lastReviewDate: string;
    nextReviewDate: string;
    supportingEvidenceCount: number;
    cautionEvidenceCount: number;
    contradictoryEvidenceCount: number;
    radar: {
      pendingAlertCount: number;
      highAlertCount: number;
      latestAlertDate: string;
      latestAlertTitle: string;
      latestAlertSource: string;
    };
  };
};

type NavPoint = { date: string; nav: number; dailyReturn: number; priceCoverage: number };
type PortfolioData = {
  asOf: string;
  summary: { anchorWeight: number; futureWeight: number; cashWeight: number };
  moatRadar: {
    asOf: string;
    checkedAt: string;
    announcementStatus: "OK" | "PARTIAL" | "UNAVAILABLE" | "OFFLINE" | "NOT_RUN";
    financialStatus: "OK" | "PARTIAL" | "NOT_RUN";
    pendingAlerts: number;
    highAlerts: number;
    announcementRowsInWindow: number;
    note: string;
  };
  holdings: Holding[];
  navHistory: NavPoint[];
  dividendSummary: {
    cumulativeCash: number;
    reinvestedCash: number;
    pendingCash: number;
    receivableCash: number;
    accountingBasis: string;
  };
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
const moatStatus: Record<Holding["moat"]["status"], { cn: string; en: string }> = {
  DRAFT: { cn: "待原始证据核验", en: "Evidence pending" },
  INTACT: { cn: "护城河仍然稳固", en: "Moat intact" },
  WATCH: { cn: "重点观察", en: "Watch closely" },
  REVIEW_DUE: { cn: "复核已经到期", en: "Review due" },
  WEAKENED: { cn: "护城河已经削弱", en: "Moat weakened" },
};

const personalStartKey = "moat-value-personal-start-date-v1";

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
  const personalBase = history.at(0)?.nav ?? 1;
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
        <div className="chart-tooltip" style={{ left: `clamp(52px, ${active.x / width * 100}%, calc(100% - 52px))`, top: `${active.y / height * 100}%` }}>
          <span>{active.point.date}</span><strong>{signedPct(active.value)}</strong><small>NAV {(active.point.nav / personalBase).toFixed(4)}</small>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [showStartSettings, setShowStartSettings] = useState(false);
  const [personalStartDate, setPersonalStartDate] = useState("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("1Y");
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);

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

  useEffect(() => {
    if (!confirmRefresh && !showStartSettings && !selectedHolding) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmRefresh(false);
        setShowStartSettings(false);
        setSelectedHolding(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmRefresh, showStartSettings, selectedHolding]);

  useEffect(() => {
    if (!data?.navHistory.length) return;
    const firstDate = data.navHistory[0].date;
    const latestDate = data.navHistory.at(-1)!.date;
    const stored = window.localStorage.getItem(personalStartKey);
    const initialDate = stored && stored >= firstDate && stored <= latestDate ? stored : latestDate;
    window.localStorage.setItem(personalStartKey, initialDate);
    setPersonalStartDate(initialDate);
  }, [data]);

  if (!data && !error) return <main className="status"><p>正在读取护城河价值策略…<small>Loading the Moat Value Strategy…</small></p></main>;
  if (!data) return <main className="status"><p>{error}<small>Portfolio data is temporarily unavailable.</small></p><button onClick={load}>重新读取<small>Retry</small></button></main>;

  const latest = data.navHistory.at(-1);
  const personalStart = personalStartDate ? data.navHistory.find((point) => point.date >= personalStartDate) ?? latest : latest;
  const personalHistory = personalStart
    ? data.navHistory.filter((point) => point.date >= personalStart.date)
    : data.navHistory;
  const personalReturn = latest && personalStart ? latest.nav / personalStart.nav - 1 : 0;
  const personalUnitNav = 1 + personalReturn;
  const periods = ranges.map((item) => ({
    ...item,
    value: item.key === "TODAY"
      ? personalHistory.length > 1 ? personalHistory.at(-1)?.dailyReturn ?? 0 : 0
      : trailingReturn(personalHistory, item.days),
  }));
  const rankedHoldings = [...data.holdings].sort((left, right) =>
    right.dailyReturn - left.dailyReturn || right.weight - left.weight || left.code.localeCompare(right.code)
  );

  return (
    <main className="canvas">
      <section className="sheet" aria-label="护城河价值策略总览">
        <header className="topbar">
          <div><p className="kicker">FORWARD BARBELL · {data.asOf}</p><h1>护城河价值策略<small>Moat Value Strategy</small></h1></div>
          <div className="top-actions">
            <span>单位净值 {personalUnitNav.toFixed(4)}<small>Personal Unit NAV</small><small className="dividend-meta">分红 {data.dividendSummary.cumulativeCash.toFixed(4)} · 已复投 {data.dividendSummary.reinvestedCash.toFixed(4)} · 待复投 {(data.dividendSummary.pendingCash + data.dividendSummary.receivableCash).toFixed(4)}<i>Dividends · Reinvested · Pending</i></small></span>
            <button className="start-date-button" onClick={() => { setDraftStartDate(personalStart?.date ?? latest?.date ?? data.asOf); setShowStartSettings(true); }}>
              我的起始日 {personalStart?.date ?? "—"}<small>个人累计 {signedPct(personalReturn)} · Set Start</small>
            </button>
            <button className="text-button" onClick={() => setConfirmRefresh(true)} disabled={refreshing}>{refreshing ? "读取中" : "刷新"}<small>{refreshing ? "Loading" : "Refresh"}</small></button>
          </div>
        </header>

        <div className="period-summary" aria-label="组合周期收益">
          {periods.map((period) => (
            <button key={period.key} className={selectedRange === period.key ? "is-active" : ""} aria-pressed={selectedRange === period.key} onClick={() => setSelectedRange(period.key)}>
              <span>{period.cn}<small>{period.en}</small></span>
              <strong className={period.value == null ? "pending" : period.value >= 0 ? "up" : "down"}>{period.value == null ? "—" : signedPct(period.value)}</strong>
              {period.value != null && <em>点击查看曲线 · View chart</em>}
            </button>
          ))}
        </div>

        <div className="main-grid">
          <section className="chart-section" aria-labelledby="chart-heading">
            <div className="section-heading">
              <div><p className="kicker">PORTFOLIO PERFORMANCE</p><h2 id="chart-heading">组合收益曲线<small>Portfolio Return Curve</small></h2></div>
              <p>{ranges.find((item) => item.key === selectedRange)?.cn}视图<small>{ranges.find((item) => item.key === selectedRange)?.en} view</small></p>
            </div>
            <PerformanceChart history={personalHistory} range={selectedRange} />
            <div className="chart-caption">
              <span><i className="line-key" />含分红单位净值收益 · Total-return unit NAV</span>
              <span>自 {personalStart?.date ?? data.asOf} 按单位1记录 · Unit 1 since {personalStart?.date ?? data.asOf}</span>
            </div>
          </section>

          <aside className="portfolio-panel" aria-labelledby="positions-heading">
            <div><p className="kicker">CURRENT ALLOCATION</p><h2 id="positions-heading">当前仓位<small>Current Positions</small></h2></div>
            <div className="holding-list" role="region" aria-label="按今日收益率排序的当前持仓，可上下滚动" tabIndex={0}>
              <div className="holding-list-head"><span>标的<small>Stock</small></span><div className="holding-values"><em>价格<small>Price</small></em><em>今日↓<small>Today</small></em><strong>仓位<small>Weight</small></strong></div></div>
              {rankedHoldings.map((holding) => (
                <button className="holding-row" key={holding.code} onClick={() => setSelectedHolding(holding)} aria-label={`查看${holding.name}的护城河动态档案`}>
                  <span className="holding-stock"><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><span className="holding-identity"><b>{holding.name}</b><small>{holding.code}</small></span></span>
                  <div className="holding-values"><em>{money(holding.price)}</em><em className={holding.dailyReturn >= 0 ? "holding-up" : "holding-down"}>{signedPct(holding.dailyReturn)}</em><strong>{pct(holding.weight)}</strong></div>
                </button>
              ))}
              <div className="cash-line"><span className="holding-stock"><i className="cash-dot" /><span className="holding-identity"><b>现金</b><small>Cash</small></span></span><div className="holding-values"><em>—</em><em>0</em><strong>{pct(data.summary.cashWeight)}</strong></div></div>
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

      {confirmRefresh && (
        <div className="confirm-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-dialog-title" aria-describedby="refresh-dialog-description">
            <p className="kicker">REFRESH PORTFOLIO DATA</p>
            <h2 id="refresh-dialog-title">确认刷新？<small>Confirm Refresh</small></h2>
            <p id="refresh-dialog-description">刷新只会重新读取最新组合和最近交易日价格，不会清零、不改变起始日期，也不会删除历史收益记录。<small>Refresh only reloads the latest portfolio data. It does not reset or delete history.</small></p>
            <div className="confirm-actions">
              <button className="dialog-button secondary" autoFocus onClick={() => setConfirmRefresh(false)}>取消<small>Cancel</small></button>
              <button className="dialog-button primary" onClick={() => { setConfirmRefresh(false); load(); }}>确认刷新<small>Refresh Now</small></button>
            </div>
          </section>
        </div>
      )}

      {showStartSettings && (
        <div className="confirm-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="start-dialog-title" aria-describedby="start-dialog-description">
            <p className="kicker">PERSONAL START DATE</p>
            <h2 id="start-dialog-title">设置个人起始日<small>Set Personal Start Date</small></h2>
            <p id="start-dialog-description">每位访问者可以从不同日期开始观察。日期只保存在当前浏览器，不改变公共组合历史，也不会影响其他人。<small>Saved only in this browser. The public portfolio history remains unchanged.</small></p>
            <label className="date-field">选择日期<small>Select Date</small><input type="date" min={data.navHistory[0]?.date} max={latest?.date} value={draftStartDate} onChange={(event) => setDraftStartDate(event.target.value)} /></label>
            <p className="dialog-note">若选择非交易日，将从其后的首个已记录交易日开始计算。<small>A non-trading date moves to the next recorded session.</small></p>
            <div className="confirm-actions">
              <button className="dialog-button secondary" autoFocus onClick={() => setShowStartSettings(false)}>取消<small>Cancel</small></button>
              <button className="dialog-button primary" onClick={() => {
                const resolvedDate = data.navHistory.find((point) => point.date >= draftStartDate)?.date ?? latest?.date ?? data.asOf;
                window.localStorage.setItem(personalStartKey, resolvedDate);
                setPersonalStartDate(resolvedDate);
                setShowStartSettings(false);
              }}>保存起始日<small>Save Start Date</small></button>
            </div>
          </section>
        </div>
      )}

      {selectedHolding && (
        <div className="confirm-backdrop" role="presentation">
          <section className="moat-dialog" role="dialog" aria-modal="true" aria-labelledby="moat-dialog-title">
            <div className="moat-dialog-head">
              <div><p className="kicker">DYNAMIC MOAT FILE · {selectedHolding.code}</p><h2 id="moat-dialog-title">{selectedHolding.name}的护城河<small>Dynamic Moat File</small></h2></div>
              <button className="moat-close" aria-label="关闭护城河档案" onClick={() => setSelectedHolding(null)}>×</button>
            </div>
            <div className={`moat-status ${selectedHolding.moat.status.toLowerCase()}`}>
              <span>{moatStatus[selectedHolding.moat.status].cn}<small>{moatStatus[selectedHolding.moat.status].en}</small></span>
              <b>下次复核 {selectedHolding.moat.nextReviewDate}<small>Next review</small></b>
            </div>
            {selectedHolding.moat.radar.pendingAlertCount > 0 ? (
              <div className="moat-radar-alert" role="status">
                <span>发现 {selectedHolding.moat.radar.pendingAlertCount} 条待人工复核事件<small>{selectedHolding.moat.radar.highAlertCount} high-priority · Pending review</small></span>
                <strong>{selectedHolding.moat.radar.latestAlertTitle}<small>{selectedHolding.moat.radar.latestAlertDate} · {selectedHolding.moat.radar.latestAlertSource}</small></strong>
              </div>
            ) : data.moatRadar.announcementStatus === "UNAVAILABLE" || data.moatRadar.announcementStatus === "NOT_RUN" ? (
              <div className="moat-radar-alert unavailable" role="status">
                <span>公告雷达未确认<small>Radar unavailable</small></span>
                <strong>当前不能据此判断“没有风险事件”<small>Missing data is not a clean signal.</small></strong>
              </div>
            ) : (
              <div className="moat-radar-alert clear" role="status">
                <span>本次扫描未发现规则触发事件<small>No rule-triggered event</small></span>
                <strong>这不代表护城河已经得到证明<small>Not proof that the moat is intact.</small></strong>
              </div>
            )}
            <div className="moat-dialog-body">
              <article className="moat-thesis">
                <p className="kicker">MOAT THESIS</p><h3>{selectedHolding.moat.type}</h3><p>{selectedHolding.moat.thesis}</p>
              </article>
              <article><p className="kicker">WHY HARD TO COPY</p><h3>为什么难以复制</h3><p>{selectedHolding.moat.replicationBarrier}</p></article>
              <article><p className="kicker">WHAT TO MONITOR</p><h3>持续观察什么</h3><ul>{selectedHolding.moat.monitoringSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></article>
              <article className="moat-risk"><p className="kicker">INVALIDATION SIGNALS</p><h3>什么变化代表削弱</h3><ul>{selectedHolding.moat.invalidationSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></article>
            </div>
            <div className="moat-action"><span>当前动作<small>Current action</small></span><strong>{selectedHolding.moat.recommendedAction}</strong><em>支持 {selectedHolding.moat.supportingEvidenceCount} · 警示 {selectedHolding.moat.cautionEvidenceCount} · 反证 {selectedHolding.moat.contradictoryEvidenceCount}</em></div>
            <p className="moat-disclaimer">这是可被新证据推翻的当前假设，不是永久标签。<small>A current falsifiable thesis, not a permanent label.</small></p>
          </section>
        </div>
      )}
    </main>
  );
}
