/* 截图：置位 / 复位线圈（docs/v43-sr-coil.png）
 * 运行：先 node tmp-serve.js，再 node snap-sr.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9910 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snapsr' + Date.now()),
    '--window-size=1680,1400', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) break;
    } catch (e) { }
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

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  await ev(`(function(){
    var pr=TIA.project;
    if(!pr.tags.some(function(t){return t.address==='M0.7';})) pr.tags.push({name:'Tag_6',address:'M0.7',datatype:'Bool'});
    var ob1=pr.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'置位：按下一次就自锁',columns:[{branches:[[
        {id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'},
        {id:'s1',type:'SET',operand:'Tag_6',addr:'M0.7'}
      ]]}],comment:'-(S)- 通一下电 → M0.7 置 1 并保持'},
      {title:'自锁后的触点',columns:[{branches:[[
        {id:'c2',type:'NO',operand:'Tag_6',addr:'M0.7'},
        {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}
      ]]}],comment:'松开按钮，M0.7 仍是 1，线圈继续得电'},
      {title:'复位：同名点位清 0',columns:[{branches:[[
        {id:'c3',type:'NO',operand:'I0.1',addr:'I0.1'},
        {id:'r1',type:'RESET',operand:'Tag_6',addr:'M0.7'}
      ]]}],comment:'-(R)- 通一下电 → 把 M0.7 的置位解开'}
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

  // 按一下 I0.0 再松开 → M0.7 应该保持
  await ev(`(function(){
    TIA.plc.write('I0.0',true);
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    TIA.plc.write('I0.0',false);
    for(var j=0;j<5;j++) TIA.plc.step(TIA.project);
    App.monitor=true; App.online=true;
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(800);

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
    L=Math.max(0,L-8);T=Math.max(0,T-8);R=Math.min(1670,R+8);B=Math.min(1390,B+8);
    return {x:L,y:T,w:R-L,h:B-T};
  })()`);
  const clip = rect ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } : undefined;
  const s = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  fs.writeFileSync('docs/v43-sr-coil.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v43-sr-coil.png', rect);
  console.log('M0.7 =', await ev(`TIA.plc.readBool('M0.7')`), ' Q0.0 =', await ev(`TIA.plc.readBool('Q0.0')`));

  ws.close(); killTree(p); process.exit(0);
})();
