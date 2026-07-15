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
  assert.match(html, /<title>今日组合｜前瞻哑铃策略<\/title>/);
  assert.match(html, /正在读取今日组合/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("portfolio card includes unit accounting, reset, prices and daily NAV", async () => {
  const [page, dataText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/portfolio.json", import.meta.url), "utf8"),
  ]);
  const data = JSON.parse(dataText);
  assert.match(page, /ming-portfolio-units-v1/);
  assert.match(page, /投入 1 单位/);
  assert.match(page, /清零，重新开始/);
  assert.match(page, /我的累计收益/);
  assert.ok(data.holdings.length > 0);
  assert.ok(data.holdings.every((holding) => holding.price > 0));
  assert.ok(data.navHistory.length > 0);
  assert.equal(data.navHistory.at(-1).nav, 1);
});
