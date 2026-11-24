/* 验证桌面 exe：无边框窗口、单一关闭按钮、圆角，且页面内 ✕ 真正关闭窗口 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const EXE = 'D:\\个人\\桌面\\DONGENS博图仿真教学版-v1.0.0.exe';
const CP = 9355;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  const p = spawn(EXE, ['--remote-debugging-port=' + CP], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) break;
    } catch (e) { }
  }
  if (!t || !t.length) { console.log('FAIL: CDP 连不上'); p.kill(); process.exit(1); }

  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300);
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await sleep(2500);

  console.log('desktop 模式 =', await ev(`document.body.classList.contains('desktop')`));
  console.log('tiaWin 可用  =', await ev(`!!(window.tiaWin && window.tiaWin.isDesktop)`));
  console.log('标题栏按钮   =', await ev(`Array.prototype.map.call(document.querySelectorAll('.win-btns div'), function(d){return d.title}).join('/')`));

  // 截图：整窗（含圆角）
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/v52-frameless-window.png', Buffer.from(shot.result.data, 'base64'));
  console.log('截图已存 docs/v52-frameless-window.png');

  // 点页面内的"关闭"按钮 —— 应触发 IPC 真正关掉窗口
  await ev(`(function(){ var d=document.querySelector('.win-btns div[title="关闭"]'); d.click(); return 'clicked'; })()`);
  await sleep(2000);
  const closed = p.killed || (function () { try { process.kill(p.pid, 0); return false; } catch (e) { return true; } })();
  console.log('点 ✕ 后进程已退出 =', closed);
  if (!closed) p.kill();
  process.exit(closed ? 0 : 1);
})();
