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
};

type NavPoint = { date: string; nav: number; dailyReturn: number; priceCoverage: number };
type PortfolioData = {
  asOf: string;
  generatedAt: string;
  summary: { anchorWeight: number; futureWeight: number; cashWeight: number };
  holdings: Holding[];
  navHistory: NavPoint[];
};
type Lot = { date: string; entryNav: number };

const STORAGE_KEY = "ming-portfolio-units-v1";
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${pct(value, 2)}`;
const money = (value: number) => `¥${value.toFixed(2)}`;

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

  if (!data && !error) return <main className="status"><p>正在读取今日组合…</p></main>;
  if (!data) return <main className="status"><p>{error}</p><button onClick={load}>重新读取</button></main>;

  const history = data.navHistory.slice(-7);

  return (
    <main className="canvas">
      <section className="sheet" aria-label="今日组合总览">
        <header className="topbar">
          <div>
            <p className="kicker">FORWARD BARBELL · {data.asOf}</p>
            <h1>今日组合</h1>
          </div>
          <div className="top-actions">
            <span>最近完成交易日收盘价</span>
            <button className="text-button" onClick={load} disabled={refreshing}>{refreshing ? "读取中" : "刷新"}</button>
          </div>
        </header>

        <div className="summary-grid">
          <article>
            <span>组合单位净值</span>
            <strong>{currentNav.toFixed(4)}</strong>
            <small>起始价格 1.0000</small>
          </article>
          <article>
            <span>今日涨跌</span>
            <strong className={(latest?.dailyReturn ?? 0) >= 0 ? "up" : "down"}>{signedPct(latest?.dailyReturn ?? 0)}</strong>
            <small>按上一交易日仓位计算</small>
          </article>
          <article>
            <span>我的累计收益</span>
            <strong className={personalReturn >= 0 ? "up" : "down"}>{lots.length ? signedPct(personalReturn) : "—"}</strong>
            <small>{firstDate ? `从 ${firstDate} 开始` : "投入1单位后开始记录"}</small>
          </article>
          <article>
            <span>我的组合总价值</span>
            <strong>{lots.length ? totalValue.toFixed(4) : "0.0000"}</strong>
            <small>{lots.length} 个累计单位</small>
          </article>
        </div>

        <div className="content-grid">
          <section className="positions" aria-labelledby="positions-title">
            <div className="panel-title">
              <div><p className="kicker">TARGET POSITIONS</p><h2 id="positions-title">买入价与仓位</h2></div>
              <div className="allocation-tags">
                <span className="anchor-tag">锚仓 {pct(data.summary.anchorWeight, 0)}</span>
                <span className="future-tag">期权 {pct(data.summary.futureWeight)}</span>
                <span className="cash-tag">现金 {pct(data.summary.cashWeight)}</span>
              </div>
            </div>
            <div className="positions-table" role="table" aria-label="目标持仓表">
              <div className="table-head" role="row"><span>股票</span><span>申万行业</span><span>类型</span><span>参考价</span><span>目标仓位</span><span>每1单位配置</span></div>
              {data.holdings.map((holding) => (
                <div className="stock-row" role="row" key={holding.code}>
                  <span className="stock-name"><b>{holding.name}</b><small>{holding.code}</small></span>
                  <span className="industry">{holding.industry}</span>
                  <span><i className={holding.bucket === "ANCHOR" ? "anchor-dot" : "future-dot"} />{holding.bucket === "ANCHOR" ? "稳定锚" : "未来期权"}</span>
                  <span className="price">{money(holding.price)}</span>
                  <strong>{pct(holding.weight)}</strong>
                  <span className="unit-allocation">{holding.weight.toFixed(4)}</span>
                </div>
              ))}
              <div className="stock-row cash-row" role="row">
                <span className="stock-name"><b>现金</b><small>CASH</small></span><span className="industry">—</span>
                <span><i className="cash-dot" />选择权</span><span className="price">—</span><strong>{pct(data.summary.cashWeight)}</strong><span className="unit-allocation">{data.summary.cashWeight.toFixed(4)}</span>
              </div>
            </div>
          </section>

          <aside className="unit-panel" aria-labelledby="unit-title">
            <p className="kicker">PERSONAL ACCUMULATION</p>
            <h2 id="unit-title">单位1，慢慢积累。</h2>
            <p className="unit-explain">每次投入1单位，按当天组合净值买入一份完整组合。不同人的记录互不相同，只保存在自己的浏览器里。</p>
            <div className="unit-composition" aria-label="每单位组成">
              <div><span><i className="anchor-dot" />稳定锚仓</span><b>{data.summary.anchorWeight.toFixed(4)}</b></div>
              <div><span><i className="future-dot" />未来期权</span><b>{data.summary.futureWeight.toFixed(4)}</b></div>
              <div><span><i className="cash-dot" />现金</span><b>{data.summary.cashWeight.toFixed(4)}</b></div>
            </div>
            <div className="unit-number"><strong>{lots.length}</strong><span>累计单位</span></div>
            <div className="unit-buttons">
              <button className="primary-button" onClick={() => saveLots([...lots, { date: data.asOf, entryNav: currentNav }])}>+ 投入 1 单位</button>
              <button className="secondary-button" onClick={() => saveLots(lots.slice(0, -1))} disabled={!lots.length}>撤回上一单位</button>
            </div>
            <button className="reset-button" onClick={() => { if (!lots.length || window.confirm("清零后将从单位0重新开始，确定吗？")) saveLots([]); }}>清零，重新开始</button>
            <p className="unit-note">1单位是归一化记账单位，不代表1元，也不自动下单。参考价为最近收盘价。</p>
          </aside>
        </div>

        <footer className="history-bar">
          <div><p className="kicker">DAILY RECORD</p><h2>组合价格记录</h2></div>
          <div className="history-points">
            {history.map((point) => (
              <div key={point.date}><span>{point.date.slice(5)}</span><strong>{point.nav.toFixed(4)}</strong><small className={point.dailyReturn >= 0 ? "up" : "down"}>{signedPct(point.dailyReturn)}</small></div>
            ))}
          </div>
          <p className="disclaimer">系统每个交易日自动追加；研究用途，不构成投资建议。</p>
        </footer>
      </section>
    </main>
  );
}
