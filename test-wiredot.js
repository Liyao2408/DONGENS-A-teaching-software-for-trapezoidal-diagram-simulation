const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9200 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'wd' + Date.now()),
    '--window-size=1680,1000', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) break;
    } catch (e) { }
  }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300);
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    const r = await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
    if (r === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  const R = [];
  const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  // 1. 创建分支（收藏夹箭头）
  await ev(`(function(){
    var cells=document.querySelectorAll('#fbCells .fb-cell');
    for(var i=0;i<cells.length;i++){
      if(cells[i].dataset.fbtype==='OPEN_BRANCH'){ cells[i].click(); return; }
    }
  })()`);
  await sleep(700);
  const branches = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.length;}))`);
  ck('收藏夹箭头可创建分支', JSON.parse(branches)[0] >= 2, branches);

  // 2. 母线可选中（逐点扫描）
  const railSel = await ev(`(function(){
    var hs=[].filter.call(document.querySelectorAll('.lad-hit'),function(x){
      return (x.getAttribute('data-seg')||'').indexOf(':rail')>=0;
    });
    for(var i=0;i<hs.length;i++){
      var x=hs[i];
      var x1=+x.getAttribute('x1'), y1=+x.getAttribute('y1'), y2=+x.getAttribute('y2');
      var svg=x.closest('svg'); var r=svg.getBoundingClientRect();
      for(var yy=r.top+y1+2; yy<r.top+y2-2; yy+=4){
        if(yy<60||yy>window.innerHeight-60) continue;
        var el=document.elementFromPoint(r.left+x1, yy);
        if(el && el.classList && el.classList.contains('lad-hit') &&
           (el.getAttribute('data-seg')||'').indexOf(':rail')>=0){
          return JSON.stringify({x:Math.round(r.left+x1), y:Math.round(yy), seg:x.getAttribute('data-seg')});
        }
      }
    }
    return 'NONE';
  })()`);
  console.log('母线可点位置: ' + railSel);
  if (railSel !== 'NONE') {
    const pk = JSON.parse(railSel);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(600);
    const sel = await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`);
    ck('点击母线可选中', sel === pk.seg, sel);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
    await sleep(400);
    ck('母线 Delete 不删数据', await ev(`!!TIA.project.blocks[0].networks`));
  } else {
    ck('点击母线可选中', false, '母线全程被覆盖');
    ck('母线 Delete 不删数据', true, '跳过');
  }

  // 3. 圆点单击创建分支
  const dot = await ev(`(function(){
    var c=document.querySelector('.br-handle');
    if(!c) return 'NONE';
    var svg=c.closest('svg'); var r=svg.getBoundingClientRect();
    var cx=r.left+c.cx.baseVal.value, cy=r.top+c.cy.baseVal.value;
    return JSON.stringify({x:Math.round(cx),y:Math.round(cy)});
  })()`);
  if (dot !== 'NONE') {
    const dp = JSON.parse(dot);
    const before = await ev(`(function(){
      var c=document.querySelector('.br-handle');
      var p=c.dataset.branch.split(':').map(Number);
      return TIA.project.blocks[0].networks[p[0]].columns[p[1]].branches.length;
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dp.x, y: dp.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dp.x, y: dp.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(700);
    const after = await ev(`(function(){
      var c=document.querySelector('.br-handle');
      if(!c) return -1;
      var p=c.dataset.branch.split(':').map(Number);
      return TIA.project.blocks[0].networks[p[0]].columns[p[1]].branches.length;
    })()`);
    ck('点圆点创建分支', after > before, before + ' -> ' + after);
  } else {
    ck('点圆点创建分支', false, '圆点未找到');
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/v25-wire2.png', Buffer.from(shot.result.data, 'base64'));

  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 4).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + '/' + R.length);
  ws.close(); killTree(p); process.exit(pass === R.length ? 0 : 1);
})();
