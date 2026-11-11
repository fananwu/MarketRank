/* MarketRank · Fluxscape — 放大视图（大图 + 十字光标读数 + 数据明细表）
   mode: sym 个股 / board 板块 / graph 转移网络 / paths 跟踪路径 */
(function () {
  "use strict";
  if (!window.MR) return;
  var MR = window.MR, st = MR.state, C = MR.Chart;

  var D = {
    open: false, mode: null, payload: {}, tab: 0, hover: -1,
    geom: null, scope: "track", gpos: {}, gids: []
  };
  var cv, ctx, W = 0, H = 0, wrap;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return MR.esc(s); }
  function pad2(v) { return (v < 10 ? "0" : "") + v; }

  var MODES = {
    sym: { kind: "个股详情", tabs: ["K 线 · 成交量", "πN 轨迹", "资金对手"] },
    board: { kind: "板块详情", tabs: ["板块走势", "成分分布", "贡献榜"] },
    graph: { kind: "资金转移网络", tabs: ["跟踪邻域", "板块成分", "Top 30"] },
    paths: { kind: "跟踪路径", tabs: ["log(π/s)", "涨跌幅", "πN", "资金社群"] }
  };

  /* ------------------------------------------------------------------ 打开 / 关闭 */
  function open(mode, payload) {
    if (!st.frame) return;
    D.open = true;
    D.mode = mode;
    D.payload = payload || {};
    D.tab = 0;
    D.hover = -1;
    if (mode === "sym" && D.payload.i == null) D.payload.i = st.selected != null ? st.selected : st.frame.top[0];
    el("drill").classList.remove("hidden");
    render();
  }
  function close() {
    D.open = false;
    el("drill").classList.add("hidden");
  }

  /* ------------------------------------------------------------------ 渲染骨架 */
  function render() {
    if (!D.open || !st.frame) return;
    var cfg = MODES[D.mode];
    var t = titleOf();
    el("drillKind").textContent = cfg.kind;
    el("drillTitle").innerHTML = t.title;
    el("drillSub").innerHTML = t.sub;
    el("drillTabs").innerHTML = cfg.tabs.map(function (x, k) {
      return '<button data-tab="' + k + '" class="' + (k === D.tab ? "active" : "") + '">' + esc(x) + "</button>";
    }).join("");

    wrap = document.querySelector(".drill-canvas-wrap");
    cv = el("drillCanvas");
    requestAnimationFrame(function () {
      var o = MR.fitCanvas(cv);
      ctx = o.ctx; W = o.w; H = o.h;
      drawChart();
      renderSide();
    });
  }

  function titleOf() {
    var f = st.frame;
    if (D.mode === "sym") {
      var i = D.payload.i, s = MR.sym(i), m = MR.metrics(i);
      return {
        title: esc(s[1]) + ' <small>' + esc(s[0]) + "</small>",
        sub: '<span class="' + MR.chgClass(f.chg[i]) + '">' + MR.signed(f.chg[i], 2, "%") + "</span> · " +
          MR.num(m.c, 2) + " 元 · " + esc(s[3]) + " · " + MR.fmtDate(st.date)
      };
    }
    if (D.mode === "board") {
      var b = st.board;
      var row = b ? (MR.boardSeries(b.id)[st.idx] || []) : (MR.marketRows()[st.idx] || []);
      return {
        title: b ? esc(b.name) : "全市场",
        sub: (b ? esc(MR.boardLabel(b)) + " · " : "") + "成分 " +
          (b ? MR.frameMembers(b, f).length : f.stats.active) + " · 平均涨幅 " +
          '<span class="' + MR.chgClass(row[0]) + '">' + MR.signed(row[0], 2, "%") + "</span> · " + MR.fmtDate(st.date)
      };
    }
    if (D.mode === "graph") {
      return { title: "资金转移网络", sub: "箭头 j→i 表示资金由 j 流向 i · 线宽＝累计金额 · 悬停节点看邻接" };
    }
    return {
      title: "跟踪路径", sub: st.tracked.length + " 只 · " + MR.fmtDate(MR.META.dates[0]) + " → " + MR.fmtDate(st.date)
    };
  }

  /* ------------------------------------------------------------------ 绘制调度 */
  function drawChart() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#080e16"; ctx.fillRect(0, 0, W, H);
    if (D.mode === "sym") D.tab === 0 ? drawSymCandles() : (D.tab === 1 ? drawSymScore() : drawSymFlow());
    else if (D.mode === "board") D.tab === 0 ? drawBoardTrend() : (D.tab === 1 ? drawBoardDist() : drawBoardContrib());
    else if (D.mode === "graph") drawGraph();
    else drawPaths();
    updateCross();
  }

  function plot(padL, padR, padT, padB) {
    return { x: padL || 56, y: padT || 18, w: W - (padL || 56) - (padR || 58), h: H - (padT || 18) - (padB || 34) };
  }

  function yAxis(r, lo, hi, n, fmt, right) {
    var ticks = C.niceTicks(lo, hi, n || 5);
    var Y = function (v) { return r.y + (hi - v) / Math.max(1e-9, hi - lo) * r.h; };
    C.grid(ctx, r, { y: ticks.map(function (v) { return { y: Y(v) }; }) });
    ticks.forEach(function (v) {
      C.label(ctx, fmt ? fmt(v) : v.toFixed(2), right ? r.x + r.w + 6 : r.x - 6,
        Y(v) + 3, { align: right ? "left" : "right", mono: true, color: "#6b8199" });
    });
    return Y;
  }

  function dateAxis(r, D_, every) {
    var n = D_;
    var step = every || Math.ceil(n / 8);
    ctx.save();
    ctx.font = "10px monospace"; ctx.fillStyle = "#6b8199"; ctx.textAlign = "center";
    for (var t = 0; t < n; t += step) {
      var x = r.x + (n <= 1 ? r.w / 2 : t / (n - 1) * r.w);
      ctx.fillText(MR.fmtDate(MR.META.dates[t]).slice(5), x, r.y + r.h + 14);
    }
    ctx.restore();
    return function (t) { return r.x + (n <= 1 ? r.w / 2 : t / (n - 1) * r.w); };
  }

  /* ------------------------------------------------------------------ 个股：K线 */
  function drawSymCandles() {
    var i = D.payload.i, f = st.frame;
    var open = MR.seriesCol(i, "open"), high = MR.seriesCol(i, "high"),
        low = MR.seriesCol(i, "low"), close = MR.seriesCol(i, "close"),
        amt = MR.seriesCol(i, "amt"), score = MR.seriesCol(i, "score");
    var n = close.length;
    var r = plot(58, 68, 18, 34);
    var ph = r.h * 0.54, vh = r.h * 0.13, sh = r.h - ph - vh - 26;
    var priceR = { x: r.x, y: r.y, w: r.w, h: ph };
    var volR = { x: r.x, y: priceR.y + ph + 14, w: r.w, h: vh };
    var scoreR = { x: r.x, y: volR.y + vh + 12, w: r.w, h: sh };

    /* 日期轴（共享） */
    var X = dateAxis(scoreR, n, Math.ceil(n / 9));
    var bw = r.w / n;

    /* 价格区 */
    var lo = Infinity, hi = -Infinity;
    for (var t = 0; t < n; t++) {
      if (isFinite(low[t])) lo = Math.min(lo, low[t]);
      if (isFinite(high[t])) hi = Math.max(hi, high[t]);
    }
    var padv = (hi - lo) * 0.08 || 1;
    lo -= padv; hi += padv;
    var PY = yAxis(priceR, lo, hi, 6, function (v) { return v.toFixed(2); }, true);
    var bars = [];
    for (var k = 0; k < n; k++) bars.push({ o: open[k], h: high[k], l: low[k], c: close[k] });
    C.candle(ctx, priceR, bars, { maxW: 14, min: lo, max: hi });
    C.label(ctx, "价格", priceR.x, priceR.y - 5, { color: "#5c7189" });

    /* 成交量 */
    var maxA = 1;
    for (var q = 0; q < n; q++) maxA = Math.max(maxA, amt[q] || 0);
    for (var v = 0; v < n; v++) {
      var hh = (amt[v] || 0) / maxA * volR.h;
      ctx.fillStyle = close[v] >= open[v] ? "rgba(255,93,108,.55)" : "rgba(47,189,147,.5)";
      ctx.fillRect(volR.x + bw * v + bw * .18, volR.y + volR.h - hh, Math.max(1, bw * .64), hh);
    }
    C.label(ctx, "成交额 " + MR.amount(maxA), volR.x, volR.y - 5, { color: "#5c7189" });

    /* πN */
    var sLo = 0, sHi = 1;
    for (var s = 0; s < n; s++) sHi = Math.max(sHi, score[s] || 0);
    var SY = yAxis(scoreR, 0, sHi, 3, function (v) { return v.toFixed(1); }, true);
    C.areaLine(ctx, scoreR, score, {
      min: 0, max: sHi, color: "#f3c969", width: 1.5, fill: "rgba(243,201,105,.12)"
    });
    C.label(ctx, "πN", scoreR.x, scoreR.y - 5, { color: "#5c7189" });

    /* 十字线 + 当前日 */
    var cur = D.hover >= 0 ? D.hover : st.idx;
    drawVLine(priceR, X(cur), cur === st.idx && D.hover < 0);
    if (D.hover >= 0 && isFinite(close[cur])) {
      var yy = PY(close[cur]);
      ctx.strokeStyle = "rgba(220,232,244,.28)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(priceR.x, yy); ctx.lineTo(priceR.x + priceR.w, yy); ctx.stroke();
      var tag = close[cur].toFixed(2);
      ctx.fillStyle = "#f3c969";
      ctx.fillRect(priceR.x + priceR.w + 2, yy - 8, 50, 15);
      ctx.fillStyle = "#0a111a"; ctx.font = "600 10px monospace";
      ctx.fillText(tag, priceR.x + priceR.w + 6, yy + 3);
      ctx.font = "10px monospace";
      ctx.fillStyle = "#5c7189";
      ctx.fillText("πN " + (score[cur] || 0).toFixed(2) + " →", scoreR.x + 4, scoreR.y + 12);
    }
    D.geom = { mode: "sym", X: X, n: n };
  }

  function drawVLine(r, x, gold) {
    ctx.save();
    ctx.strokeStyle = gold ? "rgba(243,201,105,.85)" : "rgba(180,205,230,.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash(gold ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(x, r.y - 4); ctx.lineTo(x, r.y + r.h + 4); ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ 个股：πN 轨迹 */
  function drawSymScore() {
    var i = D.payload.i;
    var score = MR.seriesCol(i, "score"), z = MR.seriesCol(i, "z"),
        chg = MR.seriesCol(i, "chg"), hb = MR.seriesCol(i, "hb");
    var n = score.length, r = plot();
    var bh = r.h * 0.22, mh = r.h - bh - 24;
    var mainR = { x: r.x, y: r.y, w: r.w, h: mh };
    var barR = { x: r.x, y: mainR.y + mh + 14, w: r.w, h: bh };
    var X = dateAxis(barR, n, Math.ceil(n / 9));

    var sHi = 1; for (var a = 0; a < n; a++) sHi = Math.max(sHi, score[a] || 0);
    var SY = yAxis(mainR, 0, sHi, 5, function (v) { return v.toFixed(1); });
    C.areaLine(ctx, mainR, score, { min: 0, max: sHi, color: "#f3c969", width: 1.8, fill: "rgba(243,201,105,.13)" });
    /* z 曲线（右轴，独立缩放） */
    var zAbs = 1; z.forEach(function (v) { if (isFinite(v)) zAbs = Math.max(zAbs, Math.abs(v)); });
    var ZY = function (v) { return mainR.y + (zAbs - v) / (2 * zAbs) * mainR.h; };
    ctx.strokeStyle = "#5fa8ff"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    z.forEach(function (v, t) { t ? ctx.lineTo(X(t), ZY(v)) : ctx.moveTo(X(t), ZY(v)); });
    ctx.stroke();
    C.label(ctx, "+" + zAbs.toFixed(1), mainR.x + mainR.w + 6, mainR.y + 8, { mono: true, color: "#6b8199" });
    C.label(ctx, "-" + zAbs.toFixed(1), mainR.x + mainR.w + 6, mainR.y + mainR.h, { mono: true, color: "#6b8199" });
    C.label(ctx, "πN（金） / log(π/s)（蓝，右轴）", mainR.x, mainR.y - 5, { color: "#5c7189" });

    /* heartbeat 柱 */
    var hAbs = 0.01; hb.forEach(function (v) { if (isFinite(v)) hAbs = Math.max(hAbs, Math.abs(v)); });
    var mid = barR.y + barR.h / 2;
    ctx.strokeStyle = "rgba(120,150,185,.35)";
    ctx.beginPath(); ctx.moveTo(barR.x, mid); ctx.lineTo(barR.x + barR.w, mid); ctx.stroke();
    var bw = barR.w / n;
    for (var t2 = 0; t2 < n; t2++) {
      var v = hb[t2] || 0, hh = v / hAbs * (barR.h / 2 - 2);
      ctx.fillStyle = v >= 0 ? "rgba(255,93,108,.7)" : "rgba(47,189,147,.7)";
      ctx.fillRect(barR.x + bw * t2 + bw * .2, mid - Math.max(0, hh), Math.max(1, bw * .6), Math.abs(hh));
    }
    C.label(ctx, "heartbeat Δlog(πN)", barR.x, barR.y - 4, { color: "#5c7189" });
    drawVLine(mainR, X(D.hover >= 0 ? D.hover : st.idx), D.hover < 0);
    D.geom = { mode: "symScore", X: X, n: n };
  }

  /* ------------------------------------------------------------------ 个股：资金对手 */
  function drawSymFlow() {
    var i = D.payload.i, f = st.frame;
    var ins = f.edges.filter(function (e) { return e[1] === i; })
      .sort(function (a, b) { return b[3] - a[3]; }).slice(0, 9);
    var outs = f.edges.filter(function (e) { return e[0] === i; })
      .sort(function (a, b) { return b[3] - a[3]; }).slice(0, 9);
    var r = plot(150, 108, 26, 24);
    var rows = ins.length + outs.length;
    if (!rows) {
      C.label(ctx, "当日该标的没有进入剪枝后转移图的强边（ETF 或流动性不足）", W / 2, H / 2, { align: "center", color: "#5c7189" });
      D.geom = null;
      return;
    }
    var rowH = Math.min(26, r.h / Math.max(6, rows));
    var maxW = Math.max(1, Math.max.apply(null, ins.concat(outs).map(function (e) { return e[3] || 0; })));
    var x0 = r.x + 180;
    var y = r.y + 6;
    function group(list, color, dict, dirLabel, sign) {
      if (!list.length) return;
      C.label(ctx, dirLabel, r.x, y + 10, { color: color, font: "600 11px sans-serif" });
      ctx.strokeStyle = "rgba(120,150,185,.18)";
      ctx.beginPath(); ctx.moveTo(r.x, y + 15.5); ctx.lineTo(r.x + r.w, y + 15.5); ctx.stroke();
      y += 22;
      list.forEach(function (e) {
        var other = dirLabel.indexOf("流入") >= 0 ? e[0] : e[1];
        var w = Math.max(2, (e[3] || 0) / maxW * (r.w - 30));
        ctx.fillStyle = color;
        ctx.globalAlpha = .78;
        ctx.fillRect(x0, y, w, rowH - 8);
        ctx.globalAlpha = 1;
        C.label(ctx, MR.symCode(other) + " " + MR.symName(other), r.x, y + rowH - 12,
          { color: "#c7d8ea", font: "11px sans-serif" });
        C.label(ctx, "P " + (e[2] * 100).toFixed(1) + "%", x0 + w + 5, y + rowH - 12,
          { color: "#8ea3ba", mono: true });
        C.label(ctx, MR.amount(e[3]), r.x + r.w + 6, y + rowH - 12, { color: "#6b8199", mono: true });
        y += rowH;
      });
      y += 8;
    }
    group(ins, "#ff5d6c", null, "← 资金流入（来源 j → 本票，红）", 1);
    group(outs, "#4f9bff", null, "→ 资金流出（本票 → 去向 i，蓝）", -1);
    D.geom = null;
  }

  /* ------------------------------------------------------------------ 板块：走势 */
  function drawBoardTrend() {
    var b = st.board;
    var rows = b ? MR.boardSeries(b.id) : MR.marketRows();
    var n = rows.length, r = plot();
    var bh = r.h * 0.2, mh = r.h - bh - 26;
    var mainR = { x: r.x, y: r.y, w: r.w, h: mh };
    var volR = { x: r.x, y: mainR.y + mh + 14, w: r.w, h: bh };
    var X = dateAxis(volR, n, Math.ceil(n / 10));
    var chg = rows.map(function (x) { return x[0]; });
    var sc = rows.map(function (x) { return x[1]; });
    var aLo = -1, aHi = 1;
    chg.forEach(function (v) { aLo = Math.min(aLo, v); aHi = Math.max(aHi, v); });
    var Y = yAxis(mainR, aLo, aHi, 5, function (v) { return v.toFixed(1) + "%"; });
    ctx.strokeStyle = "rgba(120,150,185,.35)";
    ctx.beginPath(); ctx.moveTo(mainR.x, Y(0)); ctx.lineTo(mainR.x + mainR.w, Y(0)); ctx.stroke();
    MR.line(ctx, chg.map(function (v, t) { return [X(t), Y(v)]; }), "#ff5d6c", 1.9);
    var sAbs = 1; sc.forEach(function (v) { sAbs = Math.max(sAbs, Math.abs(v)); });
    var SY = function (v) { return mainR.y + (sAbs - v) / (2 * sAbs) * mainR.h; };
    MR.line(ctx, sc.map(function (v, t) { return [X(t), SY(v)]; }), "#4f9bff", 1.4);
    C.label(ctx, "平均涨幅 %（红，左轴） · 平均 πN（蓝，独立轴）", mainR.x, mainR.y - 5, { color: "#5c7189" });

    /* 涨跌家数条带：红=上涨占比，绿=下跌占比 */
    var bR = { x: mainR.x, y: mainR.y + mainR.h - 13, w: mainR.w, h: 11 };
    var bwid = bR.w / n;
    rows.forEach(function (x, t) {
      var tot = Math.max(1, x[3] + x[4]);
      var upw = x[3] / tot * bwid;
      ctx.fillStyle = "rgba(47,189,147,.55)";
      ctx.fillRect(bR.x + bwid * t, bR.y, bwid, bR.h);
      ctx.fillStyle = "rgba(255,93,108,.72)";
      ctx.fillRect(bR.x + bwid * t, bR.y, Math.max(0, upw - 0.5), bR.h);
    });
    C.label(ctx, "涨跌家数比（红=上涨）", bR.x, bR.y - 3, { color: "#4b5f74", font: "9px sans-serif" });

    var maxA = 1; rows.forEach(function (x) { maxA = Math.max(maxA, x[2] || 0); });
    var bw = volR.w / n;
    rows.forEach(function (x, t) {
      var hh = (x[2] || 0) / maxA * volR.h;
      ctx.fillStyle = x[0] >= 0 ? "rgba(255,93,108,.5)" : "rgba(47,189,147,.45)";
      ctx.fillRect(volR.x + bw * t + bw * .12, volR.y + volR.h - hh, Math.max(1, bw * .74), hh);
    });
    C.label(ctx, "成交额", volR.x, volR.y - 5, { color: "#5c7189" });
    drawVLine(mainR, X(D.hover >= 0 ? D.hover : st.idx), D.hover < 0);
    D.geom = { mode: "board", X: X, n: n };
  }

  /* ------------------------------------------------------------------ 板块：成分分布 */
  function drawBoardDist() {
    var f = st.frame;
    var ids = st.board ? MR.frameMembers(st.board, f) : null;
    if (!ids) {
      ids = [];
      for (var i = 0; i < f.chg.length; i++) if (f.active[i]) ids.push(i);
    }
    var vals = ids.map(function (i) { return f.chg[i]; }).filter(isFinite);
    var r = plot(56, 26, 24, 40);
    if (!vals.length) { D.geom = null; return; }
    var gap = 48, hrH = r.h * 0.56;
    var hr = { x: r.x, y: r.y, w: r.w, h: hrH };
    var cumR = { x: r.x, y: hr.y + hrH + gap, w: r.w, h: Math.max(56, r.h - hrH - gap - 20) };
    var hist = C.hist(ctx, hr, vals, { bins: Math.max(7, Math.min(25, Math.round(Math.sqrt(vals.length) * 2))) });
    var ticks = C.niceTicks(hist.mn, hist.mx, 8);
    ticks.forEach(function (v) {
      var x = hr.x + (v - hist.mn) / (hist.mx - hist.mn) * hr.w;
      if (x > hr.x + hr.w - 8 || x < hr.x + 8) return;
      var txt = Math.abs(v) < 0.05 ? "0%" : v.toFixed(1) + "%";
      C.label(ctx, txt, x, hr.y + hr.h + 14, { align: "center", mono: true, color: "#6b8199" });
    });
    C.label(ctx, "成分涨跌幅分布（" + vals.length + " 只，红涨绿跌）", hr.x, hr.y - 8, { color: "#5c7189", font: "11px sans-serif" });
    /* 直方图纵轴：只数刻度 */
    [0, 0.5, 1].forEach(function (q) {
      var y = hr.y + hr.h - q * hr.h;
      C.label(ctx, String(Math.round(q * Math.max.apply(null, hist.cnt))), hr.x - 8, y + 3, { mono: true, color: "#5c7189", align: "right" });
    });
    /* 零轴：贯穿直方图与累计曲线 */
    var zx = hist.mn < 0 && hist.mx > 0 ? hr.x + (0 - hist.mn) / (hist.mx - hist.mn) * hr.w : null;
    if (zx != null) {
      ctx.save();
      ctx.strokeStyle = "rgba(190,210,232,.30)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(zx + .5, hr.y); ctx.lineTo(zx + .5, cumR.y + cumR.h); ctx.stroke();
      ctx.restore();
    }

    /* 累计分布：X 轴与上方直方图一致（涨跌幅），纵轴＝累计占比 */
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    C.grid(ctx, cumR, { y: [0, .5, 1].map(function (q) { return { y: cumR.y + cumR.h - q * cumR.h }; }) });
    [["100%", 1], ["50%", .5], ["0", 0]].forEach(function (t) {
      C.label(ctx, t[0], cumR.x - 8, cumR.y + cumR.h - t[1] * cumR.h + 3, { mono: true, color: "#5c7189", align: "right" });
    });
    var pts = [], k = 0, steps = 96;
    for (var b = 0; b <= steps; b++) {
      var vv = hist.mn + (b / steps) * (hist.mx - hist.mn);
      while (k < n && sorted[k] <= vv) k++;
      pts.push([cumR.x + b / steps * cumR.w, cumR.y + cumR.h - (k / n) * cumR.h]);
    }
    MR.line(ctx, pts, "#a98bff", 1.6);
    C.label(ctx, "累计占比（横轴同上方：涨跌幅）", cumR.x, cumR.y - 8, { color: "#5c7189", font: "11px sans-serif" });
    /* 中位数标记 */
    var med = sorted[Math.floor(n / 2)];
    var mxp = cumR.x + (med - hist.mn) / (hist.mx - hist.mn) * cumR.w;
    ctx.save();
    ctx.strokeStyle = "rgba(255,193,94,.55)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(mxp + .5, cumR.y); ctx.lineTo(mxp + .5, cumR.y + cumR.h); ctx.stroke();
    ctx.restore();
    C.label(ctx, "中位 " + MR.signed(med, 2, "%"), mxp + 5, cumR.y + 11, { mono: true, color: "#ffc15e" });
    D.geom = null;
  }

  /* ------------------------------------------------------------------ 板块：贡献榜 */
  function drawBoardContrib() {
    var f = st.frame;
    var ids = st.board ? MR.frameMembers(st.board, f) : null;
    if (!ids) {
      ids = [];
      for (var i = 0; i < f.chg.length; i++) if (f.active[i]) ids.push(i);
    }
    var arr = ids.map(function (i) {
      return { i: i, c: (f.chg[i] / 100) * (f.amt[i] || 0) };
    }).filter(function (x) { return isFinite(x.c) && x.c !== 0; });
    arr.sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); });
    arr = arr.slice(0, 17);
    var r = plot(178, 92, 26, 22);
    if (!arr.length) { D.geom = null; return; }
    var mx = Math.max.apply(null, arr.map(function (x) { return Math.abs(x.c); })) || 1;
    var rowH = Math.min(28, r.h / arr.length);
    var barX = r.x + 6, barW = r.w;
    var zero = barX + barW / 2;
    C.label(ctx, "资金贡献 = 涨跌幅 × 成交额（红＝拉动 / 绿＝拖累；长度按 √|贡献| 缩放）", r.x, r.y - 7, { color: "#5c7189" });
    ctx.strokeStyle = "rgba(160,185,210,.35)";
    ctx.beginPath(); ctx.moveTo(zero + .5, r.y); ctx.lineTo(zero + .5, r.y + r.h); ctx.stroke();
    arr.forEach(function (x, k) {
      var y = r.y + k * rowH;
      C.label(ctx, MR.symCode(x.i), r.x - 174, y + rowH / 2 + 3, { mono: true, color: "#c7d8ea", font: "10.5px monospace" });
      C.label(ctx, MR.symName(x.i).slice(0, 5), r.x - 118, y + rowH / 2 + 3, { color: "#93a9c0", font: "10.5px sans-serif" });
      var w = Math.sqrt(Math.abs(x.c) / mx) * (barW / 2 - 10);
      ctx.fillStyle = x.c >= 0 ? "rgba(255,93,108,.8)" : "rgba(47,189,147,.75)";
      if (x.c >= 0) ctx.fillRect(zero + 1, y + 3, w, rowH - 8);
      else ctx.fillRect(zero - 1 - w, y + 3, w, rowH - 8);
      C.label(ctx, MR.amount(x.c), r.x + r.w + 6, y + rowH / 2 + 3, { mono: true, color: "#8ea3ba" });
    });
    D.geom = null;
  }

  /* ------------------------------------------------------------------ 转移网络 */
  function graphScope() {
    var f = st.frame, ids = [], seen = {};
    function add(i) { if (!seen[i]) { seen[i] = 1; ids.push(i); } }
    if (D.scope === "board" && st.board) {
      MR.frameMembers(st.board, f).slice().sort(function (a, b) { return f.score[b] - f.score[a]; })
        .slice(0, 34).forEach(add);
    } else if (D.scope === "top") {
      (f.top || []).slice(0, 30).forEach(add);
    } else {
      var base = st.tracked.length ? st.tracked : f.top.slice(0, 2);
      base.forEach(add);
      var touching = f.edges.filter(function (e) { return seen[e[0]] || seen[e[1]]; })
        .sort(function (a, b) { return b[3] - a[3]; });
      touching.forEach(function (e) {
        if (ids.length < 30) add(e[0]);
        if (ids.length < 30) add(e[1]);
      });
    }
    var set = {}; ids.forEach(function (i) { set[i] = 1; });
    var edges = f.edges.filter(function (e) { return set[e[0]] && set[e[1]]; })
      .sort(function (a, b) { return b[3] - a[3]; }).slice(0, 150);
    return { ids: ids, edges: edges, focus: seen };
  }

  function drawGraph() {
    var f = st.frame, g = graphScope();
    var r = plot(12, 12, 14, 14);
    if (!g.ids.length) {
      C.label(ctx, "当前范围没有可用节点", W / 2, H / 2, { align: "center", color: "#5c7189" });
      D.geom = null; return;
    }
    var ids = g.ids, edges = g.edges;
    var trackedSet = {}; (st.tracked.length ? st.tracked : f.top.slice(0, 2)).forEach(function (i) { trackedSet[i] = 1; });
    var pos = D.gpos;
    ids.forEach(function (id, k) {
      if (!pos[id]) {
        var a = k / ids.length * Math.PI * 2;
        pos[id] = { x: W / 2 + Math.cos(a) * Math.min(W, H) * 0.3,
                    y: H / 2 + Math.sin(a) * Math.min(W, H) * 0.3, vx: 0, vy: 0 };
      }
    });
    for (var it = 0; it < 160; it++) {
      for (var a1 = 0; a1 < ids.length; a1++) {
        for (var b1 = a1 + 1; b1 < ids.length; b1++) {
          var p = pos[ids[a1]], q = pos[ids[b1]];
          var dx = p.x - q.x, dy = p.y - q.y, d2 = Math.max(120, dx * dx + dy * dy);
          var force = 5200 / d2, d = Math.sqrt(d2);
          p.vx += dx / d * force; p.vy += dy / d * force;
          q.vx -= dx / d * force; q.vy -= dy / d * force;
        }
      }
      edges.forEach(function (e) {
        var p = pos[e[0]], q = pos[e[1]];
        var dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1, Math.hypot(dx, dy));
        var k = (d - Math.min(W, H) * 0.18) * 0.012;
        p.vx += dx / d * k; p.vy += dy / d * k;
        q.vx -= dx / d * k; q.vy -= dy / d * k;
      });
      ids.forEach(function (i) {
        var p = pos[i];
        p.vx += (W / 2 - p.x) * 0.006; p.vy += (H / 2 - p.y) * 0.006;
        p.x = Math.max(r.x + 30, Math.min(r.x + r.w - 30, p.x + p.vx * .5));
        p.y = Math.max(r.y + 18, Math.min(r.y + r.h - 18, p.y + p.vy * .5));
        p.vx *= .7; p.vy *= .7;
      });
    }
    var maxD = Math.max(1, Math.max.apply(null, edges.map(function (e) { return e[3] || 0; })));
    /* 归一化：让网络铺满画布，避免挤在中间 */
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    ids.forEach(function (i) {
      var p = pos[i];
      mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
      mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
    });
    var bw0 = Math.max(1, mxx - mnx), bh0 = Math.max(1, mxy - mny);
    var sc2 = Math.min(Math.min((r.w - 90) / bw0, (r.h - 60) / bh0), 2.4);
    var cx0 = (mnx + mxx) / 2, cy0 = (mny + mxy) / 2;
    ids.forEach(function (i) {
      var p = pos[i];
      p.x = (p.x - cx0) * sc2 + (r.x + r.w / 2);
      p.y = (p.y - cy0) * sc2 + (r.y + r.h / 2);
    });
    var hov = D.hover;
    var neigh = {};
    if (hov >= 0) edges.forEach(function (e) {
      if (e[0] === hov) neigh[e[1]] = 1;
      if (e[1] === hov) neigh[e[0]] = 1;
    });
    edges.forEach(function (e) {
      var p = pos[e[0]], q = pos[e[1]];
      if (!p || !q) return;
      var hot = hov >= 0 && (e[0] === hov || e[1] === hov);
      var dim = hov >= 0 && !hot;
      var dx = q.x - p.x, dy = q.y - p.y, dd = Math.max(1, Math.hypot(dx, dy));
      var ux = dx / dd, uy = dy / dd;
      var sx = p.x + ux * 11, sy = p.y + uy * 11;
      var ex = q.x - ux * 13, ey = q.y - uy * 13;
      ctx.strokeStyle = hot ? "rgba(243,201,105,.95)" : (dim ? "rgba(70,100,135,.13)" : "rgba(110,150,195,.45)");
      ctx.lineWidth = (hot ? 1.6 : 0.6) + 3.2 * Math.sqrt((e[3] || 0) / maxD);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = hot ? "rgba(243,201,105,.95)" : (dim ? "rgba(70,100,135,.16)" : "rgba(120,160,205,.6)");
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * 7 - uy * 3.6, ey - uy * 7 + ux * 3.6);
      ctx.lineTo(ex - ux * 7 + uy * 3.6, ey - uy * 7 - ux * 3.6);
      ctx.closePath(); ctx.fill();
    });
    var lab = [];
    ids.forEach(function (i) {
      var p = pos[i];
      if (!p) return;
      var rNode = 6 + Math.min(10, Math.log10(1 + Math.max(0, f.score[i])) * 3.4);
      var dim = hov >= 0 && i !== hov && !neigh[i];
      ctx.beginPath(); ctx.arc(p.x, p.y, rNode, 0, 6.283);
      ctx.fillStyle = trackedSet[i] ? "#f3c969" : MR.commColor(f.comm[i]);
      ctx.globalAlpha = dim ? 0.28 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.2; ctx.strokeStyle = i === hov ? "#fff" : "#08111b"; ctx.stroke();
      lab.push({ i: i, x: p.x, y: p.y, r: rNode, dim: dim, hot: trackedSet[i] || i === hov });
    });
    /* 标签避让：按 πN 优先，右→左→上→下 依次尝试 */
    lab.sort(function (a, b) { return f.score[b.i] - f.score[a.i]; });
    var rects = [];
    lab.forEach(function (L) {
      if (L.dim) return;
      var code = MR.symCode(L.i), name = MR.symName(L.i).slice(0, 5);
      ctx.font = (L.hot ? "600 " : "") + "12px monospace";
      var wCode = ctx.measureText(code).width;
      var showName = L.hot || L.r > 9;
      ctx.font = "10.5px sans-serif";
      var wName = showName ? ctx.measureText(name).width : 0;
      var bw = Math.max(wCode, wName) + 6, bh = showName ? 26 : 15;
      var cands = [
        [L.x + L.r + 5, L.y - (showName ? 8 : 4)],
        [L.x - L.r - 5 - bw, L.y - (showName ? 8 : 4)],
        [L.x - bw / 2, L.y - L.r - bh - 3],
        [L.x - bw / 2, L.y + L.r + 4]
      ];
      var ok = false, bx = 0, by = 0;
      for (var ci = 0; ci < cands.length; ci++) {
        var tx = cands[ci][0], ty = cands[ci][1];
        if (tx < 4 || ty < 4 || tx + bw > W - 4 || ty + bh > H - 4) continue;
        var bad = false;
        for (var k2 = 0; k2 < rects.length; k2++) {
          var o = rects[k2];
          if (tx < o.x + o.w + 2 && tx + bw + 2 > o.x && ty < o.y + o.h + 1 && ty + bh + 1 > o.y) { bad = true; break; }
        }
        if (!bad) { ok = true; bx = tx; by = ty; break; }
      }
      if (!ok) {
        /* 无位置时至少画出跟踪/悬停标的 */
        if (!L.hot) return;
        bx = Math.max(4, Math.min(W - bw - 4, L.x + L.r + 5));
        by = Math.max(4, Math.min(H - bh - 4, L.y - 8));
      }
      rects.push({ x: bx, y: by, w: bw, h: bh });
      ctx.fillStyle = "rgba(8,14,22,.78)";
      ctx.fillRect(bx - 1, by - 1, bw, bh);
      ctx.font = (L.hot ? "600 " : "") + "12px monospace";
      ctx.fillStyle = L.hot ? "#f3c969" : "#aec4da";
      ctx.fillText(code, bx + 2, by + 11);
      if (showName) {
        ctx.font = "10.5px sans-serif"; ctx.fillStyle = "#8ea3ba";
        ctx.fillText(name, bx + 2, by + 22);
      }
    });
    D.geom = { mode: "graph", ids: ids, edges: edges, pos: pos };
  }

  /* ------------------------------------------------------------------ 跟踪路径 */
  function drawPaths() {
    var f = st.frame;
    var syms = st.tracked.length ? st.tracked.slice() : [st.selected != null ? st.selected : f.top[0]];
    var n = MR.META.dates.length, r = plot(52, 118, 22, 34);
    var tab = D.tab;
    if (tab === 3) { drawPathsCommunities(syms, r, n); return; }
    var X = dateAxis(r, n, Math.ceil(n / 10));
    var key = tab === 0 ? "z" : (tab === 1 ? "chg" : "score");
    var cols = syms.map(function (i) { return MR.seriesCol(i, key); });
    var lo = Infinity, hi = -Infinity;
    cols.forEach(function (c) { c.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad0 = (hi - lo) * 0.08;
    var Y = yAxis(r, lo - pad0, hi + pad0, 6, function (v) {
      return tab === 1 ? v.toFixed(1) + "%" : v.toFixed(2);
    });
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = "rgba(120,150,185,.35)";
      ctx.beginPath(); ctx.moveTo(r.x, Y(0)); ctx.lineTo(r.x + r.w, Y(0)); ctx.stroke();
    }
    syms.forEach(function (i, k) {
      var col = MR.COMM_COLORS[k % MR.COMM_COLORS.length];
      var vals = cols[k];
      MR.line(ctx, vals.map(function (v, t) { return [X(t), Y(isFinite(v) ? v : lo)]; }), col, 1.8);
      var vNow = vals[st.idx];
      if (isFinite(vNow)) {
        ctx.beginPath(); ctx.arc(X(st.idx), Y(vNow), 3.4, 0, 6.283);
        ctx.fillStyle = col; ctx.fill();
      }
    });
    /* 右列图例：代码 + 区间变化 */
    syms.forEach(function (i, k) {
      var col = MR.COMM_COLORS[k % MR.COMM_COLORS.length];
      var vals = cols[k], fin = vals.filter(isFinite);
      var delta = fin.length > 1 ? fin[fin.length - 1] - fin[0] : NaN;
      var ly = r.y + 8 + k * 36;
      ctx.fillStyle = col;
      ctx.fillRect(r.x + r.w + 10, ly, 9, 9);
      C.label(ctx, MR.symCode(i), r.x + r.w + 23, ly + 8, { mono: true, color: "#dce8f4", font: "600 11px monospace" });
      C.label(ctx, MR.symName(i).slice(0, 6), r.x + r.w + 10, ly + 22, { color: "#8ea3ba", font: "10px sans-serif" });
      C.label(ctx, (tab === 1 ? "" : "Δ ") + (isFinite(delta) ? (delta > 0 ? "+" : "") + delta.toFixed(2) : "—"),
        r.x + r.w + 10, ly + 34, { mono: true, color: "#6b8199", font: "10px monospace" });
    });
    drawVLine(r, X(D.hover >= 0 ? D.hover : st.idx), D.hover < 0);
    D.geom = { mode: "paths", X: X, n: n, syms: syms };
  }

  function drawPathsCommunities(syms, r, n) {
    var rowH = Math.min(56, (r.h * 0.52) / Math.max(1, syms.length));
    var X = dateAxis({ x: r.x, y: r.y + syms.length * rowH + 6, w: r.w, h: 10 }, n, Math.ceil(n / 10));
    var bw = r.w / n;
    syms.forEach(function (i, k) {
      var cs = MR.seriesCol(i, "comm");
      C.label(ctx, MR.symCode(i), r.x - 48, r.y + k * rowH + rowH / 2 - 2,
        { mono: true, color: "#c7d8ea", font: "600 11px monospace" });
      C.label(ctx, MR.symName(i).slice(0, 6), r.x - 48, r.y + k * rowH + rowH / 2 + 12,
        { color: "#8ea3ba", font: "10px sans-serif" });
      for (var t = 0; t < n; t++) {
        ctx.fillStyle = MR.commColor(cs[t]);
        ctx.fillRect(r.x + bw * t, r.y + k * rowH + 2, Math.max(1, bw - 0.6), rowH - 10);
      }
      ctx.strokeStyle = "rgba(243,201,105,.95)";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(r.x + bw * st.idx, r.y + k * rowH + 1, Math.max(2.5, bw), rowH - 8);
      /* 迁移标记 */
      for (var t2 = 1; t2 < n; t2++) {
        if (cs[t2] !== cs[t2 - 1]) {
          ctx.fillStyle = "rgba(8,14,22,.92)";
          ctx.fillRect(r.x + bw * t2 - 1, r.y + k * rowH + 2, 2.4, rowH - 10);
        }
      }
      var changes = 0;
      for (var t3 = 1; t3 < n; t3++) if (cs[t3] !== cs[t3 - 1]) changes++;
      C.label(ctx, "C" + cs[st.idx] + " · 迁移 " + changes + " 次",
        r.x + r.w + 8, r.y + k * rowH + rowH / 2, { mono: true, color: "#8ea3ba" });
    });

    /* 迁移事件时间线 */
    var evts = [];
    syms.forEach(function (i) {
      var cs = MR.seriesCol(i, "comm");
      for (var t = 1; t < n; t++) if (cs[t] !== cs[t - 1]) evts.push({ i: i, t: t, from: cs[t - 1], to: cs[t] });
    });
    evts.sort(function (a, b) { return b.t - a.t; });
    var ly = r.y + syms.length * rowH + 34;
    C.label(ctx, "社群迁移事件（最近 " + Math.min(evts.length, 16) + " 次 / 共 " + evts.length + " 次）",
      r.x, ly, { color: "#5c7189", font: "10.5px sans-serif" });
    ly += 16;
    evts.slice(0, 16).forEach(function (e, k) {
      var col = k % 2 ? "rgba(255,255,255,.03)" : "transparent";
      if (col !== "transparent") { ctx.fillStyle = col; ctx.fillRect(r.x, ly - 10, r.w, 16); }
      C.label(ctx, MR.fmtDate(MR.META.dates[e.t]).slice(5), r.x + 4, ly,
        { mono: true, color: "#8ea3ba" });
      C.label(ctx, MR.symCode(e.i) + " " + MR.symName(e.i).slice(0, 5), r.x + 62, ly,
        { color: "#dce8f4", font: "11px sans-serif" });
      ctx.fillStyle = MR.commColor(e.from);
      ctx.fillRect(r.x + r.w - 92, ly - 9, 10, 10);
      C.label(ctx, "→", r.x + r.w - 78, ly, { color: "#5c7189" });
      ctx.fillStyle = MR.commColor(e.to);
      ctx.fillRect(r.x + r.w - 64, ly - 9, 10, 10);
      C.label(ctx, "C" + e.from + " → C" + e.to, r.x + r.w - 48, ly, { mono: true, color: "#aebfd2" });
      ly += 16;
    });
    C.label(ctx, "色带 = 当日所属资金社群；金色框 = 当前交易日；深色竖线 = 迁移", r.x, r.y - 6,
      { color: "#5c7189" });
    D.geom = null;
  }

  /* ------------------------------------------------------------------ 侧栏：统计 + 表格 */
  function statGrid(items) {
    return '<div class="ds-grid">' + items.map(function (p) {
      if (p[0] === "§") return '<div class="ds-sec">' + esc(p[1]) + "</div>";
      return '<div class="ds-item"><label>' + esc(p[0]) + "</label><b class='" + (p[2] || "") + "'>" +
        esc(p[1]) + "</b></div>";
    }).join("") + "</div>";
  }

  function renderSide() {
    if (D.mode === "sym") sideSym();
    else if (D.mode === "board") sideBoard();
    else if (D.mode === "graph") sideGraph();
    else sidePaths();
    bindTable();
  }

  function sideSym() {
    var i = D.payload.i, f = st.frame, s = MR.sym(i), m = MR.metrics(i);
    var rank = MR.rankOf(f, i);
    var memberships = MR.boardsOf(i).slice(0, 8);
    el("drillStats").innerHTML = statGrid([
      ["§", "当日行情"],
      ["收盘", MR.num(m.c, 2) + " 元", "gold"],
      ["涨跌", MR.signed(f.chg[i], 2, "%"), MR.chgClass(f.chg[i])],
      ["开盘 / 最高", MR.num(m.o, 2) + " / " + MR.num(m.h, 2), ""],
      ["最低 / 昨收", MR.num(m.l, 2) + " / " + MR.num(m.pc, 2), ""],
      ["振幅", isFinite(m.amp) ? m.amp.toFixed(2) + "%" : "—", ""],
      ["成交额", MR.amount(f.amt[i]), ""],
      ["20 日均额", MR.amount(m.amtAvg), ""],
      ["§", "资金位置（论文指标）"],
      ["πN", MR.num(f.score[i], 3), "gold"],
      ["πN 排名", rank > 0 ? rank + " / " + f.stats.active : "—", ""],
      ["5 日 πN 变化", MR.percent(m.score5, 1), MR.chgClass(m.score5)],
      ["log(π/s)", MR.num(f.z[i], 3), ""],
      ["heartbeat", MR.signed(f.hb[i], 4), MR.chgClass(f.hb[i])],
      ["hotness", MR.num(f.hot[i], 2), ""],
      ["资金社群", "C" + f.comm[i] + " · 迁移 " + m.migr + " 次", ""],
      ["§", "区间结构（近 60 日）"],
      ["60 日涨跌", MR.percent(m.ret60, 1), MR.chgClass(m.ret60)],
      ["20 日涨跌", MR.percent(m.ret20, 1), MR.chgClass(m.ret20)],
      ["区间高 / 低", MR.num(m.hi, 2) + " / " + MR.num(m.lo, 2), ""],
      ["区间位置", isFinite(m.pos) ? m.pos.toFixed(0) + "%" : "—", ""],
      ["最大回撤", isFinite(m.mdd) ? m.mdd.toFixed(1) + "%" : "—", "down"]
    ]) + (memberships.length ?
      '<div class="ds-chips">' + memberships.map(function (b) {
        return '<span class="ds-chip" data-board="' + esc(b.id) + '">' + esc(b.name) + "</span>";
      }).join("") + "</div>" : "") +
      '<div class="ds-actions"><button class="btn mini" id="dsTrack">' +
      (st.tracked.indexOf(i) >= 0 ? "取消跟踪" : "加入跟踪") + "</button>" +
      '<button class="btn mini" id="dsMap">在地形中定位</button></div>';

    el("drillTableHead").textContent = "资金对手（剪枝后强边）";
    var ins = f.edges.filter(function (e) { return e[1] === i; }).sort(function (a, b) { return b[3] - a[3]; }).slice(0, 10);
    var outs = f.edges.filter(function (e) { return e[0] === i; }).sort(function (a, b) { return b[3] - a[3]; }).slice(0, 10);
    var rows = [];
    ins.forEach(function (e) {
      rows.push('<tr data-i="' + e[0] + '"><td class="dir in">流入</td><td>' + esc(MR.symCode(e[0])) +
        "</td><td>" + esc(MR.symName(e[0]).slice(0, 5)) + '</td><td class="num">' + (e[2] * 100).toFixed(2) +
        '%</td><td class="num">' + MR.amount(e[3]) + "</td></tr>");
    });
    outs.forEach(function (e) {
      rows.push('<tr data-i="' + e[1] + '"><td class="dir out">流出</td><td>' + esc(MR.symCode(e[1])) +
        "</td><td>" + esc(MR.symName(e[1]).slice(0, 5)) + '</td><td class="num">' + (e[2] * 100).toFixed(2) +
        '%</td><td class="num">' + MR.amount(e[3]) + "</td></tr>");
    });
    el("drillTable").innerHTML = '<table class="drill-tb"><thead><tr><th>方向</th><th>对手</th><th>名称</th>' +
      '<th class="num">P<sub>ji</sub></th><th class="num">金额</th></tr></thead><tbody>' +
      (rows.join("") || '<tr><td colspan="5" class="empty">当日无剪枝后强边（ETF 或流动性不足）</td></tr>') + "</tbody></table>";

    var tb = el("dsTrack");
    if (tb) tb.onclick = function () { MR.toggleTrack(i); renderSide(); };
    var mb = el("dsMap");
    if (mb) mb.onclick = function () { close(); MR.focusSymbol(i); };
    el("drillStats").querySelectorAll("[data-board]").forEach(function (n) {
      n.onclick = function () {
        var b = MR.boardById[n.getAttribute("data-board")];
        if (b) { MR.setBoard(b); open("board", {}); }
      };
    });
    el("drillLegend").innerHTML = '<span class="lg"><i style="background:#ff5d6c"></i>阳线</span>' +
      '<span class="lg"><i style="background:#2fbd93"></i>阴线</span>' +
      '<span class="lg"><i style="background:#f3c969"></i>πN</span>' +
      '<span class="lg">悬停任意位置显示当日开高低收</span>';
  }

  function sideBoard() {
    var b = st.board, f = st.frame;
    var rows = b ? MR.boardSeries(b.id) : MR.marketRows();
    var cur = rows[st.idx] || [0, 0, 0, 0, 0, 0, -1];
    var prev = rows[Math.max(0, st.idx - 1)] || cur;
    var ids = b ? MR.frameMembers(b, f) : null;
    if (!ids) { ids = []; for (var i = 0; i < f.chg.length; i++) if (f.active[i]) ids.push(i); }
    var chgs = ids.map(function (i) { return f.chg[i]; }).sort(function (a, b2) { return b2 - a; });
    var med = chgs.length ? chgs[Math.floor(chgs.length / 2)] : 0;
    var amtSum = 0, wsum = 0;
    ids.forEach(function (i) { amtSum += f.amt[i] || 0; wsum += (f.chg[i] / 100) * (f.amt[i] || 0); });
    var scoreSum = 0; ids.forEach(function (i) { scoreSum += f.score[i]; });

    el("drillStats").innerHTML = statGrid([
      ["§", "板块状态（" + MR.fmtDate(st.date) + "）"],
      ["平均涨幅", MR.signed(cur[0], 2, "%"), MR.chgClass(cur[0])],
      ["中位涨幅", MR.signed(med, 2, "%"), MR.chgClass(med)],
      ["资金加权涨幅", MR.percent(amtSum ? wsum / amtSum * 100 : NaN, 2), MR.chgClass(wsum)],
      ["较前一日", MR.percent(cur[0] - prev[0], 2), MR.chgClass(cur[0] - prev[0])],
      ["上涨 / 下跌", cur[3] + " / " + cur[4], cur[3] >= cur[4] ? "up" : "down"],
      ["成交额", MR.amount(cur[2]), ""],
      ["平均 πN", MR.num(scoreSum / Math.max(1, ids.length), 2), "gold"],
      ["§", "区间（60 日）"],
      ["累计涨幅", MR.percent(rows.reduce(function (a, r) { return a + (r[0] || 0); }, 0), 1), ""],
      ["最强日", bestDay(rows, true), "up"],
      ["最弱日", bestDay(rows, false), "down"],
      ["波动（日 std）", stdOf(rows).toFixed(2) + "%", ""],
      ["成分数", ids.length + " 只", ""]
    ]) + (b && b.kind === "flux" ? (function () {
      var info = (f.communities || []).filter(function (c) { return c.id === parseInt(b.id.split(":")[1], 10); })[0];
      return info ? '<div class="ds-note">主导行业 <b>' + esc(info.lead) + "</b> · 中位 log(π/s) <b>" +
        MR.num(info.z, 2) + "</b> · 成员 " + info.n + " 只</div>" : "";
    })() : "");

    el("drillTableHead").textContent = "成分明细（按 πN 排序）";
    var sorted = ids.slice().sort(function (x, y) { return f.score[y] - f.score[x]; }).slice(0, 60);
    var rank = MR.rankMap(f);
    el("drillTable").innerHTML = '<table class="drill-tb"><thead><tr><th>#</th><th>代码</th><th>名称</th>' +
      '<th class="num">涨跌</th><th class="num">πN</th><th class="num">排名</th><th class="num">成交额</th></tr></thead><tbody>' +
      sorted.map(function (i, k) {
        return '<tr data-i="' + i + '"><td class="dim">' + (k + 1) + "</td><td>" + esc(MR.symCode(i)) +
          "</td><td>" + esc(MR.symName(i).slice(0, 5)) + '</td><td class="num ' + MR.chgClass(f.chg[i]) + '">' +
          MR.signed(f.chg[i], 2, "%") + '</td><td class="num">' + MR.num(f.score[i], 2) +
          '</td><td class="num dim">' + (rank[i] > 0 ? rank[i] : "—") + '</td><td class="num">' +
          MR.amount(f.amt[i]) + "</td></tr>";
      }).join("") + "</tbody></table>";
    el("drillLegend").innerHTML = '<span class="lg"><i style="background:#ff5d6c"></i>平均涨幅</span>' +
      '<span class="lg"><i style="background:#4f9bff"></i>平均 πN</span>' +
      '<span class="lg"><i style="background:#35d6a3"></i>上涨占比</span>' +
      '<span class="lg">点击成分表任意行查看个股详情</span>';
  }

  function bestDay(rows, up) {
    var bi = -1, bv = up ? -1e9 : 1e9;
    rows.forEach(function (r, t) {
      if ((up && r[0] > bv) || (!up && r[0] < bv)) { bv = r[0]; bi = t; }
    });
    return bi < 0 ? "—" : MR.signed(bv, 2, "%") + " (" + MR.fmtDate(MR.META.dates[bi]).slice(5) + ")";
  }
  function stdOf(rows) {
    var v = rows.map(function (r) { return r[0]; });
    var m = v.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, v.length);
    return Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / Math.max(1, v.length));
  }

  function sideGraph() {
    var g = graphScope(), f = st.frame;
    var direct = 0, tot = 0;
    g.edges.forEach(function (e) { tot += e[3] || 0; });
    el("drillStats").innerHTML = statGrid([
      ["§", "当前网络"],
      ["节点", g.ids.length + " 只", ""],
      ["边", g.edges.length + " 条", ""],
      ["总流量", MR.amount(tot), ""],
      ["范围", D.scope === "board" ? (st.board ? st.board.name : "板块") : (D.scope === "top" ? "πN Top 30" : "跟踪邻域"), ""],
      ["§", "当日全市场"],
      ["剪枝后流量", MR.amount(f.stats.flow), ""],
      ["同大类边占比", MR.num(f.stats.coh * 100, 1) + "%", ""],
      ["转移社群", f.stats.comm + " 个", ""]
    ]) + '<div class="ds-note">节点颜色＝所属资金社群，金色＝跟踪标的；箭头指向资金沉淀方，线宽按累计金额。</div>';
    el("drillTableHead").textContent = "边表（按金额排序，点击查看来源）";
    var rows = g.edges.slice(0, 80).map(function (e) {
      return '<tr data-i="' + e[0] + '"><td>' + esc(MR.symCode(e[0])) + "</td><td class=\"dim\">→</td><td>" +
        esc(MR.symCode(e[1])) + "</td><td>" + esc(MR.symName(e[1]).slice(0, 5)) + '</td><td class="num">' +
        (e[2] * 100).toFixed(2) + '%</td><td class="num">' + MR.amount(e[3]) + "</td></tr>";
    }).join("");
    el("drillTable").innerHTML = '<table class="drill-tb"><thead><tr><th>来源 j</th><th></th><th>去向 i</th>' +
      '<th>名称</th><th class="num">P<sub>ji</sub></th><th class="num">金额</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">当前范围没有内部边</td></tr>') + "</tbody></table>";
    el("drillLegend").innerHTML = '<span class="lg">节点半径 ∝ log πN</span>' +
      '<span class="lg"><i style="background:#f3c969"></i>跟踪标的</span>' +
      '<span class="lg">悬停节点高亮其邻接边</span>';
  }

  function sidePaths() {
    var f = st.frame;
    var syms = st.tracked.length ? st.tracked : [st.selected != null ? st.selected : f.top[0]];
    var rows = syms.map(function (i) {
      var m = MR.metrics(i);
      return [
        ["$h", MR.symCode(i) + " " + MR.symName(i)],
        ["πN", MR.num(f.score[i], 2), "gold"],
        ["排名", MR.rankOf(f, i), ""],
        ["涨跌", MR.signed(f.chg[i], 2, "%"), MR.chgClass(f.chg[i])],
        ["log(π/s)", MR.num(f.z[i], 2), ""],
        ["社群", "C" + f.comm[i] + " · 迁移" + m.migr, ""],
        ["60日", MR.percent(m.ret60, 1), MR.chgClass(m.ret60)]
      ];
    });
    el("drillStats").innerHTML = rows.map(function (r) {
      return '<div class="ds-group"><div class="ds-group-h">' + esc(r[0][1]) + "</div><div class=\"ds-grid two\">" +
        r.slice(1).map(function (p) {
          return '<div class="ds-item"><label>' + esc(p[0]) + "</label><b class=\"" + (p[2] || "") + "\">" +
            esc(p[1]) + "</b></div>";
        }).join("") + "</div></div>";
    }).join("");
    el("drillTableHead").textContent = "逐日读数（点击行切换日期）";
    var start = Math.max(0, st.idx - 14);
    var head = '<tr><th>日期</th>' + syms.map(function (i) {
      return '<th class="num">' + esc(MR.symCode(i)) + "</th>";
    }).join("") + "</tr>";
    var body = "";
    for (var t = Math.min(MR.META.dates.length - 1, start + 14); t >= start; t--) {
      body += '<tr data-t="' + t + '" class="' + (t === st.idx ? "cur" : "") + '"><td>' +
        MR.fmtDate(MR.META.dates[t]).slice(5) + "</td>" + syms.map(function (i) {
          var v = D.tab === 3 ? "C" + MR.seriesCol(i, "comm")[t]
            : (D.tab === 1 ? MR.signed(MR.seriesCol(i, "chg")[t], 2, "%")
              : MR.num(MR.seriesCol(i, D.tab === 2 ? "score" : "z")[t], 2));
          return '<td class="num">' + v + "</td>";
        }).join("") + "</tr>";
    }
    /* 区间统计：整段 60 个交易日的关键数字，补足小面板看不到的细节 */
    var ND = MR.META.dates.length;
    var rangeRows = syms.map(function (i) {
      var zs = MR.seriesCol(i, "z"), cs = MR.seriesCol(i, "close"), comms = MR.seriesCol(i, "comm");
      var c0 = cs[0], c1 = cs[ND - 1];
      var hi = -Infinity, dd = 0;
      for (var t = 0; t < ND; t++) {
        if (cs[t] > hi) hi = cs[t];
        if (hi > 0 && isFinite(cs[t])) dd = Math.min(dd, cs[t] / hi - 1);
      }
      var migr = 0, stay = 0, best = 0, bestC = comms[0];
      for (var t2 = 0; t2 < ND; t2++) {
        if (t2 === 0 || comms[t2] !== comms[t2 - 1]) {
          if (t2 > 0) migr++;
          stay = 0;
        }
        stay++;
        if (stay > best) { best = stay; bestC = comms[t2]; }
      }
      var z0 = zs[0], z1 = zs[ND - 1], dz = z1 - z0;
      return '<tr><td>' + esc(MR.symCode(i)) + "</td>" +
        '<td class="num ' + (dz >= 0 ? "up" : "down") + '">' + (dz >= 0 ? "+" : "") + MR.num(dz, 2) + "</td>" +
        '<td class="num ' + MR.chgClass(c1 / c0 - 1) + '">' + MR.signed((c1 / c0 - 1) * 100, 1, "%") + "</td>" +
        '<td class="num down">' + MR.num(dd * 100, 1) + "%</td>" +
        '<td class="num">' + migr + "</td>" +
        '<td class="num">C' + bestC + " · " + best + "日</td></tr>";
    });
    el("drillTable").innerHTML =
      '<table class="drill-tb"><thead>' + head + "</thead><tbody>" + body + "</tbody></table>" +
      '<div class="drill-table-head2">区间统计（' + ND + " 个交易日）</div>" +
      '<table class="drill-tb"><thead><tr><th>代码</th><th class="num">Δlog</th>' +
      '<th class="num">区间涨跌</th><th class="num">最大回撤</th>' +
      '<th class="num">迁移</th><th class="num">最长停留</th></tr></thead><tbody>' +
      rangeRows.join("") + "</tbody></table>" +
      '<div class="drill-note">log(π/s)＝相对关注度（个股成交额占比 ÷ 全市场占比）；Δlog 越大代表资金关注度相对抬升。' +
      "迁移＝资金社群切换次数；最长停留＝连续处于同一社群的最长天数。点击上方表格任意行，可把时间轴移到该交易日。</div>";
    el("drillLegend").innerHTML = '<span class="lg">点击图表任意位置移动时间轴</span>' +
      '<span class="lg"><i style="background:#f3c969"></i>当前交易日</span>';
  }

  /* ------------------------------------------------------------------ 十字读数 */
  function updateCross() {
    var box = el("drillCross");
    if (!box) return;
    var g = D.geom;
    if (!g || D.hover < 0) { box.style.display = "none"; return; }
    var t = D.hover, f = st.frame;
    var html = "";
    if (g.mode === "graph") {
      var i0 = D.hover, s0 = MR.sym(i0), rk = MR.rankOf(f, i0);
      var inAmt = 0, outAmt = 0, cnt = 0;
      (g.edges || []).forEach(function (e) {
        if (e[1] === i0) { inAmt += e[3] || 0; cnt++; }
        if (e[0] === i0) { outAmt += e[3] || 0; cnt++; }
      });
      html = '<div class="dc-date">' + esc(s0[1]) + " " + esc(s0[0]) + "</div>" +
        '<div class="dc-grid"><span>πN</span><b class="gold">' + MR.num(f.score[i0], 2) + "</b>" +
        "<span>排名</span><b>" + (rk > 0 ? rk : "—") + "</b>" +
        "<span>涨跌</span><b class='" + MR.chgClass(f.chg[i0]) + "'>" + MR.signed(f.chg[i0], 2, "%") + "</b>" +
        "<span>社群</span><b>C" + f.comm[i0] + "</b>" +
        "<span>流入 / 流出</span><b>" + MR.amount(inAmt) + " / " + MR.amount(outAmt) + "</b>" +
        "<span>相关边</span><b>" + cnt + " 条</b></div>";
      box.innerHTML = html;
      box.style.display = "block";
      var p0 = g.pos[i0] || {};
      box.style.left = Math.min(W - 200, Math.max(8, (p0.x || 0) + 16)) + "px";
      box.style.top = Math.min(H - 150, Math.max(8, (p0.y || 0) - 40)) + "px";
      return;
    }
    if (g.mode === "sym") {
      var i = D.payload.i, m = MR.metrics(i, t);
      html = '<div class="dc-date">' + MR.fmtDate(MR.META.dates[t]) + "</div>" +
        '<div class="dc-grid"><span>开</span><b>' + MR.num(m.o, 2) + "</b>" +
        "<span>高</span><b>" + MR.num(m.h, 2) + "</b>" +
        "<span>低</span><b>" + MR.num(m.l, 2) + "</b>" +
        "<span>收</span><b class='" + MR.chgClass(MR.seriesCol(i, "chg")[t]) + "'>" + MR.num(m.c, 2) + "</b>" +
        "<span>涨跌</span><b class='" + MR.chgClass(MR.seriesCol(i, "chg")[t]) + "'>" +
        MR.signed(MR.seriesCol(i, "chg")[t], 2, "%") + "</b>" +
        "<span>成交额</span><b>" + MR.amount(MR.seriesCol(i, "amt")[t]) + "</b>" +
        "<span>πN</span><b class='gold'>" + MR.num(MR.seriesCol(i, "score")[t], 2) + "</b>" +
        "<span>社群</span><b>C" + MR.seriesCol(i, "comm")[t] + "</b></div>";
    } else if (g.mode === "board") {
      var b = st.board;
      var rows = b ? MR.boardSeries(b.id) : MR.marketRows();
      var r = rows[t] || [];
      html = '<div class="dc-date">' + MR.fmtDate(MR.META.dates[t]) + "</div>" +
        '<div class="dc-grid"><span>平均涨幅</span><b class="' + MR.chgClass(r[0]) + '">' + MR.signed(r[0], 2, "%") + "</b>" +
        "<span>平均 πN</span><b class='gold'>" + MR.num(r[1], 2) + "</b>" +
        "<span>成交额</span><b>" + MR.amount(r[2]) + "</b>" +
        "<span>涨 / 跌</span><b>" + r[3] + " / " + r[4] + "</b></div>";
    } else if (g.mode === "paths") {
      var syms = g.syms || [];
      html = '<div class="dc-date">' + MR.fmtDate(MR.META.dates[t]) + "</div>" + syms.map(function (i) {
        var v = D.tab === 3 ? "C" + MR.seriesCol(i, "comm")[t]
          : (D.tab === 1 ? MR.signed(MR.seriesCol(i, "chg")[t], 2, "%")
            : MR.num(MR.seriesCol(i, D.tab === 2 ? "score" : "z")[t], 2));
        return '<div class="dc-row"><span>' + esc(MR.symCode(i)) + "</span><b>" + v + "</b></div>";
      }).join("");
    }
    box.innerHTML = html;
    box.style.display = "block";
    var mx = g.X ? g.X(t) : 0;
    var left = Math.min(W - 190, Math.max(8, mx + 14));
    box.style.left = left + "px";
    box.style.top = "10px";
  }

  /* ------------------------------------------------------------------ 命中测试 */
  function hoverIndex(ev) {
    var g = D.geom;
    if (!g) return -1;
    var r = cv.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (g.mode === "graph") {
      var best = -1, bd = 18;
      (g.ids || []).forEach(function (i) {
        var p = g.pos[i];
        if (!p) return;
        var d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    if (!g.X) return -1;
    /* 反解最近日期 */
    var n = g.n, bestT = -1, bdist = 1e9;
    for (var t = 0; t < n; t++) {
      var d2 = Math.abs(g.X(t) - x);
      if (d2 < bdist) { bdist = d2; bestT = t; }
    }
    return bestT;
  }

  function bindCanvas() {
    cv.addEventListener("pointermove", function (e) {
      var i = hoverIndex(e);
      if (i !== D.hover) {
        D.hover = i;
        drawChart();
        if (D.geom && D.geom.mode === "graph" && D.open) highlightEdgeRows(i);
      }
    });
    cv.addEventListener("pointerleave", function () {
      if (D.hover !== -1) { D.hover = -1; drawChart(); }
    });
    cv.addEventListener("click", function (e) {
      var g = D.geom;
      if (!g) return;
      if (g.mode === "graph") {
        if (D.hover >= 0) { close(); MR.selectSymbol(D.hover, false); open("sym", { i: D.hover }); }
        return;
      }
      if (D.hover >= 0 && D.hover !== st.idx) MR.setDate(D.hover);
    });
    cv.addEventListener("dblclick", function () {
      var g = D.geom;
      if (g && g.mode !== "graph" && D.hover >= 0) {
        if (D.mode === "paths" && g.syms) {
          var k = g.syms[0];
          close(); open("sym", { i: k });
        }
      }
    });
  }

  function highlightEdgeRows(i) {
    var rows = el("drillTable").querySelectorAll("tr[data-i]");
    rows.forEach(function (r) {
      r.classList.toggle("hl", Number(r.getAttribute("data-i")) === i);
    });
  }

  /* ------------------------------------------------------------------ 表格交互 */
  var tableBound = false;
  function bindTable() {
    if (tableBound) return;
    tableBound = true;
    el("drillTable").addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (!tr) return;
      if (tr.dataset.i != null) {
        var i = Number(tr.dataset.i);
        if (D.mode === "sym") { MR.selectSymbol(i, false); open("sym", { i: i }); }
        else { close(); MR.selectSymbol(i, false); open("sym", { i: i }); }
        return;
      }
      if (tr.dataset.t != null) MR.setDate(Number(tr.dataset.t));
    });
  }

  /* ------------------------------------------------------------------ 事件绑定 */
  function init() {
    cv = el("drillCanvas");
    bindCanvas();
    el("drillClose").addEventListener("click", close);
    el("drill").addEventListener("click", function (e) {
      if (e.target === el("drill")) close();
    });
    el("drillTabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tab]");
      if (!b) return;
      D.tab = Number(b.dataset.tab);
      if (D.mode === "graph") D.scope = ["track", "board", "top"][D.tab] || "track";
      D.hover = -1;
      render();
    });
    document.querySelectorAll("[data-drill]").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-drill");
        if (m === "sym") open("sym", { i: st.selected != null ? st.selected : st.frame.top[0] });
        else open(m, {});
      });
    });
    var rt = null;
    window.addEventListener("resize", function () {
      if (!D.open) return;
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () { render(); }, 140);
    });
    document.addEventListener("keydown", function (e) {
      if (!D.open) return;
      if (e.key === "Escape") { close(); e.stopPropagation(); e.preventDefault(); }
    });
  }

  MR.Drill = {
    init: init,
    open: open,
    close: close,
    isOpen: function () { return D.open; },
    modeOf: function () { return D.mode; },
    refresh: function () { if (D.open) render(); }
  };
})();
