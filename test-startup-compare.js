/* 对比：安装版 vs portable版 启动耗时 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const APPS = {
  installed: 'C:\\Users\\yulih\\AppData\\Local\\Programs\\DONGENS\\DONGENS.exe',
  portable: 'D:\\个人\\桌面\\1dongens\\release\\DONGENS 1.0.0.exe'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

async function measure(label, exe, port) {
  const t0 = Date.now();
  const p = spawn(exe, ['--remote-debugging-port=' + port], { stdio: 'ignore' });
  let tTarget = null, t = null;
  for (let i = 0; i < 240; i++) {
    if (Date.now() - t0 > 60000) break;
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + port + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) { tTarget = Date.now() - t0; break; }
    } catch (e) { }
    await sleep(100);
  }
  const rec = { label, exe: exe.split('\\').pop(), windowReadyMs: tTarget };
  if (t && t.length) {
    const ws = new WebSocket(t[0].webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    let id = 0; const pend = new Map();
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (m2, pa = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: pa })); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? null : r.result?.result?.value; };
    await send('Runtime.enable');
    for (let i = 0; i < 200; i++) { const rs = await ev('document.readyState'); if (rs === 'complete') break; await sleep(100); }
    rec.pageLoadedMs = Date.now() - t0;
  }
  try { p.kill('SIGKILL'); } catch (e) { }
  await sleep(4000);
  return rec;
}

(async () => {
  // 各测2次（第1次冷、第2次系统缓存热）
  const results = [];
  for (const key of Object.keys(APPS)) {
    results.push(await measure(key + ' 第1次(冷)', APPS[key], 9451 + results.length));
    results.push(await measure(key + ' 第2次(热)', APPS[key], 9451 + results.length));
  }
  results.forEach(r => console.log(JSON.stringify(r)));
  process.exit(0);
})();
