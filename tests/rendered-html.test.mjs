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
  assert.match(page, /Price \/ Weight/);
  assert.match(page, /money\(holding\.price\)/);
  assert.match(css, /west-lake-willow-bg\.png/);
  assert.match(css, /west-lake-breeze/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(background.byteLength > 100_000);
  assert.ok(data.holdings.length > 0);
  assert.ok(data.holdings.every((holding) => holding.price > 0));
  assert.ok(data.holdings.every((holding) => Number.isFinite(holding.distribution.skewness)));
  assert.ok(data.holdings.every((holding) => Number.isFinite(holding.distribution.excessKurtosis)));
  assert.ok(data.holdings.every((holding) => holding.distribution.skewLabel));
  assert.ok(data.holdings.every((holding) => holding.distribution.kurtosisLabel));
  assert.ok(Number.isFinite(data.distributionSummary.skewness));
  assert.ok(Number.isFinite(data.distributionSummary.excessKurtosis));
  assert.ok(data.distributionSummary.observations >= 200);
  assert.ok(data.navHistory.length > 0);
  assert.equal(data.navHistory.at(-1).nav, 1);
});
