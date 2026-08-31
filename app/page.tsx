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
  humanMoatConfirmed: boolean;
  valuationRepair?: {
    asOf: string;
    generatedBy: string;
    generatedByEn?: string;
    currentPrice: number;
    baseDcfValuePerShare: number | null;
    baseDcfMargin: number | null;
    optimisticDcfValuePerShare?: number | null;
    institutionReferencePrice?: number | null;
    institutionReferenceAboveOptimistic?: boolean;
    valuationRule?: "HOLD" | "REVIEW";
    undervaluationReasons: string[];
    undervaluationReasonsEn?: string[];
    repairConditions: string[];
    repairConditionsEn?: string[];
    failureSignals: string[];
    failureSignalsEn?: string[];
    institutionReferences: { institution: string; institutionEn?: string; rating: string; ratingEn?: string; market: string; marketEn?: string; targetPrice: number; currency: string; publishedDate: string; sourceUrl: string; note: string; noteEn?: string }[];
    disclaimer: string;
    disclaimerEn?: string;
  };
  valuation?: Record<string, { discountRate: number; valuePerShare: number; marginOfSafety: number }> | null;
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
type BenchmarkPoint = { date: string; nav: number; dailyReturn: number };
type BenchmarkData = {
  code: string;
  name: string;
  nameEn: string;
  basis: string;
  basisEn: string;
  status: "OK" | "PARTIAL" | "UNAVAILABLE";
  startDate: string;
  endDate: string;
  history: BenchmarkPoint[];
  missingDates?: string[];
};
type PerformanceMetrics = {
  sharpe: number | null;
  smartSharpe: number | null;
  observations: number;
  periodStart: string;
  periodEnd: string;
  annualRiskFreeRate: number;
  annualizationFactor: number;
  status: "OK" | "SHORT_SAMPLE" | "INSUFFICIENT_DATA" | "INSUFFICIENT_VARIATION";
  minimumObservations: number;
  method: string;
  skewness?: number;
  excessKurtosis?: number;
};
type ExecutionRecord = { quantity: number; averagePrice: number; fee: number; modelOpenPrice: number };
type PortfolioData = {
  asOf: string;
  activeAsOf: string;
  distributionAsOf: string;
  returnDate: string;
  summary: { anchorWeight: number; futureWeight: number; cashWeight: number; activeCashWeight: number };
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
  humanReview: {
    confirmedCount: number;
    totalCount: number;
    confirmedWeight: number;
    grayWeight: number;
    modelDailyReturn: number;
    confirmedDailyReturn: number | null;
    grayDailyReturn: number | null;
    note: string;
  };
  allocationChange: {
    changed: boolean;
    activeAsOf: string;
    nextAsOf: string;
    effectiveLabel: string;
    marketContext: string;
    changes: { code: string; name: string; oldWeight: number; newWeight: number; changeType: string; reason: string; effect: string }[];
    valuationWarnings: { code: string; name: string; status: string; warningDate: string; consecutiveDays: number; dcfMargin: number; premiumCap: number; reason: string; effect: string }[];
  };
  navHistory: NavPoint[];
  benchmark: BenchmarkData;
  performanceMetrics: PerformanceMetrics;
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

type RangeKey = "TODAY" | "5D" | "1M" | "6M" | "1Y" | "CUMULATIVE" | "CALENDAR";
type Language = "zh" | "en";
const ranges: { key: RangeKey; cn: string; en: string; days: number }[] = [
  { key: "TODAY", cn: "今日", en: "Today", days: 1 },
  { key: "5D", cn: "5日", en: "5 Days", days: 5 },
  { key: "1M", cn: "1个月", en: "1 Month", days: 22 },
  { key: "6M", cn: "6个月", en: "6 Months", days: 126 },
  { key: "1Y", cn: "1年", en: "1 Year", days: 252 },
];
const cumulativeRange = { key: "CUMULATIVE" as const, cn: "累计", en: "Cumulative", days: 0 };
const calendarRange = { key: "CALENDAR" as const, cn: "收益日历", en: "Return calendar", days: 0 };

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${pct(value, 2)}`;
const decimal = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "—";
const ratio = (value: number | null, status?: PerformanceMetrics["status"]) => status && status !== "OK" ? "—" : value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
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
const dcfCaseLabels: Record<string, { cn: string; en: string }> = {
  very_optimistic: { cn: "非常乐观", en: "Very optimistic" },
  optimistic: { cn: "乐观", en: "Optimistic" },
  base: { cn: "基准", en: "Base" },
  cautious: { cn: "谨慎", en: "Cautious" },
  very_pessimistic: { cn: "非常悲观", en: "Very pessimistic" },
};

const personalStartKey = "moat-value-personal-start-date-v1";
const languageKey = "moat-value-language-v1";
const executionLedgerKey = "moat-value-execution-ledger-v1";
const allocationChangeAckKey = "moat-value-allocation-change-ack-v1";
const helpSeenKey = "moat-value-help-seen-v1";
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

const A_SHARE_LOT_SIZE = 100;
function capitalFloorForHoldings(holdings: Holding[]) {
  return Math.ceil(Math.max(0, ...holdings.filter((holding) => holding.weight > 0 && holding.price > 0).map((holding) => holding.price * A_SHARE_LOT_SIZE / holding.weight)));
}

function ReturnCalendar({ history, language }: { history: NavPoint[]; language: Language }) {
  const months = new Map<string, NavPoint[]>();
  history.forEach((point) => {
    const key = point.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), point]);
  });
  const weekdays = language === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="return-calendar" tabIndex={0} aria-label={language === "zh" ? "每日组合收益日历，可上下滑动" : "Daily portfolio return calendar, scroll vertically"}>
      <div className="calendar-intro">
        <strong>{language === "zh" ? "每日收益" : "Daily returns"}</strong>
      </div>
      <div className="calendar-months">
        {[...months.entries()].map(([key, monthPoints]) => {
          const [year, month] = key.split("-").map(Number);
          const firstDay = new Date(year, month - 1, 1).getDay();
          const daysInMonth = new Date(year, month, 0).getDate();
          const pointsByDay = new Map(monthPoints.map((point) => [Number(point.date.slice(-2)), point]));
          const cells: (NavPoint | null)[] = [
            ...Array(firstDay).fill(null),
            ...Array.from({ length: daysInMonth }, (_, index) => pointsByDay.get(index + 1) ?? null),
          ];
          return (
            <section className="calendar-month" key={key} aria-label={`${year}-${String(month).padStart(2, "0")}`}>
              <h3>{language === "zh" ? `${year}年${month}月` : `${new Date(year, month - 1).toLocaleString("en", { month: "long" })} ${year}`}</h3>
              <div className="calendar-weekdays">{weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
              <div className="calendar-grid">
                {cells.map((point, index) => point ? (
                  <div className={`calendar-day ${point.dailyReturn > 0 ? "positive" : point.dailyReturn < 0 ? "negative" : "neutral"}`} key={point.date}>
                    <b>{Number(point.date.slice(-2))}</b>
                    <strong>{signedPct(point.dailyReturn)}</strong>
                  </div>
                ) : <div className="calendar-day empty" key={`empty-${key}-${index}`} aria-hidden="true" />)}
              </div>
            </section>
          );
        })}
      </div>
      <div className="calendar-legend" aria-label={language === "zh" ? "收益日历图例" : "Return calendar legend"}>
        <span><i className="calendar-swatch positive" />{language === "zh" ? "上涨" : "Up"}</span>
        <span><i className="calendar-swatch negative" />{language === "zh" ? "下跌" : "Down"}</span>
        <span>{language === "zh" ? "每日收益" : "Daily return"}</span>
      </div>
    </div>
  );
}

function PerformanceChart({ history, benchmarkHistory = [], range, language }: { history: NavPoint[]; benchmarkHistory?: BenchmarkPoint[]; range: RangeKey; language: Language }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const rangeDays = range === "CUMULATIVE" ? history.length - 1 : ranges.find((item) => item.key === range)!.days;
  const needed = range === "TODAY" ? 2 : range === "CUMULATIVE" ? history.length : rangeDays + 1;
  const points = history.slice(-needed);
  const width = 900;
  const height = 330;
  const left = 62;
  const right = 24;
  const top = 24;
  const bottom = 274;
  const base = points.at(0)?.nav ?? 1;
  const returns = points.map((point) => point.nav / base - 1);
  const benchmarkByDate = new Map(benchmarkHistory.map((point) => [point.date, point]));
  const visibleBenchmarkPoints = points
    .map((point) => benchmarkByDate.get(point.date))
    .filter((point): point is BenchmarkPoint => point != null);
  const showBenchmark = visibleBenchmarkPoints.length > 1;
  const benchmarkBase = visibleBenchmarkPoints.at(0)?.nav ?? 1;
  const benchmarkReturns = points.map((point) => {
    const benchmarkPoint = benchmarkByDate.get(point.date);
    return showBenchmark && benchmarkPoint ? benchmarkPoint.nav / benchmarkBase - 1 : null;
  });
  const visibleReturns = [...returns, ...benchmarkReturns.filter((value): value is number => value != null)];
  const rawMin = Math.min(...visibleReturns, 0);
  const rawMax = Math.max(...visibleReturns, 0);
  const pad = Math.max((rawMax - rawMin) * 0.16, 0.0015);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const x = (index: number) => points.length <= 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (points.length - 1);
  const y = (value: number) => top + (max - value) * (bottom - top) / (max - min);
  const coordinates = points.map((point, index) => ({ x: x(index), y: y(returns[index]), point, value: returns[index] }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = coordinates.length > 1 ? `${line} L${coordinates.at(-1)!.x.toFixed(1)},${y(0).toFixed(1)} L${coordinates[0].x.toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const benchmarkCoordinates = points.map((point, index) => {
    const value = benchmarkReturns[index];
    return value == null ? null : { x: x(index), y: y(value), point: benchmarkByDate.get(point.date)!, value };
  }).filter((point): point is { x: number; y: number; point: BenchmarkPoint; value: number } => point != null);
  const benchmarkLine = benchmarkCoordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const active = hovered == null ? null : coordinates[hovered];
  const yTicks = [max, (max + min) / 2, min];

  return (
    <div className="performance-chart" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="performance-chart-title performance-chart-desc">
        <title id="performance-chart-title">{language === "zh" ? "组合收益曲线" : "Portfolio return curve"}</title>
        <desc id="performance-chart-desc">{language === "zh" ? "根据已记录的每日组合单位净值绘制；累计视图同时显示沪深300单位指数代理。" : "Recorded daily portfolio NAV; the cumulative view also shows the CSI 300 unit-index proxy."}</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text className="axis-label" x={left - 10} y={y(tick) + 4}>{signedPct(tick)}</text>
          </g>
        ))}
        <line className="chart-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {area && <path className="chart-area" d={area} />}
        {line && <path className="chart-line" d={line} />}
        {benchmarkLine && <path className="chart-line benchmark-line" d={benchmarkLine} />}
        {coordinates.map((point, index) => (
          <circle key={point.point.date} className="chart-hit" cx={point.x} cy={point.y} r="13" onMouseEnter={() => setHovered(index)} onTouchStart={() => setHovered(index)} />
        ))}
        {active && <circle className="chart-point" cx={active.x} cy={active.y} r="5" />}
        <text className="axis-label axis-start" x={left} y={height - 18}>{points.at(0)?.date ?? "—"}</text>
        <text className="axis-label axis-end" x={width - right} y={height - 18}>{points.at(-1)?.date ?? "—"}</text>
      </svg>
      {active && (
        <div className="chart-tooltip" aria-live="polite">
          <span>{active.point.date}</span><strong>{signedPct(active.value)}</strong>
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
  // Start on the realized return calendar so daily results are visible immediately;
  // the period bar still returns to the cumulative strategy-vs-benchmark curve.
  const [selectedRange, setSelectedRange] = useState<RangeKey>("CALENDAR");
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [showValuationResearch, setShowValuationResearch] = useState(false);
  const [showHoldingsDialog, setShowHoldingsDialog] = useState(false);
  const [holdingsDialogBoard, setHoldingsDialogBoard] = useState<"active" | "next">("active");
  const [language, setLanguage] = useState<Language>("zh");
  const [showExecutionLedger, setShowExecutionLedger] = useState(false);
  const [showAllocationChanges, setShowAllocationChanges] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
    if (!confirmRefresh && !showStartSettings && !selectedHolding && !showHoldingsDialog && !showExecutionLedger && !showAllocationChanges && !showValuationResearch && !showHelp) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmRefresh(false);
        setShowStartSettings(false);
        setSelectedHolding(null);
        setShowHoldingsDialog(false);
        setShowExecutionLedger(false);
        setShowAllocationChanges(false);
        setShowValuationResearch(false);
        setShowHelp(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmRefresh, showStartSettings, selectedHolding, showHoldingsDialog, showExecutionLedger, showAllocationChanges, showValuationResearch, showHelp]);

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
    if (!data) return;
    const key = `${data.allocationChange.activeAsOf}:${data.allocationChange.nextAsOf}`;
    const needsAllocationNotice = data.allocationChange.changed && window.localStorage.getItem(allocationChangeAckKey) !== key;
    if (needsAllocationNotice) setShowAllocationChanges(true);
    else if (window.localStorage.getItem(helpSeenKey) !== "1") setShowHelp(true);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const minimumCapital = Math.max(capitalFloorForHoldings(data.holdings), capitalFloorForHoldings(data.nextHoldings));
    if (minimumCapital > 0) setAccountCapital((current) => Math.max(current, minimumCapital));
  }, [data]);

  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  if (!data && !error) return <main className="status"><p>{t("正在读取安全边际投资研究平台…", "Loading the Margin of Safety Investment Research Platform…")}</p></main>;
  if (!data) return <main className="status"><p>{t(error, "Portfolio data is temporarily unavailable.")}</p><button onClick={load}>{t("重新读取", "Retry")}</button></main>;

  const latest = data.navHistory.at(-1);
  const personalStart = personalStartDate ? data.navHistory.find((point) => point.date >= personalStartDate) ?? latest : latest;
  const personalHistory = personalStart
    ? data.navHistory.filter((point) => point.date >= personalStart.date)
    : data.navHistory;
  const personalReturn = latest && personalStart ? latest.nav / personalStart.nav - 1 : 0;
  const personalUnitNav = 1 + personalReturn;
  const modelCumulative = latest && data.navHistory[0] ? latest.nav / data.navHistory[0].nav - 1 : 0;
  const benchmarkFirst = data.benchmark.history[0];
  const benchmarkLatest = data.benchmark.history.at(-1);
  const benchmarkCumulative = benchmarkFirst && benchmarkLatest ? benchmarkLatest.nav / benchmarkFirst.nav - 1 : null;
  const benchmarkExcess = benchmarkCumulative == null ? null : modelCumulative - benchmarkCumulative;
  const minimumAccountCapital = Math.max(capitalFloorForHoldings(data.holdings), capitalFloorForHoldings(data.nextHoldings));
  const capitalFloorHolding = [...data.holdings, ...data.nextHoldings].filter((holding) => holding.weight > 0 && holding.price > 0).sort((left, right) => right.price / right.weight - left.price / left.weight)[0];
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
  const activeRange = selectedRange === "CUMULATIVE" ? cumulativeRange : selectedRange === "CALENDAR" ? calendarRange : ranges.find((item) => item.key === selectedRange)!;
  const chartHistory = selectedRange === "TODAY" || selectedRange === "CUMULATIVE" || selectedRange === "CALENDAR" ? data.navHistory : personalHistory;
  const benchmarkVisible = chartHistory.filter((point) => data.benchmark.history.some((benchmarkPoint) => benchmarkPoint.date === point.date)).length > 1;
  const activeMoatCopy = selectedHolding ? moatEnglish[selectedHolding.code] : null;
  const displayCompany = (holding: Holding) => language === "zh" ? holding.name : companyEnglish[holding.code] ?? holding.name;
  const humanReviewLabel = (holding: Holding) => holding.humanMoatConfirmed
    ? t("人工已确认", "Human confirmed")
    : t("待观察·未人工确认", "Monitoring · not reviewed");
  const updateExecution = (code: string, field: keyof ExecutionRecord, value: string) => {
    const number = Math.max(0, Number(value) || 0);
    setExecutionRecords((current) => ({ ...current, [code]: { quantity: 0, averagePrice: 0, fee: 0, modelOpenPrice: 0, ...current[code], [field]: number } }));
  };
  const actualCost = Object.values(executionRecords).reduce((total, item) => total + item.quantity * item.averagePrice + item.fee, 0);
  const actualMarketValue = rankedHoldings.reduce((total, holding) => total + (executionRecords[holding.code]?.quantity ?? 0) * holding.price, 0);
  const acknowledgeAllocationChange = () => {
    window.localStorage.setItem(allocationChangeAckKey, `${data.allocationChange.activeAsOf}:${data.allocationChange.nextAsOf}`);
    setShowAllocationChanges(false);
    if (window.localStorage.getItem(helpSeenKey) !== "1") setShowHelp(true);
  };
  const closeHelp = () => {
    window.localStorage.setItem(helpSeenKey, "1");
    setShowHelp(false);
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
    setShowValuationResearch(false);
    setSelectedHolding(holding);
  };

  return (
    <main className={`canvas language-${language}`}>
      <section className="sheet" aria-label={t("安全边际投资研究平台总览", "Margin of Safety Investment Research Platform overview")}>
        <header className="topbar">
          <div><p className="kicker">FORWARD BARBELL · RETURN {data.returnDate}</p><h1 className="site-title">{t("安全边际投资研究平台", "Margin of Safety Investment Research Platform")}</h1></div>
          <div className="top-actions">
            <span>{t("单位净值", "Unit NAV")} {personalUnitNav.toFixed(4)}<small className="dividend-meta">{t("分红", "Dividends")} {data.dividendSummary.cumulativeCash.toFixed(4)} · {t("已复投", "Reinvested")} {data.dividendSummary.reinvestedCash.toFixed(4)} · {t("待复投", "Pending")} {(data.dividendSummary.pendingCash + data.dividendSummary.receivableCash).toFixed(4)}</small></span>
            <button className="start-date-button" onClick={() => { setDraftStartDate(personalStart?.date ?? latest?.date ?? data.asOf); setShowStartSettings(true); }}>
              {t("我的起始日", "My Start")} {personalStart?.date ?? "—"}<small>{t("个人累计", "Personal Return")} {signedPct(personalReturn)}</small>
            </button>
            {data.allocationChange.changed && <button className="text-button" onClick={() => setShowAllocationChanges(true)}>{t("今日调仓", "Allocation change")}</button>}
            <button className="text-button" onClick={() => setShowExecutionLedger(true)}>{t("实际成交", "My Fills")}</button>
            <button className="help-button" onClick={() => setShowHelp(true)} aria-label={t("打开使用说明", "Open user guide")}>? <span>{t("使用说明", "Guide")}</span></button>
            <button className="language-toggle" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} aria-label={t("切换到英文", "Switch to Chinese")}>{language === "zh" ? "EN" : "中文"}</button>
            <button className="text-button" onClick={() => setConfirmRefresh(true)} disabled={refreshing}>{refreshing ? t("读取中", "Loading") : t("刷新", "Refresh")}</button>
          </div>
        </header>

        <div className="period-summary" aria-label={t("组合周期收益", "Portfolio period returns")}>
            <button type="button" className={`period-total ${selectedRange === "CUMULATIVE" ? "is-active" : ""}`} aria-pressed={selectedRange === "CUMULATIVE"} onClick={() => setSelectedRange("CUMULATIVE")}>
              <span>{t("累计", "Cumulative")}</span>
              <strong className={modelCumulative >= 0 ? "up" : "down"}>{signedPct(modelCumulative)}</strong>
              <em>{t("点击查看曲线", "View cumulative curve")}</em>
            </button>
          {periods.map((period) => (
            <button key={period.key} className={selectedRange === period.key ? "is-active" : ""} aria-pressed={selectedRange === period.key} onClick={() => setSelectedRange(period.key)}>
              <span>{language === "zh" ? period.cn : period.en}{period.key === "TODAY" && <small>{t("按昨日生效仓位", "Prior-session holdings")}</small>}</span>
              <strong className={period.value == null ? "pending" : period.value >= 0 ? "up" : "down"}>{period.value == null ? "—" : signedPct(period.value)}</strong>
              {period.value != null && <em>{t("查看", "View")}</em>}
            </button>
          ))}
        </div>

        <div className="main-grid">
          <section className="chart-section" aria-labelledby="chart-heading">
            <div className="section-heading">
              <div><p className="kicker">PORTFOLIO PERFORMANCE</p><h2 id="chart-heading">{selectedRange === "CALENDAR" ? t("每日收益日历", "Daily Return Calendar") : t("组合收益曲线", "Portfolio Return Curve")}</h2></div>
              <button type="button" className="view-toggle" aria-label={selectedRange === "CALENDAR" ? t("切换到累计收益曲线", "Switch to cumulative return curve") : t("切换到收益日历", "Switch to return calendar")} aria-pressed={selectedRange === "CALENDAR"} onClick={() => setSelectedRange(selectedRange === "CALENDAR" ? "CUMULATIVE" : "CALENDAR")}>
                {selectedRange === "CALENDAR" ? t("累计视图", "Cumulative view") : t("收益日历", "Return calendar")}<small>{selectedRange === "CALENDAR" ? t("点击切换曲线", "Click for curve") : t("点击切换日历", "Click for calendar")}</small>
              </button>
            </div>
            {selectedRange === "CALENDAR" ? <ReturnCalendar history={data.navHistory} language={language} /> : <PerformanceChart history={chartHistory} benchmarkHistory={data.benchmark.history} range={selectedRange} language={language} />}
            <div className="chart-caption">
              <span><i className="line-key" />{t("策略净值", "Strategy NAV")}</span>
              {benchmarkVisible && data.benchmark.status === "OK" && <span><i className="line-key benchmark-key" />{t("沪深300代理", "CSI 300 proxy")}</span>}
              <span>{t(`起始 ${personalStart?.date ?? data.asOf}`, `Start ${personalStart?.date ?? data.asOf}`)}</span>
            </div>
            {selectedRange === "CUMULATIVE" && <div className="benchmark-strip" aria-label={t("策略与大盘累计表现", "Strategy versus market cumulative performance")}>
              <div><span>{t("策略", "Strategy")}</span><strong className={modelCumulative >= 0 ? "up" : "down"}>{signedPct(modelCumulative)}</strong><small>{t("从组合起始日单位1", "Unit 1 from portfolio start")}</small></div>
              <div><span>{data.benchmark.status === "OK" ? t(data.benchmark.name, data.benchmark.nameEn) : t("大盘基准", "Market benchmark")}</span><strong className={benchmarkCumulative == null ? "pending" : benchmarkCumulative >= 0 ? "up" : "down"}>{benchmarkCumulative == null ? "—" : signedPct(benchmarkCumulative)}</strong><small>{data.benchmark.status === "OK" ? t("原始收盘价代理，不含分红", "Raw close proxy, excl. dividends") : t("数据尚未完整", "Data not complete")}</small></div>
              <div><span>{t("相对大盘", "Excess vs market")}</span><strong className={benchmarkExcess == null ? "pending" : benchmarkExcess >= 0 ? "up" : "down"}>{benchmarkExcess == null ? "—" : signedPct(benchmarkExcess)}</strong><small>{data.benchmark.status === "OK" ? t("策略累计收益减基准", "Strategy cumulative return minus benchmark") : t("不推断超额收益", "No excess-return inference")}</small></div>
            </div>}
            <div className="risk-metrics" aria-label={t("风险调整收益指标", "Risk-adjusted performance metrics")}>
              <div><span>{t("Sharpe Ratio", "Sharpe Ratio")}</span><strong className={data.performanceMetrics.sharpe == null ? "pending" : data.performanceMetrics.sharpe >= 0 ? "up" : "down"}>{ratio(data.performanceMetrics.sharpe, data.performanceMetrics.status)}</strong><small>{data.performanceMetrics.status === "SHORT_SAMPLE" ? t(`${data.performanceMetrics.observations}/30日 · 数据不足`, `${data.performanceMetrics.observations}/30d · insufficient`) : t("现金基准0%", "0% cash baseline")}</small></div>
              <div><span>{t("Smart Sharpe", "Smart Sharpe")}</span><strong className={data.performanceMetrics.smartSharpe == null ? "pending" : data.performanceMetrics.smartSharpe >= 0 ? "up" : "down"}>{ratio(data.performanceMetrics.smartSharpe, data.performanceMetrics.status)}</strong><small>{t("偏度/峰度修正", "Skew/kurtosis adjusted")}</small></div>
            </div>
          </section>

          <aside className="portfolio-panel" aria-labelledby="positions-heading">
            <div className="allocation-switcher" role="tablist" aria-label={t("当日与明日仓位切换", "Active and next allocation boards")}><button role="tab" aria-selected={allocationBoard === 0} className={allocationBoard === 0 ? "is-active" : ""} onClick={() => jumpAllocationBoard(0)}>{t("当日收益", "Today's return")}<small>{data.returnDate}</small></button><button role="tab" aria-selected={allocationBoard === 1} className={allocationBoard === 1 ? "is-active" : ""} onClick={() => jumpAllocationBoard(1)}>{t("明日执行", "Next execution")}<small>{data.allocationChange.nextAsOf}</small></button></div>
            <div className="allocation-carousel" ref={allocationCarouselRef} onScroll={(event) => { const target = event.currentTarget; setAllocationBoard(Math.round(target.scrollLeft / Math.max(target.clientWidth - 24, 1))); }}>
            <section className="allocation-board allocation-card"><div className="allocation-card-head"><div><p className="kicker">RETURN {data.returnDate} · POSITION {data.activeAsOf}</p><h2 id="positions-heading">{t("当日收益仓位", "Today's Return Basis")}</h2><small className="allocation-note">{t("按上一交易日仓位计算", "Uses prior-session holdings")}</small></div><button className="holdings-open-button" onClick={() => openHoldingsDialog("active")}>{t("查看持仓报告", "Open holdings report")}</button></div>
            <div className="holding-list" role="region" aria-label={t("当日生效仓位，可上下滚动", "Today's active holdings; scrollable")} tabIndex={0}>
              <div className="holding-list-tools"><div className="holding-list-head"><span>{t("标的", "Stock")}</span><div className="holding-values"><em>{t("价格", "Price")}</em><em>{t("今日↓", "Today↓")}</em><strong>{t("仓位", "Weight")}</strong></div></div></div>
              {rankedHoldings.map((holding) => (
                <button className="holding-row" key={holding.code} onClick={() => setSelectedHolding(holding)} aria-label={t(`查看${holding.name}的护城河动态档案`, `View ${companyEnglish[holding.code] ?? holding.name} moat file`)}>
                  <span className="holding-stock"><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} /><span className="holding-identity"><b>{displayCompany(holding)}</b><small>{holding.code}</small></span></span>
                  <div className="holding-values"><em>{money(holding.price)}</em><em className={holding.dailyReturn >= 0 ? "holding-up" : "holding-down"}>{signedPct(holding.dailyReturn)}</em><strong>{pct(holding.weight)}</strong></div>
                </button>
              ))}
              <div className="cash-line"><span className="holding-stock"><i className="cash-dot" /><span className="holding-identity"><b>{t("现金", "Cash")}</b></span></span><div className="holding-values"><em>—</em><em>0</em><strong>{pct(data.summary.activeCashWeight)}</strong></div></div>
            </div></section>

            <section className="allocation-board allocation-card tomorrow-board"><div className="allocation-card-head"><div><p className="kicker">NEXT SESSION · {data.allocationChange.nextAsOf}</p><h2>{t("明日目标仓位", "Next-session Target")}</h2><small className="allocation-note">{t("下个交易日开盘生效", "Effective next-session open")}</small></div><button className="holdings-open-button" onClick={() => openHoldingsDialog("next")}>{t("查看持仓报告", "Open holdings report")}</button></div>
            <div className="holding-list next-holding-list" role="region" aria-label={t("明日待执行仓位，可上下滚动", "Next-session target holdings; scrollable")} tabIndex={0}>
              <div className="holding-list-tools"><div className="holding-list-head"><span>{t("标的", "Stock")}</span><div className="holding-values next-values"><em>{t("参考收盘", "Ref close")}</em><strong>{t("目标仓位", "Target")}</strong></div></div></div>
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

      {showHelp && (
        <div className="confirm-backdrop" role="presentation">
          <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title" aria-describedby="help-dialog-description">
            <div className="moat-dialog-head">
              <div><p className="kicker">MARGIN OF SAFETY · USER GUIDE</p><h2 id="help-dialog-title">{t("网站使用说明", "How to use this site")}</h2></div>
              <button className="moat-close" aria-label={t("关闭使用说明", "Close user guide")} onClick={closeHelp}>×</button>
            </div>
            <p id="help-dialog-description" className="help-lead">{t("这里把模型信号、当日收益、明日执行和你的真实成交分开。先看模型，再决定是否需要人工调整；网站不会替你下单。", "This guide separates model signals, today's return, next-session execution and your actual fills. Read the model first, then decide whether to fine-tune it; the site never places orders for you.")}</p>
            <div className="help-grid">
              <article><p className="kicker">01 · START HERE</p><h3>{t("先看顶部收益", "Start with the returns")}</h3><ul><li>{t("累计：模型从公开净值历史计算的累计收益曲线。", "Cumulative: model return from the public NAV history.")}</li><li>{t("今日收益：严格使用上一交易日已经生效的仓位。", "Today's return: strictly uses the holdings active in the prior session.")}</li><li>{t("个人累计：只根据当前浏览器设置的起始日显示。", "Personal return: only reflects the start date saved in this browser.")}</li></ul></article>
              <article><p className="kicker">02 · TWO BOARDS</p><h3>{t("当日与明日不是一回事", "Today's board vs next board")}</h3><ul><li>{t("当日收益仓位：用于解释已经发生的收益。", "Today's return basis: explains the return that already happened.")}</li><li>{t("明日执行：收盘后发布的 T+1 目标，参考收盘价不是成交价。", "Next execution: the post-close T+1 target; the reference close is not a fill.")}</li><li>{t("明日目标要到下一交易日开盘后才生效。", "The next target becomes effective only after the next session opens.")}</li></ul></article>
              <article><p className="kicker">03 · PORTFOLIO LOGIC</p><h3>{t("模型为什么这样配", "Why the model allocates this way")}</h3><ul><li>{t("锚仓：当前现金流、估值和行业位置较稳定的候选。", "Anchors: candidates with steadier current cash economics, valuation and industry position.")}</li><li>{t("种子仓：未来产业的小额期权仓，按证据里程碑逐级调整。", "Seeds: small future-industry options adjusted through evidence milestones.")}</li><li>{t("现金：没有足够确定性时保留预算，不为满仓降低标准。", "Cash: budget held back when certainty is insufficient; standards are not lowered to force full investment.")}</li></ul></article>
              <article><p className="kicker">04 · HUMAN REVIEW</p><h3>{t("人工判断看什么", "What human review is for")}</h3><ul><li>{t("人工未确认不阻止持仓，也不从模型收益中剔除。", "An unreviewed moat does not block a holding or remove it from model returns.")}</li><li>{t("人工重点判断行业未来、利润改善概率和风险是否被市场提前定价。", "Human judgment focuses on industry outlook, probability of profit improvement and whether risks are already priced in.")}</li><li>{t("点击个股可看护城河、低估原因、修复条件、预期转恶因素和机构参考。", "Click a stock to see its moat, discount reasons, repair conditions, downside outlook and public references.")}</li></ul></article>
              <article><p className="kicker">05 · MY FILLS</p><h3>{t("实际成交单独记录", "Record your fills separately")}</h3><ul><li>{t("模型开盘代理只是可复现基准，不保证订单成交。", "The model open proxy is a reproducible benchmark, not a guaranteed fill.")}</li><li>{t("填写实际均价、数量和手续费后，才计算实际权重和滑点。", "Actual weight and slippage are calculated only after entering average price, quantity and fees.")}</li><li>{t("未成交或部分成交不会改写公共模型净值。", "Unfilled or partial orders never rewrite the public model NAV.")}</li></ul></article>
              <article><p className="kicker">06 · ALERTS & LIMITS</p><h3>{t("预警不等于自动交易", "Alerts are not automatic trades")}</h3><ul><li>{t("调仓弹窗解释变化原因，但目标仓位只从下一交易日生效。", "The allocation popup explains changes, but targets take effect only on the next session.")}</li><li>{t("护城河雷达命中只生成待复核；接口不可用也不代表没有风险。", "Radar hits create review items; an unavailable interface is not a clean bill of health.")}</li><li>{t("网站用于研究和记录，不连接券商、不自动下单。", "This site is for research and records; it does not connect to a broker or place orders.")}</li></ul></article>
            </div>
            <div className="help-flow"><strong>{t("推荐使用顺序", "Recommended order")}</strong><span>{t("① 看累计和今日收益 → ② 左右滑动比较当日/明日 → ③ 点个股看护城河 → ④ 打开实际成交填写账户数据 → ⑤ 人工决定是否微调仓位", "① Check cumulative and today's return → ② swipe between today's and next boards → ③ open a stock's moat file → ④ enter your account fills → ⑤ decide whether to fine-tune weights")}</span></div>
            <p className="help-disclaimer">{t("所有内容均为研究辅助，不构成投资建议；模型价格、机构目标价和开盘代理都不能替代你的实际成交记录。", "Research aid only, not investment advice; model prices, institution references and open proxies do not replace your actual fill records.")}</p>
            <button className="dialog-button primary help-close" onClick={closeHelp}>{t("我知道了，开始查看组合", "Got it — view the portfolio")}</button>
          </section>
        </div>
      )}

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
            <p className="dialog-note">{t(`今日收益仍只使用 ${data.allocationChange.activeAsOf} 已生效仓位。${data.allocationChange.marketContext} 以下变化仅在下一交易日开盘后生效，不能用今天收盘价视作已成交。`, `Today's return still uses the ${data.allocationChange.activeAsOf} active holdings. ${data.allocationChange.marketContext} Changes below become effective after the next session opens and are not fills at today's close.`)}</p>
            <div className="allocation-change-list">{data.allocationChange.changes.map((change) => <article key={change.code}><div><strong>{change.name}</strong><small>{change.code} · {change.changeType}</small></div><b>{pct(change.oldWeight)} → {pct(change.newWeight)}</b><p className="change-why"><strong>{t("为什么", "Why")}</strong>{change.reason || t("下一交易日目标仓位调整", "Next-session target adjustment")}</p><p className="change-effect"><strong>{t("影响", "Effect")}</strong>{change.effect}</p></article>)}{data.allocationChange.valuationWarnings.map((warning) => <article className="valuation-warning" key={`valuation-${warning.code}`}><div><strong>{warning.name}</strong><small>{warning.code} · {warning.status === "EXIT_DUE" ? t("估值持续偏高", "Persistent premium") : t("估值预警", "Valuation warning")}</small></div><b>{t("DCF", "DCF")} {pct(warning.dcfMargin)} · {t("溢价上限", "Premium cap")} {pct(warning.premiumCap)}</b><p className="change-why"><strong>{t("预警", "Warning")}</strong>{warning.reason}</p><p className="change-effect"><strong>{t("后续", "Next")}</strong>{warning.effect}</p></article>)}</div>
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
            <p className="dialog-note">{t("收盘后只发布 T+1 目标仓位，参考收盘价不代表成交。模型用下一交易日官方开盘价作统一执行代理，但开盘价也不保证你的订单能成交；实际均价、数量和手续费必须按账户记录填写，未成交或部分成交不会改写模型净值。", "After close, targets are T+1 signals and the shown close is not a fill. The next official open is only a reproducible model execution proxy, not a guaranteed fill for your order. Enter actual average price, quantity and fees from your account; unfilled or partial orders never rewrite model NAV.")}</p>
            <label className="date-field">{t("本期账户资金", "Capital for this execution")}<input type="number" min={minimumAccountCapital} value={accountCapital} onChange={(event) => setAccountCapital(Math.max(minimumAccountCapital, Number(event.target.value) || 0))} /><small className="capital-floor-note">{t(`最低账户金额 ${money(minimumAccountCapital)}：按 ${capitalFloorHolding?.name ?? "最贵目标股"} 目标仓位至少买 100 股；未含手续费、滑点和开盘跳空缓冲。`, `Minimum account capital ${money(minimumAccountCapital)}: enough to buy one A-share board lot (100 shares) of ${capitalFloorHolding ? companyEnglish[capitalFloorHolding.code] ?? capitalFloorHolding.name : "the most capital-intensive target"} at its target weight; excludes fees, slippage and gap buffer.`)}</small></label>
            <div className="execution-summary"><span>{t("实际市值", "Market value")} <b>{money(actualMarketValue)}</b></span><span>{t("成交后现金", "Cash after fills")} <b>{money(accountCapital - actualCost)}</b></span><span>{t("实际仓位", "Actual invested")} <b>{pct(accountCapital > 0 ? actualMarketValue / accountCapital : 0)}</b></span></div>
            <div className="execution-list">
              {rankedHoldings.map((holding) => {
                const record = executionRecords[holding.code] ?? { quantity: 0, averagePrice: 0, fee: 0, modelOpenPrice: 0 };
                const proxy = record.modelOpenPrice;
                const targetShares = accountCapital > 0 ? accountCapital * holding.weight / (proxy || holding.price) : 0;
                const status = !proxy ? t("待开盘代理", "Awaiting open") : record.quantity === 0 ? t("未成交", "Unfilled") : record.averagePrice <= 0 ? t("待补录成交价", "Fill price needed") : record.quantity + 1e-8 < targetShares ? t("部分成交", "Partial") : t("已记录", "Recorded");
                const slippage = proxy > 0 && record.averagePrice > 0 && record.quantity > 0 ? (record.averagePrice - proxy) * record.quantity + record.fee : null;
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
              <div className="holding-dialog-cash"><span><i className="cash-dot" /><b>{t("现金", "Cash")}</b></span><strong>{pct(holdingsDialogBoard === "active" ? data.summary.activeCashWeight : data.summary.cashWeight)}</strong></div>
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
            <div className={`human-review-wrap ${selectedHolding.humanMoatConfirmed ? "" : "pending"}`}>
              {!selectedHolding.humanMoatConfirmed && <span className="human-review-alert" aria-hidden="true" title={t("待人工判断", "Human review pending")}>!</span>}
              <button type="button" className={`human-review-status ${selectedHolding.humanMoatConfirmed ? "confirmed" : "gray"}`} onClick={() => setShowValuationResearch((current) => !current)} aria-expanded={showValuationResearch}><span>{t("人工护城河判断", "Human moat judgment")}</span><strong>{humanReviewLabel(selectedHolding)}</strong><small>{selectedHolding.humanMoatConfirmed ? t("人工判断仅用于记录和后续预警，不改变模型已计算的持仓收益。点击查看估值复核。", "Human review is informational and supports future alerts; it does not change model holdings or returns. Click for valuation review.") : t("尚未判断；这不会阻止当前持仓或模型收益，只在出现不利证据时触发后续预警。点击查看低估原因、修复条件和机构估值参考。", "Not yet reviewed; this does not block the current holding or model return. It only supports future alerts when adverse evidence appears. Click to review undervaluation reasons, repair conditions and institution references.")}</small></button>
            </div>
            {selectedHolding.valuationRepair?.institutionReferenceAboveOptimistic && (
              <div className="valuation-rule-hold" role="status"><span>{t("估值规则动作", "Valuation rule")}</span><strong>{t("安全边际充足", "Margin supported")}</strong><small>{t(`最低机构参考价 ${money(selectedHolding.valuationRepair.institutionReferencePrice ?? 0)} 高于乐观DCF ${money(selectedHolding.valuationRepair.optimisticDcfValuePerShare ?? 0)}；估值规则允许继续持有，护城河判断仍单独用于观察和预警。`, `The lowest linked institution reference ${money(selectedHolding.valuationRepair.institutionReferencePrice ?? 0)} is above the optimistic DCF ${money(selectedHolding.valuationRepair.optimisticDcfValuePerShare ?? 0)}; valuation supports holding, while moat review remains a separate monitoring and alert layer.`)}</small></div>
            )}
            {showValuationResearch && selectedHolding.valuationRepair && (
              <section className="valuation-repair" aria-label={t("估值修复辅助研究", "Valuation repair research aid")}>
                <div className="valuation-repair-head"><div><p className="kicker">AI VALUATION REVIEW</p><h3>{t("低估原因与估值修复条件", "Why it is discounted and what could repair value")}</h3></div><small>{selectedHolding.valuationRepair.asOf || data.asOf} · {language === "zh" ? selectedHolding.valuationRepair.generatedBy : selectedHolding.valuationRepair.generatedByEn ?? selectedHolding.valuationRepair.generatedBy}</small></div>
                <div className="valuation-repair-grid">
                  <article><p className="kicker">WHY DISCOUNTED</p><h4>{t("当前为什么便宜", "Why the market discounts it")}</h4><ul>{(language === "zh" ? selectedHolding.valuationRepair.undervaluationReasons : selectedHolding.valuationRepair.undervaluationReasonsEn ?? selectedHolding.valuationRepair.undervaluationReasons).map((reason) => <li key={reason}>{reason}</li>)}</ul></article>
                  <article><p className="kicker">REPAIR CONDITIONS</p><h4>{t("估值修复需要什么", "Conditions for re-rating")}</h4><ul>{(language === "zh" ? selectedHolding.valuationRepair.repairConditions : selectedHolding.valuationRepair.repairConditionsEn ?? selectedHolding.valuationRepair.repairConditions).map((condition) => <li key={condition}>{condition}</li>)}</ul></article>
                  <article className="valuation-repair-risk"><p className="kicker">OUTLOOK RISKS</p><h4>{t("预期转恶的因素", "What could turn the outlook negative")}</h4><ul>{(language === "zh" ? selectedHolding.valuationRepair.failureSignals : selectedHolding.valuationRepair.failureSignalsEn ?? selectedHolding.valuationRepair.failureSignals).map((signal) => <li key={signal}>{signal}</li>)}</ul></article>
                </div>
                <div className="institution-reference"><div className="valuation-repair-head"><div><p className="kicker">PUBLIC INSTITUTION REFERENCES</p><h4>{t("公开机构估值参考", "Public institution valuation references")}</h4></div><small>{t("仅作参考，不代表模型采纳", "Reference only; not adopted by the model")}</small></div>{selectedHolding.valuationRepair.institutionReferences.length > 0 ? <div className="institution-reference-list">{selectedHolding.valuationRepair.institutionReferences.map((reference) => <article key={`${reference.institution}-${reference.publishedDate}`}><div><strong>{language === "zh" ? reference.institution : reference.institutionEn ?? reference.institution}</strong><small>{language === "zh" ? reference.rating : reference.ratingEn ?? reference.rating} · {language === "zh" ? reference.market : reference.marketEn ?? reference.market} · {reference.publishedDate}</small></div><b>{reference.targetPrice.toFixed(2)} {reference.currency}</b><p>{language === "zh" ? reference.note : reference.noteEn ?? reference.note}</p><a href={reference.sourceUrl} target="_blank" rel="noreferrer">{t("查看原文", "Open source")} ↗</a></article>)}</div> : <p className="institution-reference-empty">{t("暂无已整理的公开机构目标价；这里不会把缺失资料解释成没有参考。", "No public institution target has been compiled yet; missing coverage is not treated as no reference exists.")}</p>}</div>
                <p className="valuation-repair-disclaimer">{language === "zh" ? selectedHolding.valuationRepair.disclaimer : selectedHolding.valuationRepair.disclaimerEn ?? selectedHolding.valuationRepair.disclaimer}</p>
              </section>
            )}
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
            {selectedHolding.valuation && (
              <article className="dcf-sensitivity" aria-label={t("DCF五档折现率敏感性", "Five-level DCF discount-rate sensitivity")}>
                <div className="dcf-sensitivity-head"><div><p className="kicker">DCF SENSITIVITY</p><h3>{t("五档折现率敏感性", "Five discount-rate cases")}</h3></div><small>{t("基准门槛仍使用中性档；这里只展示估值区间", "The base gate remains neutral; this shows the valuation range")}</small></div>
                <div className="dcf-sensitivity-grid">{Object.entries(selectedHolding.valuation).map(([key, value]) => <div key={key} className={key === "base" ? "is-base" : ""}><span>{dcfCaseLabels[key]?.[language === "zh" ? "cn" : "en"] ?? key}</span><b>{pct(value.discountRate)}</b><strong>{money(value.valuePerShare)}</strong><em>{signedPct(value.marginOfSafety)}</em></div>)}</div>
              </article>
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
