"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Holding = {
  code: string;
  name: string;
  bucket: "ANCHOR" | "FUTURE";
  industry: string;
  weight: number;
  price: number;
  dailyReturn: number;
  reason?: string;
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
type ExecutionRecord = { quantity: number; averagePrice: number; fee: number; modelOpenPrice: number };
type PortfolioData = {
  asOf: string;
  activeAsOf: string;
  distributionAsOf: string;
  returnDate: string;
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
  nextHoldings: Holding[];
  allocationChange: {
    changed: boolean;
    activeAsOf: string;
    nextAsOf: string;
    effectiveLabel: string;
    changes: { code: string; name: string; oldWeight: number; newWeight: number; changeType: string; reason: string }[];
  };
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
type Language = "zh" | "en";
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
const languageKey = "moat-value-language-v1";
const executionLedgerKey = "moat-value-execution-ledger-v1";
const allocationChangeAckKey = "moat-value-allocation-change-ack-v1";
const companyEnglish: Record<string, string> = {
  "600519.SH": "Kweichow Moutai", "300760.SZ": "Mindray", "300628.SZ": "Yealink",
  "000786.SZ": "BNBM", "002032.SZ": "Supor", "603195.SH": "Bull Group", "000651.SZ": "Gree Electric",
  "600941.SH": "China Mobile", "000400.SZ": "Xuji Electric", "600312.SH": "Pinggao Electric",
};
type MoatCopy = { type: string; thesis: string; barrier: string; monitor: string[]; invalidate: string[]; action: string };
const moatEnglish: Record<string, MoatCopy> = {
  "600519.SH": {
    type: "Scarce origin and brand mindshare",
    thesis: "A unique production region and ageing ecosystem constrain supply, while long-built brand recognition and social-consumption status support pricing power.",
    barrier: "The local ecology and years of base-liquor ageing cannot be accelerated. Premium social consensus takes decades to establish.",
    monitor: ["Direct sales and wholesale price", "Premium-market share", "Price per tonne and gross margin", "Recognition among younger consumers"],
    invalidate: ["Persistent wholesale-price inversion", "Sustained erosion of brand premium", "Core consumers migrate", "Channel inventory keeps worsening"],
    action: "Hold while valuation retains a margin of safety; stop adding and reduce in stages if pricing power or channel health is disproved.",
  },
  "300760.SZ": {
    type: "Installed base and medical-platform synergy",
    thesis: "Hospital installations, a broad product platform and local service networks may create workflow stickiness and cross-selling advantages.",
    barrier: "Medical-device validation, service coverage, multi-product R&D and hospital habits require years to build.",
    monitor: ["High-end product penetration", "Quality of overseas revenue", "Installations and repeat purchases", "R&D efficiency", "Gross margin"],
    invalidate: ["Hospitals shift materially to rivals", "High-end progress stalls", "Price competition persistently erodes margin", "Overseas compliance is blocked"],
    action: "Hold only while moat evidence and reasonable valuation coexist; stop adding and reduce in stages if installed-base stickiness weakens.",
  },
  "300628.SZ": {
    type: "Specialist channels and R&D efficiency",
    thesis: "Specialist enterprise-communications channels, rapid product iteration and efficient R&D may sustain a niche-market advantage.",
    barrier: "Global channel relationships, protocol compatibility, reliability and enterprise certification take time to accumulate.",
    monitor: ["Channel coverage", "New-product revenue", "Overseas share", "R&D productivity", "Gross margin"],
    invalidate: ["Channel losses", "Platform vendors replace terminals", "Repeated product failures", "Materially stronger price competition"],
    action: "Hold after primary evidence validates channel and product advantages; pause additions and reduce if either deteriorates.",
  },
  "000786.SZ": {
    type: "Scale cost and channel standards",
    thesis: "A distributed gypsum-board footprint, channel coverage and brand standards may create local delivery and cost advantages.",
    barrier: "The asset network, raw-material coordination, regional logistics and project channels are difficult to reproduce quickly.",
    monitor: ["Regional share", "Unit cost", "Capacity utilisation", "Cash conversion", "Waterproofing integration"],
    invalidate: ["New capacity starts a price war", "Channel share falls", "Cost advantage disappears", "Acquisitions drain cash for years"],
    action: "Hold while scale-cost evidence and valuation remain sound; stop adding and reduce if cost or channel advantages are disproved.",
  },
  "002032.SZ": {
    type: "Brand, channels and product system",
    thesis: "Cookware and appliance mindshare, broad channels and SEB-linked product development may support stable category share.",
    barrier: "Brand trust, omni-channel reach, supply-chain scale and product development require sustained investment.",
    monitor: ["Category share", "New-product success", "Channel efficiency", "Related-party transaction quality", "Gross margin"],
    invalidate: ["Brand ageing", "Core-category share declines", "New products stay weak", "Channel expense erodes profit"],
    action: "Hold while brand and channel evidence persists; stop adding and reduce if mindshare or channel efficiency keeps declining.",
  },
  "603195.SH": {
    type: "Brand mindshare and channel network",
    thesis: "Brand recognition in consumer electrical products, broad distribution and a quality reputation may support repeat choice and stable category share.",
    barrier: "Trust in safety and reliability, retail-channel coverage, product certification and quality systems take sustained investment and time to build.",
    monitor: ["Core-category share", "Channel coverage and efficiency", "New-category expansion quality", "Gross margin", "Operating cash flow and inventory turns"],
    invalidate: ["Brand premium keeps narrowing", "Channel coverage or efficiency falls materially", "New categories stay loss-making or drain cash", "Quality or safety events damage trust"],
    action: "Hold only after primary evidence verifies brand and channel advantages; stop adding and reduce in stages if either is disproved.",
  },
  "000651.SZ": {
    type: "Air-conditioner brand and supply-chain scale",
    thesis: "Strong air-conditioner mindshare, manufacturing scale and service coverage may support quality and cost advantages.",
    barrier: "Core-component capability, dealer service, quality reputation and purchasing scale require long accumulation.",
    monitor: ["Air-conditioner share", "Channel inventory", "Installation-service quality", "Returns from diversification", "Cash conversion"],
    invalidate: ["Channel reform fails", "Share declines persistently", "Brand mindshare ages", "Diversification keeps consuming capital"],
    action: "Hold while the core franchise and capital allocation remain sound; pause additions and reduce if share and channel advantages deteriorate.",
  },
  "600941.SH": {
    type: "Licences, networks and scale effects",
    thesis: "Scarce spectrum, a nationwide network, customer scale and cloud-network integration may create barriers in a high-fixed-cost industry.",
    barrier: "Regulatory licences, spectrum, capital investment and customer coverage cannot be replicated quickly by a new entrant.",
    monitor: ["Mobile-customer quality", "ARPU", "Cloud cash returns", "Capital-spending efficiency", "Free cash flow"],
    invalidate: ["Regulation changes return economics", "ARPU keeps falling", "Cloud grows without profit", "Capital spending remains uncontrolled"],
    action: "Keep as a future-industry seed while waiting for profit-pool evidence; return to research-only or exit if evidence worsens.",
  },
  "000400.SZ": {
    type: "Grid certification and project experience",
    thesis: "Qualifications, long project records and system-integration experience may form an access barrier for critical grid equipment.",
    barrier: "Safety validation, utility certification, delivery experience and legacy-system compatibility take years.",
    monitor: ["Grid-related revenue", "Tender share", "Contract liabilities", "Gross margin", "Operating cash flow"],
    invalidate: ["Grid revenue keeps falling", "Tender share is lost", "Receivables and cash flow worsen", "Technology route is displaced"],
    action: "Keep the 2.5% seed while waiting for revenue and cash flow to confirm together; exit the seed if unresolved risks expand.",
  },
  "600312.SH": {
    type: "High-voltage certification and reliability",
    thesis: "High-voltage equipment certification, operating reliability and UHV project experience may create project-access advantages.",
    barrier: "Long operating validation, grid-customer certification and large-project delivery records cannot be built quickly.",
    monitor: ["High-voltage revenue", "Tenders and contract liabilities", "Gross margin", "Operating cash flow", "Receivables turnover"],
    invalidate: ["Orders fail to convert into cash", "Operating cash flow keeps falling", "Tender share declines", "Substitute technology changes demand"],
    action: "Keep the 2.5% seed while waiting for orders and cash flow to recover; exit if either evidence stream weakens further.",
  },
};

function englishAlert(title: string) {
  return title
    .replace("归母净利润同比", "Attributable net profit YoY ")
    .replace("经营现金流同比", "Operating cash flow YoY ")
    .replace("收入同比", "Revenue YoY ")
    .replace("，达到复核阈值", "; review threshold reached");
}

function trailingReturn(history: NavPoint[], tradingDays: number) {
  if (history.length <= tradingDays) return null;
  return history.at(-1)!.nav / history.at(-1 - tradingDays)!.nav - 1;
}

function PerformanceChart({ history, range, language }: { history: NavPoint[]; range: RangeKey; language: Language }) {
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
        <title id="performance-chart-title">{language === "zh" ? "组合收益曲线" : "Portfolio return curve"}</title>
        <desc id="performance-chart-desc">{language === "zh" ? "根据已记录的每日组合单位净值绘制，可用上方周期按钮切换观察区间。" : "Recorded daily portfolio NAV; use the period controls above to change the visible range."}</desc>
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
  const [showHoldingsDialog, setShowHoldingsDialog] = useState(false);
  const [holdingsDialogBoard, setHoldingsDialogBoard] = useState<"active" | "next">("active");
  const [language, setLanguage] = useState<Language>("zh");
  const [showExecutionLedger, setShowExecutionLedger] = useState(false);
  const [showAllocationChanges, setShowAllocationChanges] = useState(false);
  const [allocationBoard, setAllocationBoard] = useState(0);
  const allocationCarouselRef = useRef<HTMLDivElement>(null);
  const [accountCapital, setAccountCapital] = useState(100000);
  const [executionRecords, setExecutionRecords] = useState<Record<string, ExecutionRecord>>({});
  const [executionLoaded, setExecutionLoaded] = useState(false);

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
    const stored = window.localStorage.getItem(languageKey);
    if (stored === "en") setLanguage("en");
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(executionLedgerKey) ?? "{}");
      if (Number.isFinite(stored.capital) && stored.capital > 0) setAccountCapital(stored.capital);
      if (stored.records && typeof stored.records === "object") setExecutionRecords(stored.records);
    } catch { /* Start with an empty browser-local execution ledger. */ }
    setExecutionLoaded(true);
  }, []);

  useEffect(() => {
    if (executionLoaded) window.localStorage.setItem(executionLedgerKey, JSON.stringify({ capital: accountCapital, records: executionRecords }));
  }, [accountCapital, executionLoaded, executionRecords]);

  useEffect(() => {
    window.localStorage.setItem(languageKey, language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    if (!confirmRefresh && !showStartSettings && !selectedHolding && !showHoldingsDialog && !showExecutionLedger && !showAllocationChanges) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmRefresh(false);
        setShowStartSettings(false);
        setSelectedHolding(null);
        setShowHoldingsDialog(false);
        setShowExecutionLedger(false);
        setShowAllocationChanges(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmRefresh, showStartSettings, selectedHolding, showHoldingsDialog, showExecutionLedger, showAllocationChanges]);

  useEffect(() => {
    if (!data?.navHistory.length) return;
    const firstDate = data.navHistory[0].date;
    const latestDate = data.navHistory.at(-1)!.date;
    const stored = window.localStorage.getItem(personalStartKey);
    const initialDate = stored && stored >= firstDate && stored <= latestDate ? stored : latestDate;
    window.localStorage.setItem(personalStartKey, initialDate);
    setPersonalStartDate(initialDate);
  }, [data]);

  useEffect(() => {
    if (!data?.allocationChange?.changed) return;
    const key = `${data.allocationChange.activeAsOf}:${data.allocationChange.nextAsOf}`;
    if (window.localStorage.getItem(allocationChangeAckKey) !== key) setShowAllocationChanges(true);
  }, [data]);

  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  if (!data && !error) return <main className="status"><p>{t("正在读取护城河价值策略…", "Loading the Moat Value Strategy…")}</p></main>;
  if (!data) return <main className="status"><p>{t(error, "Portfolio data is temporarily unavailable.")}</p><button onClick={load}>{t("重新读取", "Retry")}</button></main>;

  const latest = data.navHistory.at(-1);
  const personalStart = personalStartDate ? data.navHistory.find((point) => point.date >= personalStartDate) ?? latest : latest;
  const personalHistory = personalStart
    ? data.navHistory.filter((point) => point.date >= personalStart.date)
    : data.navHistory;
  const personalReturn = latest && personalStart ? latest.nav / personalStart.nav - 1 : 0;
  const personalUnitNav = 1 + personalReturn;
  const modelCumulative = latest && data.navHistory[0] ? latest.nav / data.navHistory[0].nav - 1 : 0;
  const periods = ranges.map((item) => ({
    ...item,
    value: item.key === "TODAY"
      ? latest?.dailyReturn ?? null
      : trailingReturn(personalHistory, item.days),
  }));
  const rankedHoldings = [...data.holdings].sort((left, right) =>
    right.dailyReturn - left.dailyReturn || right.weight - left.weight || left.code.localeCompare(right.code)
  );
  const rankedNextHoldings = [...data.nextHoldings].sort((left, right) => right.weight - left.weight || left.code.localeCompare(right.code));
  const holdingsDialogItems = holdingsDialogBoard === "active" ? rankedHoldings : rankedNextHoldings;
  const activeRange = ranges.find((item) => item.key === selectedRange)!;
  const chartHistory = selectedRange === "TODAY" ? data.navHistory : personalHistory;
  const activeMoatCopy = selectedHolding ? moatEnglish[selectedHolding.code] : null;
  const displayCompany = (holding: Holding) => language === "zh" ? holding.name : companyEnglish[holding.code] ?? holding.name;
  const updateExecution = (code: string, field: keyof ExecutionRecord, value: string) => {
    const number = Math.max(0, Number(value) || 0);
    setExecutionRecords((current) => ({ ...current, [code]: { quantity: 0, averagePrice: 0, fee: 0, modelOpenPrice: 0, ...current[code], [field]: number } }));
  };
  const actualCost = Object.values(executionRecords).reduce((total, item) => total + item.quantity * item.averagePrice + item.fee, 0);
  const actualMarketValue = rankedHoldings.reduce((total, holding) => total + (executionRecords[holding.code]?.quantity ?? 0) * holding.price, 0);
  const acknowledgeAllocationChange = () => {
    window.localStorage.setItem(allocationChangeAckKey, `${data.allocationChange.activeAsOf}:${data.allocationChange.nextAsOf}`);
    setShowAllocationChanges(false);
  };
  const jumpAllocationBoard = (index: number) => {
    const carousel = allocationCarouselRef.current;
    const card = carousel?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setAllocationBoard(index);
  };
  const openHoldingsDialog = (board: "active" | "next") => {
    setHoldingsDialogBoard(board);
    setShowHoldingsDialog(true);
  };
  const openHoldingMoat = (holding: Holding) => {
    setShowHoldingsDialog(false);
    setSelectedHolding(holding);
  };

  return (
    <main className={`canvas language-${language}`}>
      <section className="sheet" aria-label={t("护城河价值策略总览", "Moat Value Strategy overview")}>
        <header className="topbar">
          <div><p className="kicker">FORWARD BARBELL · RETURN {data.returnDate}</p><h1>{t("护城河价值策略", "Moat Value Strategy")}</h1></div>
          <div className="top-actions">
            <span>{t("单位净值", "Unit NAV")} {personalUnitNav.toFixed(4)}<small className="dividend-meta">{t("分红", "Dividends")} {data.dividendSummary.cumulativeCash.toFixed(4)} · {t("已复投", "Reinvested")} {data.dividendSummary.reinvestedCash.toFixed(4)} · {t("待复投", "Pending")} {(data.dividendSummary.pendingCash + data.dividendSummary.receivableCash).toFixed(4)}</small></span>
            <button className="start-date-button" onClick={() => { setDraftStartDate(personalStart?.date ?? latest?.date ?? data.asOf); setShowStartSettings(true); }}>
              {t("我的起始日", "My Start")} {personalStart?.date ?? "—"}<small>{t("个人累计", "Personal Return")} {signedPct(personalReturn)}</small>
            </button>
            {data.allocationChange.changed && <button className="text-button" onClick={() => setShowAllocationChanges(true)}>{t("今日调仓", "Allocation change")}</button>}
            <button className="text-button" onClick={() => setShowExecutionLedger(true)}>{t("实际成交", "My Fills")}</button>
            <button className="language-toggle" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} aria-label={t("切换到英文", "Switch to Chinese")}>{language === "zh" ? "EN" : "中文"}</button>
            <button className="text-button" onClick={() => setConfirmRefresh(true)} disabled={refreshing}>{refreshing ? t("读取中", "Loading") : t("刷新", "Refresh")}</button>
          </div>
        </header>

        <div className="period-summary" aria-label={t("组合周期收益", "Portfolio period returns")}>
          <div className="period-total" aria-label={t("模型累计收益", "Model cumulative return")}>
            <span>{t("累计", "Cumulative")}</span>
            <strong className={modelCumulative >= 0 ? "up" : "down"}>{signedPct(modelCumulative)}</strong>
            <em>{t("自策略重启", "Since restart")}</em>
          </div>
          {periods.map((period) => (
            <button key={period.key} className={selectedRange === period.key ? "is-active" : ""} aria-pressed={selectedRange === period.key} onClick={() => setSelectedRange(period.key)}>
              <span>{language === "zh" ? period.cn : period.en}{period.key === "TODAY" && <small>{t("按昨日生效仓位", "Prior-session holdings")}</small>}</span>
              <strong className={period.value == null ? "pending" : period.value >= 0 ? "up" : "down"}>{period.value == null ? "—" : signedPct(period.value)}</strong>
              {period.value != null && <em>{t("点击查看曲线", "View chart")}</em>}
            </button>
          ))}
        </div>

        <div className="main-grid">
          <section className="chart-section" aria-labelledby="chart-heading">
            <div className="section-heading">
              <div><p className="kicker">PORTFOLIO PERFORMANCE</p><h2 id="chart-heading">{t("组合收益曲线", "Portfolio Return Curve")}</h2></div>
              <p>{language === "zh" ? `${activeRange.cn}视图` : `${activeRange.en} View`}</p>
            </div>
            <PerformanceChart history={chartHistory} range={selectedRange} language={language} />
            <div className="chart-caption">
              <span><i className="line-key" />{t("含分红单位净值收益", "Total-return unit NAV")}</span>
              <span>{t(`自 ${personalStart?.date ?? data.asOf} 按单位1记录`, `Unit 1 since ${personalStart?.date ?? data.asOf}`)}</span>
            </div>
          </section>

          <aside className="portfolio-panel" aria-labelledby="positions-heading">
            <div className="allocation-switcher" role="tablist" aria-label={t("当日与明日仓位切换", "Active and next allocation boards")}><button role="tab" aria-selected={allocationBoard === 0} className={allocationBoard === 0 ? "is-active" : ""} onClick={() => jumpAllocationBoard(0)}>{t("当日收益", "Today's return")}<small>{data.returnDate}</small></button><button role="tab" aria-selected={allocationBoard === 1} className={allocationBoard === 1 ? "is-active" : ""} onClick={() => jumpAllocationBoard(1)}>{t("明日执行", "Next execution")}<small>{data.allocationChange.nextAsOf}</small></button></div>
            <div className="allocation-carousel" ref={allocationCarouselRef} onScroll={(event) => { const target = event.currentTarget; setAllocationBoard(Math.round(target.scrollLeft / Math.max(target.clientWidth - 24, 1))); }}>
            <section className="allocation-board allocation-card"><div><p className="kicker">RETURN {data.returnDate} · POSITION {data.activeAsOf}</p><h2 id="positions-heading">{t("当日收益用仓位", "Today's Return Basis")}</h2><small className="allocation-note">{t("收益属于当日，但仓位来自上一交易日已公布组合", "Today's return, based on the prior session's published holdings")}</small></div>
            <div className="holding-list" role="region" aria-label={t("当日生效仓位，可上下滚动", "Today's active holdings; scrollable")} tabIndex={0}>
              <div className="holding-list-tools"><div className="holding-list-head"><span>{t("标的", "Stock")}</span><div className="holding-values"><em>{t("价格", "Price")}</em><em>{t("今日↓", "Today↓")}</em><strong>{t("仓位", "Weight")}</strong></div></div><button className="holdings-open-button" onClick={() => openHoldingsDialog("active")}>{t("查看持仓报告", "Open holdings report")}</button></div>
              {rankedHoldings.map((holding) => (
                <button className="holding-row" key={holding.code} onClick={() => setSelectedHolding(holding)} aria-label={t(`查看${holding.name}的护城河动态档案`, `View ${companyEnglish[holding.code] ?? holding.name} moat file`)}>
                  <span className="holding-stock"><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><span className="holding-identity"><b>{displayCompany(holding)}</b><small>{holding.code}</small></span></span>
                  <div className="holding-values"><em>{money(holding.price)}</em><em className={holding.dailyReturn >= 0 ? "holding-up" : "holding-down"}>{signedPct(holding.dailyReturn)}</em><strong>{pct(holding.weight)}</strong></div>
                </button>
              ))}
              <div className="cash-line"><span className="holding-stock"><i className="cash-dot" /><span className="holding-identity"><b>{t("现金", "Cash")}</b></span></span><div className="holding-values"><em>—</em><em>0</em><strong>{pct(data.summary.cashWeight)}</strong></div></div>
            </div></section>

            <section className="allocation-board allocation-card tomorrow-board"><div><p className="kicker">NEXT SESSION · {data.allocationChange.nextAsOf}</p><h2>{t("明日待执行仓位", "Next-session Target")}</h2><small className="allocation-note">{t("下一交易日开盘后生效；参考收盘价不视作成交", "Effective after next-session open; reference close is not a fill")}</small></div>
            <div className="holding-list next-holding-list" role="region" aria-label={t("明日待执行仓位，可上下滚动", "Next-session target holdings; scrollable")} tabIndex={0}>
              <div className="holding-list-tools"><div className="holding-list-head"><span>{t("标的", "Stock")}</span><div className="holding-values next-values"><em>{t("参考收盘", "Ref close")}</em><strong>{t("目标仓位", "Target")}</strong></div></div><button className="holdings-open-button" onClick={() => openHoldingsDialog("next")}>{t("查看持仓报告", "Open holdings report")}</button></div>
              {rankedNextHoldings.map((holding) => <button className="holding-row" key={`next-${holding.code}`} onClick={() => setSelectedHolding(holding)} aria-label={t(`查看${holding.name}的明日目标仓位`, `View ${companyEnglish[holding.code] ?? holding.name} next-session target`)}><span className="holding-stock"><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><span className="holding-identity"><b>{displayCompany(holding)}</b><small>{holding.code}</small></span></span><div className="holding-values next-values"><em>{money(holding.price)}</em><strong>{pct(holding.weight)}</strong></div></button>)}
              <div className="cash-line"><span className="holding-stock"><i className="cash-dot" /><span className="holding-identity"><b>{t("现金", "Cash")}</b></span></span><div className="holding-values next-values"><em>—</em><strong>{pct(data.summary.cashWeight)}</strong></div></div>
            </div></section>
            </div>

            <div className="portfolio-distribution">
              <p className="kicker">PORTFOLIO DISTRIBUTION <small>{t(`按 ${data.distributionAsOf} 生效仓位`, `Based on ${data.distributionAsOf} active holdings`)}</small></p>
              <div><span>{t("偏度判断", "Skewness")}</span><strong>{language === "zh" ? data.distributionSummary.skewLabel : distributionEnglish[data.distributionSummary.skewLabel]}</strong><b>{decimal(data.distributionSummary.skewness)}</b></div>
              <div><span>{t("峰度判断", "Kurtosis")}</span><strong>{language === "zh" ? data.distributionSummary.kurtosisLabel : distributionEnglish[data.distributionSummary.kurtosisLabel]}</strong><b>{decimal(data.distributionSummary.excessKurtosis)}</b></div>
            </div>
          </aside>
        </div>

        <footer>
          <span>{t("系统每个交易日自动追加", "Updated each trading day")}</span>
          <span>{t("研究用途，不构成投资建议", "Research only, not investment advice")}</span>
        </footer>
      </section>

      {confirmRefresh && (
        <div className="confirm-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-dialog-title" aria-describedby="refresh-dialog-description">
            <p className="kicker">REFRESH PORTFOLIO DATA</p>
            <h2 id="refresh-dialog-title">{t("确认刷新？", "Confirm Refresh?")}</h2>
            <p id="refresh-dialog-description">{t("刷新只会重新读取最新组合和最近交易日价格，不会清零、不改变起始日期，也不会删除历史收益记录。", "Refresh only reloads the latest portfolio and completed-session prices. It does not reset the start date or delete return history.")}</p>
            <div className="confirm-actions">
              <button className="dialog-button secondary" autoFocus onClick={() => setConfirmRefresh(false)}>{t("取消", "Cancel")}</button>
              <button className="dialog-button primary" onClick={() => { setConfirmRefresh(false); load(); }}>{t("确认刷新", "Refresh Now")}</button>
            </div>
          </section>
        </div>
      )}

      {showAllocationChanges && data.allocationChange.changed && (
        <div className="confirm-backdrop" role="presentation">
          <section className="change-dialog" role="dialog" aria-modal="true" aria-labelledby="allocation-change-title">
            <div className="moat-dialog-head"><div><p className="kicker">T+1 ALLOCATION NOTICE · {data.allocationChange.nextAsOf}</p><h2 id="allocation-change-title">{t("明日仓位已更新", "Next-session allocation updated")}</h2></div><button className="moat-close" aria-label={t("关闭调仓提示", "Close allocation notice")} onClick={acknowledgeAllocationChange}>×</button></div>
            <p className="dialog-note">{t(`当日收益图仍只使用 ${data.allocationChange.activeAsOf} 已生效仓位。以下变化在下一交易日开盘后才生效，不能用今天收盘价视作已成交。`, `Today's return chart still uses the ${data.allocationChange.activeAsOf} active holdings. These changes become effective after the next session opens and are not treated as fills at today's close.`)}</p>
            <div className="allocation-change-list">{data.allocationChange.changes.map((change) => <article key={change.code}><div><strong>{change.name}</strong><small>{change.code} · {change.changeType}</small></div><b>{pct(change.oldWeight)} → {pct(change.newWeight)}</b><p>{change.reason || t("下一交易日目标仓位调整", "Next-session target adjustment")}</p></article>)}</div>
            <button className="dialog-button primary change-confirm" onClick={acknowledgeAllocationChange}>{t("知道了，明日开盘后再执行", "Understood — execute after next open")}</button>
          </section>
        </div>
      )}

      {showStartSettings && (
        <div className="confirm-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="start-dialog-title" aria-describedby="start-dialog-description">
            <p className="kicker">PERSONAL START DATE</p>
            <h2 id="start-dialog-title">{t("设置个人起始日", "Set Personal Start Date")}</h2>
            <p id="start-dialog-description">{t("每位访问者可以从不同日期开始观察。日期只保存在当前浏览器，不改变公共组合历史，也不会影响其他人。", "Each visitor may choose a different starting point. It is saved only in this browser and never changes the public portfolio history.")}</p>
            <label className="date-field">{t("选择日期", "Select Date")}<input type="date" min={data.navHistory[0]?.date} max={latest?.date} value={draftStartDate} onChange={(event) => setDraftStartDate(event.target.value)} /></label>
            <p className="dialog-note">{t("若选择非交易日，将从其后的首个已记录交易日开始计算。", "A non-trading date moves to the next recorded session.")}</p>
            <div className="confirm-actions">
              <button className="dialog-button secondary" autoFocus onClick={() => setShowStartSettings(false)}>{t("取消", "Cancel")}</button>
              <button className="dialog-button primary" onClick={() => {
                const resolvedDate = data.navHistory.find((point) => point.date >= draftStartDate)?.date ?? latest?.date ?? data.asOf;
                window.localStorage.setItem(personalStartKey, resolvedDate);
                setPersonalStartDate(resolvedDate);
                setShowStartSettings(false);
              }}>{t("保存起始日", "Save Start Date")}</button>
            </div>
          </section>
        </div>
      )}

      {showExecutionLedger && (
        <div className="confirm-backdrop" role="presentation">
          <section className="execution-dialog" role="dialog" aria-modal="true" aria-labelledby="execution-dialog-title">
            <div className="moat-dialog-head"><div><p className="kicker">MODEL SIGNAL · PERSONAL FILLS</p><h2 id="execution-dialog-title">{t("模型信号与实际成交", "Model Signal & My Fills")}</h2></div><button className="moat-close" aria-label={t("关闭成交账本", "Close fill ledger")} onClick={() => setShowExecutionLedger(false)}>×</button></div>
            <p className="dialog-note">{t("收盘后只发布 T+1 目标仓位，价格是参考收盘价而非成交价。模型在下一交易日开盘后以官方开盘价记为执行代理；未有开盘价前，信号保持待执行。你的记录仅保存在此浏览器，不会下单或改写模型净值。", "After close, targets are T+1 signals and the shown close is reference only. The model records the next official open as its execution proxy; until then the signal remains pending. Your records stay in this browser, never place orders, and never rewrite model NAV.")}</p>
            <label className="date-field">{t("本期账户资金", "Capital for this execution")}<input type="number" min="0" value={accountCapital} onChange={(event) => setAccountCapital(Math.max(0, Number(event.target.value) || 0))} /></label>
            <div className="execution-summary"><span>{t("实际市值", "Market value")} <b>{money(actualMarketValue)}</b></span><span>{t("成交后现金", "Cash after fills")} <b>{money(accountCapital - actualCost)}</b></span><span>{t("实际仓位", "Actual invested")} <b>{pct(accountCapital > 0 ? actualMarketValue / accountCapital : 0)}</b></span></div>
            <div className="execution-list">
              {rankedHoldings.map((holding) => {
                const record = executionRecords[holding.code] ?? { quantity: 0, averagePrice: 0, fee: 0, modelOpenPrice: 0 };
                const proxy = record.modelOpenPrice;
                const targetShares = accountCapital > 0 ? accountCapital * holding.weight / (proxy || holding.price) : 0;
                const status = !proxy ? t("待开盘代理", "Awaiting open") : record.quantity === 0 ? t("未成交", "Unfilled") : record.quantity + 1e-8 < targetShares ? t("部分成交", "Partial") : t("已记录", "Recorded");
                const slippage = proxy > 0 && record.quantity > 0 ? (record.averagePrice - proxy) * record.quantity + record.fee : null;
                return <article key={holding.code}><div><strong>{displayCompany(holding)}</strong><small>{holding.code} · {t("目标", "Target")} {pct(holding.weight)} · {t("参考收盘", "Ref close")} {money(holding.price)} · {status}</small></div><div className="execution-fields"><label>{t("模型开盘代理", "Model open proxy")}<input type="number" min="0" step="0.01" value={record.modelOpenPrice || ""} onChange={(event) => updateExecution(holding.code, "modelOpenPrice", event.target.value)} /></label><label>{t("实际均价", "Average fill")}<input type="number" min="0" step="0.01" value={record.averagePrice || ""} onChange={(event) => updateExecution(holding.code, "averagePrice", event.target.value)} /></label><label>{t("数量", "Shares")}<input type="number" min="0" step="1" value={record.quantity || ""} onChange={(event) => updateExecution(holding.code, "quantity", event.target.value)} /></label><label>{t("手续费", "Fee")}<input type="number" min="0" step="0.01" value={record.fee || ""} onChange={(event) => updateExecution(holding.code, "fee", event.target.value)} /></label></div><small className="execution-result">{proxy > 0 ? `${t("目标数量", "Target shares")} ${targetShares.toFixed(0)} · ${t("实际权重", "Actual weight")} ${pct(accountCapital > 0 ? record.quantity * holding.price / accountCapital : 0)} · ${t("相对模型滑点", "Slippage vs model")} ${money(slippage ?? 0)}` : t("开盘价未确认：不计算滑点，也不把参考收盘价当作成交。", "Open proxy is not confirmed: no slippage is calculated and reference close is not treated as a fill.")}</small></article>;
              })}
            </div>
          </section>
        </div>
      )}

      {showHoldingsDialog && (
        <div className="confirm-backdrop" role="presentation">
          <section className="holdings-dialog" role="dialog" aria-modal="true" aria-labelledby="holdings-dialog-title">
            <div className="moat-dialog-head">
              <div><p className="kicker">HOLDINGS REPORT · {holdingsDialogBoard === "active" ? data.activeAsOf : data.allocationChange.nextAsOf}</p><h2 id="holdings-dialog-title">{t("持仓报告", "Holdings report")}</h2></div>
              <button className="moat-close" aria-label={t("关闭全部持仓", "Close full holdings")} onClick={() => setShowHoldingsDialog(false)}>×</button>
            </div>
            <div className="holdings-dialog-tabs" role="tablist" aria-label={t("持仓日期切换", "Holdings date switcher")}>
              <button role="tab" aria-selected={holdingsDialogBoard === "active"} className={holdingsDialogBoard === "active" ? "is-active" : ""} onClick={() => setHoldingsDialogBoard("active")}>{t("当日收益用仓位", "Return basis")}<small>{data.activeAsOf}</small></button>
              <button role="tab" aria-selected={holdingsDialogBoard === "next"} className={holdingsDialogBoard === "next" ? "is-active" : ""} onClick={() => setHoldingsDialogBoard("next")}>{t("明日待执行仓位", "Next target")}<small>{data.allocationChange.nextAsOf}</small></button>
            </div>
            <div className="holdings-dialog-list">
              {holdingsDialogItems.map((holding) => (
                <button className="holding-dialog-row" key={`dialog-${holdingsDialogBoard}-${holding.code}`} onClick={() => openHoldingMoat(holding)} aria-label={t(`查看${holding.name}的护城河信息`, `View ${companyEnglish[holding.code] ?? holding.name} moat information`)}>
                  <span className="holding-dialog-stock"><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><span><b>{displayCompany(holding)}</b><small>{holding.code}</small></span></span>
                  <span className="holding-dialog-values"><strong>{pct(holding.weight)}</strong><em>{t("查看护城河", "View moat")} →</em></span>
                </button>
              ))}
              <div className="holding-dialog-cash"><span><i className="cash-dot" /><b>{t("现金", "Cash")}</b></span><strong>{pct(data.summary.cashWeight)}</strong></div>
            </div>
          </section>
        </div>
      )}

      {selectedHolding && (
        <div className="confirm-backdrop" role="presentation">
          <section className="moat-dialog" role="dialog" aria-modal="true" aria-labelledby="moat-dialog-title">
            <div className="moat-dialog-head">
              <div><p className="kicker">DYNAMIC MOAT FILE · {selectedHolding.code}</p><h2 id="moat-dialog-title">{t(`${selectedHolding.name}的护城河`, `${companyEnglish[selectedHolding.code] ?? selectedHolding.name} Moat`)}</h2></div>
              <button className="moat-close" aria-label={t("关闭护城河档案", "Close moat file")} onClick={() => setSelectedHolding(null)}>×</button>
            </div>
            <div className={`moat-status ${selectedHolding.moat.status.toLowerCase()}`}>
              <span>{moatStatus[selectedHolding.moat.status][language === "zh" ? "cn" : "en"]}</span>
              <b>{t("下次复核", "Next review")} {selectedHolding.moat.nextReviewDate}</b>
            </div>
            {selectedHolding.moat.radar.pendingAlertCount > 0 ? (
              <div className="moat-radar-alert" role="status">
                <span>{t(`发现 ${selectedHolding.moat.radar.pendingAlertCount} 条待人工复核事件`, `${selectedHolding.moat.radar.pendingAlertCount} events pending human review`)}<small>{selectedHolding.moat.radar.highAlertCount} {t("条高优先级", "high priority")}</small></span>
                <strong>{language === "zh" ? selectedHolding.moat.radar.latestAlertTitle : englishAlert(selectedHolding.moat.radar.latestAlertTitle)}<small>{selectedHolding.moat.radar.latestAlertDate} · {selectedHolding.moat.radar.latestAlertSource}</small></strong>
              </div>
            ) : data.moatRadar.announcementStatus === "UNAVAILABLE" || data.moatRadar.announcementStatus === "NOT_RUN" ? (
              <div className="moat-radar-alert unavailable" role="status">
                <span>{t("公告雷达未确认", "Radar unavailable")}</span>
                <strong>{t("当前不能据此判断“没有风险事件”", "Missing data is not a clean signal.")}</strong>
              </div>
            ) : (
              <div className="moat-radar-alert clear" role="status">
                <span>{t("本次扫描未发现规则触发事件", "No rule-triggered event in this scan")}</span>
                <strong>{t("这不代表护城河已经得到证明", "This is not proof that the moat is intact.")}</strong>
              </div>
            )}
            <div className="moat-dialog-body">
              <article className="moat-thesis">
                <p className="kicker">MOAT THESIS</p><h3>{language === "zh" ? selectedHolding.moat.type : activeMoatCopy?.type}</h3><p>{language === "zh" ? selectedHolding.moat.thesis : activeMoatCopy?.thesis}</p>
              </article>
              <article><p className="kicker">WHY HARD TO COPY</p><h3>{t("为什么难以复制", "Why it is hard to copy")}</h3><p>{language === "zh" ? selectedHolding.moat.replicationBarrier : activeMoatCopy?.barrier}</p></article>
              <article><p className="kicker">WHAT TO MONITOR</p><h3>{t("持续观察什么", "What to monitor")}</h3><ul>{(language === "zh" ? selectedHolding.moat.monitoringSignals : activeMoatCopy?.monitor ?? []).map((signal) => <li key={signal}>{signal}</li>)}</ul></article>
              <article className="moat-risk"><p className="kicker">INVALIDATION SIGNALS</p><h3>{t("什么变化代表削弱", "What would weaken the thesis")}</h3><ul>{(language === "zh" ? selectedHolding.moat.invalidationSignals : activeMoatCopy?.invalidate ?? []).map((signal) => <li key={signal}>{signal}</li>)}</ul></article>
            </div>
            <div className="moat-action"><span>{t("当前动作", "Current action")}</span><strong>{language === "zh" ? selectedHolding.moat.recommendedAction : activeMoatCopy?.action}</strong><em>{t("支持", "Support")} {selectedHolding.moat.supportingEvidenceCount} · {t("警示", "Caution")} {selectedHolding.moat.cautionEvidenceCount} · {t("反证", "Contradiction")} {selectedHolding.moat.contradictoryEvidenceCount}</em></div>
            <p className="moat-disclaimer">{t("这是可被新证据推翻的当前假设，不是永久标签。", "A current falsifiable thesis, not a permanent label.")}</p>
          </section>
        </div>
      )}
    </main>
  );
}
