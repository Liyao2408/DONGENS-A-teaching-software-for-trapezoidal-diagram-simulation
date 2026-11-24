/* 截图：定时器盒体不再被分支竖线压住（docs/v47-branch-clear.png）
 * 网络1 = 用户截图那个网络（触点 → TON + 同列开口分支）
 * 网络2 = 两行定时器（TON / TOF），框外 PT 值都在自己格子里
 * 运行：先 node tmp-serve.js，再 node snap-branch-clear.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9960 + Math.floor(Math.random() * 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snapclear' + Date.now()),
    '--window-size=1680,1400', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
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
      {title:'框外 PT 值有自己的位置，不再压在分支竖线上',columns:[
        {branches:[[{id:'c1',type:'NO',operand:'Q0.1',addr:'Q0.1'}]]},
        {branches:[
          [{id:'t1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#1s'}}],
          [{id:'e1',type:'OPEN_END'}]
        ]}
      ]},
      {title:'上下两个定时器：行距按盒体高度算，值框和 PT 值都不打架',columns:[{branches:[
        [{id:'t2',type:'TON',instance:'TON_2',db:3,params:{PT:'T#4s'}}],
        [{id:'t3',type:'TOF',instance:'TOF_DB',db:2,params:{PT:'T#4s'}}]
      ]}]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(800);

  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1600);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(900);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);
  await ev(`(function(){
    App.monitor=true; App.online=true;
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(500);
  await ev(`(function(){
    var st=TIA.plc.timers, k;
    TIA.plc.step(TIA.project);
    for(k in st){ if(/:(t2)$/.test(k)) st[k].start = TIA.plc.clock - 3200; }
    TIA.plc.step(TIA.project);
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(700);

  const rect = await ev(`(function(){
    var ns=document.querySelectorAll('.network');
    if(!ns.length) return null;
    var L=1e9,T=1e9,R=-1e9,B=-1e9;
    [].forEach.call(ns,function(n){
      var r=n.getBoundingClientRect();
      if(r.width<5) return;
      L=Math.min(L,r.left);T=Math.min(T,r.top);R=Math.max(R,r.right);B=Math.max(B,r.bottom);
    });
    if(R<L) return null;
    L=Math.max(0,L-6);T=Math.max(0,T-6);R=Math.min(1670,R+6);B=Math.min(1390,B+6);
    return {x:L,y:T,w:R-L,h:B-T};
  })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1.6 } });
  fs.writeFileSync('docs/v47-branch-clear.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v47-branch-clear.png', rect);

  ws.close(); killTree(p); process.exit(0);
})();
