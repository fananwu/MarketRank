/* MarketRank · Fluxscape — 状态、数据装载与公共工具 */
(function () {
  "use strict";

  var META = window.MR_META;
  var SERIES = window.MR_SERIES;
  var BOARDS = window.MR_BOARDS;
  var MANIFEST = window.MR_MANIFEST;
  if (!META || !SERIES || !BOARDS || !MANIFEST) {
    document.getElementById("ldMsg").textContent = "数据文件缺失，请确认 data/ 目录完整";
    return;
  }

  var state = {
    idx: META.dates.length - 1,
    date: META.dates[META.dates.length - 1],
    frame: null,
    tracked: [],
    board: null,
    boardKind: "hy",
    boardQuery: "",
    view: "3d",
    playing: false,
    truthTop: 10,
    cross: null,
    selected: null,
    wire: false,
    hold: true,
    expanded: false
  };

  var byKind = {};
  META.boards.forEach(function (b) { (byKind[b.kind] = byKind[b.kind] || []).push(b); });
  var boardById = {};
  META.boards.forEach(function (b) { boardById[b.id] = b; });

  var KIND_LABEL = {
    hy: "行业", major: "大类", gn: "概念", fg: "风格",
    zs: "指数", flux: "资金社群"
  };

  var COMM_COLORS = [
    "#ff6b7d", "#4f9bff", "#39d3a0", "#f5c451", "#b18cff", "#ff9a55",
    "#58c7d8", "#e07bb5", "#9ad36b", "#7f8cff", "#ff7f50", "#5ed0c0",
    "#d0a6ff", "#ffc978", "#6fa8dc", "#ef6f9b"
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(d) {
    d = String(d);
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
  }
  function num(v, d) {
    if (!isFinite(v)) return "—";
    return Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function amount(v) {
    if (!isFinite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + "万亿";
    if (a >= 1e8) return (v / 1e8).toFixed(2) + "亿";
    if (a >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return Math.round(v).toString();
  }
  function signed(v, d, suffix) {
    if (!isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + num(v, d == null ? 2 : d) + (suffix || "");
  }
  function chgClass(v) { return v > 0.0001 ? "up" : (v < -0.0001 ? "down" : "flat"); }
  function commColor(c) { return COMM_COLORS[((Number(c) % COMM_COLORS.length) + COMM_COLORS.length) % COMM_COLORS.length]; }
  function boardLabel(b) { return KIND_LABEL[b.kind] || b.kind; }
  function sym(i) { return META.symbols[i] || []; }
  function symName(i) { return sym(i)[1] || sym(i)[0] || "—"; }
  function symCode(i) { return sym(i)[0] || "—"; }
  var colCache = {};
  function seriesOf(i) { return SERIES.data[i] || [[], [], [], [], [], []]; }
  function seriesCol(i, key) {
    var ck = i + "|" + key;
    var hit = colCache[ck];
    if (hit) return hit;
    var k = SERIES.cols.indexOf(key);
    var out = k < 0 ? [] : (SERIES.data[i] || [])[k] || [];
    colCache[ck] = out;
    return out;
  }

  /* 帧内 πN 排名（1 = 最高），按 active 过滤 */
  var rankCache = { date: null, map: null, total: 0 };
  function rankMap(f) {
    if (!f) return null;
    if (rankCache.date === f.date) return rankCache.map;
    var idx = [];
    for (var i = 0; i < f.score.length; i++) if (f.active[i]) idx.push(i);
    idx.sort(function (a, b) { return f.score[b] - f.score[a]; });
    var m = new Int32Array(f.score.length);
    m.fill(-1);
    idx.forEach(function (v, k) { m[v] = k + 1; });
    rankCache = { date: f.date, map: m, total: idx.length };
    return m;
  }
  function rankOf(f, i) {
    var m = rankMap(f);
    return m ? m[i] : -1;
  }

  /* 反查：某只股票属于哪些板块 */
  var symBoardIdx = null;
  function boardsOf(i) {
    if (!symBoardIdx) {
      symBoardIdx = {};
      META.boards.forEach(function (b) {
        if (b.kind === "flux" || !b.members) return;
        b.members.forEach(function (m) {
          (symBoardIdx[m] = symBoardIdx[m] || []).push(b.id);
        });
      });
    }
    return (symBoardIdx[i] || []).map(function (id) { return boardById[id]; }).filter(Boolean);
  }

  /* 个股 60 日统计（全部基于真实 OHLC） */
  function metrics(i, t) {
    t = t == null ? state.idx : t;
    var close = seriesCol(i, "close"), high = seriesCol(i, "high"),
        low = seriesCol(i, "low"), amt = seriesCol(i, "amt"),
        score = seriesCol(i, "score"), comm = seriesCol(i, "comm");
    var c = close[t], pc = t > 0 ? close[t - 1] : c;
    var out = {
      o: seriesCol(i, "open")[t], h: high[t], l: low[t], c: c, pc: pc,
      amp: pc > 0 ? (high[t] - low[t]) / pc * 100 : NaN,
      ret20: NaN, ret60: NaN, mdd: NaN, pos: NaN, hi: NaN, lo: NaN,
      amtAvg: NaN, migr: 0, score5: NaN
    };
    var from = Math.max(0, t - 19);
    if (close[from] > 0) out.ret20 = (c / close[from] - 1) * 100;
    if (close[0] > 0) out.ret60 = (c / close[0] - 1) * 100;
    var s = t >= 40 ? t - 39 : 0, hi = -Infinity, lo = Infinity, peak = 0, mdd = 0;
    for (var k = s; k <= t; k++) {
      if (high[k] > 0) hi = Math.max(hi, high[k]);
      if (low[k] > 0 && low[k] < 1e6) lo = Math.min(lo, low[k]);
      var cc = close[k];
      if (cc > peak) peak = cc;
      if (peak > 0) mdd = Math.min(mdd, cc / peak - 1);
    }
    out.hi = hi; out.lo = lo; out.mdd = mdd * 100;
    out.pos = hi > lo && isFinite(hi) && isFinite(lo) ? (c - lo) / (hi - lo) * 100 : NaN;
    var sum = 0, cnt = 0;
    for (var q = Math.max(0, t - 19); q <= t; q++) if (amt[q] > 0) { sum += amt[q]; cnt++; }
    out.amtAvg = cnt ? sum / cnt : NaN;
    var migr = 0;
    for (var m = Math.max(1, t - 59); m <= t; m++) if (comm[m] !== comm[m - 1]) migr++;
    out.migr = migr;
    if (t >= 5 && score[t - 5] > 0) out.score5 = (score[t] / score[t - 5] - 1) * 100;
    return out;
  }


  /* 地形颜色：diverging red(inflow) / blue(outflow)，tanh soft-clip（论文 §6.8） */
  function diverging(z, p90) {
    var t = Math.tanh(z / Math.max(0.35, (p90 || 1) * 1.1));
    var r, g, b;
    if (t >= 0) {
      r = 26 + 229 * t; g = 35 + 58 * t; b = 48 + 60 * t;
    } else {
      var u = -t;
      r = 26 + 37 * u; g = 35 + 105 * u; b = 48 + 207 * u;
    }
    return [r / 255, g / 255, b / 255];
  }

  function fitCanvas(cv) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(10, cv.clientWidth), h = Math.max(10, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  function line(ctx, pts, color, width, dash) {
    if (!pts.length) return;
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = width || 1.2;
    ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }

  function frameMembers(board, frame) {
    if (!board) return null;
    if (board.kind === "flux") {
      var cid = parseInt(board.id.split(":")[1], 10);
      var out = [];
      frame.comm.forEach(function (c, i) { if (c === cid) out.push(i); });
      return out;
    }
    return board.members;
  }

  function boardSeries(id) { return (BOARDS.ts && BOARDS.ts[id]) || []; }

  /* 全市场逐日聚合（无板块选择时的默认序列） */
  var marketCache = null;
  function marketRows() {
    if (marketCache) return marketCache;
    var out = [], n = SERIES.data.length, D = META.dates.length;
    for (var t = 0; t < D; t++) {
      var chg = 0, score = 0, amt = 0, up = 0, down = 0, cnt = 0;
      for (var i = 0; i < n; i++) {
        var row = SERIES.data[i];
        var c = row[2][t], s = row[0][t], a = row[4][t];
        if (!isFinite(c) || !isFinite(s)) continue;
        chg += c; score += s; amt += a; cnt++;
        if (c > 0) up++; else if (c < 0) down++;
      }
      out.push([chg / Math.max(1, cnt), score / Math.max(1, cnt), amt, up, down, 0, -1]);
    }
    marketCache = out;
    return out;
  }

  /* 帧懒加载：file:// 下也走 <script>，无 fetch/CORS 限制 */
  var pending = {};
  window.MR_ONFRAME = function (d) {
    var cbs = pending[d] || [];
    delete pending[d];
    cbs.forEach(function (cb) { cb(window.MR_FRAMES[d]); });
  };
  function loadFrame(date, cb) {
    if (window.MR_FRAMES[date]) { cb(window.MR_FRAMES[date]); return; }
    var list = pending[date] || (pending[date] = []);
    list.push(cb);
    if (list.length > 1) return;
    var s = document.createElement("script");
    var msg = document.getElementById("ldMsg");
    if (msg) msg.textContent = "正在载入 " + date + " 帧…";
    s.src = (window.MR_CDN || "") + "data/frames/" + date + ".js";
    s.onerror = function () {
      /* CDN 不可用时回退到同目录相对路径，每帧只回退一次 */
      if (!s.getAttribute("data-fallback")) {
        s.setAttribute("data-fallback", "1");
        if (msg) msg.textContent = "CDN 不可用，改用本地源载入 " + date + " 帧…";
        s.src = "data/frames/" + date + ".js";
        return;
      }
      delete pending[date];
      if (msg) msg.textContent = "帧加载失败: " + date;
    };
    document.head.appendChild(s);
  }

  var MR = {
    META: META, SERIES: SERIES, BOARDS: BOARDS, MANIFEST: MANIFEST,
    state: state, byKind: byKind, boardById: boardById, KIND_LABEL: KIND_LABEL,
    COMM_COLORS: COMM_COLORS,
    esc: esc, fmtDate: fmtDate, num: num, amount: amount, signed: signed,
    chgClass: chgClass, commColor: commColor, boardLabel: boardLabel,
    sym: sym, symName: symName, symCode: symCode, seriesOf: seriesOf,
    seriesCol: seriesCol, diverging: diverging, fitCanvas: fitCanvas, line: line,
    frameMembers: frameMembers, boardSeries: boardSeries, loadFrame: loadFrame,
    marketRows: marketRows,
    rankMap: rankMap, rankOf: rankOf, boardsOf: boardsOf, metrics: metrics,
    labelMode: 30,
    percent: function (v, d) {
      if (!isFinite(v)) return "—";
      return (v > 0 ? "+" : "") + v.toFixed(d == null ? 2 : d) + "%";
    },
    render: function () {}, renderSelection: function () {}
  };
  window.MR = MR;
})();
