/* MarketRank · Fluxscape — 初始化与全局联动 */
(function () {
  "use strict";
  var MR = window.MR;
  if (!MR) return;
  var st = MR.state, META = MR.META;
  var reqToken = 0, timer = null;
  function el(id) { return document.getElementById(id); }

  function hideLoading() {
    var l = el("loading");
    if (l) { l.style.opacity = "0"; l.style.transition = "opacity .25s"; setTimeout(function () { l.remove(); }, 260); }
  }

  /* 入场影片：标题 + 规模，1.9s 后淡出，把注意力交给地形 */
  function playIntro() {
    var box = el("intro");
    if (!box) return;
    if (el("introDays")) el("introDays").textContent = META.dates.length;
    if (el("introSyms")) el("introSyms").textContent = META.symbols.length;
    if (el("introBoards")) el("introBoards").textContent = META.boards.length;
    setTimeout(function () {
      box.classList.add("hide");
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 820);
    }, 1900);
  }

  MR.setDate = function (i, first) {
    i = Math.max(0, Math.min(META.dates.length - 1, Number(i)));
    st.idx = i;
    st.date = META.dates[i];
    el("tlDate").textContent = MR.fmtDate(st.date);
    el("tlRange").value = i;
    var token = ++reqToken;
    el("tlMeta").textContent = "载入 " + MR.fmtDate(st.date) + " …";
    MR.loadFrame(st.date, function (f) {
      if (token !== reqToken || !f) return;
      st.frame = f;
      if (first) {
        st.tracked = f.top.slice(0, 2);
        st.selected = f.top[0];
      }
      MR.Landscape.renderFrame(f);
      applyPrefsOnce();               /* 首帧就绪后把缓存设置推给地形 */
      MR.Landscape.updateHighlight();
      MR.Panels.renderFrame();
      if (MR.Drill && MR.Drill.isOpen()) MR.Drill.refresh();
      if (first) {
        el("aboutParams").textContent = "固定参数：" + JSON.stringify(META.params) +
          " | 帧区间 " + META.dates[0] + " → " + META.dates[META.dates.length - 1];
        hideLoading();
        playIntro();
      }
    });
  };

  MR.setBoard = function (b) {
    st.board = b;
    if (b) {
      var f = st.frame;
      var mem = f ? MR.frameMembers(b, f) : [];
      if (mem.length) st.selected = mem.slice().sort(function (x, y) {
        return f.score[y] - f.score[x];
      })[0];
    }
    MR.renderSelection();
    if (MR.Drill && MR.Drill.isOpen() && MR.Drill.modeOf() === "board") MR.Drill.refresh();
  };

  function addTrack(i) {
    if (st.tracked.indexOf(i) >= 0) return;
    if (st.tracked.length >= 4) st.tracked.shift();
    st.tracked.push(i);
  }

  MR.toggleTrack = function (i) {
    var k = st.tracked.indexOf(i);
    if (k >= 0) st.tracked.splice(k, 1);
    else addTrack(i);
    st.selected = i;
    MR.renderSelection();
  };

  MR.selectSymbol = function (i, track) {
    st.selected = i;
    if (track) addTrack(i);
    MR.renderSelection();
  };

  MR.render = function () {
    if (!st.frame) return;
    MR.Landscape.renderFrame(st.frame);
    applyPrefsOnce();
    MR.Landscape.updateHighlight();
    MR.Panels.renderAll();
    if (MR.Drill && MR.Drill.isOpen()) MR.Drill.refresh();
  };
  MR.renderSelection = function () {
    if (!st.frame) return;
    MR.Landscape.updateHighlight();
    MR.Landscape.refreshLabels();
    MR.Panels.renderSelection();
  };

  /* 在地形中定位某只股票：设置十字线并选中 */
  MR.focusSymbol = function (i) {
    st.selected = i;
    var f = st.frame;
    if (f && f.grid && f.grid.pos && f.grid.pos[i]) {
      var p = f.grid.pos[i];
      if (p[0] >= 0) st.cross = { x: p[0], y: p[1] };
    }
    MR.Landscape.renderFrame(f);
    MR.Landscape.updateHighlight();
    MR.Panels.renderSelection();
  };

  function setPlaying(on) {
    st.playing = on;
    el("btnPlay").textContent = on ? "❚❚" : "▶";
    el("btnPlay").classList.toggle("active", on);
    if (timer) { clearInterval(timer); timer = null; }
    if (on) {
      /* 780ms 一拍，正好留出地形形变的时间，看起来像"市场在呼吸" */
      timer = setInterval(function () {
        MR.setDate(st.idx >= META.dates.length - 1 ? 0 : st.idx + 1);
      }, 780);
    }
  }

  /* 中央地形全屏：整块面板放大，✕ / Esc / 再点 ⛶ 都能退出 */
  function setFullscreen(on) {
    var panel = el("surfacePanel"), mask = el("expandMask"), btn = el("btnExpand");
    if (!panel) return;
    on = on == null ? !panel.classList.contains("expanded") : !!on;
    panel.classList.toggle("expanded", on);
    if (mask) mask.classList.toggle("hidden", !on);
    if (btn) {
      btn.textContent = on ? "✕" : "⛶";
      btn.title = on ? "退出全屏 (Esc)" : "全屏主视图 (F)";
      btn.classList.toggle("on", on);
    }
    var hint = el("surfaceFullHint");
    if (hint) hint.classList.toggle("hidden", !on);
    if (on) {
      var pop = el("tunePop");
      if (pop) pop.classList.add("hidden");
    }
    MR.Landscape.resize();
    setTimeout(function () { MR.Landscape.resize(); }, 60);
  }

  /* ---------------- 客户端设置缓存 ----------------
     所有地形设置写进 localStorage，刷新后原样恢复；
     读取失败（隐私模式 / file:// 限制）时静默退回默认值，不影响使用 */
  var PREFS_KEY = "mrc.surface.v1";
  var PREFS_DEF = {
    view: "3d", labelMode: 30, labelSize: 13, contour: true, contourStep: 0,
    flow: true, flowSpeed: 1, flowCount: 120, wire: false, hold: true
  };
  var prefsPushed = false;

  function readPrefs() {
    var out = {}, k;
    for (k in PREFS_DEF) out[k] = PREFS_DEF[k];
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (k in out) if (o && o[k] !== undefined && o[k] !== null) out[k] = o[k];
      }
    } catch (e) { /* 读不到就用默认值 */ }
    return out;
  }
  function savePrefs() {
    var o = {
      view: st.view,
      labelMode: Number(el("selLabels").value || 0),
      labelSize: Number(el("selLabelSize").value || 13),
      contour: el("chkContour").checked,
      contourStep: Number(el("selContourStep").value || 0),
      flow: el("chkFlow").checked,
      flowSpeed: Number(el("rngFlowSpeed").value || 1),
      flowCount: Number(el("rngFlowCount").value || 120),
      wire: el("chkWire").checked,
      hold: el("chkHold").checked
    };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(o)); } catch (e) { }
  }
  /* 缓存值套回控件，保证 UI 状态与画面一致 */
  function applyPrefs(p) {
    Array.prototype.forEach.call(el("viewSwitch").children, function (x) {
      x.classList.toggle("active", x.dataset.view === p.view);
    });
    el("selLabels").value = String(p.labelMode);
    el("selLabelSize").value = String(p.labelSize);
    el("chkContour").checked = !!p.contour;
    el("selContourStep").value = String(p.contourStep);
    el("chkFlow").checked = !!p.flow;
    el("rngFlowSpeed").value = String(p.flowSpeed);
    el("flowSpeedVal").textContent = Number(p.flowSpeed).toFixed(1) + "×";
    el("rngFlowCount").value = String(p.flowCount);
    el("flowCountVal").textContent = String(p.flowCount);
    el("chkWire").checked = !!p.wire;
    el("chkHold").checked = !!p.hold;
    st.labelMode = Number(p.labelMode);
  }
  /* 直接把缓存推给地形：首帧落地后执行一次（两条渲染入口共用） */
  function applyPrefsOnce() {
    if (prefsPushed || !st.frame) return;
    prefsPushed = true;
    pushPrefs(readPrefs());
  }
  /* 直接把缓存推给地形：开机第一次渲染后执行一次 */
  function pushPrefs(p) {
    var L = MR.Landscape;
    if (!L) return;
    L.setView(p.view);
    L.setLabelSize(p.labelSize);
    L.setLabelMode(p.labelMode);
    L.setContourStep(Number(p.contourStep) || 0);
    L.setContour(!!p.contour);
    L.setFlow(!!p.flow);
    L.setFlowSpeed(Number(p.flowSpeed) || 1);
    L.setFlowCount(Number(p.flowCount) || 120);
    L.setWire(!!p.wire);
    L.setHold(!!p.hold);
  }

  function bindUI() {
    el("tlRange").addEventListener("input", function (e) { MR.setDate(e.target.value); });
    el("btnPlay").addEventListener("click", function () { setPlaying(!st.playing); });
    el("viewSwitch").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (!b) return;
      Array.prototype.forEach.call(el("viewSwitch").children, function (x) {
        x.classList.toggle("active", x === b);
      });
      MR.Landscape.setView(b.dataset.view);
      savePrefs();
    });
    el("chkWire").addEventListener("change", function (e) { MR.Landscape.setWire(e.target.checked); savePrefs(); });
    el("chkContour").addEventListener("change", function (e) { MR.Landscape.setContour(e.target.checked); savePrefs(); });
    el("chkFlow").addEventListener("change", function (e) { MR.Landscape.setFlow(e.target.checked); savePrefs(); });
    el("chkHold").addEventListener("change", function (e) { MR.Landscape.setHold(e.target.checked); savePrefs(); });
    el("selLabels").addEventListener("change", function (e) {
      MR.Landscape.setLabelMode(e.target.value);
      savePrefs();
    });
    el("selLabelSize").addEventListener("change", function (e) {
      MR.Landscape.setLabelSize(Number(e.target.value));
      savePrefs();
    });
    el("btnExpand").addEventListener("click", function () { setFullscreen(); });
    el("btnTune").addEventListener("click", function (e) {
      e.stopPropagation();
      el("tunePop").classList.toggle("hidden");
    });
    document.addEventListener("click", function (e) {
      var pop = el("tunePop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target) || e.target === el("btnTune")) return;
      pop.classList.add("hidden");
    });
    el("selContourStep").addEventListener("change", function (e) {
      MR.Landscape.setContourStep(Number(e.target.value));
      savePrefs();
    });
    var rngSpeed = el("rngFlowSpeed");
    rngSpeed.addEventListener("input", function (e) {
      var v = Number(e.target.value);
      el("flowSpeedVal").textContent = v.toFixed(1) + "×";
      MR.Landscape.setFlowSpeed(v);
    });
    rngSpeed.addEventListener("change", savePrefs);
    var rngCount = el("rngFlowCount");
    rngCount.addEventListener("input", function (e) {
      el("flowCountVal").textContent = e.target.value;
    });
    /* 粒子规模重建有成本，拖动时只更新数字，松手才重建 */
    rngCount.addEventListener("change", function (e) {
      MR.Landscape.setFlowCount(Number(e.target.value));
      savePrefs();
    });
    el("btnResetCam").addEventListener("click", function () { MR.Landscape.resetCamera(); });
    el("btnAbout").addEventListener("click", function () { el("about").classList.remove("hidden"); });
    el("btnAboutClose").addEventListener("click", function () { el("about").classList.add("hidden"); });
    el("about").addEventListener("click", function (e) {
      if (e.target === el("about")) el("about").classList.add("hidden");
    });
    el("btnReset").addEventListener("click", function () {
      st.board = null; st.boardKind = "hy"; st.boardQuery = ""; st.truthTop = 10;
      el("boardSearch").value = "";
      if (st.frame) {
        st.tracked = st.frame.top.slice(0, 2);
        st.selected = st.frame.top[0];
      }
      if (MR.Landscape.resetCamera) MR.Landscape.resetCamera();
      MR.render();
    });
    document.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.defaultPrevented) return;              /* 下钻视图已经处理过 Esc */
      if (e.key === "Escape") {
        /* 层级：下钻大图 → 全屏地形 → 说明弹窗 → 参数浮层 */
        if (MR.Drill && MR.Drill.isOpen()) { MR.Drill.close(); e.preventDefault(); return; }
        var panel = el("surfacePanel");
        if (panel && panel.classList.contains("expanded")) { setFullscreen(false); e.preventDefault(); return; }
        var about = el("about");
        if (about && !about.classList.contains("hidden")) { about.classList.add("hidden"); return; }
        var pop = el("tunePop");
        if (pop && !pop.classList.contains("hidden")) pop.classList.add("hidden");
        return;
      }
      if (e.key === "f" || e.key === "F") { setFullscreen(); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") { MR.setDate(st.idx - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { MR.setDate(st.idx + 1); e.preventDefault(); }
      else if (e.key === " ") { setPlaying(!st.playing); e.preventDefault(); }
    });
    var rt = null;
    window.addEventListener("resize", function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () {
        MR.Landscape.resize();
        if (st.frame) MR.Panels.renderFrame();
      }, 130);
    });
  }

  function boot() {
    el("ldMsg").textContent = META.dates.length + " 个交易日 · " +
      META.symbols.length + " 只标的 · " + META.boards.length + " 个板块";
    st.labelMode = Number(el("selLabels").value || 30);
    applyPrefs(readPrefs());          /* 先把控件恢复成上次的样子，再初始化地形 */
    MR.Landscape.init();
    MR.Panels.init();
    if (MR.Drill) MR.Drill.init();
    bindUI();
    MR.setDate(META.dates.length - 1, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
