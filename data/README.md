# data/ · 预生成数据集

本目录是 `tools/build_dataset.py` 的产物，页面直接以 `<script>` 方式加载，无需任何构建步骤。

所有 `.js` 文件都是 `window.MR_* = {...}` 形式的纯数据赋值，可以直接用 Python / Node 读取后做二次分析。

---

## 文件与结构

### `manifest.js` → `window.MR_MANIFEST`

```js
{ dates: ["20260810", ...],        // 60 个交易日
  frames: ["20260810.js", ...],    // 帧文件名
  stats:  [ {...}, ... ] }         // 逐帧统计，与 dates 一一对应
```

`stats` 每项字段：`active`（活跃标的数）、`floor`（传送地板占比）、`gini`（π 集中度）、`coh`（行业一致性）、`up` / `down`（上涨 / 下跌家数）、`amount`（全市场成交额）、`iters`（幂迭代次数）、`comm`（社群数）、`flow`（总流量）。

**这是论文复算的入口** —— `tools/analyze_paper.py` 的稳态指标、行业一致性、结构增益均由此出发，对应论文附录 A.3。

### `meta.js` → `window.MR_META`

```js
{ paper, generated, dates,
  symbols: [ [代码, 名称, 市场, 类别, 行业, 标志位, 日期], ... ],  // 2,000 项
  boards:  [ { id, kind, name, members: [股票下标], ... } ],      // 743 个板块
  holdings, params, sources }
```

`params` 记录模型参数（`damping` / `alpha` / `lambda` 等），`sources` 记录原始数据来源路径。字段细节以 `tools/build_dataset.py` 的写入口为准。

### `series.js` → `window.MR_SERIES`

```js
{ cols: ["score","z","chg","close","amt","comm","open","high","low"],
  data: [ 股票 ][ 列 ][ 交易日 ] }
```

`data[i][k][t]` 即第 i 只股票在第 t 日的第 k 个指标。九列的含义分别是：模型得分 πN、标准化 z、涨跌幅（%）、收盘价、成交额、社群 ID、开盘、最高、最低。

### `boards.js` → `window.MR_BOARDS`

```js
{ ts: { "fg:MSCI中盘": [ [涨幅, πN, 成交额, 上涨数, 下跌数, 强弱, 只数], ... ], ... } }
```

每个板块一条按日排列的数组，字段顺序与页面「板块全景」表头一致。

### `frames/YYYYMMDD.js` → `window.MR_FRAME(date, obj)`

单日完整帧，约 650 KB，由页面按需动态插入 `<script>` 懒加载：

```js
{ date, i, n,                        // 日期、帧序号、标的数
  score, hb, z, chg, close, amt,     // 长度均为 n 的逐只数组
  hot, comm, active,                 // 热度、社群 ID、活跃标志
  top,                               // 关注列表下标
  edges,                             // [source, sink, 流量份额, 流量金额]
  grid,                              // 地形采样网格 { n, h: [...] }
  communities,                       // [{ id, n, lead, z }]
  stats }                            // 与 manifest 中同帧一致
```

地形渲染只依赖 `score` / `grid` / `edges` / `comm`，价格类字段仅用于下钻详情面板。

---

## 读取示例

```python
import re, json

def load(path, var):
    raw = open(path, encoding="utf-8").read()
    s = raw[raw.index("{"):].rstrip().rstrip(";")
    return json.loads(s[:s.rindex("}") + 1])

manifest = load("data/manifest.js", "MR_MANIFEST")
series   = load("data/series.js",   "MR_SERIES")
print(len(manifest["dates"]), len(series["cols"]))
```

---

## 边界

- 数据区间 2026-08-10 ~ 2026-11-09，60 个交易日，2,000 只标的（含 237 只 ETF/基金）。
- 来源为通达信日线；`meta.sources` 中记录了具体路径。
- **本目录的数据不在仓库代码许可（Apache-2.0）范围内**，仅用于本复现的方法验证。
- 全部数值不构成任何投资建议。
