/* E2E：在并联分支里插入器件时，同列另一行的元件不能被往后推（不能靠拉伸填满列宽）
 *
 * 场景（对应截图）：主行 1 个触点，下面那条支路 3 个元件，再往后是 TON。
 * 旧实现按比例把每条分支拉伸到列宽 → 主行那个触点被推到列尾，前面留一大片空线，
 * 于是"在下面加一个器件，上面那行的器件整体往后挪、上面空出一块没有器件的空间"。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9460 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'bg' + Date.now()), '--window-size=1500,1000',
    'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 70; i++) {
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
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || '').slice(0, 300));
  });
  const send = (m2, p2 = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: p2 })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || '').slice(0, 300);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');
  const R = []; const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 60; k++) { await sleep(250); if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length>0") === true) break; }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }
  await ev("(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()");
  await sleep(300);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(600);

  // 主行 1 个触点；支路 1 个触点（后面再往里加两个）
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'gap',columns:[
      {branches:[[{id:'a0',type:'NO',operand:'M1.0',addr:'M1.0'}]]},
      {branches:[
        [{id:'m1',type:'NO',operand:'M1.1',addr:'M1.1'}],
        [{id:'b1',type:'NO',operand:'M1.2',addr:'M1.2'},{id:'bo',type:'OPEN_END'}]
      ]},
      {branches:[[{id:'tn',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#10s'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true}); return 'ok';
  })()`);
  await sleep(600);

  const cells = async () => JSON.parse(await ev(`(function(){
    var o={};
    document.querySelectorAll('.network[data-net="0"] .lad-el').forEach(function(g){
      var h=g.querySelector('.hit'); if(!h) return;
      o[g.getAttribute('data-el')]={x:+h.getAttribute('x'), w:+h.getAttribute('width'), y:+h.getAttribute('y')};
    });
    return JSON.stringify(o);
  })()`));

  let c0 = await cells();
  console.log('初始: m1.x=' + c0.m1.x + ' b1.x=' + c0.b1.x);
  ck('主线元件与支路元件同列左对齐（都贴在列首）',
    Math.abs(c0.m1.x - c0.b1.x) <= 1, 'm1=' + c0.m1.x + ' b1=' + c0.b1.x);
  ck('主线元件没被推到列尾（单元格不占满整列）',
    c0.m1.w < 100, 'w=' + c0.m1.w);

  // 往支路里加两个器件（模拟用户在箭头位置连点两次）
  await ev(`(function(){
    var net=TIA.project.blocks[0].networks[0];
    LadEdit.setSelection('b1');
    LadEdit.appendInstruction('NO');
    return true;
  })()`);
  await sleep(500);
  await ev("(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();document.querySelectorAll('.modal-mask,.modal').forEach(function(m){m.style.display='none';});return true;})()");
  await ev(`(function(){
    var net=TIA.project.blocks[0].networks[0];
    var br=net.columns[1].branches[1];
    var last=br[br.length-2];
    LadEdit.setSelection(last.id);
    LadEdit.appendInstruction('NO');
    return true;
  })()`);
  await sleep(600);
  await ev("(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();document.querySelectorAll('.modal-mask,.modal').forEach(function(m){m.style.display='none';});return true;})()");

  const c1 = await cells();
  console.log('加两个后: m1.x=' + c1.m1.x + ' b1.x=' + c1.b1.x);
  ck('支路变长后主线元件位置不变（不再"整体往后挪"）',
    Math.abs(c1.m1.x - c0.m1.x) <= 1, c0.m1.x + ' → ' + c1.m1.x);
  ck('支路里确实多出了两个元件',
    await ev('TIA.project.blocks[0].networks[0].columns[1].branches[1].length') === 4,
    '长度=' + await ev('TIA.project.blocks[0].networks[0].columns[1].branches[1].length'));

  // 主线元件右边到列尾之间必须有导线（不能是空白断口）
  ck('主线元件右边到列尾是连续的导线（没有断口）', await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    var h=document.querySelector('.network[data-net="0"] .lad-el[data-el="m1"] .hit');
    if(!svg||!h) return false;
    var y=+h.getAttribute('y')+ +h.getAttribute('height')/2;
    var from=+h.getAttribute('x')+ +h.getAttribute('width'), to=+h.getAttribute('x')+520;
    // 这一行上，[from,to] 区间内必须有水平线段覆盖
    var cover=0;
    svg.querySelectorAll('line').forEach(function(l){
      if(l.getAttribute('y1')!==l.getAttribute('y2')) return;
      if(Math.abs(+l.getAttribute('y1')-y)>1) return;
      var x1=+l.getAttribute('x1'), x2=+l.getAttribute('x2');
      if(x2>=from && x1<=to) cover++;
    });
    return cover>0;
  })()`));

  // 编译仍然通过
  await ev(`(function(){
    var net=TIA.project.blocks[0].networks[0];
    var i=0;
    net.columns.forEach(function(c){c.branches.forEach(function(b){b.forEach(function(e){
      if(e.type==='NO' && !e.operand){ e.operand='M2.'+(++i); e.addr='M2.'+i; }
    });});});
    LadEdit.rerender({keepScroll:true}); return true;
  })()`);
  await sleep(400);
  await ev('document.querySelector(".tb[data-act=compile]").click()');
  await sleep(600);
  const errs = await ev('TIA.diags.filter(function(d){return d.level==="error";}).length');
  ck('结构改动后编译通过', errs === 0, 'errors=' + errs);

  ws.close(); killTree(p);
  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 5).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + ' / ' + R.length);
  process.exit(pass === R.length ? 0 : 1);
})();
