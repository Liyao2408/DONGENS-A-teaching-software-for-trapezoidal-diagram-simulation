/* 截图：比较指令取"运行值"——同一个 TON（PT=T#10s）、比较框都填 5（秒）
 *   网络 3：经过值 5.4s → 比较闭合，线圈输出
 *   网络 5：经过值 2.6s → 还没到，比较断开
 * 产出 docs/v46-cmp-running.png
 * 运行：先 node tmp-serve.js，再 node snap-cmp-run.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9985 + Math.floor(Math.random() * 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snaprun' + Date.now()),
    '--window-size=1680,1500', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
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
    var pr=TIA.project;
    if(!pr.tags.some(function(t){return t.address==='Q0.7';})) pr.tags.push({name:'Tag_5',address:'Q0.7',datatype:'Bool'});
    var ob1=pr.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'延时通：PT = T#10s',columns:[{branches:[[
        {id:'ta',type:'TON',instance:'TON_A',db:1,params:{PT:'T#10s'}}]]}]},
      {title:'已经跑到 5.4s：比较 5 成立 → 线圈输出',columns:[{branches:[[
        {id:'ka',type:'CMP_GE',params:{IN1:'"TON_A".PT',IN2:'5',TYPE:'Time'}},
        {id:'sa',type:'COIL',operand:'Q0.7',addr:'Q0.7'}]]}]},
      {title:'延时通：PT 同样 T#10s',columns:[{branches:[[
        {id:'tb',type:'TON',instance:'TON_B',db:3,params:{PT:'T#10s'}}]]}]},
      {title:'才跑到 2.6s：还没到 5 → 比较断开，没有输出',columns:[{branches:[[
        {id:'kb',type:'CMP_GE',params:{IN1:'"TON_B".PT',IN2:'5',TYPE:'Time'}},
        {id:'sb',type:'COIL',operand:'Q1.0',addr:'Q1.0'}]]}]}
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
  await sleep(600);
  await ev(`(function(){
    var st=TIA.plc.timers, k;
    for(k in st){ if(/:(ta|tb)$/.test(k)) delete st[k]; }
    TIA.plc.step(TIA.project);                 // 先跑一拍，建立实例状态
    for(k in st){
      if(/:(ta)$/.test(k)) st[k].start = TIA.plc.clock - 5400;
      if(/:(tb)$/.test(k)) st[k].start = TIA.plc.clock - 2600;
    }
    TIA.plc.step(TIA.project);
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(700);
  console.log('Q0.7 =', await ev(`TIA.plc.read('Q0.7')`), ' Q1.0 =', await ev(`TIA.plc.read('Q1.0')`));
  console.log('cmpbox =', await ev(`document.querySelectorAll('[data-cmpbox]').length`));

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
    L=Math.max(0,L-8);T=Math.max(0,T-8);R=Math.min(1670,R+8);B=Math.min(1490,B+8);
    return {x:L,y:T,w:R-L,h:B-T};
  })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } });
  fs.writeFileSync('docs/v46-cmp-running.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v46-cmp-running.png', rect);

  ws.close(); killTree(p); process.exit(0);
})();
