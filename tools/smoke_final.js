/* 最终验收：加载、错误、时间联动、下钻、file:// 直开 */
const fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = process.env.CDP_PORT || 9223;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(res => { ws.onopen = res; });
  let seq = 0; const pend = new Map(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("LOG: " + m.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const E = async expr => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "ERR:" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async n => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync("tools/" + n, Buffer.from(s.data, "base64")); };

  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:8899/?v=20" });
  let ready = false;
  for (let i = 0; i < 120; i++) { ready = await E("!!(window.MR&&MR.state&&MR.state.frame)").catch(() => false); if (ready) break; await sleep(250); }
  await sleep(900);
  console.log("load", await E(`JSON.stringify({dates:MR.META.dates.length,symbols:MR.META.symbols.length,boards:MR.META.boards.length,labels:[...document.querySelectorAll('#surfaceLabels .slab')].filter(d=>d.style.display!=='none').length,cols:MR.SERIES.cols.join(',')})`));

  // 时间切换性能
  const t0 = Date.now();
  await E("MR.setDate(30);true");
  for (let i = 0; i < 60; i++) { if (await E("MR.state.frame && MR.state.frame.i===30")) break; await sleep(50); }
  console.log("frame ms", Date.now() - t0, await E("MR.state.frame.date"));

  // 下钻后切日期，验证刷新
  await E(`MR.Drill.open('sym',{i:MR.state.frame.top[0]});true`);
  await sleep(500);
  await E("MR.setDate(45);true");
  for (let i = 0; i < 60; i++) { if (await E("MR.state.frame && MR.state.frame.i===45")) break; await sleep(50); }
  await sleep(500);
  console.log("drillRefresh", await E(`JSON.stringify({open:MR.Drill.isOpen(),sub:document.getElementById('drillSub').textContent,canvas:[document.getElementById('drillCanvas').width,document.getElementById('drillCanvas').height]})`));

  // 板块下钻 + 板块成分 tab
  await E("MR.Drill.close();MR.setBoard(MR.byKind.gn[0]);MR.Drill.open('board',{});true");
  await sleep(600);
  await E("document.querySelectorAll('#drillTabs button')[1].click();true");
  await sleep(400);
  await shot("shot_final_board2.png");
  await E("MR.Drill.close();true");

  // 3D 拖动 + 缩放
  await E(`document.querySelector('[data-view="3d"]').click();true`);
  await sleep(500);
  const b = JSON.parse(await E("(()=>{const r=document.getElementById('surface').getBoundingClientRect();return JSON.stringify([r.left,r.top,r.width,r.height]);})()"));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b[0] + b[2] / 2, y: b[1] + b[3] / 2, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: b[0] + b[2] / 2, y: b[1] + b[3] / 2, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b[0] + b[2] / 2 + i * 12, y: b[1] + b[3] / 2 - i * 3, button: "left", buttons: 1 });
    await sleep(30);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b[0] + b[2] / 2 + 72, y: b[1] + b[3] / 2 - 18, button: "left", buttons: 0, clickCount: 1 });
  await sleep(500);
  console.log("3d drag", await E(`JSON.stringify({view:MR.state.view,labels:[...document.querySelectorAll('#surfaceLabels .slab')].filter(d=>d.style.display!=='none').length,drill:MR.Drill.isOpen()})`));
  await shot("shot_final_3d.png");

  console.log("ERRORS", errors.length, JSON.stringify(errors.slice(0, 8)));
  ws.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
