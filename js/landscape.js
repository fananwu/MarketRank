/* MarketRank · Fluxscape — Sections 主视图
   Three.js Gouraud 地形 + 全量落点点云 + 可直接阅读的股票标签层 + 富信息卡片 + 点击下钻 */
(function () {
  "use strict";
  if (!window.MR) return;
  var MR = window.MR, st = MR.state;
  var THREE = window.THREE;

  var host, renderer, scene, camera, mesh, wire, holdGroup, crossGroup, points, selRing;
  var dotTexture = null, ringTexture = null;
  var frame = null, grid = null, cellNode = {}, cellBoard = {};
  var cam = { theta: 0.70, phi: 0.80, dist: 14.2, zoom: 1 };
  var SIZE = 10, H = 0.66;
  var dragging = false, moved = 0, lastPointer = null, hoverCell = null, hoverSym = -1;
  var use2D = false, cv2d, ctx2d;

  /* 缩放与平移：zoomTarget 让滚轮变成"无级"平滑推进，focus 是镜头注视点（朝鼠标所指处放大） */
  var zoomTarget = 1, focus = { x: 0, z: 0 }, focusT = { x: 0, z: 0 }, ZOOM_MIN = 0.42, ZOOM_MAX = 6.2;

  var worldPos = [];       /* 每只标的的世界坐标（未落点为 null） */
  var proj = [];           /* 屏幕投影缓存 {x,y,z} */
  var labelCands = [];     /* 标签候选：按优先级排序的 symbol 下标 */
  var labelPool = [], labelUsed = 0;
  var labelLayer = null, tipTimer = 0, needProject = true, lastW = 0, lastH = 0;
  var leadersCv = null, leadersCtx = null;   /* 引线画布：把标签和它的落点连起来 */
  var labelSize = 13;                        /* 标签字号 px，可在 ⚙ 里切小/中/大/特大 */
  var panning = false, panLast = null;       /* 中键拖动平移 */
  var lastTap = { t: 0, sym: -1, x: 0, y: 0 };  /* 自实现双击判定 */
  var lastLabelRects = [];                   /* 上一帧股票标签占位，供等高线标注避让 */

  /* —— 动效层：等高线 / 资金流粒子 / 高度形变 / 热点辉光 / 镜头运动 —— */
  var contours = null, contourLevels = [], pointsCell = [];
  var contourMarks = [], clabelPool = [], clabelUsed = 0, clabelLayer = null;
  var contourStep = 0, contourUsed = 0;      /* 0=自动；否则按该 log(π/s) 间距取档 */
  var flow = null, flowEdges = [], flowPos = null, flowCol = null, flowPhase = null, flowLast = [];
  var flowSpeed = 1, flowCount = 120, pulseOn = true;
  var pulseGroup = null, pulseRing = [], pulseFlash = [];
  var glowGroup = null, glowList = [];
  var animH = null, morphFrom = null, morphTo = null, morphT = 1, morphStart = 0, morphDur = 680;
  var camTween = null, introPlayed = false;
  var loopStarted = false, lastLoop = 0, elapsed = 0, flowOn = true, contourOn = true;


  /* ------------------------------------------------------------------ 初始化 */
  function makeDotTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2);
    g.fillStyle = "#ffffff"; g.fill();
    g.lineWidth = 8; g.strokeStyle = "rgba(4,10,16,.85)"; g.stroke();
    return new THREE.CanvasTexture(c);
  }
  function makeRingTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 96;
    var g = c.getContext("2d");
    g.beginPath(); g.arc(48, 48, 34, 0, Math.PI * 2);
    g.strokeStyle = "#f3c969"; g.lineWidth = 9; g.stroke();
    g.beginPath(); g.arc(48, 48, 16, 0, Math.PI * 2);
    g.fillStyle = "rgba(243,201,105,.55)"; g.fill();
    return new THREE.CanvasTexture(c);
  }
  /* 柔和径向辉光：热点股票的光晕、地形底部的氛围光都用它 */
  function makeGlowTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var rg = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    rg.addColorStop(0, "rgba(255,255,255,.95)");
    rg.addColorStop(.28, "rgba(255,255,255,.42)");
    rg.addColorStop(.62, "rgba(255,255,255,.10)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  var glowTexture = null;

  function init() {
    host = document.getElementById("surface");
    labelLayer = document.getElementById("surfaceLabels");
    clabelLayer = document.getElementById("contourLabels");
    leadersCv = document.getElementById("surfaceLeaders");
    applyLabelSize(labelSize);
    if (leadersCv) leadersCtx = leadersCv.getContext("2d");
    if (!THREE) { use2D = true; return init2D(); }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x080d14, 1);
      host.appendChild(renderer.domElement);
    } catch (e) {
      use2D = true;
      return init2D();
    }
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x080d14, 24, 48);
    dotTexture = makeDotTexture();
    ringTexture = makeRingTexture();
    glowTexture = makeGlowTexture();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    bindEvents(host);   /* 绑在宿主上：标签上按下也能拖动地形 */
    watchSize();
    resize();
    draw();
  }

  /* 布局变化（面板高度/字体载入）也会改变画布尺寸，用 ResizeObserver 保证投影与标签同步 */
  function watchSize() {
    if (!window.ResizeObserver || !host) return;
    var ro = new ResizeObserver(function () {
      if (Math.abs(host.clientWidth - lastW) < 2 && Math.abs(host.clientHeight - lastH) < 2) return;
      resize();
    });
    ro.observe(host);
  }

  function init2D() {
    cv2d = document.createElement("canvas");
    cv2d.style.cssText = "width:100%;height:100%;display:block";
    host.appendChild(cv2d);
    bindEvents(host);
    resize();
  }

  function resize() {
    if (!host) return;
    var w = host.clientWidth || 600, h = host.clientHeight || 420;
    if (renderer) renderer.setSize(w, h, false);
    if (cv2d) {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv2d.width = w * dpr; cv2d.height = h * dpr;
      var c = cv2d.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (camera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (leadersCv) {
      var ldpr = Math.min(2, window.devicePixelRatio || 1);
      leadersCv.width = Math.round(w * ldpr);
      leadersCv.height = Math.round(h * ldpr);
      leadersCtx = leadersCv.getContext("2d");
      leadersCtx.setTransform(ldpr, 0, 0, ldpr, 0, 0);
    }
    fitPending = true;
    updateCamera();
    needProject = true;
    draw();
  }

  function updateCamera() {
    if (!camera) return;
    var v = st.view;
    if (v === "top") {
      if (!camera.isOrthographicCamera) camera = new THREE.OrthographicCamera(-7, 7, 7, -7, 0.1, 100);
      camera.left = -6.3 / cam.zoom; camera.right = 6.3 / cam.zoom;
      camera.top = 6.3 / cam.zoom; camera.bottom = -6.3 / cam.zoom;
      camera.up.set(0, 0, -1);
      camera.position.set(focus.x, 20, focus.z + 0.0001);
      fitPending = false;
    } else if (v === "front" || v === "side") {
      if (!camera.isOrthographicCamera) camera = new THREE.OrthographicCamera(-7, 7, 7, -7, 0.1, 100);
      camera.left = -6.6 / cam.zoom; camera.right = 6.6 / cam.zoom;
      camera.top = 6.6 / cam.zoom; camera.bottom = -6.6 / cam.zoom;
      camera.up.set(0, 1, 0);
      if (v === "front") camera.position.set(focus.x, 3.4, 20 + focus.z);
      else camera.position.set(20 + focus.x, 3.4, focus.z);
      fitPending = false;
    } else {
      if (!camera.isPerspectiveCamera) camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      placePersp();
      if (fitPending) ensureFit();
    }
    camera.lookAt(focus.x, 0, focus.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    needProject = true;
  }

  var camFit = 1;         /* 取景距离因子：只影响显示，不改用户设定的 cam.dist */
  var fitPending = true;  /* 需要重新做一次取景校验 */
  function placePersp() {
    var r = cam.dist / cam.zoom * camFit;
    camera.up.set(0, 1, 0);
    camera.position.set(
      focus.x + r * Math.sin(cam.phi) * Math.sin(cam.theta),
      r * Math.cos(cam.phi),
      focus.z + r * Math.sin(cam.phi) * Math.cos(cam.theta)
    );
    camera.lookAt(focus.x, 0, focus.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /* 把地形的 4 个包围角点投影到屏幕，超出 0.99 NDC 就把相机往后拉，
     保证换视角/换日期时地形永远完整在画布里 */
  var FIT_BOX = [
    [-5.0, 0, -5.0], [5.0, 0, -5.0], [5.0, 0, 5.0], [-5.0, 0, 5.0]
  ];
  var FIT_V = null;
  function ensureFit() {
    if (!THREE || !camera) return;
    if (!FIT_V) FIT_V = new THREE.Vector3();
    var saved = camFit;
    camFit = 1; placePersp();
    for (var k = 0; k < 3; k++) {
      var mx = 0;
      for (var i = 0; i < FIT_BOX.length; i++) {
        FIT_V.set(FIT_BOX[i][0], FIT_BOX[i][1], FIT_BOX[i][2]).project(camera);
        mx = Math.max(mx, Math.abs(FIT_V.x), Math.abs(FIT_V.y));
      }
      if (!isFinite(mx) || mx <= 0.99) break;
      camFit = Math.min(2.4, camFit * mx / 0.99);
      placePersp();
    }
    /* 平滑逼近，拖动旋转时不会突然缩放 */
    var target = camFit;
    camFit = Math.abs(target - saved) < 0.003 ? target : saved + (target - saved) * 0.34;
    placePersp();
    if (Math.abs(target - camFit) < 0.004) fitPending = false;
  }

  /* ------------------------------------------------------------------ 几何 */
  function cellX(x) { return (x / (grid.n - 1) - 0.5) * SIZE; }
  function cellZ(y) { return (y / (grid.n - 1) - 0.5) * SIZE; }
  function cellY(k, Hs) { return Math.max(-2.6, Math.min(2.6, ((Hs || grid.h)[k] || 0) * H)); }

  /* 地形配色：diverging 底 + 高度调制亮度 + 流出侧压暗，让山脊从暗场里长出来 */
  function tcol(h, p90) {
    var c = MR.diverging(h, p90 || 1);
    var hn = Math.max(-1, Math.min(1, h / Math.max(0.4, (p90 || 1) * 1.7)));
    var lum = 0.32 + 0.68 * Math.pow(hn * 0.5 + 0.5, 1.4);
    var k = h < 0 ? [0.70, 0.78, 0.92] : [1.42, 1.05, 1.02];
    return [c[0] * lum * k[0], c[1] * lum * k[1], c[2] * lum * k[2]];
  }

  /* 把"光照"直接烘焙进顶点色：山脊受光、背坡入暗、谷底压到近黑，
     不依赖实时灯光也能得到干净利落的体积感 */
  var LIGHT = { x: 0.42, y: 0.80, z: 0.43 };
  function paintGeo(geo, Hs) {
    var n = grid.n, p90 = grid.p90 || 1;
    var nrm = geo.getAttribute("normal");
    var col = geo.getAttribute("color");
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var k = y * n + x, h = (Hs || grid.h)[k] || 0;
        var base = tcol(h, p90);
        var nx = nrm.getX(k), ny = nrm.getY(k), nz = nrm.getZ(k);
        var sh = 0.30 + 0.70 * Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
        /* gamma 提亮中间调，让地形有发光感而不是死黑 */
        var r = Math.min(1, Math.pow(base[0] * sh, 0.78)),
            g2 = Math.min(1, Math.pow(base[1] * sh, 0.78)),
            b = Math.min(1, Math.pow(base[2] * sh, 0.78));
        if (cellBoard && cellBoard[x + "," + y]) {
          r = r * .26 + .96 * .74; g2 = g2 * .26 + .82 * .74; b = b * .26 + .46 * .74;
        }
        col.setXYZ(k, r, g2, b);
      }
    }
    col.needsUpdate = true;
  }

  function buildGeometry(Hs) {
    var n = grid.n;
    if (!n) return null;
    var pos = [], idx = [];
    Hs = Hs || grid.h;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        pos.push(cellX(x), cellY(y * n + x, Hs), cellZ(y));
      }
    }
    for (var yy = 0; yy < n - 1; yy++) {
      for (var xx = 0; xx < n - 1; xx++) {
        var a = yy * n + xx, b = a + 1, c1 = a + n, d = c1 + 1;
        idx.push(a, c1, b, b, c1, d);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n * n * 3).fill(0), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    paintGeo(g, Hs);
    return g;
  }

  function clearScene() {
    [mesh, wire, holdGroup, crossGroup, points, selRing, contours, flow, pulseGroup, glowGroup].forEach(function (o) {
      if (!o) return;
      scene.remove(o);
      if (o.traverse) o.traverse(function (ch) {
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) ch.material.forEach(function (m) { m.dispose(); });
          else ch.material.dispose();
        }
      });
      else {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
    });
    mesh = wire = holdGroup = crossGroup = points = selRing = contours = flow = pulseGroup = glowGroup = null;
    glowList = [];
    pulseRing = []; pulseFlash = [];
    contourMarks = [];
    hideClabels();
  }

  /* 全量落点点云：每只股票一个点，颜色随涨跌，大小随 πN */
  function buildPoints(Hs) {
    if (!grid.pos || !frame) return;
    Hs = Hs || grid.h;
    var pos = [], col = [], size = [];
    var n = grid.n, maxScore = 1;
    pointsCell = [];
    for (var i = 0; i < frame.score.length; i++) if (frame.active[i]) maxScore = Math.max(maxScore, frame.score[i]);
    for (var j = 0; j < grid.pos.length; j++) {
      var p = grid.pos[j];
      if (!p || p[0] < 0) continue;
      if (MR.sym(j)[5]) continue;                 /* ETF 不落点，与论文一致 */
      var k = p[1] * n + p[0];
      pointsCell.push(k);
      pos.push(cellX(p[0]), cellY(k, Hs) + 0.05, cellZ(p[1]));
      var up = frame.chg[j] >= 0;
      var t = Math.min(1, Math.abs(frame.chg[j]) / 5);
      if (up) col.push(1.0, 0.36 + 0.18 * t, 0.42 + 0.06 * t);
      else col.push(0.18, 0.80 + 0.12 * t, 0.60);
      size.push(0.014 + 0.02 * Math.min(1, frame.score[j] / maxScore));
    }
    if (!pos.length) return;
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("pcolor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("psize", new THREE.Float32BufferAttribute(size, 1));
    var m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: dotTexture },
        uOrtho: { value: (st.view === "3d") ? 0.0 : 1.0 },
        uScale: { value: 210.0 * Math.min(2, window.devicePixelRatio || 1) }
      },
      vertexShader: [
        "attribute vec3 pcolor;",
        "attribute float psize;",
        "uniform float uOrtho; uniform float uScale;",
        "varying vec3 vC;",
        "void main(){",
        "  vC = pcolor;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  float att = mix(20.0 / max(1.0, -mv.z), 1.0, uOrtho);",
        "  gl_PointSize = psize * uScale * att;",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D map;",
        "varying vec3 vC;",
        "void main(){",
        "  vec4 t = texture2D(map, gl_PointCoord);",
        "  if (t.a < 0.28) discard;",
        "  gl_FragColor = vec4(vC * t.rgb, 0.42);",
        "}"
      ].join("\n"),
      transparent: true, depthTest: true, depthWrite: false
    });
    points = new THREE.Points(g, m);
    points.frustumCulled = false;
    scene.add(points);
  }

  /* ------------------------------------------------------------------ 等高线（marching squares）
     档位按 log(π/s) 的固定间距取整数倍（而不是把值域等分），
     这样"相邻两条线之间的资金高度差"恒定，读数才有意义；间距可由用户手动调 */
  var STEP_CHOICES = [0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2];
  var contourStepUsed = 0.2;
  function autoStep(span) {
    for (var i = 0; i < STEP_CHOICES.length; i++) {
      if (span / STEP_CHOICES[i] <= 12) return STEP_CHOICES[i];
    }
    return 2;
  }
  function contourLevelsFor(Hs) {
    var n = grid.n, mn = Infinity, mx = -Infinity;
    for (var k = 0; k < n * n; k++) {
      var v = Hs[k] || 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    contourUsed = 0;
    if (!isFinite(mn) || mx - mn < 0.12) return [];
    var span = mx - mn;
    var step = contourStep > 0 ? contourStep : autoStep(span);
    contourStepUsed = step;
    var out = [];
    var first = Math.ceil((mn + 1e-6) / step) * step;
    for (var lv = first; lv < mx - 1e-6; lv += step) out.push(lv);
    if (out.length > 36) {
      var skip = Math.ceil(out.length / 36);
      out = out.filter(function (_, i) { return i % skip === 0; });
      contourStepUsed = step * skip;
    }
    contourUsed = out.length;
    return out;
  }

  function buildContours(Hs) {
    var n = grid.n;
    if (!n) return;
    Hs = Hs || grid.h;
    contourLevels = contourLevelsFor(Hs);
    if (!contourLevels.length) { contourMarks = []; return; }
    var segs = [], cols = [], marks = [];
    contourMarks = [];
    var yOf = function (v) { return Math.max(-2.6, Math.min(2.6, v * H)) + 0.012; };
    var iP = function (k0, k1, v0, v1, lvl) {
      var t = (lvl - v0) / ((v1 - v0) || 1e-6);
      return t;
    };
    for (var y = 0; y < n - 1; y++) {
      for (var x = 0; x < n - 1; x++) {
        var k00 = y * n + x, k10 = k00 + 1, k01 = k00 + n, k11 = k01 + 1;
        var v00 = Hs[k00] || 0, v10 = Hs[k10] || 0, v01 = Hs[k01] || 0, v11 = Hs[k11] || 0;
        var cmin = Math.min(v00, v10, v01, v11), cmax = Math.max(v00, v10, v01, v11);
        var x0 = cellX(x), x1 = cellX(x + 1), z0 = cellZ(y), z1 = cellZ(y + 1);
        for (var L = 0; L < contourLevels.length; L++) {
          var lvl = contourLevels[L];
          if (lvl < cmin || lvl > cmax) continue;
          var e0 = iP(k00, k10, v00, v10, lvl);   /* 上边 00→10 */
          var e1 = iP(k10, k11, v10, v11, lvl);   /* 右边 10→11 */
          var e2 = iP(k01, k11, v01, v11, lvl);   /* 下边 01→11 */
          var e3 = iP(k00, k01, v00, v01, lvl);   /* 左边 00→01 */
          var P0 = [x0 + (x1 - x0) * e0, z0], P1 = [x1, z0 + (z1 - z0) * e1],
              P2 = [x0 + (x1 - x0) * e2, z1], P3 = [x0, z0 + (z1 - z0) * e3];
          var idx = (v00 > lvl ? 1 : 0) | (v10 > lvl ? 2 : 0) | (v11 > lvl ? 4 : 0) | (v01 > lvl ? 8 : 0);
          var pairs = CONTOUR_CASES[idx];
          if (!pairs) continue;
          var yy = yOf(lvl);
          /* 每 5 档为一条"计曲线"（index contour），更亮更实；其余为间曲线，压暗 */
          var mag = Math.abs(lvl) / Math.max(1e-6, contourStepUsed);
          var isIdx = Math.abs(mag - Math.round(mag)) < 1e-4 && Math.round(mag) % 5 === 0;
          var base = lvl >= 0 ? [1.0, 0.52, 0.42] : [0.44, 0.70, 1.0];
          var kk = isIdx ? 1.0 : 0.5;
          var cc = [base[0] * kk, base[1] * kk, base[2] * kk];
          for (var q = 0; q < pairs.length; q++) {
            var A = [P0, P1, P2, P3][pairs[q][0]], B = [P0, P1, P2, P3][pairs[q][1]];
            segs.push(A[0], yy, A[1], B[0], yy, B[1]);
            cols.push(cc[0], cc[1], cc[2], cc[0], cc[1], cc[2]);
            /* 稀疏采样：给每个档位留一些候选点，稍后挑 1~2 个标数值 */
            if (q === 0 && ((y * n + x) % 27) === 0) {
              marks.push({ v: lvl, idx: isIdx, L: L,
                           x: (A[0] + B[0]) / 2, y: yy + 0.02, z: (A[1] + B[1]) / 2 });
            }
          }
        }
      }
    }
    if (!segs.length) { contourUsed = 0; contourMarks = []; return; }
    contourMarks = pickContourMarks(marks);
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    contours = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: contourOn ? 0.52 : 0, depthWrite: false
    }));
    contours.frustumCulled = false;
    contours.visible = contourOn;
    scene.add(contours);
    publishContourInfo();
  }
  /* 每档挑 1 个点（计曲线挑 2 个，且第二个取离第一个最远的，尽量铺开） */
  function pickContourMarks(list) {
    if (!list || !list.length) return [];
    var byL = {}, out = [];
    list.forEach(function (m) { (byL[m.L] = byL[m.L] || []).push(m); });
    Object.keys(byL).forEach(function (L2) {
      var g = byL[L2];
      var first = g[Math.floor(g.length / 2)];
      out.push(first);
      if (first.idx && g.length > 4) {
        var best = g[0], bd = -1;
        for (var i = 0; i < g.length; i++) {
          var d = (g[i].x - first.x) * (g[i].x - first.x) + (g[i].z - first.z) * (g[i].z - first.z);
          if (d > bd) { bd = d; best = g[i]; }
        }
        out.push(best);
      }
    });
    return out;
  }
  /* 把当前档位写到 ⚙ 浮层和地形右下角的读数里 */
  function publishContourInfo() {
    var info = document.getElementById("contourInfo");
    if (info) info.textContent = contourUsed
      ? "间距 " + contourStepUsed.toFixed(2) + " · " + contourUsed + " 条（每 5 条加粗）"
      : "按 log(π/s) 等间距取值";
    var stat = document.getElementById("surfaceStat");
    if (stat && grid && grid.n) {
      stat.textContent = "格 " + grid.n + "×" + grid.n + " · 落点 " + (grid.placed || 0) +
        " · 社群 " + (frame ? frame.communities.length : 0) + " · 边 " + (frame ? frame.edges.length : 0) +
        (contourOn && contourUsed ? " · 等高线 " + contourStepUsed.toFixed(2) + "×" + contourUsed : "");
    }
  }
  function mxAbs(a) { var m = 0; for (var i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m || 1; }
  /* 16 种 marching squares 情形（角点顺序：00 10 11 01） */
  var CONTOUR_CASES = [
    null, [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
    [[2, 3]], [[0, 2]], [[0, 3], [1, 2]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], null
  ];

  /* ------------------------------------------------------------------ 资金流粒子
     沿当日最强的资金迁移边 source→sink 抛射光点：
     起飞处闪一下、抵达处扩散一圈接收环，方向与收付双方一眼可辨；速度可调 */
  var FLOW_PER = 3;                 /* 每条边 3 颗光点，相位均匀，读起来像一串资金 */
  var pulseRingI = 0, pulseFlashI = 0;

  function buildFlow(Hs) {
    if (!frame || !grid.pos || !grid.n) return;
    Hs = Hs || grid.h;
    var n = grid.n, cands = [];
    (frame.edges || []).forEach(function (e) {
      var a = grid.pos[e[0]], b = grid.pos[e[1]];
      if (!a || !b || a[0] < 0 || b[0] < 0) return;
      cands.push({ a: a, b: b, w: e[3] || 0 });
    });
    if (!cands.length) return;
    cands.sort(function (p, q) { return q.w - p.w; });
    cands = cands.slice(0, Math.max(20, Math.min(260, flowCount)));
    flowEdges = [];
    var P = [], C = [], PH = [];
    cands.forEach(function (c) {
      var kA = c.a[1] * n + c.a[0], kB = c.b[1] * n + c.b[0];
      flowEdges.push({ kA: kA, kB: kB, w: c.w });
      for (var s = 0; s < FLOW_PER; s++) {
        PH.push(s / FLOW_PER + Math.random() * 0.06);
        P.push(0, 0, 0); C.push(1, 1, 1);
      }
    });
    flowPhase = PH;
    flowLast = new Array(flowEdges.length * FLOW_PER);
    for (var q0 = 0; q0 < flowLast.length; q0++) flowLast[q0] = -1;
    var g = new THREE.BufferGeometry();
    flowPos = new THREE.Float32BufferAttribute(P, 3);
    flowCol = new THREE.Float32BufferAttribute(C, 3);
    g.setAttribute("position", flowPos);
    g.setAttribute("color", flowCol);
    flow = new THREE.Points(g, new THREE.PointsMaterial({
      map: dotTexture, size: 0.185, vertexColors: true, transparent: true,
      opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      sizeAttenuation: true
    }));
    flow.frustumCulled = false;
    flow.visible = flowOn;
    scene.add(flow);
    buildPulses();
    updateFlow(Hs);
  }

  /* 起飞闪点（flash）与抵达接收环（ring）各一池，循环复用，不额外产生 GC */
  function buildPulses() {
    pulseGroup = new THREE.Group();
    pulseRing = []; pulseFlash = [];
    var i, spr;
    for (i = 0; i < 26; i++) {
      spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ringTexture, color: 0xffa06a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false
      }));
      spr.visible = false;
      pulseGroup.add(spr);
      pulseRing.push({ s: spr, t0: 0, dur: 640, base: 1.45 });
    }
    for (i = 0; i < 26; i++) {
      spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, color: 0x9ad2ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false
      }));
      spr.visible = false;
      pulseGroup.add(spr);
      pulseFlash.push({ s: spr, t0: 0, dur: 380, base: 0.62 });
    }
    pulseGroup.visible = flowOn && pulseOn;
    scene.add(pulseGroup);
  }

  function spawnPulse(x, y, z, kind, warm) {
    if (!pulseOn) return;
    var pool = kind === "in" ? pulseRing : pulseFlash;
    if (!pool.length) return;
    var o = kind === "in" ? pool[(pulseRingI++) % pool.length] : pool[(pulseFlashI++) % pool.length];
    o.s.visible = true;
    o.s.position.set(x, y + 0.1, z);
    o.t0 = elapsed;
    o.dur = kind === "in" ? 660 : 380;
    o.base = kind === "in" ? 1.5 : 0.62;
    o.s.material.color.setHex(kind === "in" ? (warm ? 0xffa870 : 0xff7b8c) : 0x9ad2ff);
  }

  function updatePulses() {
    var i, o, k, sc;
    for (i = 0; i < pulseRing.length; i++) {
      o = pulseRing[i];
      if (!o.s.visible) continue;
      k = (elapsed - o.t0) / o.dur;
      if (k >= 1) { o.s.visible = false; o.s.material.opacity = 0; continue; }
      sc = o.base * (0.12 + 1.05 * k);
      o.s.scale.set(sc, sc, 1);
      o.s.material.opacity = 0.92 * (1 - k) * (1 - k);
    }
    for (i = 0; i < pulseFlash.length; i++) {
      o = pulseFlash[i];
      if (!o.s.visible) continue;
      k = (elapsed - o.t0) / o.dur;
      if (k >= 1) { o.s.visible = false; o.s.material.opacity = 0; continue; }
      sc = o.base * (0.35 + 0.9 * k);
      o.s.scale.set(sc, sc, 1);
      o.s.material.opacity = 0.9 * (1 - k);
    }
  }

  function updateFlow(Hs) {
    if (!flow || !flowEdges.length || !flowPos) return;
    Hs = Hs || grid.h;
    var n = grid.n, per = FLOW_PER, arr = flowPos.array, carr = flowCol.array;
    var pos = 0, spawnCap = Math.min(flowEdges.length, 56);
    for (var e = 0; e < flowEdges.length; e++) {
      var E = flowEdges[e];
      var ax = cellX(E.kA % n), az = cellZ(Math.floor(E.kA / n)), ay = cellY(E.kA, Hs);
      var bx = cellX(E.kB % n), bz = cellZ(Math.floor(E.kB / n)), by = cellY(E.kB, Hs);
      for (var s = 0; s < per; s++) {
        var t = (flowPhase[pos] + elapsed * 0.00022 * flowSpeed) % 1;
        var lift = Math.sin(Math.PI * t) * (0.24 + Math.abs(by - ay) * 0.18);
        arr[pos * 3] = ax + (bx - ax) * t;
        arr[pos * 3 + 1] = ay + (by - ay) * t + lift + 0.05;
        arr[pos * 3 + 2] = az + (bz - az) * t;
        /* 尾巴暗、头亮：让流向不用箭头也能看出来 */
        var glow = 0.16 + 0.84 * Math.pow(t, 1.6);
        carr[pos * 3] = 0.55 + 0.42 * glow;
        carr[pos * 3 + 1] = 0.76 + 0.2 * glow;
        carr[pos * 3 + 2] = 1.0;
        /* 相位回绕 = 这一颗刚抵达 sink，同时下一颗正从 source 起飞 */
        var prev = flowLast[pos];
        if (prev >= 0 && t < prev - 0.5 && e < spawnCap && pulseOn) {
          if (Math.random() < 0.72) spawnPulse(bx, by, bz, "in", E.w >= 0);
          if (Math.random() < 0.5) spawnPulse(ax, ay, az, "out", E.w >= 0);
        }
        flowLast[pos] = t;
        pos++;
      }
    }
    flowPos.needsUpdate = true;
    flowCol.needsUpdate = true;
    if (pulseOn) updatePulses();
  }

  /* ------------------------------------------------------------------ 热点辉光 + 底部氛围光
     光斑只做"山体自身发亮"的暗示：半径小、透明度低、几乎贴着地表，
     避免 billboard 在山脊之外散成一团悬空的红黄雾 */
  function buildGlow(Hs) {
    if (!frame || !grid.pos) return;
    Hs = Hs || grid.h;
    glowGroup = new THREE.Group();
    var n = grid.n;
    var top = frame.top ? frame.top.slice(0, 10) : [];
    top.forEach(function (i, k) {
      var p = grid.pos[i];
      if (!p || p[0] < 0) return;
      var kk = p[1] * n + p[0];
      var up = frame.chg[i] >= 0;
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, color: up ? 0xff5d6c : 0x35d6a3,
        transparent: true, opacity: 0.24 - k * 0.013,
        blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false
      }));
      spr.position.set(cellX(p[0]), cellY(kk, Hs) + 0.03, cellZ(p[1]));
      var sc = 0.30 + 0.22 * Math.min(1, frame.score[i] / Math.max(1, frame.score[top[0]]));
      spr.scale.set(sc, sc, 1);
      spr.userData.base = sc;
      spr.userData.ph = Math.random() * 6.28;
      glowGroup.add(spr);
      glowList.push(spr);
    });
    /* 山脊自发光：取高度最高的一批格子，铺一层暖光，热区会"亮"起来 */
    var hs = [];
    for (var kk = 0; kk < n * n; kk++) hs.push({ k: kk, h: Hs[kk] || 0 });
    hs.sort(function (a, b) { return b.h - a.h; });
    var hMax = Math.max(1e-6, hs[0] ? hs[0].h : 1);
    hs.slice(0, 14).forEach(function (o, idx) {
      if (o.h <= 0.15) return;
      var gx = o.k % n, gz = Math.floor(o.k / n);
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, color: 0xff6a4a, transparent: true,
        opacity: 0.07 + 0.08 * Math.min(1, o.h / hMax),
        blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false
      }));
      spr.position.set(cellX(gx), cellY(o.k, Hs) + 0.035, cellZ(gz));
      var sc = 0.28 + 0.20 * Math.min(1, o.h / hMax);
      spr.scale.set(sc, sc, 1);
      glowGroup.add(spr);
    });
    /* 基准网格：给地形一个"地面"，空场不再是一片黑 */
    var base = new THREE.GridHelper(17, 17, 0x2b4a6b, 0x1b3048);
    base.position.set(0, -2.62, 0);
    if (base.material) {
      base.material.transparent = true; base.material.opacity = 0.34; base.material.depthWrite = false;
    }
    glowGroup.add(base);
    /* 地形底部的冷光，让整块地形"浮"在暗场里 */
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0x1b4a7a, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    }));
    halo.position.set(0, -1.9, 0);
    halo.scale.set(21, 21, 1);
    glowGroup.add(halo);
    scene.add(glowGroup);
  }

  /* ------------------------------------------------------------------ 高度形变
     切日期时地形不是瞬间跳变，而是像水面一样重新起伏 */
  function applyHeights(Hs) {
    if (!mesh || !Hs) return;
    var n = grid.n, attr = mesh.geometry.getAttribute("position");
    for (var k = 0; k < n * n; k++) attr.setY(k, cellY(k, Hs));
    attr.needsUpdate = true;
    if (mesh.geometry) { mesh.geometry.computeVertexNormals(); paintGeo(mesh.geometry, Hs); }
    if (wire) {
      scene.remove(wire);
      wire.geometry.dispose();
      wire.geometry = new THREE.WireframeGeometry(mesh.geometry);
      scene.add(wire);
    }
    if (points) {
      var pa = points.geometry.getAttribute("position");
      for (var j = 0; j < pointsCell.length; j++) pa.setY(j, cellY(pointsCell[j], Hs) + 0.05);
      pa.needsUpdate = true;
      points.geometry.computeBoundingSphere();
    }
    if (contours) {
      scene.remove(contours);
      contours.geometry.dispose();
      if (contours.material) contours.material.dispose();
      contours = null;
    }
    if (contourOn) buildContours(Hs);
    glowList.forEach(function (spr) {
      var x = spr.position.x, z = spr.position.z;
      var gx = Math.round((x / SIZE + 0.5) * (n - 1)), gz = Math.round((z / SIZE + 0.5) * (n - 1));
      spr.position.y = cellY(gz * n + gx, Hs) + 0.03;
    });
    if (crossGroup) { disposeCross(); buildCross(Hs); }
    if (holdGroup) {
      holdGroup.children.forEach(function (spr) {
        var i = spr.userData.symbol, p = grid.pos[i];
        if (!p || p[0] < 0) return;
        spr.position.y = cellY(p[1] * n + p[0], Hs) + 0.12;
      });
    }
    if (selRing) updateSelectionRing(Hs);
    updateFlow(Hs);
    needProject = true;
  }

  function beginMorph(fromH, toH, dur) {
    morphFrom = fromH; morphTo = toH; morphT = 0;
    morphStart = (window.performance || Date).now();
    morphDur = dur || 680;
  }

  /* 统一动画循环：形变、粒子、辉光脉冲、镜头缓动都在这里推进 */
  function startLoop() {
    if (loopStarted) return;
    loopStarted = true;
    var step = function (ts) {
      try {
      if (document.hidden) { lastLoop = ts; requestAnimationFrame(step); return; }
      /* 约 30fps：够顺滑，又不至于让笔记本风扇起飞 */
      if (lastLoop && ts - lastLoop < 30) { requestAnimationFrame(step); return; }
      var dt = Math.min(140, lastLoop ? ts - lastLoop : 33);
      lastLoop = ts;
      elapsed += dt;
      var busy = false;
      if (morphT < 1 && morphFrom && morphTo) {
        morphT = Math.min(1, (ts - morphStart) / morphDur);
        var e = 1 - Math.pow(1 - morphT, 3);
        var Hh = new Float32Array(morphTo.length);
        for (var k = 0; k < Hh.length; k++) {
          var a = morphFrom[k] || 0, b = morphTo[k] || 0;
          Hh[k] = a + (b - a) * e;
        }
        animH = Hh;
        applyHeights(Hh);
        busy = true;
        if (morphT >= 1) { animH = morphTo.slice(); morphFrom = null; }
      }
      if (camTween && !use2D) {
        var ct = Math.min(1, (ts - camTween.t0) / camTween.dur);
        var ce = 1 - Math.pow(1 - ct, 3);
        cam.theta = camTween.from.theta + (camTween.to.theta - camTween.from.theta) * ce;
        cam.phi = camTween.from.phi + (camTween.to.phi - camTween.from.phi) * ce;
        cam.dist = camTween.from.dist + (camTween.to.dist - camTween.from.dist) * ce;
        cam.zoom = camTween.from.zoom + (camTween.to.zoom - camTween.from.zoom) * ce;
        if (camTween.to.fx != null) { focus.x = camTween.to.fx; focus.z = camTween.to.fz; }
        zoomTarget = cam.zoom; focusT.x = focus.x; focusT.z = focus.z;
        updateCamera();
        busy = true;
        if (ct >= 1) camTween = null;
      }
      /* 滚轮的无级缩放：目标值平滑逼近，指数插值不会"一跳一跳" */
      if (!use2D) {
        var dz = zoomTarget - cam.zoom, dfx = focusT.x - focus.x, dfz = focusT.z - focus.z;
        if (Math.abs(dz) > 6e-4 || Math.abs(dfx) > 6e-4 || Math.abs(dfz) > 6e-4) {
          cam.zoom += dz * 0.28;
          focus.x += dfx * 0.28; focus.z += dfz * 0.28;
          if (Math.abs(zoomTarget - cam.zoom) < 8e-4) { cam.zoom = zoomTarget; focus.x = focusT.x; focus.z = focusT.z; }
          updateCamera();
          busy = true;
        } else if (fitPending) {
          updateCamera();
          busy = true;
        }
      }
      if (flowOn && flow) { updateFlow(animH); busy = true; }
      if (glowList.length) {
        var pulse = 1 + 0.12 * Math.sin(elapsed * 0.0035);
        glowList.forEach(function (spr, k) {
          var s2 = spr.userData.base * (pulse + 0.05 * Math.sin(elapsed * 0.0021 + spr.userData.ph));
          spr.scale.set(s2, s2, 1);
        });
        busy = true;
      }
      if (busy || needProject) draw();
      requestAnimationFrame(step);
      } catch (err) {
        /* 动画帧里任何异常都不能让循环停摆，否则地形会"冻住" */
        if (window.console) console.warn("[landscape] tick failed", err);
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  function renderFrame(f) {
    frame = f;
    grid = f.grid || { n: 0, h: [], pos: [], p90: 1 };
    cellNode = {};
    if (grid.pos) {
      grid.pos.forEach(function (p, i) {
        if (p && p[0] >= 0) (cellNode[p[0] + "," + p[1]] = cellNode[p[0] + "," + p[1]] || []).push(i);
      });
    }
    if (!st.cross || st.cross.x >= (grid.n || 1)) {
      st.cross = { x: Math.floor((grid.n || 2) / 2), y: Math.floor((grid.n || 2) / 2) };
    }
    buildWorldPos();
    buildLabelCands();
    if (use2D) { draw2D(); drawProfiles(); return; }
    if (!renderer) init();
    var target = new Float32Array(grid.h.length || 0);
    for (var k = 0; k < target.length; k++) target[k] = grid.h[k] || 0;
    var from = animH && animH.length === target.length ? animH : new Float32Array(target.length);
    var firstPaint = !(animH && animH.length === target.length);
    animH = from;
    clearScene();
    var g = buildGeometry(from);
    if (!g) return;
    mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: false
    }));
    scene.add(mesh);
    wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(g),
      new THREE.LineBasicMaterial({ color: 0x6b8fb5, transparent: true, opacity: 0.12 })
    );
    wire.visible = st.wire;
    scene.add(wire);
    buildPoints(from);
    buildContours(from);
    buildGlow(from);
    buildFlow(from);
    buildHoldings();
    buildCross(from);
    updateHighlight();
    if (firstPaint && st.view === "3d") {
      /* 入场：从远处俯冲下来 */
      var to = { theta: cam.theta, phi: cam.phi, dist: cam.dist, zoom: cam.zoom };
      cam.theta = to.theta - 0.62; cam.phi = 0.28; cam.dist = 27; cam.zoom = 0.86;
      updateCamera();
      camTween = {
        from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, zoom: cam.zoom },
        to: to, t0: (window.performance || Date).now(), dur: 1500
      };
    }
    if (firstPaint) fitPending = true;
    updateCamera();
    zoomTarget = cam.zoom;
    focusT.x = focus.x; focusT.z = focus.z;
    draw();
    startLoop();
    beginMorph(from, target, firstPaint ? 1500 : 640);
    if (firstPaint) introPlayed = true;
    publishContourInfo();
    drawProfiles();
  }

  function buildWorldPos() {
    worldPos = [];
    if (!grid || !grid.pos) return;
    var n = grid.n;
    for (var i = 0; i < grid.pos.length; i++) {
      var p = grid.pos[i];
      if (!p || p[0] < 0) { worldPos.push(null); continue; }
      worldPos.push(new THREE.Vector3(cellX(p[0]), cellY(p[1] * n + p[0]) + 0.07, cellZ(p[1])));
    }
  }

  /* 落点是否朝向镜头：地形是高度场，法线朝外即正面；
     背面（被山脊挡住）的点虽然还能投影到屏幕，但它本身是看不见的，
     给它标标签只会得到一串"悬空"的文字 */
  var VIEW_V = null;
  function facingCamera(i) {
    if (use2D || !camera) return true;
    var p = grid.pos[i], n = grid.n;
    if (!p || p[0] < 0) return false;
    var x = p[0], y = p[1];
    var sx = 2 * SIZE / Math.max(1, n - 1);
    var hl = grid.h[y * n + Math.max(0, x - 1)] || 0;
    var hr = grid.h[y * n + Math.min(n - 1, x + 1)] || 0;
    var hd = grid.h[Math.max(0, y - 1) * n + x] || 0;
    var hu = grid.h[Math.min(n - 1, y + 1) * n + x] || 0;
    var gx = (hr - hl) * H / sx, gz = (hu - hd) * H / sx;
    var len = Math.sqrt(gx * gx + 1 + gz * gz);
    var nx = -gx / len, ny = 1 / len, nz = -gz / len;
    var wx = cellX(x), wy = cellY(y * n + x, animH) + 0.07, wz = cellZ(y);
    var vx = camera.position.x - wx, vy = camera.position.y - wy, vz = camera.position.z - wz;
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    return (nx * vx + ny * vy + nz * vz) / vl > 0.05;
  }

  /* 标签候选排序：选中 > 跟踪 > 持仓 > 板块成分 > πN 排名 */
  function buildLabelCands() {
    var arr = [];
    if (!grid || !grid.n || !frame) { labelCands = arr; return; }
    var boardSet = null;
    if (st.board) {
      var mem = MR.frameMembers(st.board, frame) || [];
      boardSet = {};
      mem.forEach(function (i) { boardSet[i] = 1; });
    }
    var holdSet = {};
    (MR.META.holdings || []).forEach(function (i) { holdSet[i] = 1; });
    var trackSet = {};
    (st.tracked || []).forEach(function (i) { trackSet[i] = 1; });
    for (var i = 0; i < grid.pos.length; i++) {
      var p = grid.pos[i];
      if (!p || p[0] < 0) continue;
      if (MR.sym(i)[5]) continue;
      var pr = frame.score[i];
      if (i === st.selected) pr += 1e6;
      else if (trackSet[i]) pr += 5e5;
      else if (holdSet[i]) pr += 2e5;
      else if (boardSet && boardSet[i]) pr += 1e5;
      arr.push({ i: i, p: pr, major: pr >= 1e5 });
    }
    arr.sort(function (a, b) { return b.p - a.p; });
    labelCands = arr;
  }

  function projectAll() {
    proj = [];
    if (use2D || !camera || !grid || !grid.n || !worldPos.length) { needProject = false; return; }
    var w = host.clientWidth || 1, h = host.clientHeight || 1;
    var v = new THREE.Vector3();
    for (var i = 0; i < worldPos.length; i++) {
      var wp = worldPos[i];
      if (!wp) { proj.push(null); continue; }
      v.copy(wp).project(camera);
      proj.push({ x: (v.x * .5 + .5) * w, y: (-v.y * .5 + .5) * h, z: v.z });
    }
    needProject = false;
  }

  /* ------------------------------------------------------------------ 标签层 */
  function ensureLabel(k) {
    if (labelPool[k]) return labelPool[k];
    var d = document.createElement("div");
    d.className = "slab";
    d.innerHTML = '<i class="slab-dot"></i><b></b><span></span><em></em>';
    d.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (moved > 8) { moved = 0; return; }        /* 刚才是拖地形，不是点标签 */
      var i = Number(d.dataset.sym);
      if (!isFinite(i)) return;
      MR.selectSymbol(i, false);
      if (MR.Drill) MR.Drill.open("sym", { i: i });
    });
    d.addEventListener("pointerenter", function () {
      var i = Number(d.dataset.sym);
      if (!isFinite(i) || dragging) return;
      hoverSym = i;
      var key = "l" + i;
      hoverKey = key;
      clearHoverTimer();
      hoverTimer = setTimeout(function () {
        hoverTimer = 0;
        if (hoverKey !== key) return;
        showSymbolTip(i, null, d);
      }, HOVER_DELAY);
    });
    d.addEventListener("pointerleave", function () {
      clearHoverTimer();
      if (st.frame) hideTip();
    });
    labelLayer.appendChild(d);
    labelPool[k] = d;
    return d;
  }

  function hideLabels() {
    /* 必须遍历整个池：只按 labelUsed 隐藏会留下上次的残影 */
    for (var k = 0; k < labelPool.length; k++) labelPool[k].style.display = "none";
    labelUsed = 0;
    lastLabelRects = [];
    if (leadersCtx && leadersCv) leadersCtx.clearRect(0, 0, leadersCv.width, leadersCv.height);
  }

  /* 引线：从落点画一条细线到标签最近的边，标签再密也不会"飘"在半空 */
  function drawLeaders(list) {
    if (!leadersCtx || !leadersCv) return;
    var c = leadersCtx;
    c.clearRect(0, 0, leadersCv.width, leadersCv.height);
    if (!list || !list.length) return;
    for (var k = 0; k < list.length; k++) {
      var o = list[k];
      var ax = Math.max(o.x, Math.min(o.px, o.x + o.w));
      var ay = Math.max(o.y, Math.min(o.py, o.y + o.h));
      var dx = o.px - ax, dy = o.py - ay;
      if (Math.sqrt(dx * dx + dy * dy) < 8) continue;
      c.beginPath();
      c.moveTo(o.px, o.py);
      c.lineTo(ax, ay);
      c.strokeStyle = o.sel ? "rgba(243,201,105,1)" : (o.major ? "rgba(243,201,105,.85)" : "rgba(160,198,232,.78)");
      c.lineWidth = o.sel ? 1.8 : 1.5;
      c.stroke();
      c.beginPath();
      c.arc(o.px, o.py, o.sel ? 3.2 : 2.2, 0, 6.283);
      c.fillStyle = o.sel ? "#f3c969" : "rgba(190,218,244,.95)";
      c.fill();
    }
  }

  /* 字号：CSS 变量驱动 .slab / .clabel；改完只重排，不重建 DOM */
  function applyLabelSize(px) {
    labelSize = Math.max(9, Math.min(18, Number(px) || 13));
    var v = labelSize + "px";
    if (labelLayer) labelLayer.style.setProperty("--slab-fs", v);
    if (clabelLayer) clabelLayer.style.setProperty("--slab-fs", v);
    lastW = 0;                                  /* 让下一帧重新测量、重排 */
    needProject = true;
    if (frame && grid && grid.n) { buildLabelCands(); draw(); if (use2D) draw2D(); }
  }

  /* ---------------- 等高线高程标识 ---------------- */
  function ensureClabel(k) {
    if (clabelPool[k]) return clabelPool[k];
    var d = document.createElement("div");
    d.className = "clabel";
    if (clabelLayer) clabelLayer.appendChild(d);
    clabelPool[k] = d;
    return d;
  }
  function hideClabels() {
    for (var k = 0; k < clabelPool.length; k++) clabelPool[k].style.display = "none";
    clabelUsed = 0;
  }
  /* 把每个档位的代表点投到屏幕标数值。
     先连带避让股票标签；若被挤得只剩一两个，就退化成"只避让同类"，
     保证等高线上始终能读到数字，而不是被密集标签挡光 */
  function updateContourLabels() {
    if (!clabelLayer) return;
    if (!contourOn || use2D || !camera || !contourMarks.length) { hideClabels(); return; }
    var used = placeClabels(true);
    if (used < Math.ceil(contourMarks.length * 0.6) && contourMarks.length > 3) {
      for (var k = 0; k < clabelPool.length; k++) clabelPool[k].style.display = "none";
      used = placeClabels(false);
    }
    for (var z = used; z < clabelPool.length; z++) clabelPool[z].style.display = "none";
    clabelUsed = used;
  }
  function placeClabels(avoidSlabs) {
    var W = host.clientWidth, Hh = host.clientHeight, used = 0;
    var rects = avoidSlabs ? lastLabelRects.slice() : [];
    var v3 = new THREE.Vector3();
    for (var i = 0; i < contourMarks.length; i++) {
      var m = contourMarks[i];
      v3.set(m.x, m.y, m.z).project(camera);
      if (v3.z > 1) continue;
      var sx = (v3.x + 1) / 2 * W, sy = (1 - v3.y) / 2 * Hh;
      if (sx < 10 || sy < 10 || sx > W - 10 || sy > Hh - 10) continue;
      var num = Math.abs(m.v) < 0.005 ? "0.00" : m.v.toFixed(2);
      var txt = (m.v > 0.005 ? "+" : "") + num;
      var w = txt.length * labelSize * 0.46 + 7, h = labelSize * 1.18;
      /* 原地放不下就小步挪：上下优先，其次左右 */
      var offs = avoidSlabs ? [[0, 0], [0, -h - 4], [0, h + 4], [-w * 0.8, 0], [w * 0.8, 0]] : [[0, 0]];
      var lx = null, ly = null;
      for (var oi = 0; oi < offs.length; oi++) {
        var tx = sx - w / 2 + offs[oi][0], ty = sy - h / 2 + offs[oi][1];
        if (tx < 4 || ty < 4 || tx + w > W - 8 || ty + h > Hh - 30) continue;
        var bad = false;
        for (var r = 0; r < rects.length; r++) {
          var o = rects[r];
          if (tx < o.x + o.w + 2 && tx + w + 2 > o.x && ty < o.y + o.h + 1 && ty + h + 1 > o.y) { bad = true; break; }
        }
        if (!bad) { lx = tx; ly = ty; break; }
      }
      if (lx == null) continue;
      rects.push({ x: lx, y: ly, w: w, h: h });
      var d = ensureClabel(used++);
      d.textContent = txt;
      d.className = "clabel" + (m.v < 0 ? " down" : "") + (m.idx ? " idx" : "") + (avoidSlabs ? "" : " low");
      d.style.display = "block";
      d.style.transform = "translate3d(" + lx.toFixed(1) + "px," + ly.toFixed(1) + "px,0)";
    }
    return used;
  }

  function updateLabels() {
    if (!labelLayer) return;
    var mode = st.labelMode == null ? 30 : Number(st.labelMode);
    if (host && (host.clientWidth !== lastW || host.clientHeight !== lastH)) {
      lastW = host.clientWidth; lastH = host.clientHeight; needProject = true;
    }
    if (use2D || !mode || !grid || !grid.n || !frame) { hideLabels(); return; }
    if (needProject || !proj.length) projectAll();
    var W = host.clientWidth, Hh = host.clientHeight;
    /* 预留边距：底部 30px 让给色带/图例，右侧留 6px 防止压到面板边框 */
    var mL = 4, mR = 10, mT = 4, mB = 32;
    var rects = [], used = 0, placed = [];
    /* 右上角的脉搏卡也要当作不可占用区域 */
    var hero = document.getElementById("surfaceHero");
    if (hero && hero.offsetParent !== null) {
      var hb2 = host.getBoundingClientRect(), hr = hero.getBoundingClientRect();
      rects.push({ x: hr.left - hb2.left - 5, y: hr.top - hb2.top - 5, w: hr.width + 10, h: hr.height + 10 });
    }
    var want = Math.min(mode, labelCands.length);
    var pool = cam.zoom > 1.45 ? Math.min(labelCands.length, 420) : want;
    for (var k = 0; k < pool; k++) {
      var c = labelCands[k], i = c.i, q = proj[i];
      if (!q || q.z > 1 || q.z < -1) continue;
      if (q.x < 2 || q.y < 2 || q.x > W - 2 || q.y > Hh - 2) continue;
      if (!facingCamera(i)) continue;
      var s = MR.sym(i), chg = frame.chg[i];
      var dot = ensureLabel(used);
      var showName = c.major || mode <= 30;
      var txtCode = s[0], txtName = showName ? (s[1] || "") : "";
      var txtChg = (chg > 0 ? "+" : "") + chg.toFixed(2) + "%";
      /* 宽高随字号等比放大：字号调大后避让仍按真实尺寸算，不会互相压住 */
      var sc = labelSize / 10;
      var wEst = (34 + (txtName ? Math.min(5, txtName.length) * 11 + 6 : 0) + 46) * sc;
      var hEst = labelSize * 1.42 + 6;   /* 行高 + 上下 padding/border 余量 */
      var cands = [
        [q.x + 12, q.y - hEst - 6],
        [q.x - wEst - 12, q.y - hEst - 6],
        [q.x + 12, q.y + 9],
        [q.x - wEst - 12, q.y + 9],
        [q.x + 12, q.y - hEst * 2 - 10],
        [q.x - wEst - 12, q.y + hEst + 14],
        [q.x - wEst / 2, q.y - hEst - 12],
        [q.x - wEst / 2, q.y + hEst + 12]
      ];
      var lx = null, ly = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var tx = cands[ci][0], ty = cands[ci][1];
        if (tx < mL || ty < mT || tx + wEst > W - mR || ty + hEst > Hh - mB) continue;
        var bad = false;
        for (var r = 0; r < rects.length; r++) {
          var o = rects[r];
          if (tx < o.x + o.w + 2 && tx + wEst + 2 > o.x && ty < o.y + o.h + 1 && ty + hEst + 1 > o.y) { bad = true; break; }
        }
        if (!bad) { lx = tx; ly = ty; break; }
      }
      if (lx == null) continue;
      rects.push({ x: lx, y: ly, w: wEst, h: hEst });
      placed.push({ x: lx, y: ly, w: wEst, h: hEst, px: q.x, py: q.y, major: c.major, sel: i === st.selected });
      dot.style.display = "block";
      dot.style.transform = "translate3d(" + lx.toFixed(1) + "px," + ly.toFixed(1) + "px,0)";
      dot.dataset.sym = i;
      dot.className = "slab" + (chg > 0 ? " up" : (chg < 0 ? " down" : "")) + (c.major ? " major" : "") +
        (st.tracked && st.tracked.indexOf(i) >= 0 ? " tracked" : "") +
        (i === st.selected ? " sel" : "");
      dot.children[1].textContent = txtCode;
      dot.children[2].textContent = txtName;
      var em = dot.children[3];
      em.textContent = txtChg;
      em.className = chg > 0 ? "up" : (chg < 0 ? "down" : "flat");
      used++;
      if (used >= want) break;
    }
    for (var z = used; z < labelPool.length; z++) labelPool[z].style.display = "none";
    labelUsed = used;
    lastLabelRects = rects;                     /* 供等高线数值标签避让 */
    drawLeaders(placed);
  }

  /* ------------------------------------------------------------------ 持仓 / 十字线 / 高亮 */
  function buildHoldings() {
    if (!grid.pos || !MR.META.holdings) return;
    holdGroup = new THREE.Group();
    MR.META.holdings.forEach(function (i) {
      var p = grid.pos[i];
      if (!p || p[0] < 0) return;
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTexture, color: 0x35d6a3, transparent: true, depthTest: false, depthWrite: false
      }));
      var k = p[1] * grid.n + p[0];
      spr.position.set(cellX(p[0]), cellY(k) + 0.12, cellZ(p[1]));
      spr.scale.set(0.19, 0.19, 1);
      spr.userData.symbol = i;
      holdGroup.add(spr);
    });
    holdGroup.visible = st.hold;
    scene.add(holdGroup);
  }

  function disposeCross() {
    if (!crossGroup) return;
    scene.remove(crossGroup);
    crossGroup.children.forEach(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    crossGroup = null;
  }

  function buildCross(Hs) {
    if (!grid.n) return;
    Hs = Hs || grid.h;
    var c = st.cross, n = grid.n;
    crossGroup = new THREE.Group();
    var row = [], col = [];
    for (var x = 0; x < n; x++) {
      row.push(new THREE.Vector3(cellX(x), cellY(c.y * n + x, Hs) + 0.04, cellZ(c.y)));
    }
    for (var y = 0; y < n; y++) {
      col.push(new THREE.Vector3(cellX(c.x), cellY(y * n + c.x, Hs) + 0.04, cellZ(y)));
    }
    var mat = new THREE.LineBasicMaterial({ color: 0xf3c969, transparent: true, opacity: .8 });
    crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(row), mat));
    crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(col), mat));
    scene.add(crossGroup);
  }

  function updateHighlight() {
    if (!grid || !grid.n) return;
    var members = st.board ? MR.frameMembers(st.board, frame) : null;
    cellBoard = {};
    if (members) members.forEach(function (i) {
      var p = grid.pos[i];
      if (p && p[0] >= 0) cellBoard[p[0] + "," + p[1]] = true;
    });
    lastSelected = st.selected;
    if (!mesh) { if (use2D) draw2D(); return; }
    paintGeo(mesh.geometry, animH || grid.h);
    draw();
    if (use2D) draw2D();
  }

  function draw() {
    if (!renderer || !scene || !camera) return;
    updateSelectionRing(animH || (grid && grid.h));
    renderer.render(scene, camera);
    if (needProject) { projectAll(); }
    updateLabels();
    updateContourLabels();
  }

  /* 最短弧方向，镜头旋转不会绕远路 */
  function angleDelta(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  var lastSelected = null;

  function updateSelectionRing(Hs) {
    var i = st.selected;
    if (i == null || !grid || !grid.n) { if (selRing) selRing.visible = false; return; }
    var p = grid.pos[i];
    if (!p || p[0] < 0) { if (selRing) selRing.visible = false; return; }
    if (!selRing) {
      selRing = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ringTexture, transparent: true, depthTest: false, depthWrite: false
      }));
      selRing.scale.set(0.5, 0.5, 1);
      scene.add(selRing);
    }
    var k = p[1] * grid.n + p[0];
    selRing.position.set(cellX(p[0]), cellY(k, Hs) + 0.16, cellZ(p[1]));
    selRing.visible = true;
  }

  /* ------------------------------------------------------------------ 拾取与提示 */
  function pointerToLocal(ev, dom) {
    var r = dom.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  }

  function nearestSymbol(lx, ly, maxD) {
    if (needProject || !proj.length) projectAll();
    var best = -1, bd = maxD == null ? 15 : maxD;
    for (var i = 0; i < proj.length; i++) {
      var q = proj[i];
      if (!q || q.z > 1) continue;
      var d = Math.hypot(q.x - lx, q.y - ly);
      if (d > bd) continue;
      if (!facingCamera(i)) continue;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function pickCell(ev, dom) {
    if (use2D || !renderer) {
      var l0 = pointerToLocal(ev, dom);
      var side = Math.min(l0.w, l0.h) * 0.86;
      var left = (l0.w - side) / 2, top = (l0.h - side) / 2;
      var gx = (l0.x - left) / side, gy = (l0.y - top) / side;
      if (gx < 0 || gy < 0 || gx > 1 || gy > 1 || !grid.n) return null;
      return { x: Math.floor(gx * grid.n), y: Math.floor(gy * grid.n) };
    }
    var l = pointerToLocal(ev, dom);
    var m = new THREE.Vector2((l.x / l.w) * 2 - 1, -(l.y / l.h) * 2 + 1);
    var rc = new THREE.Raycaster();
    rc.setFromCamera(m, camera);
    var hit = rc.intersectObject(mesh, false)[0];
    if (!hit) return null;
    var n = grid.n;
    return {
      x: Math.round((hit.point.x / SIZE + 0.5) * (n - 1)),
      y: Math.round((hit.point.z / SIZE + 0.5) * (n - 1))
    };
  }

  function hideTip() {
    var tip = document.getElementById("surfaceTip");
    if (tip) tip.style.display = "none";
    hoverSym = -1;
    lastTipSym = -1;
    hoverKey = "";
    clearHoverTimer();
  }
  function setTipVisible(on) {
    var tip = document.getElementById("surfaceTip");
    if (tip) tip.style.display = on ? "block" : "none";
  }

  function tipPosition(tip, ev, anchor) {
    var hostR = host.getBoundingClientRect();
    var px, py;
    if (ev) {
      px = ev.clientX - hostR.left + 16; py = ev.clientY - hostR.top + 14;
    } else if (anchor) {
      px = parseFloat(anchor.style.transform.replace(/[^0-9.,-]/g, "").split(",")[0]) + 150;
      py = parseFloat(anchor.style.transform.replace(/[^0-9.,-]/g, "").split(",")[1]) - 10;
    } else { px = 40; py = 40; }
    var tw = tip.offsetWidth || 268, th = tip.offsetHeight || 180;
    if (px + tw > hostR.width - 4) px = Math.max(4, px - tw - 32);
    if (py + th > hostR.height - 4) py = Math.max(4, hostR.height - th - 6);
    tip.style.left = px + "px";
    tip.style.top = py + "px";
  }

  function drawSpark(cv, vals, color) {
    if (!cv) return;
    var w = cv.width, h = cv.height, c = cv.getContext("2d");
    c.clearRect(0, 0, w, h);
    var fin = vals.map(function (v) { return isFinite(v) ? v : null; });
    var nums = fin.filter(function (v) { return v != null; });
    if (!nums.length) return;
    var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
    if (mx === mn) { mx += 1; mn -= 1; }
    var X = function (i) { return 2 + i / Math.max(1, vals.length - 1) * (w - 4); };
    var Y = function (v) { return h - 3 - (v - mn) / (mx - mn) * (h - 6); };
    c.beginPath();
    var started = false;
    fin.forEach(function (v, i) {
      if (v == null) return;
      if (!started) { c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v));
    });
    c.strokeStyle = color; c.lineWidth = 1.4; c.stroke();
    var lastI = fin.length - 1;
    while (lastI >= 0 && fin[lastI] == null) lastI--;
    if (lastI >= 0) {
      c.beginPath(); c.arc(X(lastI), Y(fin[lastI]), 2.4, 0, 6.283);
      c.fillStyle = color; c.fill();
    }
  }

  var lastTipSym = -1, lastTipAt = 0;

  function showSymbolTip(i, ev, anchor) {
    var tip = document.getElementById("surfaceTip");
    if (!tip || !frame) return;
    if (i === lastTipSym && Date.now() - lastTipAt < 160) {
      tipPosition(tip, ev, anchor);
      return;
    }
    lastTipSym = i; lastTipAt = Date.now();
    var s = MR.sym(i), m = MR.metrics(i), f = frame;
    var rank = MR.rankOf(f, i);
    var chg = f.chg[i];
    var row = function (k, v, cls) {
      return '<div class="tr"><span>' + k + '</span><em class="' + (cls || "") + '">' + MR.esc(v) + "</em></div>";
    };
    tip.innerHTML =
      '<div class="tip-head"><div class="tip-name"><b>' + MR.esc(s[1]) + "</b>" +
        '<small>' + MR.esc(s[0]) + " · " + MR.esc(s[2].toUpperCase()) + (s[5] ? " · ETF" : "") + "</small></div>" +
        '<div class="tip-chg ' + MR.chgClass(chg) + '">' + MR.signed(chg, 2, "%") + "</div></div>" +
      '<div class="tip-spark"><canvas id="tipSpark" width="232" height="38"></canvas>' +
        "<span>πN 60 日走势</span></div>" +
      '<div class="tip-cols">' +
        '<div>' + row("πN", MR.num(f.score[i], 2), "gold") + row("排名", rank > 0 ? rank + " / " + f.stats.active : "—") +
          row("log(π/s)", MR.num(f.z[i], 2)) + row("Δlog(πN)", MR.signed(f.hb[i], 4), MR.chgClass(f.hb[i])) + "</div>" +
        '<div>' + row("收盘", MR.num(m.c, 2)) + row("成交额", MR.amount(f.amt[i])) +
          row("振幅", isFinite(m.amp) ? m.amp.toFixed(1) + "%" : "—") + row("20日", MR.percent(m.ret20, 1), MR.chgClass(m.ret20)) + "</div>" +
      "</div>" +
      '<div class="tip-meta">' + MR.esc(s[3]) + " · " + MR.esc(s[4] || "") + " · 社群 C" + f.comm[i] +
        (st.tracked.indexOf(i) >= 0 ? " · 跟踪中" : "") + "</div>" +
      '<div class="tip-go">点击查看 K 线 / 资金流详情 ↗</div>';
    tip.style.display = "block";
    tipPosition(tip, ev, anchor);
    drawSpark(document.getElementById("tipSpark"), MR.seriesCol(i, "score"), "#7fb4ff");
  }

  function showCellTip(cell, ev) {
    var tip = document.getElementById("surfaceTip");
    if (!tip || !cell) { hideTip(); return; }
    var nodes = cellNode[cell.x + "," + cell.y] || [];
    var k = cell.y * grid.n + cell.x;
    var rows = "";
    if (nodes.length) {
      var sorted = nodes.slice().sort(function (a, b) { return frame.score[b] - frame.score[a]; });
      rows = sorted.slice(0, 4).map(function (i) {
        var chg = frame.chg[i];
        return '<div class="tr"><span>' + MR.esc(MR.symName(i)) + '</span><em class="' + MR.chgClass(chg) +
          '">' + MR.signed(chg, 2, "%") + "</em></div>";
      }).join("");
      if (sorted.length > 4) rows += '<div class="tr more">…另 ' + (sorted.length - 4) + " 只</div>";
    } else {
      rows = '<div class="tr"><span>无股票落点</span><em>—</em></div>';
    }
    tip.innerHTML = '<div class="tip-head"><div class="tip-name"><b>格 (' + cell.x + ", " + cell.y + ")</b>" +
      '<small>log(π/s) ' + MR.num(grid.h[k], 3) + " · 社群 " +
      (grid.cellComm ? grid.cellComm[k] : "—") + "</small></div></div>" + rows +
      (nodes.length ? '<div class="tip-go">点击最近的点查看个股详情 ↗</div>' : "");
    tip.style.display = "block";
    tipPosition(tip, ev);
  }

  /* ------------------------------------------------------------------ 事件 */
  function bindEvents(dom) {
    /* 中键在浏览器里默认是"自动滚动"，不挡掉会连页面一起动 */
    dom.addEventListener("mousedown", function (e) {
      if (e.button === 1) e.preventDefault();
    });
    dom.addEventListener("auxclick", function (e) {
      if (e.button === 1) e.preventDefault();
    });
    dom.addEventListener("pointerdown", function (e) {
      if (e.button === 1) {                       /* 中键：平移板面 */
        e.preventDefault();
        panning = true; moved = 0;
        panLast = { x: e.clientX, y: e.clientY };
        dom.classList.add("panning");
        clearHoverTimer(); hideTip();
        dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      dragging = true; moved = 0;
      lastPointer = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointerup", function (e) {
      if (panning) {
        panning = false; panLast = null;
        dom.classList.remove("panning");
        return;
      }
      dragging = false;
      if (e.button !== 0) return;
      if (moved > 6) return;                       /* 拖动旋转，不当点击 */
      var l = pointerToLocal(e, dom);
      var sym = nearestSymbol(l.x, l.y, 20);
      if (sym >= 0) {
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        /* 自己判定"双击"：浏览器 dblclick 会被浮层/卡片遮挡吞掉，这里按时间+距离更稳 */
        if (lastTap.sym === sym && now - lastTap.t < 380 &&
            Math.abs(l.x - lastTap.x) < 9 && Math.abs(l.y - lastTap.y) < 9) {
          lastTap = { t: 0, sym: -1, x: 0, y: 0 };
          var p2 = grid.pos[sym];
          if (p2) { st.cross = { x: p2[0], y: p2[1] }; disposeCross(); buildCross(); drawProfiles(); }
          MR.selectSymbol(sym, true);
          if (MR.Drill) MR.Drill.open("sym", { i: sym });
          return;
        }
        lastTap = { t: now, sym: sym, x: l.x, y: l.y };
        var p = grid.pos[sym];
        if (p) { st.cross = { x: p[0], y: p[1] }; disposeCross(); buildCross(); drawProfiles(); }
        MR.selectSymbol(sym, true);                /* 单击只选中，双击才开详情 */
        return;
      }
      lastTap = { t: 0, sym: -1, x: 0, y: 0 };
      var c = pickCell(e, dom);
      if (c && c.x >= 0 && c.y >= 0 && c.x < grid.n && c.y < grid.n) {
        st.cross = c;
        var nodes = cellNode[c.x + "," + c.y] || [];
        if (nodes.length) MR.selectSymbol(nodes[0], false);
        disposeCross(); buildCross(); drawProfiles(); draw();
      }
    });
    dom.addEventListener("pointermove", function (e) {
      if (panning && panLast) {
        var pdx = e.clientX - panLast.x, pdy = e.clientY - panLast.y;
        panLast = { x: e.clientX, y: e.clientY };
        moved += Math.abs(pdx) + Math.abs(pdy);
        panBy(pdx, pdy);
        return;
      }
      if (dragging && lastPointer && st.view === "3d" && !use2D) {
        moved += Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y);
        cam.theta -= (e.clientX - lastPointer.x) * 0.006;
        cam.phi = Math.max(0.16, Math.min(1.48, cam.phi + (e.clientY - lastPointer.y) * 0.006));
        lastPointer = { x: e.clientX, y: e.clientY };
        clearHoverTimer();
        if (moved > 8) hideTip();
        updateCamera(); draw(); return;
      }
      if (dragging) return;
      var ev = { clientX: e.clientX, clientY: e.clientY };
      if (tipTimer) cancelAnimationFrame(tipTimer);
      tipTimer = requestAnimationFrame(function () {
        tipTimer = 0;
        var l = pointerToLocal(e, dom);
        var sym = nearestSymbol(l.x, l.y, 22);
        var c = sym >= 0 ? null : pickCell(e, dom);
        hoverSym = sym; hoverCell = c;
        var key = sym >= 0 ? "s" + sym : (c ? "c" + c.x + "," + c.y : "none");
        if (key !== hoverKey) {
          hoverKey = key;
          clearHoverTimer();
          if (key === "none") setTipVisible(false);
          else {
            /* 停在该目标上约 0.4 秒才弹卡片：扫过去时不闪、不挡视线 */
            hoverTimer = setTimeout(function () {
              hoverTimer = 0;
              if (hoverKey !== key) return;
              if (sym >= 0) showSymbolTip(sym, ev); else showCellTip(c, ev);
            }, HOVER_DELAY);
          }
        } else if (tipVisible()) {
          tipPosition(document.getElementById("surfaceTip"), ev, null);
        }
        if (c && (c.x !== st.cross.x || c.y !== st.cross.y)) {
          st.cross = c;
          if (crossGroup && scene) { disposeCross(); buildCross(); }
          drawProfiles();
          if (!use2D) draw();
        }
        if (use2D) draw2D();
      });
    });
    dom.addEventListener("pointerleave", function () {
      dragging = false;
      clearHoverTimer();
      hideTip();
    });
    /* 滚轮：指数曲线 + 目标值平滑逼近 = 近似无级缩放，并且朝鼠标所指处推进 */
    dom.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (use2D || !grid || !grid.n) {
        cam.zoom = Math.max(0.55, Math.min(3.4, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
        updateCamera(); draw2D(); return;
      }
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= 120;
      var k = Math.exp(-d * 0.0017);
      k = Math.max(0.5, Math.min(2.0, k));
      var nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomTarget * k));
      var kk = nz / Math.max(1e-6, zoomTarget);
      if (Math.abs(kk - 1) > 1e-6) {
        if (st.view === "3d") {
          var l = pointerToLocal(e, dom);
          var gp = groundPoint(l.x, l.y, dom);
          if (gp) {
            /* 保持鼠标下的那一点不动：镜头焦点朝它平移 */
            focusT.x = Math.max(-5.2, Math.min(5.2, gp.x + (focusT.x - gp.x) / kk));
            focusT.z = Math.max(-5.2, Math.min(5.2, gp.z + (focusT.z - gp.z) / kk));
          }
        }
        zoomTarget = nz;
        startLoop();
      }
    }, { passive: false });
    /* 空白处双击 → 视角、缩放、平移一起复位（小球的双击已在 pointerup 里处理） */
    dom.addEventListener("dblclick", function (e) {
      e.preventDefault();
      if (MR.Drill && MR.Drill.isOpen()) return;
      resetView(680);
    });
  }

  var HOVER_DELAY = 400, hoverKey = "", hoverTimer = 0;
  function clearHoverTimer() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; } }
  function tipVisible() {
    var t = document.getElementById("surfaceTip");
    return !!t && t.style.display === "block";
  }

  /* 屏幕坐标 → 地形基准平面(y=0)的交点，用于"朝光标缩放" */
  function groundPoint(lx, ly, dom) {
    if (!camera || !THREE) return null;
    var w = dom.clientWidth || 1, h = dom.clientHeight || 1;
    var m = new THREE.Vector2((lx / w) * 2 - 1, -(ly / h) * 2 + 1);
    var rc = new THREE.Raycaster();
    rc.setFromCamera(m, camera);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var out = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, out)) return null;
    return { x: out.x, z: out.z };
  }

  /* 中键拖动：把屏幕像素差换算成 focus 的世界位移。
     用相机基向量（right / up）而不是射线程交点，斜视和正交都能一致跟手 */
  function panBy(dx, dy) {
    if (!camera || !host) return;
    var w = host.clientWidth || 1, h = host.clientHeight || 1;
    var wppX, wppY;
    if (camera.isOrthographicCamera) {
      wppX = (camera.right - camera.left) / w;
      wppY = (camera.top - camera.bottom) / h;
    } else {
      var r = cam.dist / cam.zoom * camFit;
      wppX = 2 * r * Math.tan((camera.fov || 42) * Math.PI / 360) / h;
      /* 斜视时 up 的水平分量被压缩，纵向要按 sin(phi) 补偿，否则拖不动 */
      wppY = wppX / Math.max(0.3, Math.sin(Math.max(0.16, cam.phi)));
    }
    var m = camera.matrixWorld.elements;
    var kx = -dx * wppX, ky = dy * wppY;
    var nx = focus.x + kx * m[0] + ky * m[4];
    var nz = focus.z + kx * m[2] + ky * m[6];
    focus.x = focusT.x = Math.max(-5.2, Math.min(5.2, nx));
    focus.z = focusT.z = Math.max(-5.2, Math.min(5.2, nz));
    updateCamera();
    draw();
    if (use2D) draw2D();
  }

  function resetView(dur) {
    zoomTarget = 1;
    focusT.x = 0; focusT.z = 0;
    camTween = {
      from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, zoom: cam.zoom },
      to: { theta: 0.70, phi: 0.80, dist: 14.2, zoom: 1, fx: 0, fz: 0 },
      t0: (window.performance || Date).now(), dur: dur || 700
    };
    fitPending = true;
    startLoop();
    if (use2D) draw2D();
  }

  /* ------------------------------------------------------------------ 2D 降级 */
  function draw2D() {
    if (!cv2d || !grid || !grid.n) return;
    var o = MR.fitCanvas(cv2d), c = o.ctx, w = o.w, h = o.h;
    var side = Math.min(w, h) * 0.86, left = (w - side) / 2, top = (h - side) / 2;
    var n = grid.n, cw = side / n;
    c.fillStyle = "#0a111a"; c.fillRect(0, 0, w, h);
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var v = grid.h[y * n + x] || 0, rgb = MR.diverging(v, grid.p90);
        var shade = Math.max(0.55, Math.min(1.35, 1 + v * 0.12));
        var hi = cellBoard[x + "," + y] ? .55 : 0;
        c.fillStyle = "rgb(" + Math.round(Math.min(255, rgb[0] * 255 * shade + hi * 220)) + "," +
          Math.round(Math.min(255, rgb[1] * 255 * shade + hi * 190)) + "," +
          Math.round(Math.min(255, rgb[2] * 255 * shade + hi * 90)) + ")";
        c.fillRect(left + x * cw, top + y * cw, cw + 0.6, cw + 0.6);
      }
    }
    /* 落点 */
    for (var i = 0; i < grid.pos.length; i++) {
      var p = grid.pos[i];
      if (!p || p[0] < 0 || MR.sym(i)[5]) continue;
      var cx = left + (p[0] + .5) * cw, cy = top + (p[1] + .5) * cw;
      c.beginPath();
      c.arc(cx, cy, frame && frame.chg[i] >= 0 ? 2 : 2, 0, 6.283);
      c.fillStyle = frame && frame.chg[i] >= 0 ? "#ff5d6c" : "#35d6a3";
      c.fill();
    }
    if (st.hold && MR.META.holdings) {
      MR.META.holdings.forEach(function (i) {
        var p = grid.pos[i];
        if (!p || p[0] < 0) return;
        c.beginPath();
        c.arc(left + (p[0] + .5) * cw, top + (p[1] + .5) * cw, Math.max(2.6, cw * .32), 0, 6.283);
        c.fillStyle = "#35d6a3"; c.fill();
        c.lineWidth = 1; c.strokeStyle = "#07130f"; c.stroke();
      });
    }
    /* 标签 */
    var mode = st.labelMode == null ? 30 : Number(st.labelMode);
    if (mode) {
      c.font = "10px monospace"; c.textBaseline = "middle";
      var used = 0;
      for (var q = 0; q < labelCands.length && used < mode; q++) {
        var ii = labelCands[q].i, pp = grid.pos[ii];
        if (!pp || pp[0] < 0) continue;
        var tx = left + (pp[0] + .5) * cw + 5, ty = top + (pp[1] + .5) * cw - 5;
        if (tx + 58 > left + side) tx = left + (pp[0] + .5) * cw - 52;
        c.fillStyle = "rgba(8,13,20,.82)";
        c.fillRect(tx - 2, ty - 7, 56, 13);
        c.fillStyle = frame && frame.chg[ii] >= 0 ? "#ff8b96" : "#6fe3bb";
        c.fillText(MR.symCode(ii), tx, ty);
        used++;
      }
    }
    var cr = st.cross;
    c.strokeStyle = "rgba(243,201,105,.85)"; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(left + (cr.x + .5) * cw, top); c.lineTo(left + (cr.x + .5) * cw, top + side);
    c.moveTo(left, top + (cr.y + .5) * cw); c.lineTo(left + side, top + (cr.y + .5) * cw);
    c.stroke();
    c.strokeStyle = "rgba(120,150,180,.45)";
    c.strokeRect(left, top, side, side);
  }

  /* ------------------------------------------------------------------ 剖面 */
  function drawProfile(cv, cells, crossPos, labelId, label) {
    if (!cv || !grid || !grid.n) return;
    var o = MR.fitCanvas(cv), c = o.ctx, w = o.w, h = o.h;
    var pad = 6, zero = h / 2;
    c.fillStyle = "#0a111a"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#1d2b3a"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, zero); c.lineTo(w, zero); c.stroke();
    var vals = cells.map(function (k) { return grid.h[k] || 0; });
    var mx = Math.max(0.8, Math.max.apply(null, vals.map(Math.abs)));
    var pts = vals.map(function (v, i) {
      return [pad + i / Math.max(1, vals.length - 1) * (w - 2 * pad),
              zero - v / mx * (h / 2 - 8)];
    });
    c.beginPath(); c.moveTo(pts[0][0], zero);
    pts.forEach(function (p) { c.lineTo(p[0], p[1]); });
    c.lineTo(pts[pts.length - 1][0], zero); c.closePath();
    c.fillStyle = "rgba(63,140,255,.13)"; c.fill();
    MR.line(c, pts, "#7fb4ff", 1.3);
    for (var i = 0; i < cells.length; i++) {
      var k = cells[i], cx = pts[i][0];
      var cell = { x: k % grid.n, y: Math.floor(k / grid.n) };
      var nodes = cellNode[cell.x + "," + cell.y] || [];
      if (!nodes.length || !frame) continue;
      var z = frame.z[nodes[0]];
      var py = zero - z / mx * (h / 2 - 8);
      c.beginPath(); c.arc(cx, py, 2, 0, 6.283);
      c.fillStyle = z >= 0 ? "#ff6b7d" : "#4f9bff"; c.fill();
    }
    var cx2 = pad + crossPos / Math.max(1, vals.length - 1) * (w - 2 * pad);
    c.strokeStyle = "rgba(243,201,105,.75)";
    c.beginPath(); c.moveTo(cx2, 0); c.lineTo(cx2, h); c.stroke();
    if (labelId) document.getElementById(labelId).textContent = label;
  }

  function drawProfiles() {
    if (!grid || !grid.n) return;
    var n = grid.n, cr = st.cross;
    if (!cr) return;
    var row = [], col = [];
    for (var x = 0; x < n; x++) row.push(cr.y * n + x);
    for (var y = 0; y < n; y++) col.push(y * n + cr.x);
    drawProfile(document.getElementById("profileRow"), row, cr.x, "rowLabel", "x=" + cr.x);
    drawProfile(document.getElementById("profileCol"), col, cr.y, "colLabel", "y=" + cr.y);
    var cl = document.getElementById("crossLabel");
    if (cl) cl.textContent = "(" + cr.x + ", " + cr.y + ")";
  }

  /* 粒子规模变了要重建粒子和光效池，但不动地形本身 */
  function rebuildFlow() {
    if (!mesh || use2D) return;
    [flow, pulseGroup].forEach(function (o) {
      if (!o) return;
      scene.remove(o);
      o.traverse(function (ch) {
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      });
    });
    flow = pulseGroup = null;
    pulseRing = []; pulseFlash = [];
    buildFlow(animH || grid.h);
    draw();
  }

  MR.Landscape = {
    init: init,
    renderFrame: renderFrame,
    updateHighlight: updateHighlight,
    refreshLabels: function () { buildLabelCands(); needProject = true; draw(); if (use2D) draw2D(); },
    setView: function (v) {
      st.view = v;
      focus.x = 0; focus.z = 0; focusT.x = 0; focusT.z = 0;
      fitPending = true;
      updateCamera(); draw();
    },
    setWire: function (v) { st.wire = v; if (wire) wire.visible = v; draw(); },
    setHold: function (v) { st.hold = v; if (holdGroup) holdGroup.visible = v; draw(); if (use2D) draw2D(); },
    setLabelMode: function (n) { st.labelMode = Number(n); needProject = true; draw(); if (use2D) draw2D(); },
    setLabelSize: function (px) { applyLabelSize(px); },
    setContour: function (v) {
      contourOn = !!v;
      if (contours) { contours.visible = contourOn; contours.material.opacity = contourOn ? 0.52 : 0; }
      if (!contourOn) { contourMarks = []; hideClabels(); }
      publishContourInfo();
      draw();
    },
    /* 手动设等高线间距（0 = 自动按值域选一个整齐档位） */
    setContourStep: function (v) {
      contourStep = Math.max(0, Number(v) || 0);
      if (!mesh) return;
      if (contours) {
        scene.remove(contours);
        contours.geometry.dispose();
        if (contours.material) contours.material.dispose();
        contours = null;
      }
      if (contourOn) buildContours(animH || grid.h);
      else publishContourInfo();
      draw();
    },
    setFlow: function (v) {
      flowOn = !!v;
      if (flow) flow.visible = flowOn;
      if (pulseGroup) pulseGroup.visible = flowOn && pulseOn;
      draw();
    },
    setFlowSpeed: function (v) { flowSpeed = Math.max(0.1, Math.min(6, Number(v) || 1)); },
    setFlowCount: function (v) { flowCount = Math.max(20, Math.min(260, Math.round(Number(v) || 120))); rebuildFlow(); },
    setPulse: function (v) { pulseOn = !!v; if (pulseGroup) pulseGroup.visible = pulseOn && flowOn; },
    /* 外部（例如"重置视图"、双击）把镜头、缩放、平移一起拉回默认 */
    resetCamera: function () { resetView(900); },
    resetView: resetView,
    resize: resize,
    drawProfiles: drawProfiles,
    debug: function () {
      return {
        cam: { theta: cam.theta, phi: cam.phi, dist: cam.dist, zoom: cam.zoom, zoomTarget: zoomTarget, focus: [focus.x, focus.z], camFit: camFit },
        morphT: morphT, elapsed: elapsed, loop: loopStarted,
        hasMesh: !!mesh, hasContour: !!contours, hasFlow: !!(flow && flow.geometry),
        contourStep: contourStepUsed, contourLevels: contourUsed,
        labelSize: labelSize,
        tap: [Math.round(lastTap.t), lastTap.sym],
        labelCssVar: labelLayer ? labelLayer.style.getPropertyValue("--slab-fs") : "",
        contourMarks: contourMarks.length,
        flowCount: flow ? flow.geometry.getAttribute("position").count : 0,
        flowSpeed: flowSpeed,
        pulses: pulseGroup ? pulseGroup.children.filter(function (o) { return o.visible; }).length : 0,
        contourSegs: contours ? contours.geometry.getAttribute("position").count / 2 : 0,
        h: animH ? [animH[0], animH[100], animH[500]] : null,
      };
    },
    projOf: function (i) { return proj[i] ? { x: proj[i].x, y: proj[i].y, z: proj[i].z } : null; },
    is2D: function () { return use2D; }
  };
})();
