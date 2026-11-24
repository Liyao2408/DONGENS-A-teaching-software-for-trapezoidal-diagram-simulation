/* snap-pinport.js — 出图：docs/v51-pin-port.png
 * 画面内容：两个网络对照 ——
 *   上面：CTU 的 R 脚小方块是空心的（还没接支路）
 *   下面：R 脚接了触点支路，小方块变实心（已连接）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9830 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'snapport' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + String((r.result.exceptionDetails.exception || {}).description || '').slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  console.log(await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'R 脚还没接支路（空心方块）',columns:[
        {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
        {branches:[[{id:'u1',type:'CTU',instance:'CTU_DB',params:{PV:'5'}}]]}
      ]},
      {title:'R 脚接了触点支路（实心方块）',columns:[
        {branches:[[{id:'c2',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
        {branches:[[{id:'u2',type:'CTU',instance:'CTU_DB_1',params:{PV:'5'},
          pins:{R:[{id:'pr1',type:'NO',operand:'I0.1',addr:'I0.1'}]}}]]}
      ]}
    ];
    LadEdit.rerender({keepScroll:true});
    return 'ok';
  })()`));
  await sleep(900);

  const box = await ev(`(function(){
    var ns=document.querySelectorAll('.network');
    if(ns.length<2) return null;
    var a=ns[0].getBoundingClientRect(), b=ns[1].getBoundingClientRect();
    var top=Math.min(a.top,b.top), bot=Math.max(a.bottom,b.bottom);
    return JSON.stringify({x:a.left,y:top,width:Math.max(a.width,b.width),height:bot-top});
  })()`);
  let clip = {};
  try {
    const b = JSON.parse(box);
    if (b) clip = {
      x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 16),
      width: Math.min(1080, b.width + 24), height: Math.min(520, b.height + 32), scale: 2
    };
  } catch (e) { }
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: clip });
  const out = path.join(__dirname, 'docs', 'v51-pin-port.png');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved ' + out);

  /* 第二张：监视模式下 R 支路上的触点闭合 → 整条支路导线变绿（含起点小圆点） */
  console.log(await ev(`(function(){
    App.monitor=true; App.online=true; App.running=true;
    TIA.plc.write('I0.1',true);
    for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
    LadEdit.rerender({keepScroll:true});
    App.refreshLive();
    return 'monitor ok';
  })()`));
  await sleep(800);
  const box2 = await ev(`(function(){
    var n=document.querySelectorAll('.network')[1];
    if(!n) return null;
    var r=n.getBoundingClientRect();
    return JSON.stringify({x:r.left,y:r.top,width:r.width,height:r.height});
  })()`);
  let clip2 = {};
  try {
    const b = JSON.parse(box2);
    if (b) clip2 = {
      x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10),
      width: Math.min(900, b.width + 20), height: Math.min(260, b.height + 20), scale: 2
    };
  } catch (e) { }
  const shot2 = await send('Page.captureScreenshot', { format: 'png', clip: clip2 });
  const out2 = path.join(__dirname, 'docs', 'v51-pin-live.png');
  fs.writeFileSync(out2, Buffer.from(shot2.result.data, 'base64'));
  console.log('saved ' + out2);
  ws.close(); try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
