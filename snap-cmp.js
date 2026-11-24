/* 截一张图：比较指令下面填的数字（按秒 / 两位小数 / 超限标红）
 * 运行：先 node tmp-serve.js，再 node snap-cmp.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9900 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'snapcmp' + Date.now()),
    '--window-size=1680,1500', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });

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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + ((r.result.exceptionDetails.exception || {}).description || '').slice(0, 300);
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
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'TON 的 PT = T#10s（能取到的上限）',columns:[{branches:[[
        {id:'t1',type:'TON',instance:'T1',db:1,params:{PT:'T#10s'}}
      ]]}],comment:'PT 最大就到 10s'},
      {title:'下面填 5 合法；填 11 超过上限 → 标红',columns:[{branches:[
        [{id:'k1',type:'CMP',params:{IN1:'"T1".PT',IN2:'5',TYPE:'Time'}},
         {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}],
        [{id:'k2',type:'CMP',params:{IN1:'"T1".PT',IN2:'11',TYPE:'Time'}},
         {id:'o2',type:'COIL',operand:'Q0.1',addr:'Q0.1'}]
      ]}],comment:'裸数字按秒算：5 = T#5s；11 永远等不到 → 标红＋编译报错'}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(900);
  // 跑一次编译，让诊断面板显示错误
  await ev(`(function(){var b=document.querySelector('.tb[data-act="compile"]');if(b)b.click();})()`);
  await sleep(900);

  // 只截编辑器区域（所有网络 + 诊断面板的并集）
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
    L=Math.max(0,L-8);T=Math.max(0,T-8);R=Math.min(1670,R+8);B=Math.min(995,B+8);
    return {x:L,y:T,w:R-L,h:B-T};
  })()`);
  const clip = rect ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } : undefined;
  const s = await send('Page.captureScreenshot', clip ? { format: 'png', clip, captureBeyondViewport: true } : { format: 'png' });
  fs.writeFileSync('docs/v42-cmp-num.png', Buffer.from(s.result.data, 'base64'));
  console.log('saved docs/v42-cmp-num.png', rect);

  ws.close(); killTree(p); process.exit(0);
})();
