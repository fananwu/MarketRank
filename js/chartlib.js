/* MarketRank · Fluxscape — 轻量 canvas 图表库（K线 / 面积 / 直方 / 网格 / 十字光标） */
(function () {
  "use strict";
  if (!window.MR) return;
  var MR = window.MR;

  function niceTicks(min, max, n) {
    if (!isFinite(min) || !isFinite(max) || min === max) return [min || 0];
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / Math.max(1, n))));
    var err = (span / Math.max(1, n)) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var out = [], v = Math.ceil(min / step) * step;
    for (; v <= max + step * 1e-6 && out.length < 40; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function pad(r) {
    return { x: r.x + (r.padL || 0), y: r.y + (r.padT || 0),
             w: r.w - (r.padL || 0) - (r.padR || 0),
             h: r.h - (r.padT || 0) - (r.padB || 0) };
  }

  function grid(ctx, r, opts) {
    opts = opts || {};
    ctx.save();
    ctx.strokeStyle = opts.color || "rgba(120,150,185,.16)";
    ctx.lineWidth = 1;
    (opts.y || []).forEach(function (t) {
      ctx.beginPath();
      ctx.moveTo(r.x, Math.round(t.y) + .5);
      ctx.lineTo(r.x + r.w, Math.round(t.y) + .5);
      ctx.stroke();
    });
    (opts.x || []).forEach(function (t) {
      if (!t.line) return;
      ctx.beginPath();
      ctx.moveTo(Math.round(t.x) + .5, r.y);
      ctx.lineTo(Math.round(t.x) + .5, r.y + r.h);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* K 线：bars = [{o,h,l,c}]，红涨绿跌 */
  function candle(ctx, r, bars, opts) {
    opts = opts || {};
    var n = bars.length;
    if (!n) return;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) {
      if (!isFinite(b.l) || !isFinite(b.h)) return;
      lo = Math.min(lo, b.l); hi = Math.max(hi, b.h);
    });
    if (!isFinite(lo) || !isFinite(hi)) return;
    var span = Math.max(hi - lo, 1e-6), padV = span * 0.08;
    if (opts.min != null && opts.max != null) { lo = opts.min; hi = opts.max; }
    else { lo -= padV; hi += padV; }
    var cw = r.w / n, bw = Math.max(1.5, Math.min(opts.maxW || 16, cw * 0.66));
    var Y = function (v) { return r.y + (hi - v) / (hi - lo) * r.h; };
    bars.forEach(function (b, i) {
      if (!isFinite(b.o) || !isFinite(b.c)) return;
      var cx = r.x + cw * (i + .5);
      var up = b.c >= b.o;
      var col = up ? (opts.up || "#ff5d6c") : (opts.down || "#2fbd93");
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + .5, Y(b.h));
      ctx.lineTo(Math.round(cx) + .5, Y(b.l));
      ctx.stroke();
      var y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      var hh = Math.max(1, y2 - y1);
      if (opts.hollow && up) {
        ctx.strokeRect(Math.round(cx - bw / 2) + .5, Math.round(y1) + .5, Math.round(bw), Math.round(hh));
      } else {
        ctx.fillRect(cx - bw / 2, y1, bw, hh);
      }
    });
    return { lo: lo, hi: hi, Y: Y, cw: cw };
  }

  function areaLine(ctx, r, vals, opts) {
    opts = opts || {};
    var n = vals.length, lo = opts.min, hi = opts.max;
    if (lo == null || hi == null) {
      lo = Infinity; hi = -Infinity;
      vals.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (hi === lo) { hi = lo + 1; lo -= 1; }
    var X = function (i) { return r.x + (n <= 1 ? r.w / 2 : i / (n - 1) * r.w); };
    var Y = function (v) { return r.y + (hi - v) / (hi - lo) * r.h; };
    var pts = vals.map(function (v, i) { return [X(i), Y(isFinite(v) ? v : lo)]; });
    if (opts.fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], r.y + r.h);
      pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(pts[pts.length - 1][0], r.y + r.h);
      ctx.closePath();
      ctx.fillStyle = opts.fill; ctx.fill();
    }
    MR.line(ctx, pts, opts.color || "#6fb0ff", opts.width || 1.4, opts.dash);
    return { lo: lo, hi: hi, X: X, Y: Y };
  }

  function hist(ctx, r, values, opts) {
    opts = opts || {};
    var v = values.filter(isFinite);
    if (!v.length) return null;
    var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
    if (mx === mn) { mx = mn + 1; mn -= 1; }
    var bins = opts.bins || 21, cnt = new Array(bins).fill(0);
    v.forEach(function (x) {
      var k = Math.min(bins - 1, Math.floor((x - mn) / (mx - mn) * bins));
      cnt[k]++;
    });
    var mxc = Math.max.apply(null, cnt) || 1;
    var bw = r.w / bins;
    cnt.forEach(function (c, i) {
      var mid = mn + (i + .5) / bins * (mx - mn);
      var hh = c / mxc * r.h;
      ctx.fillStyle = mid >= 0 ? (opts.up || "rgba(255,93,108,.72)") : (opts.down || "rgba(47,189,147,.72)");
      ctx.fillRect(r.x + i * bw + 1, r.y + r.h - hh, Math.max(1, bw - 2), hh);
    });
    return { mn: mn, mx: mx, cnt: cnt, bins: bins };
  }

  function label(ctx, text, x, y, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = opts.font || "10px " + (opts.mono ? "monospace" : "sans-serif");
    ctx.fillStyle = opts.color || "#7d93aa";
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function chip(ctx, text, x, y, color, bg) {
    ctx.save();
    ctx.font = "600 10.5px monospace";
    var w = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg || "rgba(10,18,28,.92)";
    ctx.fillRect(x, y, w, 16);
    ctx.strokeStyle = color || "#35506d";
    ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, 15);
    ctx.fillStyle = color || "#dce8f4";
    ctx.fillText(text, x + 5, y + 11.5);
    ctx.restore();
    return w;
  }

  MR.Chart = {
    niceTicks: niceTicks, pad: pad, grid: grid, candle: candle,
    areaLine: areaLine, hist: hist, label: label, chip: chip
  };
})();
