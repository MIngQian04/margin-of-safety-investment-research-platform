"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Holding = {
  code: string;
  name: string;
  bucket: "ANCHOR" | "FUTURE";
  state: string;
  theme: string;
  industry: string;
  weight: number;
  metrics: Record<string, string>;
};

type PortfolioData = {
  asOf: string;
  generatedAt: string;
  summary: {
    anchorWeight: number;
    futureWeight: number;
    cashWeight: number;
    universeScanned: number;
    financialReviewed: number;
    financialComplete: number;
    anchorEligible: number;
  };
  holdings: Holding[];
  pendingFinancials: string[];
  logic: { step: string; title: string; body: string }[];
};

const pct = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

function HoldingCard({ holding }: { holding: Holding }) {
  return (
    <article className={`holding-card ${holding.bucket === "FUTURE" ? "future-card" : ""}`}>
      <div className="holding-head">
        <div>
          <p className="eyebrow">{holding.industry} · {holding.code}</p>
          <h3>{holding.name}</h3>
        </div>
        <strong className="holding-weight">{pct(holding.weight)}</strong>
      </div>
      <div className="metric-row">
        {Object.entries(holding.metrics).map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <b>{value.replace("BOTTOM_HOLD_NO_ADD", "底部持有 · 暂不加仓")}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function Home() {
  const [data, setData] = useState<PortfolioData | null>(null);
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

  useEffect(() => { load(); }, [load]);

  const anchors = useMemo(() => data?.holdings.filter((item) => item.bucket === "ANCHOR") ?? [], [data]);
  const futures = useMemo(() => data?.holdings.filter((item) => item.bucket === "FUTURE") ?? [], [data]);

  if (!data && !error) {
    return <main className="status-page"><p className="eyebrow">PORTFOLIO NOTE</p><h1>正在读取今日组合…</h1></main>;
  }
  if (!data) {
    return <main className="status-page"><p className="eyebrow">DATA OFFLINE</p><h1>{error}</h1><button onClick={load}>重新读取</button></main>;
  }

  const ring = `conic-gradient(var(--sage) 0 ${data.summary.anchorWeight * 100}%, var(--terracotta) ${data.summary.anchorWeight * 100}% ${(data.summary.anchorWeight + data.summary.futureWeight) * 100}%, var(--sand) ${(data.summary.anchorWeight + data.summary.futureWeight) * 100}% 100%)`;

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到顶部">MING <span>/</span> PORTFOLIO NOTE</a>
        <div className="header-actions">
          <span className="live-dot">策略快照</span>
          <button className="refresh-button" onClick={load} disabled={refreshing}>{refreshing ? "读取中" : "重新读取"}</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AS OF {data.asOf} · FORWARD BARBELL</p>
          <h1>今天，<br />组合应该怎么拿。</h1>
          <p className="hero-note">稳定现金流负责等待，未来产业负责可能性，现金负责选择权。</p>
        </div>
        <div className="allocation-card">
          <div className="ring" style={{ background: ring }} role="img" aria-label={`稳定锚${pct(data.summary.anchorWeight)}，未来期权${pct(data.summary.futureWeight)}，现金${pct(data.summary.cashWeight)}`}>
            <div className="ring-center"><strong>{pct(1 - data.summary.cashWeight)}</strong><span>已配置</span></div>
          </div>
          <div className="allocation-list">
            <div><i className="dot sage" /><span>稳定锚</span><b>{pct(data.summary.anchorWeight)}</b></div>
            <div><i className="dot terra" /><span>未来期权</span><b>{pct(data.summary.futureWeight)}</b></div>
            <div><i className="dot sand" /><span>现金</span><b>{pct(data.summary.cashWeight)}</b></div>
          </div>
        </div>
      </section>

      <section className="section holdings-section" aria-labelledby="anchor-title">
        <div className="section-heading">
          <div><p className="eyebrow">01 · STABLE ANCHORS</p><h2 id="anchor-title">稳定锚仓</h2></div>
          <p>目标 {pct(data.summary.anchorWeight)} · {anchors.length} 家公司</p>
        </div>
        <div className="holding-grid">{anchors.map((holding) => <HoldingCard holding={holding} key={holding.code} />)}</div>
      </section>

      <section className="section future-section" aria-labelledby="future-title">
        <div className="section-heading">
          <div><p className="eyebrow">02 · FUTURE OPTIONS</p><h2 id="future-title">未来产业期权</h2></div>
          <p>目标 {pct(data.summary.futureWeight)} · 只试错，不追涨</p>
        </div>
        <div className="holding-grid future-grid">{futures.map((holding) => <HoldingCard holding={holding} key={holding.code} />)}</div>
      </section>

      <section className="cash-panel" aria-label="现金仓位">
        <div><p className="eyebrow">03 · OPTIONALITY</p><h2>现金也是仓位。</h2></div>
        <strong>{pct(data.summary.cashWeight)}</strong>
        <p>没有足够证据时，不为了满仓降低标准。现金等待更好的价格、产业里程碑与趋势确认。</p>
      </section>

      <section className="section logic-section" aria-labelledby="logic-title">
        <div className="logic-intro">
          <p className="eyebrow">THE PORTFOLIO LOGIC</p>
          <h2 id="logic-title">组合不是预测，<br />而是一套升级规则。</h2>
          <p>先决定买什么，再决定什么时候加仓。财务数据用于判断能否长期等待，国家规划与产业需求用于寻找未来，价格与成交量只负责时机。</p>
        </div>
        <div className="logic-list">
          {data.logic.map((item) => <article key={item.step}><span>{item.step}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}
        </div>
      </section>

      <section className="section funnel" aria-labelledby="funnel-title">
        <div className="section-heading">
          <div><p className="eyebrow">FULL MARKET FUNNEL</p><h2 id="funnel-title">全A股海选进度</h2></div>
          <p>缺失数据永远不会被当作合格</p>
        </div>
        <div className="funnel-grid">
          <div><strong>{data.summary.universeScanned.toLocaleString("zh-CN")}</strong><span>全市场扫描</span></div>
          <div><strong>{data.summary.financialReviewed}</strong><span>进入财务复核</span></div>
          <div><strong>{data.summary.financialComplete}</strong><span>财务数据完整</span></div>
          <div><strong>{data.summary.anchorEligible}</strong><span>锚仓规则合格</span></div>
        </div>
        {data.pendingFinancials.length > 0 && <p className="pending-note">待网络恢复后补齐：{data.pendingFinancials.join("、")}。这些公司当前强制保持观察。</p>}
      </section>

      <footer>
        <p>研究规则输出，不构成投资建议或自动交易指令。</p>
        <p>数据日期 {data.asOf} · 页面生成 {new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
      </footer>
    </main>
  );
}
