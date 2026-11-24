/* 截图：置位线圈自锁后线圈本身变绿（docs/v48-set-coil-green.png）
 * 网络1 R 线圈、网络2 S 线圈都写 M12.0；按一下 M10.2 → 置位并保持，S 线圈变绿
 * 运行：先 node tmp-serve.js，再 node snap-set-green.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9978 + Math.floor(Math.random() * 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snapgreen' + Date.now()),
    '--window-size=1680,1300', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
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

  // 和用户截图一样：上面一行 R、下面一行 S，都写 M12.0
  await ev(`(function(){
    var pr=TIA.project;
    ['M10.3','M10.2','M12.0'].forEach(function(a){
      if(!pr.tags.some(function(t){return t.address===a;})) pr.tags.push({name:'Tag_'+a.replace('.','_'),address:a,datatype:'Bool'});
    });
    var ob1=pr.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'',columns:[
        {branches:[[{id:'c1',type:'NO',operand:'M10.3',addr:'M10.3'}]]},
        {branches:[[{id:'r1',type:'RESET',operand:'M12.0',addr:'M12.0'}]]}
      ]},
      {title:'通一下电就置位，松开后自己保持 —— 线圈保持绿色',columns:[
        {branches:[[{id:'c2',type:'NO',operand:'M10.2',addr:'M10.2'}]]},
        {branches:[[{id:'s1',type:'SET',operand:'M12.0',addr:'M12.0'}]]}
      ]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(800);

  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1700);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(1000);
  // 下载完会跳到仿真面板：像用户那样点回 OB1，并打开监视
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(800);
  await ev(`(function(){
    App.monitor=true; App.online=true;
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(500);
  // 按一下 M10.2（置位），随后松开，看线圈是否保持绿色
  const seq = await ev(`(function(){
    TIA.plc.write('M10.2',true);
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    TIA.plc.write('M10.2',false);
    for(var j=0;j<6;j++) TIA.plc.step(TIA.project);
    App.refreshLive();
    var g=document.querySelector('.network .lad-el[data-type="SET"]');
    var b=g?g.querySelector('.lad-body'):null;
    return JSON.stringify({m12:TIA.plc.readBool('M12.0'), cls:g?g.getAttribute('class'):'',
      stroke:b?getComputedStyle(b).stroke:''});
  })()`);
  console.log('state =', seq);
  await sleep(600);
  await ev(`(function(){ App.refreshLive(); return true; })()`);
  await sleep(400);

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
    L=Math.max(0,L-6);T=Math.max(0,T-6);R=Math.min(1670,R+6);B=Math.min(1290,B+6);
    return {x:L,y:T,w:R-L,h:B-T};
  })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 } });
  fs.writeFileSync('docs/v48-set-coil-green.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v48-set-coil-green.png', rect);

  ws.close(); killTree(p); process.exit(0);
})();
