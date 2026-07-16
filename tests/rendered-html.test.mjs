import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the portfolio shell and finished metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>护城河价值策略｜前瞻哑铃策略<\/title>/);
  assert.match(html, /正在读取护城河价值策略/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("portfolio card includes interactive period returns, chart, positions and portfolio distribution", async () => {
  const [page, css, dataText, background] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/data/portfolio.json", import.meta.url), "utf8"),
    readFile(new URL("../public/images/west-lake-willow-bg.png", import.meta.url)),
  ]);
  const data = JSON.parse(dataText);
  assert.doesNotMatch(page, /ming-portfolio-units-v1|投入 1 单位|清零，重新开始/);
  assert.doesNotMatch(page, /组合 Sharpe|加权个股 Sharpe|年化波动|最大回撤/);
  assert.match(page, /Kurtosis/);
  assert.match(page, /Portfolio Return Curve/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /5 Days/);
  assert.match(page, /1 Month/);
  assert.match(page, /6 Months/);
  assert.match(page, /1 Year/);
  assert.match(page, /Current Positions/);
  assert.match(page, /PORTFOLIO DISTRIBUTION/);
  assert.match(page, /chart-tooltip/);
  assert.match(page, /Moat Value Strategy/);
  assert.match(page, /Today/);
  assert.match(page, /money\(holding\.price\)/);
  assert.match(page, /holding\.dailyReturn/);
  assert.match(page, /rankedHoldings/);
  assert.match(page, /right\.dailyReturn - left\.dailyReturn/);
  assert.match(page, /今日↓/);
  assert.match(page, /可上下滚动/);
  assert.match(page, /tabIndex=\{0\}/);
  assert.match(page, /<em>0<\/em>/);
  assert.match(page, /确认刷新？/);
  assert.match(page, /不会清零、不改变起始日期，也不会删除历史收益记录/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /setConfirmRefresh\(true\)/);
  assert.match(page, /moat-value-personal-start-date-v1/);
  assert.match(page, /设置个人起始日/);
  assert.match(page, /只保存在当前浏览器，不改变公共组合历史/);
  assert.match(page, /type="date"/);
  assert.match(page, /latest\.nav \/ personalStart\.nav - 1/);
  assert.match(page, /data\.navHistory\.filter\(\(point\) => point\.date >= personalStart\.date\)/);
  assert.match(page, /PerformanceChart history=\{personalHistory\}/);
  assert.match(page, /Personal Unit NAV/);
  assert.doesNotMatch(page, /正在积累该周期记录|记录积累中|Building this range|记录积累中 · Building/);
  assert.match(css, /\.confirm-dialog/);
  assert.match(css, /\.date-field input/);
  assert.match(css, /west-lake-willow-bg\.png/);
  assert.match(css, /west-lake-breeze/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /width:min\(1180px,100%\)/);
  assert.match(css, /height:min\(780px,calc\(100svh - 36px\)\)/);
  assert.match(css, /grid-template-columns:minmax\(0,3fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.period-summary strong \{[^}]*font-size:32px/);
  assert.match(css, /\.axis-label \{[^}]*font-size:12px/);
  assert.doesNotMatch(css, /\.chart-building/);
  assert.match(css, /\.portfolio-distribution \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.holding-list b \{[^}]*font-size:15px/);
  assert.match(css, /\.holding-list>div \{[^}]*min-height:36px/);
  assert.match(css, /\.holding-identity b,\.holding-identity small \{[^}]*white-space:nowrap/);
  assert.match(css, /\.holding-list \{[^}]*overflow-y:auto/);
  assert.match(css, /writing-mode:horizontal-tb/);
  assert.match(css, /background:rgba\(37,36,31,\.46\)/);
  assert.match(css, /background:rgba\(250,248,243,\.48\)/);
  assert.match(css, /backdrop-filter:blur\(\.5px\)/);
  assert.ok(background.byteLength > 100_000);
  assert.ok(data.holdings.length > 0);
  assert.ok(data.holdings.every((holding) => holding.price > 0));
  assert.ok(data.holdings.every((holding) => Number.isFinite(holding.dailyReturn)));
  assert.ok(data.holdings.every((holding) => Number.isFinite(holding.distribution.skewness)));
  assert.ok(data.holdings.every((holding) => Number.isFinite(holding.distribution.excessKurtosis)));
  assert.ok(data.holdings.every((holding) => holding.distribution.skewLabel));
  assert.ok(data.holdings.every((holding) => holding.distribution.kurtosisLabel));
  assert.ok(Number.isFinite(data.distributionSummary.skewness));
  assert.ok(Number.isFinite(data.distributionSummary.excessKurtosis));
  assert.ok(data.distributionSummary.observations >= 200);
  assert.ok(data.navHistory.length > 0);
  assert.equal(data.navHistory[0].nav, 1);
  assert.equal(data.navHistory[0].date, "2026-07-15");
  assert.equal(data.navHistory[0].dailyReturn, 0);
  assert.ok(Number.isFinite(data.navHistory.at(-1).nav));
  assert.ok(data.navHistory.at(-1).nav > 0);
});
