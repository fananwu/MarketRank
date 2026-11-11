/* MarketRank · Fluxscape — 面板群（板块 / 真值表 / 路径 / 转移图 / 个股 / 时间序列） */
(function () {
  "use strict";
  if (!window.MR) return;
  var MR = window.MR, st = MR.state;
  function el(id) { return document.getElementById(id); }
  function setHTML(id, html) { var e = el(id); if (e) e.innerHTML = html; }

  var graphPos = {};
  var graphHover = -1;
  var lastSuggest = [];

  function currentRows(id) { return MR.boardSeries(id)[st.idx] || [0, 0, 0, 0, 0, 0, -1]; }

  /* ---------------- KPI ---------------- */
  function renderKpis() {
    var f = st.frame; if (!f) return;
    var s = f.stats, leader = f.top[0];
    var items = [
      ["交易日", MR.fmtDate(f.date), "gold"],
      ["活跃标的", MR.num(s.active, 0), ""],
      ["涨 / 跌", s.up + " / " + s.down, s.up >= s.down ? "up" : "down"],
      ["成交额", MR.amount(s.amount), ""],
      ["资金社群", MR.num(s.comm, 0), ""],
      ["Gini(π)", MR.num(s.gini, 3), ""],
      ["teleport 底", MR.num(s.floor * 100, 1) + "%", ""],
      ["同大类边", MR.num(s.coh * 100, 1) + "%", ""],
      ["Top1 πN", leader != null ? MR.num(f.score[leader], 2) : "—", "gold"]
    ];
    setHTML("kpis", items.map(function (p) {
      return '<div class="kpi"><label>' + p[0] + '</label><b class="' + p[2] + '">' +
        MR.esc(p[1]) + "</b></div>";
    }).join(""));
  }

  /* ---------------- 板块 ---------------- */
  function renderBoardTabs() {
    var kinds = ["hy", "major", "gn", "fg", "zs", "flux"];
    setHTML("boardTabs", kinds.map(function (k) {
      var n = (MR.byKind[k] || []).length;
      return '<button data-kind="' + k + '" class="' + (st.boardKind === k ? "active" : "") +
        '">' + MR.esc(MR.KIND_LABEL[k]) + "<em>" + n + "</em></button>";
    }).join(""));
    setHTML("boardCount", MR.META.boards.length + " 个板块");
  }

  function boardMemberCount(b, f) {
    if (b.kind === "flux") {
      var cid = parseInt(b.id.split(":")[1], 10);
      return f.comm.filter(function (c) { return c === cid; }).length;
    }
    return b.n;
  }

  function renderBoardList() {
    var f = st.frame; if (!f) return;
    var list = MR.byKind[st.boardKind] || [];
    var q = (st.boardQuery || "").trim().toLowerCase();
    var shown = list.filter(function (b) {
      if (!q) return true;
      if (b.name.toLowerCase().indexOf(q) >= 0) return true;
      if (q.length >= 2 && b.members) {
        for (var j = 0; j < b.members.length; j++) {
          var i = b.members[j];
          if (MR.symCode(i).indexOf(q) >= 0 || MR.symName(i).toLowerCase().indexOf(q) >= 0) return true;
        }
      }
      return false;
    });
    /* 按当日平均涨幅排序，方便直接看出强弱 */
    shown = shown.slice().sort(function (a, b) {
      return (currentRows(b.id)[0] || 0) - (currentRows(a.id)[0] || 0);
    });
    var rows = shown.map(function (b) {
      var r = currentRows(b.id);
      var cls = MR.chgClass(r[0]);
      var strength = Math.max(-1, Math.min(1, (r[0] || 0) / 4));
      return '<div class="board-row' + (st.board && st.board.id === b.id ? " active" : "") +
        '" data-id="' + MR.esc(b.id) + '" title="点击筛选主视图">' +
        '<div class="nm">' + MR.esc(b.name) + "<small>" + MR.esc(MR.boardLabel(b)) + "</small></div>" +
        '<div class="v ' + cls + '">' + MR.signed(r[0], 2, "%") + "</div>" +
        '<div class="v dim">' + MR.num(r[1], 1) + "</div>" +
        '<div class="bar"><i class="' + cls + '" style="width:' +
        (Math.abs(strength) * 100).toFixed(0) + '%"></i></div>' +
        '<div class="cnt">' + boardMemberCount(b, f) + "</div></div>";
    });
    setHTML("boardList", rows.join("") ||
      '<div style="padding:14px;color:var(--txt3);font-size:11px">没有匹配的板块</div>');
  }

  function renderBoardSummary() {
    var f = st.frame; if (!f) return;
    if (!st.board) {
      var kinds = ["hy", "major", "gn", "fg", "zs", "flux"];
      setHTML("boardSummary", "全部 " + MR.META.boards.length + " 个板块 · " +
        kinds.map(function (k) { return MR.KIND_LABEL[k] + " " + (MR.byKind[k] || []).length; }).join(" / ") +
        "<br>点击板块可过滤主视图、排行表与成分明细；数据随交易日联动。");
      return;
    }
    var b = st.board, r = currentRows(b.id);
    var members = MR.frameMembers(b, f);
    var lead = r[6] >= 0 ? MR.symName(r[6]) : "—";
    var extra = "";
    if (b.kind === "flux") {
      var info = f.communities.filter(function (c) { return c.id === parseInt(b.id.split(":")[1], 10); })[0];
      if (info) extra = " · 主导行业 <b>" + MR.esc(info.lead) + "</b> · 中位 z <b>" + MR.num(info.z, 2) + "</b>";
    } else {
      extra = " · 分类 <b>" + MR.esc(MR.boardLabel(b)) + "</b>";
    }
    setHTML("boardSummary",
      "<b>" + MR.esc(b.name) + "</b>" + extra + "<br>" +
      "成分 <b>" + members.length + "</b> · 平均涨幅 <b class='" + MR.chgClass(r[0]) + "'>" +
      MR.signed(r[0], 2, "%") + "</b> · 平均 πN <b>" + MR.num(r[1], 2) + "</b><br>" +
      "涨 <b class='up'>" + r[3] + "</b> / 跌 <b class='down'>" + r[4] + "</b> · 成交额 <b>" +
      MR.amount(r[2]) + "</b> · 领涨 <b>" + MR.esc(lead) + "</b>");
  }

  function renderBoardMembers() {
    var f = st.frame; if (!f) return;
    if (!st.board) {
      setHTML("boardMembers", "<h3>板块成分</h3><div style='color:var(--txt3)'>未选择板块 · 显示全市场 · " +
        "在地形上悬停或点击标签可直接看个股</div>");
      return;
    }
    var ids = MR.frameMembers(st.board, f).slice().sort(function (a, b) { return f.score[b] - f.score[a]; });
    var shown = ids.slice(0, 24);
    setHTML("boardMembers", "<h3>" + MR.esc(st.board.name) + " · πN 前 " + shown.length +
      " / 共 " + ids.length + " 只 <button class='link-btn' id='memAll'>全部明细 ↗</button></h3>" +
      '<div class="mem-grid">' + shown.map(function (i) {
        return '<div class="mem-item' + (i === st.selected ? " sel" : "") + '" data-sym="' + i + '">' +
          "<span>" + MR.esc(MR.symName(i)) + "</span>" +
          "<em class='" + MR.chgClass(f.chg[i]) + "'>" + MR.signed(f.chg[i], 1, "%") + "</em></div>";
      }).join("") + "</div>");
    var all = el("memAll");
    if (all) all.onclick = function (e) {
      e.stopPropagation();
      if (MR.Drill) MR.Drill.open("board", {});
    };
  }

  /* ---------------- 真值表 ---------------- */
  function renderTruth() {
    var f = st.frame; if (!f) return;
    var ids;
    if (st.board) {
      ids = MR.frameMembers(st.board, f).slice().sort(function (a, b) { return f.score[b] - f.score[a]; });
    } else {
      ids = f.top.slice();
    }
    ids = ids.slice(0, st.truthTop);
    var rank = MR.rankMap(f);
    var body = ids.map(function (i, k) {
      var s = MR.sym(i);
      return '<tr data-sym="' + i + '" title="点击选中 · 双击看详情" class="' +
        (st.tracked.indexOf(i) >= 0 ? "tracked" : "") + (i === st.selected ? " sel" : "") + '">' +
        "<td>" + (k + 1) + "</td><td>" + MR.esc(s[0]) + "</td><td>" + MR.esc(s[1]) + "</td>" +
        '<td class="' + MR.chgClass(f.chg[i]) + '">' + MR.signed(f.chg[i], 2, "%") + "</td>" +
        "<td>" + MR.num(f.score[i], 2) + "</td>" +
        '<td class="' + MR.chgClass(f.hb[i]) + '">' + MR.signed(f.hb[i], 3) + "</td>" +
        '<td class="dim">' + (rank[i] > 0 ? rank[i] : "—") + "</td></tr>";
    }).join("");
    setHTML("truthTable",
      "<thead><tr><th>#</th><th>代码</th><th>名称</th><th>涨跌</th><th>πN</th><th>Δlog</th><th>排名</th></tr></thead><tbody>" +
      (body || '<tr><td colspan="7" style="text-align:center;color:var(--txt3)">该板块当日无成分</td></tr>') + "</tbody>");
    el("truthCount").textContent = "Top " + st.truthTop;
    el("truthScope").textContent = st.board ? MR.esc(st.board.name) : "全部 A 股";
    el("btnMore").textContent = st.truthTop === 10 ? "展开 Top 50" : "收起 Top 10";
  }

  /* ---------------- 跟踪路径 ---------------- */
  function renderPaths() {
    var f = st.frame; if (!f) return;
    var cv = el("pathChart");
    if (!cv) return;
    var o = MR.fitCanvas(cv), c = o.ctx, w = o.w, h = o.h;
    var D = MR.META.dates.length, padL = 26, padR = 74;
    c.fillStyle = "#0a111a"; c.fillRect(0, 0, w, h);
    var tracked = st.tracked.length ? st.tracked : (st.selected != null ? [st.selected] : []);
    if (!tracked.length) {
      c.fillStyle = "#5c7189"; c.font = "11px sans-serif";
      c.fillText("在下方输入代码或用 ↑ 选择股票进行跟踪", padL, h / 2);
      setHTML("commStrip", ""); setHTML("trackChips", "");
      el("trackCount").textContent = "0 / 4";
      return;
    }
    var all = [];
    tracked.forEach(function (i) { all = all.concat(MR.seriesCol(i, "z")); });
    var mx = Math.max(1.2, Math.max.apply(null, all.map(Math.abs).filter(isFinite)) || 1.2);
    var X = function (t) { return padL + t / Math.max(1, D - 1) * (w - padL - padR); };
    var Y = function (v) { return h / 2 - v / mx * (h / 2 - 12); };
    c.strokeStyle = "#1b2837"; c.lineWidth = 1;
    [0.25, 0.75].forEach(function (q) {
      c.beginPath(); c.moveTo(padL, h * q); c.lineTo(w - padR, h * q); c.stroke();
    });
    c.strokeStyle = "rgba(140,165,190,.42)";
    c.beginPath(); c.moveTo(padL, h / 2); c.lineTo(w - padR, h / 2); c.stroke();
    c.fillStyle = "#5c7189"; c.font = "9.5px monospace";
    c.fillText("+" + mx.toFixed(1), 2, 12); c.fillText("0", 2, h / 2 + 3);
    c.fillText("-" + mx.toFixed(1), 2, h - 13);
    /* 日期刻度（左对齐，避免与纵轴刻度重叠） */
    var step = Math.ceil(D / 4);
    for (var t0 = 0; t0 < D; t0 += step) {
      c.fillStyle = "#40536a"; c.font = "9px monospace";
      c.fillText(MR.fmtDate(MR.META.dates[t0]).slice(5), X(t0) + 2, h - 2);
    }
    /* 右侧图例：按纵坐标排序后强制上下错开，避免两条线贴太近时文字互压 */
    var leg = tracked.map(function (i, k) {
      var zs = MR.seriesCol(i, "z");
      var vy = Y(isFinite(zs[st.idx]) ? zs[st.idx] : 0);
      return { i: i, col: MR.COMM_COLORS[k % MR.COMM_COLORS.length], vy: vy, ly: vy };
    }).sort(function (a, b) { return a.ly - b.ly; });
    for (var li = 1; li < leg.length; li++) leg[li].ly = Math.max(leg[li].ly, leg[li - 1].ly + 22);
    var over = leg.length ? leg[leg.length - 1].ly - (h - 6) : 0;
    if (over > 0) leg.forEach(function (x) { x.ly -= over; });
    tracked.forEach(function (i, k) {
      var col = MR.COMM_COLORS[k % MR.COMM_COLORS.length];
      var zs = MR.seriesCol(i, "z");
      var pts = zs.map(function (v, t) { return [X(t), Y(isFinite(v) ? v : 0)]; });
      MR.line(c, pts, col, 1.7);
      var vy = Y(zs[st.idx] || 0);
      c.beginPath(); c.arc(X(st.idx), vy, 3.2, 0, 6.283);
      c.fillStyle = col; c.fill();
    });
    leg.forEach(function (x) {
      c.fillStyle = "rgba(10,18,28,.9)"; c.fillRect(w - padR + 2, x.ly - 9, padR - 5, 22);
      c.fillStyle = x.col; c.fillRect(w - padR + 2, x.ly - 9, 2, 22);
      c.font = "600 10px monospace"; c.fillStyle = x.col;
      c.fillText(MR.symCode(x.i), w - padR + 7, x.ly + 1);
      c.font = "9.5px sans-serif"; c.fillStyle = "#8ea3ba";
      c.fillText(MR.symName(x.i).slice(0, 5), w - padR + 7, x.ly + 13);
    });
    c.strokeStyle = "rgba(243,201,105,.85)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(X(st.idx), 0); c.lineTo(X(st.idx), h); c.stroke();

    setHTML("commStrip", tracked.map(function (i) {
      var cs = MR.seriesCol(i, "comm");
      var bars = cs.map(function (v, t) {
        return '<i title="' + MR.fmtDate(MR.META.dates[t]) + ' · C' + v + '" style="background:' +
          MR.commColor(v) + (t === st.idx ? ';outline:1px solid #f3c969;outline-offset:-1px' : "") + '"></i>';
      }).join("");
      return '<div class="strip-row"><label>' + MR.esc(MR.symCode(i)) + '</label><div class="strip-bar">' +
        bars + "</div></div>";
    }).join(""));
    setHTML("trackChips", tracked.map(function (i) {
      return '<span class="chip" data-sym="' + i + '">' + MR.esc(MR.symCode(i)) + " " +
        MR.esc(MR.symName(i)) + " ×</span>";
    }).join(""));
    el("trackCount").textContent = st.tracked.length + " / 4";
  }

  /* ---------------- 局部转移图 ---------------- */
  function renderGraph() {
    var f = st.frame; if (!f) return;
    var cv = el("graphChart");
    if (!cv) return;
    var o = MR.fitCanvas(cv), c = o.ctx, w = o.w, h = o.h;
    c.fillStyle = "#0a111a"; c.fillRect(0, 0, w, h);
    var tracked = st.tracked.length ? st.tracked : f.top.slice(0, 2);
    var tset = {}; tracked.forEach(function (i) { tset[i] = 1; });
    var touching = f.edges.filter(function (e) { return tset[e[0]] || tset[e[1]]; });
    touching.sort(function (a, b) { return (b[3] || 0) - (a[3] || 0); });
    var nodes = {};
    tracked.forEach(function (i) { nodes[i] = (nodes[i] || 0) + 3; });
    touching.slice(0, 26).forEach(function (e) { nodes[e[0]] = (nodes[e[0]] || 0) + 1; nodes[e[1]] = (nodes[e[1]] || 0) + 1; });
    var ids = Object.keys(nodes).map(Number).sort(function (a, b) { return nodes[b] - nodes[a]; }).slice(0, 16);
    if (!ids.length) { el("graphCount").textContent = "0 节点"; return; }
    var nset = {}; ids.forEach(function (i) { nset[i] = 1; });
    var edges = f.edges.filter(function (e) { return nset[e[0]] && nset[e[1]]; })
      .sort(function (a, b) { return (b[3] || 0) - (a[3] || 0); }).slice(0, 46);

    ids.forEach(function (i, k) {
      if (!graphPos[i]) {
        var a = k / ids.length * Math.PI * 2;
        graphPos[i] = { x: w / 2 + Math.cos(a) * Math.min(w, h) * .26,
                        y: h / 2 + Math.sin(a) * Math.min(w, h) * .26, vx: 0, vy: 0 };
      }
    });
    for (var it = 0; it < 70; it++) {
      for (var a1 = 0; a1 < ids.length; a1++) {
        for (var b1 = a1 + 1; b1 < ids.length; b1++) {
          var p = graphPos[ids[a1]], q = graphPos[ids[b1]];
          var dx = p.x - q.x, dy = p.y - q.y, d2 = Math.max(36, dx * dx + dy * dy);
          var force = 760 / d2, d = Math.sqrt(d2);
          p.vx += dx / d * force; p.vy += dy / d * force;
          q.vx -= dx / d * force; q.vy -= dy / d * force;
        }
      }
      edges.forEach(function (e) {
        var p = graphPos[e[0]], q = graphPos[e[1]];
        if (!p || !q) return;
        var dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var k = (d - 56) * 0.012;
        p.vx += dx / d * k; p.vy += dy / d * k;
        q.vx -= dx / d * k; q.vy -= dy / d * k;
      });
      ids.forEach(function (i) {
        var p = graphPos[i];
        p.vx += (w / 2 - p.x) * 0.004; p.vy += (h / 2 - p.y) * 0.004;
        p.x = Math.max(22, Math.min(w - 34, p.x + p.vx * .55));
        p.y = Math.max(16, Math.min(h - 16, p.y + p.vy * .55));
        p.vx *= .72; p.vy *= .72;
      });
    }
    var maxD = Math.max(1, Math.max.apply(null, edges.map(function (e) { return e[3] || 0; })));
    edges.forEach(function (e) {
      var p = graphPos[e[0]], q = graphPos[e[1]];
      if (!p || !q) return;
      var dark = tset[e[0]] || tset[e[1]];
      var dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      var ux = dx / d, uy = dy / d;
      var sx = p.x + ux * 8, sy = p.y + uy * 8;
      var ex = q.x - ux * 10, ey = q.y - uy * 10;
      c.strokeStyle = dark ? "rgba(127,180,255,.8)" : "rgba(70,100,135,.3)";
      c.lineWidth = 0.6 + 2.2 * Math.sqrt((e[3] || 0) / maxD);
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
      c.fillStyle = dark ? "rgba(127,180,255,.9)" : "rgba(70,100,135,.4)";
      c.beginPath();
      c.moveTo(ex, ey);
      c.lineTo(ex - ux * 6 - uy * 3, ey - uy * 6 + ux * 3);
      c.lineTo(ex - ux * 6 + uy * 3, ey - uy * 6 - ux * 3);
      c.closePath(); c.fill();
    });
    var labRects = [];
    function putLabel(i, p, r, strong) {
      var txt = MR.symCode(i);
      c.font = (strong ? "600 10px monospace" : "9.5px monospace");
      var tw = c.measureText(txt).width + 6, th = 13;
      var cands = [
        [p.x + r + 2, p.y - 6],
        [p.x - r - 2 - tw, p.y - 6],
        [p.x - tw / 2, p.y - r - th - 3],
        [p.x - tw / 2, p.y + r + 4]
      ];
      for (var ci = 0; ci < cands.length; ci++) {
        var x = cands[ci][0], y = cands[ci][1];
        if (x < 1 || y < 1 || x + tw > w - 1 || y + th > h - 1) continue;
        var bad = false;
        for (var k2 = 0; k2 < labRects.length; k2++) {
          var o = labRects[k2];
          if (x < o.x + o.w + 1 && x + tw + 1 > o.x && y < o.y + o.h + 1 && y + th + 1 > o.y) { bad = true; break; }
        }
        if (bad) continue;
        labRects.push({ x: x, y: y, w: tw, h: th });
        c.fillStyle = "rgba(9,16,25,.82)"; c.fillRect(x, y, tw, th);
        c.fillStyle = strong ? "#f3c969" : "rgba(159,179,200,.9)";
        c.fillText(txt, x + 3, y + 10);
        return true;
      }
      return false;
    }
    ids.forEach(function (i) {
      var p = graphPos[i];
      var r = 4 + Math.min(6, Math.log10(1 + Math.max(0, f.score[i])) * 2.2);
      c.beginPath(); c.arc(p.x, p.y, r, 0, 6.283);
      c.fillStyle = tset[i] ? "#f3c969" : MR.commColor(f.comm[i]); c.fill();
      c.lineWidth = 1; c.strokeStyle = "#08111b"; c.stroke();
      putLabel(i, p, r, !!tset[i]);
    });
    if (graphHover >= 0 && graphPos[graphHover]) {
      var p2 = graphPos[graphHover];
      var rel = edges.filter(function (e) { return e[0] === graphHover || e[1] === graphHover; })
        .sort(function (a, b) { return b[3] - a[3]; })[0];
      var lines = [MR.symCode(graphHover) + " " + MR.symName(graphHover),
                   "πN " + MR.num(f.score[graphHover], 2) + " · C" + f.comm[graphHover],
                   rel ? (rel[0] === graphHover ? "流出→" + MR.symCode(rel[1]) : "流入←" + MR.symCode(rel[0])) +
                     " P " + (rel[2] * 100).toFixed(1) + "%" : "无邻接边"];
      var bw = 158, bh = 8 + lines.length * 13;
      var bx = Math.min(w - bw - 4, p2.x + 12), by = Math.max(4, p2.y - bh - 8);
      c.fillStyle = "rgba(10,18,28,.96)"; c.fillRect(bx, by, bw, bh);
      c.strokeStyle = "#35506d"; c.strokeRect(bx, by, bw, bh);
      c.font = "10px monospace";
      lines.forEach(function (t, k) { c.fillStyle = k ? "#8ea3ba" : "#dce8f4"; c.fillText(t, bx + 6, by + 14 + k * 13); });
    }
    el("graphCount").textContent = ids.length + " 节点 / " + edges.length + " 边";
  }

  /* ---------------- 当前标的（紧凑卡片，详情进放大视图） ---------------- */
  function renderDetail() {
    var f = st.frame; if (!f) return;
    var i = st.selected;
    if (i == null || !MR.sym(i).length) i = st.tracked[0] != null ? st.tracked[0] : f.top[0];
    var s = MR.sym(i), m = MR.metrics(i), rank = MR.rankOf(f, i);
    el("detailCode").textContent = s[0];
    var tracked = st.tracked.indexOf(i) >= 0;
    var items = [
      ["πN", MR.num(f.score[i], 2), "gold"],
      ["排名", rank > 0 ? rank : "—", ""],
      ["成交额", MR.amount(f.amt[i]), ""],
      ["60 日", MR.percent(m.ret60, 1), MR.chgClass(m.ret60)],
      ["社群", "C" + f.comm[i], ""],
      ["振幅", isFinite(m.amp) ? m.amp.toFixed(1) + "%" : "—", ""]
    ];
    setHTML("detailBody",
      '<div class="sel-card">' +
        '<div class="sc-head"><b>' + MR.esc(s[1]) + "</b><small>" + MR.esc(s[0]) + " · " + MR.esc(s[3]) +
          (s[5] ? " · ETF" : "") + "</small></div>" +
        '<div class="sc-price"><b class="' + MR.chgClass(f.chg[i]) + '">' + MR.num(m.c, 2) + "</b>" +
          '<em class="' + MR.chgClass(f.chg[i]) + '">' + MR.signed(f.chg[i], 2, "%") + "</em></div>" +
        '<div class="sc-grid">' + items.map(function (p) {
          return '<div class="sc-i"><span>' + p[0] + "</span><b class=\"" + (p[2] || "") + "\">" + p[1] + "</b></div>";
        }).join("") + "</div>" +
        '<div class="sc-actions"><button class="btn mini" id="scDetail">K 线 & 资金详情 ↗</button>' +
          '<button class="btn mini" id="scTrack">' + (tracked ? "取消跟踪" : "加入跟踪") + "</button></div>" +
      "</div>");
    var b1 = el("scDetail");
    if (b1) b1.onclick = function () { if (MR.Drill) MR.Drill.open("sym", { i: i }); };
    var b2 = el("scTrack");
    if (b2) b2.onclick = function () { MR.toggleTrack(i); };
  }

  /* ---------------- 板块时间序列 ---------------- */
  function renderTs() {
    var f = st.frame; if (!f) return;
    var id = st.board ? st.board.id : null;
    var rows = id ? MR.boardSeries(id) : MR.marketRows();
    if (!rows || !rows.length) return;
    el("tsTitle").textContent = st.board ? st.board.name : "全市场 · 全部 " + MR.META.symbols.length + " 只";
    var cv = el("boardTs");
    if (!cv) return;
    var o = MR.fitCanvas(cv), c = o.ctx, w = o.w, h = o.h;
    var D = rows.length, pad = 30;
    c.fillStyle = "#0a111a"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#1b2837";
    for (var g = 0; g <= 3; g++) {
      var yy = 8 + g * (h - 18) / 3;
      c.beginPath(); c.moveTo(pad, yy); c.lineTo(w - 6, yy); c.stroke();
    }
    var X = function (t) { return pad + t / Math.max(1, D - 1) * (w - pad - 8); };
    var mxChg = Math.max(1.2, Math.max.apply(null, rows.map(function (r) { return Math.abs(r[0]); })));
    c.strokeStyle = "rgba(140,165,190,.35)";
    c.beginPath(); c.moveTo(pad, h / 2); c.lineTo(w - 6, h / 2); c.stroke();
    var series = [
      { key: 0, color: "#ff5d6c", scale: mxChg, width: 1.7 },
      { key: 1, color: "#4f9bff", scale: Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.abs(r[1]); }))), width: 1.3 },
      { key: 4, color: "#35d6a3", scale: 0, width: 1.1, dash: [3, 3] }
    ];
    series.forEach(function (s) {
      var pts = rows.map(function (r, t) {
        var v = s.key === 4 ? ((r[3] / Math.max(1, r[3] + r[4])) * 100 - 50) / 50 : r[s.key] / s.scale;
        return [X(t), h / 2 - Math.max(-1, Math.min(1, v)) * (h / 2 - 9)];
      });
      MR.line(c, pts, s.color, s.width, s.dash);
    });
    c.strokeStyle = "rgba(243,201,105,.85)";
    c.beginPath(); c.moveTo(X(st.idx), 0); c.lineTo(X(st.idx), h); c.stroke();
    c.font = "9px monospace"; c.fillStyle = "#5c7189";
    c.fillText("±" + mxChg.toFixed(1) + "%", 2, 11);
    c.fillText(MR.fmtDate(MR.META.dates[0]).slice(5), pad, h - 2);
    c.fillText(MR.fmtDate(MR.META.dates[D - 1]).slice(5), w - 48, h - 2);

    var start = Math.max(0, Math.min(D - 10, st.idx - 6));
    var trs = [];
    for (var t2 = start; t2 < Math.min(D, start + 10); t2++) {
      var r = rows[t2];
      trs.push('<tr data-t="' + t2 + '" class="' + (t2 === st.idx ? "cur" : "") + '">' +
        "<td>" + MR.fmtDate(MR.META.dates[t2]).slice(5) + "</td>" +
        "<td class='" + MR.chgClass(r[0]) + "'>" + MR.signed(r[0], 2) + "</td>" +
        "<td>" + MR.num(r[1], 2) + "</td><td>" + MR.amount(r[2]) + "</td>" +
        "<td>" + r[3] + ":" + r[4] + "</td>" +
        (st.board
          ? "<td>" + (r[6] >= 0 ? MR.esc(MR.symName(r[6])) : "—") + "</td>"
          : "<td class='" + MR.chgClass((r[3] / Math.max(1, r[3] + r[4]) - .5) * 100) + "'>" +
            (r[3] / Math.max(1, r[3] + r[4]) * 100).toFixed(0) + "%</td>") + "</tr>");
    }
    setHTML("tsTable", "<thead><tr><th>日期</th><th>涨%</th><th>πN</th><th>成交额</th><th>涨:跌</th><th>" +
      (st.board ? "领涨" : "涨占比") + "</th></tr></thead><tbody>" +
      trs.join("") + "</tbody>");
  }

  function renderTimeline() {
    var f = st.frame; if (!f) return;
    el("tlDate").textContent = MR.fmtDate(f.date);
    el("tlIndex").textContent = "T+" + (st.idx + 1) + "/" + MR.META.dates.length;
    el("tlRange").value = st.idx;
    var D = MR.META.dates.length;
    setHTML("tlTicks", [0, Math.floor(D / 4), Math.floor(D / 2), Math.floor(D * 3 / 4), D - 1]
      .map(function (t) { return "<span>" + MR.fmtDate(MR.META.dates[t]).slice(5) + "</span>"; }).join(""));
    el("tlMeta").textContent = "up " + f.stats.up + " / down " + f.stats.down +
      " · floor " + (f.stats.floor * 100).toFixed(1) + "% · iters " + f.stats.iters;
  }

  /* ---------------- 事件 ---------------- */
  function initEvents() {
    el("boardTabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-kind]");
      if (!b) return;
      st.boardKind = b.dataset.kind;
      renderBoardTabs(); renderBoardList();
    });
    el("boardSearch").addEventListener("input", function (e) {
      st.boardQuery = e.target.value; renderBoardList();
    });
    el("boardList").addEventListener("click", function (e) {
      var row = e.target.closest(".board-row");
      if (!row) return;
      var b = MR.boardById[row.dataset.id];
      MR.setBoard(st.board && st.board.id === b.id ? null : b);
    });
    el("boardMembers").addEventListener("click", function (e) {
      var m = e.target.closest(".mem-item");
      if (m) MR.selectSymbol(Number(m.dataset.sym), true);
    });
    el("truthTable").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-sym]");
      if (tr) MR.selectSymbol(Number(tr.dataset.sym), true);
    });
    el("truthTable").addEventListener("dblclick", function (e) {
      var tr = e.target.closest("tr[data-sym]");
      if (tr && MR.Drill) MR.Drill.open("sym", { i: Number(tr.dataset.sym) });
    });
    el("btnMore").addEventListener("click", function () {
      st.truthTop = st.truthTop === 10 ? 50 : 10; renderTruth();
    });
    el("trackChips").addEventListener("click", function (e) {
      var ch = e.target.closest(".chip");
      if (ch) MR.toggleTrack(Number(ch.dataset.sym));
    });
    el("trackSearch").addEventListener("input", function (e) {
      var q = e.target.value.trim().toLowerCase();
      var box = el("trackSuggest");
      if (!q) { box.innerHTML = ""; box.style.display = "none"; lastSuggest = []; return; }
      var hits = [];
      for (var i = 0; i < MR.META.symbols.length && hits.length < 10; i++) {
        var s = MR.META.symbols[i];
        if (s[0].indexOf(q) >= 0 || s[1].toLowerCase().indexOf(q) >= 0) hits.push(i);
      }
      lastSuggest = hits;
      box.innerHTML = hits.map(function (i) {
        return '<div data-sym="' + i + '">' + MR.esc(MR.symCode(i)) + " · " + MR.esc(MR.symName(i)) +
          " <small style='color:var(--txt3)'>" + MR.esc(MR.sym(i)[3]) + "</small></div>";
      }).join("");
      box.style.display = hits.length ? "block" : "none";
    });
    el("trackSearch").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && lastSuggest.length) {
        MR.selectSymbol(lastSuggest[0], true);
        e.target.value = ""; el("trackSuggest").style.display = "none";
      }
    });
    el("trackSuggest").addEventListener("click", function (e) {
      var d = e.target.closest("div[data-sym]");
      if (!d) return;
      MR.selectSymbol(Number(d.dataset.sym), true);
      el("trackSearch").value = ""; el("trackSuggest").style.display = "none";
    });
    el("pathChart").addEventListener("pointermove", function (e) {
      if (e.buttons !== 1) return;
      scrub(e);
    });
    el("pathChart").addEventListener("pointerdown", scrub);
    function scrub(e) {
      var r = e.currentTarget.getBoundingClientRect();
      var t = Math.round((e.clientX - r.left - 26) / Math.max(1, r.width - 100) * (MR.META.dates.length - 1));
      t = Math.max(0, Math.min(MR.META.dates.length - 1, t));
      if (t !== st.idx) MR.setDate(t);
    }
    el("graphChart").addEventListener("pointermove", function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = 16;
      Object.keys(graphPos).forEach(function (k) {
        var p = graphPos[k], d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = Number(k); }
      });
      if (best !== graphHover) { graphHover = best; renderGraph(); }
    });
    el("graphChart").addEventListener("pointerleave", function () {
      graphHover = -1; renderGraph();
    });
    el("graphChart").addEventListener("click", function () {
      if (graphHover >= 0 && MR.Drill) MR.Drill.open("sym", { i: graphHover });
    });
    el("tsTable").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-t]");
      if (tr) MR.setDate(Number(tr.dataset.t));
    });
  }

  /* ---------------- 地形上的市场脉搏卡：一眼看到全市场体量与结构 ---------------- */
  function renderHero() {
    var f = st.frame, box = el("surfaceHero");
    if (!f || !box) return;
    var s = f.stats;
    var amt = MR.amount(s.amount), mm = /^([\d.]+)(.*)$/.exec(amt) || [0, amt, ""];
    var upPct = s.up + s.down > 0 ? s.up / (s.up + s.down) : .5;
    var hb = 0, cnt = 0;
    for (var i = 0; i < f.hb.length; i++) {
      if (!f.active[i] || !isFinite(f.hb[i])) continue;
      hb += f.hb[i]; cnt++;
    }
    hb = cnt ? hb / cnt : 0;
    var lead = f.top[0], chg = f.chg[lead];
    box.innerHTML =
      '<div class="sh-top"><span>全市场成交额</span><b>' + MR.fmtDate(f.date).slice(5) + "</b></div>" +
      '<div class="sh-big">' + MR.esc(mm[1]) + "<small>" + MR.esc(mm[2]) + "</small></div>" +
      '<div class="sh-bar"><i style="width:' + (upPct * 100).toFixed(1) + "%;background:linear-gradient(90deg,#ff5d6c,#ff8b96)\"></i>" +
        '<i style="flex:1;background:linear-gradient(90deg,#2aa07c,#35d6a3)"></i></div>' +
      '<div class="sh-row"><span>涨 / 跌</span><b><span class="up">' + s.up + '</span> / <span class="down">' + s.down + "</span></b></div>" +
      '<div class="sh-row"><span>heartbeat</span><b class="' + MR.chgClass(hb) + '">' + MR.signed(hb, 4) + "</b></div>" +
      '<div class="sh-row"><span>最强πN</span><b class="' + MR.chgClass(chg) + '">' + MR.esc(MR.symCode(lead)) +
        " " + MR.signed(chg, 1, "%") + "</b></div>";
  }

  MR.Panels = {
    init: function () { initEvents(); },
    renderAll: function () {
      renderKpis(); renderBoardTabs(); renderBoardList(); renderBoardSummary();
      renderBoardMembers(); renderTruth(); renderPaths(); renderGraph();
      renderDetail(); renderTs(); renderTimeline(); renderHero();
    },
    renderFrame: function () {
      renderKpis(); renderBoardTabs(); renderBoardList(); renderBoardSummary(); renderBoardMembers();
      renderTruth(); renderPaths(); renderGraph(); renderDetail(); renderTs(); renderTimeline(); renderHero();
    },
    renderSelection: function () {
      renderBoardList(); renderBoardSummary(); renderBoardMembers();
      renderTruth(); renderPaths(); renderGraph(); renderDetail(); renderTs(); renderHero();
    }
  };
})();
