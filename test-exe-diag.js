/* 诊断：.win-btns 在桌面窗口里的实际几何/样式 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const EXE = 'D:\\个人\\桌面\\DONGENS博图仿真教学版-v1.0.0.exe';
const CP = 9356;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  const p = spawn(EXE, ['--remote-debugging-port=' + CP], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list')); t = l.filter(x => x.url.includes('index.html')); if (t.length) break; } catch (e) { }
  }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m2, pa = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: pa })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'THROW' : r.result?.result?.value; };
  await send('Runtime.enable');
  await sleep(2500);
  console.log(JSON.stringify(await ev(`(function(){
    var bar=document.querySelector('.titlebar');
    var wb=document.querySelector('.win-btns');
    var br=bar.getBoundingClientRect(), wr=wb.getBoundingClientRect();
    var cs=getComputedStyle(wb);
    return {barW:br.width, barRight:br.right, wbX:wr.x, wbW:wr.width, wbRight:wr.right,
            wbDisplay:cs.display, wbVis:cs.visibility, wbZ:cs.zIndex,
            innerW:window.innerWidth, dpr:window.devicePixelRatio,
            barHTMLlen: bar.innerHTML.length};
  })()`), null, 1));
  p.kill();
  process.exit(0);
})();
