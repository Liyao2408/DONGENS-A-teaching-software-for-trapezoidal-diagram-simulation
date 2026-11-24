/* 启动耗时测量：exe 拉起 -> CDP 目标出现(解压+进程初始化) -> DOMContentLoaded -> load -> 门户可见 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const EXE = 'D:\\个人\\桌面\\DONGENS博图仿真教学版-v1.0.0.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

async function measure(label, port) {
  const t0 = Date.now();
  const p = spawn(EXE, ['--remote-debugging-port=' + port], { stdio: 'ignore' });
  let tTarget = null, t = null;
  for (let i = 0; i < 120; i++) {
    if (Date.now() - t0 > 60000) break;
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + port + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) { tTarget = Date.now() - t0; break; }
    } catch (e) { }
    await sleep(250);
  }
  const rec = { label, tTargetMs: tTarget };
  if (t && t.length) {
    const ws = new WebSocket(t[0].webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    let id = 0; const pend = new Map();
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (m2, pa = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: pa })); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'THROW:' + JSON.stringify(r.result.exceptionDetails) : r.result?.result?.value; };
    await send('Runtime.enable');
    // 等 load 完成
    for (let i = 0; i < 120; i++) { const rs = await ev('document.readyState'); if (rs === 'complete') break; await sleep(250); }
    rec.tLoadMs = Date.now() - t0;
    const info = await ev(`(function(){
      var n = performance.getEntriesByType('navigation')[0];
      var portal = document.getElementById('portal');
      var vis = portal ? getComputedStyle(portal).display : 'none';
      var btnVis = (function(){var b=document.querySelector('.titlebar .win-btns');return b?getComputedStyle(b).display:'none';})();
      return { navStart: n.startTime, domContent: n.domContentLoadedEventEnd, loadEnd: n.loadEventEnd,
               resourceCount: performance.getEntriesByType('resource').length,
               transferMB: +(performance.getEntriesByType('resource').reduce(function(s,r){return s+(r.transferSize||0);},0)/1048576).toFixed(2),
               portalDisplay: vis, winBtns: btnVis, now: performance.now() };
    })()`);
    rec.page = info;
  }
  try { p.kill(); } catch (e) { }
  await sleep(1500);
  return rec;
}

(async () => {
  const r1 = await measure('第1次(冷启动)', 9441);
  console.log(JSON.stringify(r1, null, 1));
  const r2 = await measure('第2次(系统缓存热)', 9442);
  console.log(JSON.stringify(r2, null, 1));
  process.exit(0);
})();
