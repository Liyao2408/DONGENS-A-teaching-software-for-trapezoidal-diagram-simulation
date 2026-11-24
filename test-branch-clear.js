/* E2E：定时器/计数器盒体不能被"分支竖线 / 相邻元件的值"压住
 *
 * 用户现场（截图）：Q0.1 触点后面接 TON，TON 这一列还挂着一条开口分支，
 * 框外的 PT 值（T#1s）正好写在格子的最左边，被那条分支竖线压住 / 贴着。
 *
 * 原因：定时器盒体以前和普通盒体一样只留 12px 引线，框外值只能往外溢，
 * 正好溢出到列边界上，而分支竖线就画在列边界上。
 *
 * 断言（全部用屏幕坐标量，不写死像素）：
 *   1) 框外 PT 值和分支竖线之间至少留 12px
 *   2) 没有竖线穿过盒体内部
 *   3) 框外 PT 值完整落在自己这一列里（不越过列左边界）
 *   4) TON 放在分支行（第 2 行）时同样满足 1)~3)
 *   5) 计数器的 PV 值同样不被竖线压住
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-branch-clear.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9600 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'bclear' + Date.now()), '--window-size=1500,1000',
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
  if (!t || !t.length) { console.log('NO TARGET（先起 tmp-serve.js）'); process.exit(1); }
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
  const R = []; const ck = (n, c, x) => { R.push(!!c); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 60; k++) { await sleep(250); if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length>0") === true) break; }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }
  await ev("(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()");
  await sleep(300);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(700);

  const setNets = async (json) => {
    await ev(`(function(){
      var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
      ob1.networks=${json};
      LadEdit.rerender({keepScroll:true});
      return true;
    })()`);
    await sleep(600);
  };

  /* 量一量：竖线、盒体、框外值文字。全部返回屏幕坐标 */
  const probe = async (netIdx) => ev(`(function(){
    var root=document.querySelector('.network[data-net="${netIdx}"]');
    if(!root) return 'NO NET';
    var svg=root.querySelector('svg');
    if(!svg) return 'NO SVG';
    var out={vert:[],bodies:[],vals:[]};
    [].forEach.call(svg.querySelectorAll('line'),function(l){
      var x1=+l.getAttribute('x1'), y1=+l.getAttribute('y1');
      var x2=+l.getAttribute('x2'), y2=+l.getAttribute('y2');
      if(!(Math.abs(x1-x2)<0.5 && Math.abs(y2-y1)>6)) return;
      var st=l.getAttribute('stroke')||'';
      if(st==='transparent'||st==='none') return;
      if((l.getAttribute('class')||'').indexOf('lad-hit')>=0) return;
      var b=l.getBoundingClientRect();
      out.vert.push({x:Math.round(b.left+b.width/2), y1:Math.round(Math.min(b.top,b.bottom)),
                     y2:Math.round(Math.max(b.top,b.bottom))});
    });
    [].forEach.call(svg.querySelectorAll('rect.lad-body'),function(r){
      var b=r.getBoundingClientRect();
      // 触点 / 线圈也用 lad-body 那个 class，这里只要"高盒体"（定时器 / 计数器）
      if(b.height < 40) return;
      out.bodies.push({x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)});
    });
    [].forEach.call(svg.querySelectorAll('text'),function(t){
      var pr=t.getAttribute('data-prm')||'';
      if(!/:(PT|PV)$/.test(pr)) return;
      var b=t.getBoundingClientRect();
      out.vals.push({pr:pr,txt:t.textContent,x:Math.round(b.left),y:Math.round(b.top),
                     w:Math.round(b.width),h:Math.round(b.height)});
    });
    return JSON.stringify(out);
  })()`).then(s => { try { return JSON.parse(String(s)); } catch (e) { return { err: String(s) }; } });

  /* 一条竖线有没有压到这块矩形（允许 1px 抗锯齿误差） */
  function pressedVerts(g, r) {
    return (g.vert || []).filter(v =>
      v.x > r.x - 1 && v.x < r.x + r.w + 1 && v.y2 > r.y && v.y1 < r.y + r.h);
  }
  function minGapLeft(g, r) {
    var best = 1e9;
    (g.vert || []).forEach(v => { if (v.x <= r.x) best = Math.min(best, r.x - v.x); });
    return best;
  }

  /* ---------- 场景 1：TON + 同列开口分支（用户截图那个网络） ---------- */
  await setNets(`[{title:'',columns:[
    {branches:[[{id:'c1',type:'NO',operand:'Q0.1',addr:'Q0.1'}]]},
    {branches:[
      [{id:'t1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#1s'}}],
      [{id:'e1',type:'OPEN_END'}]
    ]}
  ]}]`);
  let g1 = await probe(0);
  ck('场景1 能取到盒体和框外 PT 值', g1.bodies && g1.bodies.length === 1 && g1.vals.length === 1, JSON.stringify(g1.err || {b: (g1.bodies || []).length, v: (g1.vals || []).length}));

  const body1 = (g1.bodies || [])[0], pt1 = (g1.vals || [])[0];
  ck('场景1 框外 PT 值和分支竖线至少隔 12px', minGapLeft(g1, pt1) >= 12, 'gap=' + minGapLeft(g1, pt1));
  ck('场景1 没有竖线穿过 TON 盒体', pressedVerts(g1, body1).length === 0,
    JSON.stringify(pressedVerts(g1, body1)));
  ck('场景1 PT 值也在盒体外面（没被盒体压住）', pt1.x + pt1.w <= body1.x - 2,
    'ptRight=' + (pt1.x + pt1.w) + ' boxLeft=' + body1.x);

  /* ---------- 场景 2：TON 放在分支行（第 2 行） ---------- */
  await setNets(`[{title:'',columns:[
    {branches:[[{id:'c1',type:'NO',operand:'Q0.1',addr:'Q0.1'}]]},
    {branches:[
      [{id:'c2',type:'NO',operand:'Q0.2',addr:'Q0.2'}],
      [{id:'t2',type:'TON',instance:'TON_2',db:2,params:{PT:'T#2s'}}]
    ]}
  ]}]`);
  let g2 = await probe(0);
  const bodys2 = g2.bodies || [];
  const pt2 = (g2.vals || [])[0];
  ck('场景2 TON 在分支行：盒体不被竖线穿过', bodys2.length === 1 && pressedVerts(g2, bodys2[0]).length === 0,
    JSON.stringify(pressedVerts(g2, bodys2[0] || {})));
  ck('场景2 TON 在分支行：PT 值与竖线至少隔 12px', !!pt2 && minGapLeft(g2, pt2) >= 12,
    'gap=' + (pt2 ? minGapLeft(g2, pt2) : 'n/a'));

  /* ---------- 场景 3：计数器（PV 也在框外） ---------- */
  await setNets(`[{title:'',columns:[
    {branches:[[{id:'c3',type:'NO',operand:'Q0.3',addr:'Q0.3'}]]},
    {branches:[
      [{id:'n3',type:'CTU',instance:'CTU_DB',db:3,params:{PV:'5'}}],
      [{id:'e3',type:'OPEN_END'}]
    ]}
  ]}]`);
  let g3 = await probe(0);
  const body3 = (g3.bodies || [])[0], pv3 = (g3.vals || [])[0];
  ck('场景3 计数器盒体不被竖线穿过', !!body3 && pressedVerts(g3, body3).length === 0,
    JSON.stringify(pressedVerts(g3, body3 || {})));
  ck('场景3 计数器 PV 与竖线至少隔 12px', !!pv3 && minGapLeft(g3, pv3) >= 12,
    'gap=' + (pv3 ? minGapLeft(g3, pv3) : 'n/a'));

  if (logs.length) console.log('\n页面异常:\n' + logs.slice(0, 5).join('\n'));
  ws.close(); killTree(p);
  const bad = R.filter(x => !x).length;
  console.log('\n通过 ' + (R.length - bad) + '/' + R.length);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.stack || e.message); process.exit(2); });
