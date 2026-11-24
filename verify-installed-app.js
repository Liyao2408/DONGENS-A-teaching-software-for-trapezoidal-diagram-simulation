/* verify-installed-app.js — 启动桌面已安装的 DONGENS.exe，验证变量表删除功能
   用法：node verify-installed-app.js
*/
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const EXE = 'D:\\个人\\桌面\\dongens\\DONGENS.exe';
const SHOT = path.join(__dirname, 'docs', 'installed-tag-menu.png');
const CP = 9555;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EXE, ['--remote-debugging-port=' + CP], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list'));
      t = l.filter(x => x.url && x.url.includes('index.html'));
      if (t.length) break;
    } catch (e) { }
  }
  if (!t || !t.length) { console.log('NO TARGET'); killTree(p); process.exit(1); }

  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(); const errs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push('EXC:' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 200));
  });
  const send = (me, pa = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'THROW:' + ((r.result.exceptionDetails.exception || {}).description || '').slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable'); await send('Page.enable');

  for (let k = 0; k < 60; k++) { await sleep(500); if (await ev(`!!document.querySelector('#portalTable tr[data-id]')`) === true) break; }
  await ev(`(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev(`!!document.querySelector('#treeBody [data-node="tags:0"]')`) === true) break; }
  await ev(`document.querySelector('#treeBody [data-node="tags:0"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!document.querySelector('#editorArea .tag-grid')`) === true) break; }

  const n0 = await ev(`document.querySelectorAll('#editorArea .tag-grid tr[data-tag]').length`);
  const t0 = await ev(`App.project.tags.length`);
  console.log('变量表行数:', n0, ' tags:', t0);
  console.log('行号选中:', await ev(`(function(){var tr=document.querySelectorAll('#editorArea .tag-grid tr[data-tag]')[1];tr.querySelector('td.num').dispatchEvent(new MouseEvent('click',{bubbles:true}));return tr.classList.contains('sel');})()`));
  console.log('右键菜单:', await ev(`(function(){var tr=document.querySelectorAll('#editorArea .tag-grid tr[data-tag]')[1];tr.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:230}));return !!document.getElementById('rackMenu');})()`));
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('截图:', SHOT);
  console.log('菜单删除后 tags:', await ev(`(function(){var m=document.getElementById('rackMenu');if(!m)return 'no menu';var it=Array.prototype.filter.call(m.querySelectorAll('.lm-item'),function(x){return x.textContent.indexOf('删除')>=0;})[0];if(!it)return 'no item';it.click();return App.project.tags.length;})()`), '(期望 ' + (t0 - 1) + ')');
  console.log('Delete键删除后:', await ev(`(function(){var tr=document.querySelectorAll('#editorArea .tag-grid tr[data-tag]')[0];tr.querySelector('td.num').dispatchEvent(new MouseEvent('click',{bubbles:true}));var n=App.project.tags.length;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));return App.project.tags.length+' (期望 '+(n-1)+')';})()`));
  console.log('页面异常:', errs.length ? errs.slice(0, 3) : '无');
  killTree(p);
  await sleep(1500);
  process.exit(0);
})();
