/* tmp-probe2.js — 排查：R 字被小方块遮挡的真实几何（用完删） */
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
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'probe2' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + String((r.result.exceptionDetails.exception || {}).description || '').slice(0, 300);
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
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'u1',type:'CTU',instance:'CTU_DB',params:{PV:'5'},
        pins:{R:[{id:'pr1',type:'NO',operand:'I0.1',addr:'I0.1'}]}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return 'ok';
  })()`));
  await sleep(900);

  console.log(await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var pad=net.querySelector('[data-pin-port]');
    var rTxt=null;
    [].forEach.call(net.querySelectorAll('text'),function(t){
      if(t.textContent==='R' && !rTxt) rTxt=t;
    });
    function box(n){ if(!n) return null;
      var b=n.getBBox?n.getBBox():null;
      return {x:+n.getAttribute('x'),y:+n.getAttribute('y'),
        w:+n.getAttribute('width')||0,h:+n.getAttribute('height')||0,
        bbox:b?{x:b.x,y:b.y,w:b.width,h:b.height}:null,
        fs:n.getAttribute('font-size')}; }
    return JSON.stringify({pad:box(pad),rtxt:box(rTxt),
      rtxtX:rTxt?+rTxt.getAttribute('x'):null, rtxtY:rTxt?+rTxt.getAttribute('y'):null,
      padRight:pad?(+pad.getAttribute('x')+ +pad.getAttribute('width')):null},null,1);
  })()`));

  const box = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var pad=net.querySelector('[data-pin-port]');
    if(!pad) return null;
    var r=pad.getBoundingClientRect();
    return JSON.stringify({x:r.left-90,y:r.top-60,width:220,height:150});
  })()`);
  let clip = {};
  try { const b = JSON.parse(box); if (b) clip = { ...b, scale: 4 }; } catch (e) { }
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: clip });
  fs.writeFileSync(path.join(__dirname, 'docs', 'tmp-probe2.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('saved');
  ws.close(); try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
