/* ============================================================
 * test-ui-tweak.js — 界面细节回归（用户现场提的四处）
 *
 *  1) "这些小圆圈去掉"            → 分支手柄 .br-handle、拖拽手柄 .drag-dot 默认不可见
 *  2) "比较下方填数字 / 计数器 PV 的输入框保持空白"
 *                                 → 这两个参数双击后 placeholder 为空、不弹地址候选
 *  3) "这两个指令意外换行"        → 收藏夹 .fb-cells 必须不换行（nowrap）
 *  4) "添加分支意外连在一起"      → 没选中元件时插分支不能落到第 1 列（那儿的分出竖线
 *                                   和母线重合，引线会像直接从母线上长出来）
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-ui-tweak.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9830 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'tweak' + Date.now()),
    '--window-size=1680,1200', 'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list')); t = l.filter(x => x.url.includes('index.html')); if (t.length) break; } catch (e) { }
  }
  if (!t || !t.length) { console.log('NO TARGET（先起 tmp-serve.js）'); process.exit(1); }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (((m.params.exceptionDetails || {}).exception || {}).description || '').slice(0, 200));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + ((((r.result.exceptionDetails || {}).exception || {}).description) || '').slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');

  const R = [];
  const ck = (n, c, x) => { R.push(!!c); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  /* ---------- 准备网络：2 列，第 2 列放 CTU ---------- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'t',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'u1',type:'CTU',instance:'CTU_DB',params:{PV:'7'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);

  /* ---------- 4) 没选中元件时插分支：不能落到第 1 列 ---------- */
  const addNoSel = await ev(`(function(){
    LadEdit.clearSelection();
    LadEdit.setCurrentNet(0);
    LadEdit.addOpenBranch('down');
    var net=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0].networks[0];
    var multi=[];
    net.columns.forEach(function(c,i){ if(c.branches.length>1) multi.push(i); });
    return JSON.stringify({
      multi:multi,
      col0:net.columns[0].branches.length,
      col1:net.columns[1].branches.length,
      last:net.columns[net.columns.length-1].branches.length
    });
  })()`);
  let A = {}; try { A = JSON.parse(String(addNoSel)); } catch (e) { }
  ck('没选中时插分支：不在第 1 列（第 1 列仍只有主线）', A.col0 === 1, 'col0=' + A.col0);
  ck('没选中时插分支：落在最后一列（第 2 列多出一行）', A.col1 === 2, 'col1=' + A.col1);
  ck('没选中时插分支：只有一列是多分支', Array.isArray(A.multi) && A.multi.length === 1 && A.multi[0] === 1, JSON.stringify(A.multi));

  // 几何：新分支的横线不能从母线（x = padL）上长出来
  const geo = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    if(!net) return 'NO NET';
    var rail=net.querySelector('line.lad-hit[data-seg$=":rail"]');
    var railX=rail?parseFloat(rail.getAttribute('x1')):null;
    // 主线 y：第 1 列的元件中心（主线的横线本来就该从母线画起，要排除掉）
    var first=net.querySelector('.lad-el .hit');
    var mainY=null;
    if(first){ var r=first.getBoundingClientRect(); mainY=r.top+r.height/2; }
    // 只看主线之外的行：它们不该有横线贴在母线上
    var starts=[];
    [].forEach.call(net.querySelectorAll('line.lad-wire'),function(l){
      if(l.getAttribute('pointer-events')==='none') return;
      var y1=parseFloat(l.getAttribute('y1')),y2=parseFloat(l.getAttribute('y2'));
      if(Math.abs(y1-y2)>0.6) return;               // 只关心横线
      var sy=net.querySelector('svg').getBoundingClientRect().top+y1;
      if(mainY!=null && Math.abs(sy-mainY)<6) return;   // 主线
      starts.push(parseFloat(l.getAttribute('x1')));
    });
    return JSON.stringify({railX:railX,minStart:starts.length?Math.min.apply(null,starts):null,n:starts.length});
  })()`);
  let G = {}; try { G = JSON.parse(String(geo)); } catch (e) { }
  ck('母线 x 可读', typeof G.railX === 'number', 'railX=' + G.railX);
  ck('没有横线贴在母线上（不会"连在一起"）', typeof G.minStart === 'number' && G.minStart > G.railX + 5,
    'minStart=' + G.minStart + ' railX=' + G.railX);

  // 选中元件（CTU）后插分支：仍然落在元件所在列
  const addSel = await ev(`(function(){
    var net0=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0].networks[0];
    // 先把上一轮加的分支行清掉，回到干净的两列
    net0.columns[1].branches=[net0.columns[1].branches[0]];
    LadEdit.rerender({keepScroll:true});
    var g=[].filter.call(document.querySelectorAll('.network[data-net="0"] .lad-el'),function(x){
      return x.getAttribute('data-type')==='CTU';
    })[0];
    if(!g) return 'NO CTU';
    g.querySelector('.hit').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    LadEdit.addOpenBranch('down');
    var cols=net0.columns.map(function(c){return c.branches.length;});
    return JSON.stringify(cols);
  })()`);
  let S = []; try { S = JSON.parse(String(addSel)); } catch (e) { }
  ck('选中 CTU 后插分支：落在 CTU 所在第 2 列', Array.isArray(S) && S[1] === 2 && S[0] === 1, JSON.stringify(S));

  /* ---------- 1) 小圆圈默认不可见 ---------- */
  const op = await ev(`(function(){
    var h=document.querySelector('.network[data-net="0"] .br-handle');
    var d=document.querySelector('.network[data-net="0"] .drag-dot');
    var o=function(el){ return el?getComputedStyle(el).opacity:null; };
    return JSON.stringify({br:o(h),dot:o(d)});
  })()`);
  let O = {}; try { O = JSON.parse(String(op)); } catch (e) { }
  ck('分支手柄小圆圈默认透明（opacity 0）', O.br === '0', 'opacity=' + O.br);
  ck('拖拽手柄小圆圈默认透明（opacity 0）', O.dot === '0', 'opacity=' + O.dot);

  /* ---------- 2) 比较 IN2 / 计数器 PV 输入框空白 ---------- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks.push({title:'cmp',columns:[{branches:[[
      {id:'m1',type:'CMP',params:{IN1:'"CTU_DB".CV',IN2:'5',TYPE:'Int'}}
    ]]}],});
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);

  const cmpBox = await ev(`(function(){
    var el=document.querySelector('[data-prm="m1:IN2"]');
    if(!el) return 'NO PRM';
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(400);
  const cmpState = await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return JSON.stringify({open:false});
    return JSON.stringify({open:true,ph:i.placeholder,sel:!!document.querySelector('#inlineEdit .ie-sel')});
  })()`);
  let C = {}; try { C = JSON.parse(String(cmpState)); } catch (e) { }
  ck('双击比较指令下方数字会弹输入框', C.open === true, cmpBox);
  ck('比较 IN2 输入框 placeholder 为空', C.ph === '', 'placeholder="' + C.ph + '"');
  ck('比较 IN2 不弹地址候选', C.sel === false);
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i)i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
  await sleep(250);

  const pvBox = await ev(`(function(){
    var el=document.querySelector('[data-prm="u1:PV"]');
    if(!el) return 'NO PRM';
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(400);
  const pvState = await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return JSON.stringify({open:false});
    return JSON.stringify({open:true,ph:i.placeholder,sel:!!document.querySelector('#inlineEdit .ie-sel')});
  })()`);
  let P = {}; try { P = JSON.parse(String(pvState)); } catch (e) { }
  ck('双击计数器 PV 会弹输入框', P.open === true, pvBox);
  ck('计数器 PV 输入框 placeholder 为空', P.ph === '', 'placeholder="' + P.ph + '"');
  ck('计数器 PV 不弹地址候选', P.sel === false);
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i)i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
  await sleep(250);

  // 触点仍然是地址输入（别改过头）：有 placeholder、有候选
  const noBox = await ev(`(function(){
    var g=[].filter.call(document.querySelectorAll('.network[data-net="0"] .lad-el'),function(x){
      return x.getAttribute('data-type')==='NO';
    })[0];
    if(!g) return 'NO CONTACT';
    g.querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(400);
  const noState = await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return JSON.stringify({open:false});
    return JSON.stringify({open:true,ph:i.placeholder,sel:!!document.querySelector('#inlineEdit .ie-sel')});
  })()`);
  let N = {}; try { N = JSON.parse(String(noState)); } catch (e) { }
  ck('触点双击仍是地址输入（有提示、有候选）', N.ph && /I0\.0/.test(N.ph) && N.sel === true,
    'ph=' + N.ph + ' sel=' + N.sel);
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i)i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
  await sleep(200);

  /* ---------- 3) 收藏夹不换行 ---------- */
  const fb = await ev(`(function(){
    var c=document.querySelector('.fb-cells');
    if(!c) return 'NO FB';
    var cs=getComputedStyle(c);
    var rows={},n=0;
    [].forEach.call(c.querySelectorAll('.fb-cell'),function(el){
      var r=el.getBoundingClientRect(); if(!r.width) return;
      rows[Math.round(r.top)]=1; n++;
    });
    return JSON.stringify({
      wrap:cs.flexWrap, overflowX:cs.overflowX,
      rows:Object.keys(rows).length, cells:n,
      h:Math.round(c.getBoundingClientRect().height)
    });
  })()`);
  let F = {}; try { F = JSON.parse(String(fb)); } catch (e) { }
  ck('收藏夹 flex-wrap 为 nowrap', F.wrap === 'nowrap', F.wrap);
  ck('收藏夹里所有指令同一行排布', F.rows === 1, 'rows=' + F.rows + ' cells=' + F.cells);
  ck('收藏夹高度没有被撑成两排', typeof F.h === 'number' && F.h <= 56, 'h=' + F.h);

  console.log('');
  const bad = R.filter(x => !x).length;
  if (logs.length) { console.log('页面异常：'); logs.slice(0, 6).forEach(l => console.log('  ' + l)); }
  console.log((bad ? 'FAILED ' : 'PASS ') + (R.length - bad) + '/' + R.length);
  ws.close(); try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
