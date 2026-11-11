# MarketRank · Fluxscape

**A 股资金稳态地形的马尔可夫链复现与证伪**

把 A 股的资金流建成马尔可夫链、求稳态分布 π、渲染成可交互的三维资金地形 —— 然后用零模型把这个看起来最好的结果证伪掉。

> 基础工作：B. K. Karamete, *MarketRank*, [arXiv:2610.08946v1](https://arxiv.org/abs/2610.08946)
> 复现标的：A 股，2,000 只（沪深北，含 237 只 ETF/基金），60 个交易日（2026-08-10 ~ 2026-11-09）

*An interactive 3D "capital terrain" for China's A-share market. We port the MarketRank Markov-chain pipeline, adapt it to six A-share institutional differences, then falsify our own best-looking result with a size-neutralization control and two null models. Conclusion: the solver is sound; the daily-bar connectivity is not.*

---

## 结论先行

三层结论，其中两层是负的。这是本仓库的主要贡献，不是附注。

| 层 | 结论 | 关键数字 |
|---|---|---|
| 1 · 正（弱于美股） | 行业富集确实存在，但明显弱于美股 | 104 细分：0.0533 vs 零模型 0.0355（**1.50×**）；12 大类：0.2318 vs 0.1779（**1.30×**）；原论文美股同口径 **2.35×** |
| 2 · **负（核心）** | 表面强反转信号是**小盘效应的伪装** | 原始 IC = **−0.0806**（t = −4.42）；小盘因子 IC = **+0.0930**（t = +5.11）更强；规模中性化后 IC 翻正为 **+0.0287**（t = +1.91），不再显著 |
| 3 · 负 | 资金社群是快照，不是结构 | 社群 NMI 0.153（104 细分）/ 0.089（12 大类）；1 日后自一致度 0.679，20 日后降至 0.177 |

第二层是本文相对原论文的方法论增量：**原论文证伪的是自己的模型，本文证伪的是自己的实证结果** —— 先拿到一个漂亮的负 IC，再用两个对照说明它是假的。

这与原论文的结论同构但更强：*求解器是数学，没有问题；问题在喂进去的连通性。*

---

## 打开方式

零构建，无依赖安装，无打包步骤。

```bash
# 方式一：直接双击 index.html（file:// 可正常加载）

# 方式二：起个静态服务器（推荐，避免个别浏览器的 file:// 限制）
python -m http.server 8000
# 打开 http://localhost:8000
```

页面加载后：滚轮无级缩放 · 拖动旋转 · 中键拖动平移 · 双击小球看个股详情 · 时间轴可播放 60 个交易日。

### 在线演示与资源加载

线上地址：<https://fananwu.github.io/MarketRank/>

页面资源优先从 jsDelivr CDN 加载（`cdn.jsdelivr.net/gh/fananwu/MarketRank@v1.0.1/`），
原因是 GitHub Pages 的服务节点在东京，国内访问约 3.7MB 的同步脚本时常中途断连。
任一资源加载失败会自动回退到仓库内相对路径，因此**离线或 CDN 不可用时仍能正常运行**。

本地开发时若改动了 `js/` 或 `data/`，记得把 `index.html` 里的版本号与资源路径一起更新，
并打新 tag —— jsDelivr 对分支名有 12 小时缓存，用 commit 引用可避免版本错配。

---

## 目录结构

```
index.html              单页入口
styles.css              全部样式
js/
  core.js               数据装配、K 线合成、格式化
  landscape.js          Three.js 地形：等高线、资金流粒子、网格、标签层
  panels.js             板块导航、KPI、时间轴
  drill.js              下钻详情：个股 K 线、边表、社群、真值表
  chartlib.js           轻量 Canvas 绘图工具
  main.js               事件绑定、偏好持久化
data/                   预生成数据集（见 data/README.md）
  manifest.js           60 帧的逐帧统计（论文复算入口）
  meta.js               2,000 只代码/名称/行业/板块
  series.js             全量时序面板
  boards.js             743 个板块时序
  frames/*.js           逐日帧（约 650 KB/帧，懒加载）
vendor/three.min.js     Three.js（MIT）
tools/
  analyze_paper.py      论文全部实测数字的秒级复算
  smoke_final.js        页面验收脚本（CDP）
A股资金稳态地形-论文-MarketRank中国复现与证伪.md
MarketRank-资金流马尔可夫链排名-中文详解.md
```

---

## 复现

### 秒级复算（不重跑模型）

论文附录 A.3 列出的全部指标都可以从已提交的 `data/` 直接算出，不需要重跑模型、不需要重新抓数据：

```bash
python tools/analyze_paper.py
```

输出按论文小节分块：稳态指标（§8.1）、行业一致性 + 打乱零模型（§8.3）、结构增益（§8.4）、IC 与小盘对照 + 规模中性化（§9.1–9.3）、社群持久性 NMI（§10）。复算方式与论文附录 A.3 一一对应。

`data/` 已自包含全部复算所需数据，无需重建。原始数据管道依赖本地通达信目录，未随仓库发布；如需复刻数据集，请参考 `data/README.md` 的字段说明与论文 §7 的构造过程。

---

## 模型参数

| 环节 | 做法 |
|---|---|
| 压力 | φ = r · V · VWAP（涨跌 × 成交额），φ > 0 为汇点，φ < 0 为来源 |
| 配对 | correlation-tilted gravity：a_ij = 1 + λρ_ij，每个 source 取最强的 top-64 个 sink |
| 剪枝 | 累积 T 后双侧剪枝（行 top-20 / 列 top-10），行归一化得 P |
| 稳态 | 阻尼幂迭代 π = (1−p)πP + p/N，p = 0.15，至 ‖Δπ‖₁ < 1e−10 |
| 排名 | score = πN，1 为市场平均 |
| 高度 | height = log(π/s)，s 为 20 日中位成交额份额 |
| 心跳 | heartbeat = Δlog(πN) |

---

## 数据边界

- 数据为通达信日线，区间 2026-08-10 ~ 2026-11-09，共 60 个交易日，2,000 只标的。
- 全部数值为按论文公式在本地重算的结果，**不构成任何投资建议**。
- 本项目的结论是负的：π 不预测次日收益，flux communities 不是行业板块。请勿将其用作选股工具。
- `data/` 内的行情数据仅用于本复现的方法验证，不在本仓库的代码许可范围内（见下节）。

---

## 引用

若在研究中引用本项目：

```bibtex
@misc{marketrank_ashare_2026,
  title  = {A 股资金稳态地形的马尔可夫链建模与证伪},
  author = {fananwu},
  year   = {2026},
  note   = {Reproduction and falsification of arXiv:2610.08946 on China's A-share market},
  url    = {https://github.com/fananwu/MarketRank}
}
```

同时请引用原始工作：B. K. Karamete, *MarketRank*, arXiv:2610.08946v1.

---

## 许可

Copyright © 2026 fananwu.

本仓库采用**分块授权**，请注意区分：

| 范围 | 许可 |
|---|---|
| 代码（`js/`、`index.html`、`styles.css`、`tools/*.py`、`tools/*.js`） | **Apache-2.0** — 见 [LICENSE](LICENSE)，含明示专利授权 |
| 文档（两份论文 `.md`） | **CC BY 4.0** — 见 [LICENSE-DOCS](LICENSE-DOCS) |
| 第三方依赖（`vendor/three.min.js`） | MIT，版权归 three.js authors — 见 [NOTICE](NOTICE) |
| `data/` 内的行情数据 | **不在上述许可范围内**，不随本仓库授权再分发 |

选用 Apache-2.0 而非 MIT 的原因：本项目的主要价值在方法论（零模型检验、规模中性化、三层证伪）。Apache-2.0 的专利授权条款可以防止使用者将本方法申请专利后反过来限制原作者。
