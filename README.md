# Margin of Safety Strategy Website

A 股安全边际策略的公开只读网站。它展示前瞻模型组合的目标仓位、含分红单位净值、个人观察起始日、收益分布和动态护城河档案。

Live site: [ming-daily-portfolio.qianmin968641.chatgpt.site](https://ming-daily-portfolio.qianmin968641.chatgpt.site)

## Features

- Today、5日、1个月、6个月和1年真实前瞻收益；
- 当前价格、当日涨跌幅、目标权重和现金；
- 含现金分红与送转股的单位净值曲线；
- 每位访问者浏览器本地保存的个人起始日；
- 每只持仓的护城河机制、复制壁垒、监测和失效信号；
- 待人工复核事件与数据源健康状态；
- 中文/英文切换；
- 键盘操作、移动端布局和 `prefers-reduced-motion` 支持。

## Data boundary

The site reads a generated, browser-safe snapshot from:

```text
public/data/portfolio.json
```

The snapshot contains public portfolio research only. It must never contain a
Tushare token, API key, local path, broker credential or personal account data.

Portfolio history is shared and read-only. A visitor's language and chosen
start date are stored only in that visitor's browser and do not change the
public model history.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Validate before publishing:

```bash
npm test
```

## Important limitations

- The website is not a real-time quote terminal; data changes only after a new
  strategy snapshot is generated and deployed.
- Radar hits are research prompts, not automatic moat verdicts or trades.
- Missing or unavailable source data is not a clean risk signal.
- Nothing on the site is investment advice.

## License

MIT License. See [LICENSE](LICENSE).
