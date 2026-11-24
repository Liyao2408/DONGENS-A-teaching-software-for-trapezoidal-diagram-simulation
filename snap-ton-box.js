/* 截图：在线监视时盒体上方的"经过的值"值框（docs/v44-ton-vbox.png）
 * 运行：先 node tmp-serve.js，再 node snap-ton-box.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9960 + Math.floor(Math.random() * 30);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snapton' + Date.now()),
    '--window-size=1680,1200', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list')); t = l.filter(x => x.url.includes('index.html')); if (t.length) break; } catch (e) { }
  }
  if (!t || !t.length) { console.log('NO TARGET'); process.exit(1); }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + (((r.result.exceptionDetails || {}).exception || {}).description || '').slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable'); await send('Page.enable');

  for (let k = 0; k < 40; k++) { await sleep(250); if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break; }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'延时通：盒体上方显示经过的值',columns:[{branches:[[
        {id:'c1',type:'NO',operand:'Q0.1',addr:'Q0.1'},
        {id:'t1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#10s'}}
      ]]}],comment:'PT 是设定值，ET 是已过时间；上方值框跟着 ET 走'}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);

  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1600);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(900);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  // 让定时器跑到 ~3.4s（PT=10s，还没到）
  await ev(`(function(){
    TIA.plc.write('Q0.1',true);
    App.monitor=true; App.online=true;
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  await ev(`(function(){
    var st=TIA.plc.timers; for(var k in st){ st[k].start = TIA.plc.clock - 3370; }
    for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(600);
  console.log('vbox =', await ev(`(function(){var t=document.querySelector('[data-tvbox]');return t?t.textContent:'NONE';})()`));

  const rect = await ev(`(function(){
    var n=document.querySelector('.network[data-net="0"]');
    if(!n) return null;
    var r=n.getBoundingClientRect();
    return {x:Math.max(0,r.left-8),y:Math.max(0,r.top-8),w:Math.min(1200,r.width+16),h:Math.min(700,r.height+16)};
  })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } });
  fs.writeFileSync('docs/v44-ton-vbox.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v44-ton-vbox.png', rect);

  ws.close(); killTree(p); process.exit(0);
})();
