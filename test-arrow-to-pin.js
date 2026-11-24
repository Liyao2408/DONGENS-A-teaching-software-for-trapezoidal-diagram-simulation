/* ============================================================
 * test-arrow-to-pin.js — 拖开放分支的开口箭头到计数器 R 脚（V53）
 *
 * 用户现场："我希望通过鼠标左键拖动箭头来将分支的触点与计数器的 r 脚相连"
 *   · 拖拽中：R 小方块高亮（lad-pinport.hot + 绿色光晕），dragArrow.target = pin:elId:R
 *   · 松开后：整条开放分支的触点按顺序挪进 host.pins.R，开口箭头/空分支清掉
 *   · 边界：分支里有非触点 → 拒绝；合入后超过 3 个触点 → 拒绝；引脚名不存在 → 拒绝
 *   · 保留：单个无地址触点接入后弹地址框；合并后编译通过
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-arrow-to-pin.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9840 + Math.floor(Math.random() * 30);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('ok   : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'a2p' + Date.now()),
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
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }

  // 通用：真实指针拖拽
  const drag = async (fx, fy, tx, ty, midCb) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(60);
    for (let i = 1; i <= 10; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx + (tx - fx) * i / 10, y: fy + (ty - fy) * i / 10, button: 'left', buttons: 1, pointerType: 'mouse' });
      await sleep(30);
    }
    // 最后一步已停在目标点上；等输入队列被页面处理完，再采样拖拽中状态
    if (midCb) { await sleep(250); await midCb(); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(500);
  };

  /* ============================================================
   * 1. 用户截图场景：主线 NO + CTU；下面一条开放分支（NO + 开口箭头）
   *    左键拖开口箭头到 R 小方块 → 分支触点接成 R 支路
   * ============================================================ */
  await ev(`(function(){
    App.monitor=false; App.online=false; App.running=false;
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'拖箭头接 R',columns:[
      {branches:[[{id:'a1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct1',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}],
        [{id:'a2',type:'NO',operand:'I0.1',addr:'I0.1'},{id:'oe1',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.state.selId=null;LadEdit.state.selSeg=null;TIA.selSeg=null;TIA.selEl=null;
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);

  // 1a. arrowTargetAt：指到 R 端子上认出 pin，指到空白处退回横线落点
  const tHit = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var hit=net.querySelector('[data-pin-port="ct1:R"]');
    if(!hit) return JSON.stringify({found:false});
    var r=hit.getBoundingClientRect();
    var tp=window.LadEdit.arrowTargetAt(r.left+r.width/2, r.top+r.height/2);
    var svg=net.querySelector('.net-svg svg');
    var sr=svg.getBoundingClientRect();
    var tw=window.LadEdit.arrowTargetAt(sr.left+40, sr.top+sr.height-6);
    return JSON.stringify({found:true, pin:tp, wire:tw});
  })()`);
  let TH = {}; try { TH = JSON.parse(String(tHit)); } catch (e) { }
  ok(TH.found === true && TH.pin && TH.pin.kind === 'pin' && TH.pin.elId === 'ct1' && TH.pin.pin === 'R',
    'arrowTargetAt 指到 R 小方块 → kind:pin', JSON.stringify(TH.pin));
  ok(TH.wire && TH.wire.kind === undefined && TH.wire.net === 0 && typeof TH.wire.col === 'number',
    'arrowTargetAt 指到网络空白处 → 仍是横线落点', JSON.stringify(TH.wire));

  // 1b. 真实拖拽：开口箭头 → R 小方块
  const dragGeo = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var og=net.querySelector('.lad-el[data-el="oe1"]');
    var s=og?(og.querySelector('.hit')||og):null;
    var hit=net.querySelector('[data-pin-port="ct1:R"]');
    if(!s||!hit) return JSON.stringify({ok:false,s:!!s,hit:!!hit});
    var a=s.getBoundingClientRect(), b=hit.getBoundingClientRect();
    return JSON.stringify({ok:true,
      fx:a.left+a.width/2, fy:a.top+a.height/2,
      tx:b.left+b.width/2, ty:b.top+b.height/2});
  })()`);
  let DG = {}; try { DG = JSON.parse(String(dragGeo)); } catch (e) { }
  ok(DG.ok === true, '找到开口箭头与 R 小方块的拖拽坐标', JSON.stringify(DG));

  let MID = {};
  if (DG.ok) {
    await drag(DG.fx, DG.fy, DG.tx, DG.ty, async () => {
      const m = await ev(`(function(){
        return JSON.stringify({
          active: !!(LadEdit.state.adrag&&LadEdit.state.adrag.active),
          key: LadEdit.state.dragArrow ? LadEdit.state.dragArrow.target : null,
          hot: document.querySelectorAll('rect.lad-pinport.hot[data-pin-port="ct1:R"]').length
        });
      })()`);
      try { MID = JSON.parse(String(m)); } catch (e) { }
    });
    ok(MID.active === true, '拖拽中进入激活状态（adrag.active）', JSON.stringify(MID));
    ok(MID.key === 'pin:ct1:R', '拖拽中 dragArrow.target 认出引脚落点', JSON.stringify(MID.key));
    ok(MID.hot === 1, '拖拽中 R 小方块高亮（lad-pinport.hot）', 'hot=' + MID.hot);

    const res1 = await ev(`(function(){
      var cols=TIA.project.blocks[0].networks[0].columns, ct=null, openN=0, rows=0;
      for(var c=0;c<cols.length;c++){
        rows=Math.max(rows,cols[c].branches.length);
        for(var b=0;b<cols[c].branches.length;b++)
          for(var e=0;e<cols[c].branches[b].length;e++){
            var el=cols[c].branches[b][e];
            if(el.id==='ct1') ct=el;
            if(el.type==='OPEN_END') openN++;
          }
      }
      var ch=(ct&&ct.pins&&ct.pins.R)||[];
      return JSON.stringify({
        pinN:ch.length, pinId:ch[0]?ch[0].id:null, pinOp:ch[0]?ch[0].operand:null,
        openN:openN, rows:rows, dirty:!!LadEdit.state.tab.dirty,
        openDom:document.querySelectorAll('.lad-el[data-type="OPEN_END"]').length
      });
    })()`);
    let R1 = {}; try { R1 = JSON.parse(String(res1)); } catch (e) { }
    ok(R1.pinN === 1 && R1.pinId === 'a2' && R1.pinOp === 'I0.1',
      '松开后分支触点挪进 R 支路（地址保留）', JSON.stringify(R1));
    ok(R1.openN === 0 && R1.openDom === 0, '开口箭头已被收掉（数据+DOM）', JSON.stringify(R1));
    ok(R1.rows === 1, '空分支整行删掉（每列只剩主线）', 'rows=' + R1.rows);
    ok(R1.dirty === true, '合并后标记 dirty', String(R1.dirty));
    const cerr1 = await ev(`(function(){try{return JSON.stringify(PLC.compileProject(TIA.project).filter(function(d){return d.level==='error';}))}catch(e){return 'ERR:'+e.message} })()`);
    ok(cerr1 === '[]', '合并后编译通过', String(cerr1));
  }

  /* ============================================================
   * 2. 多触点串联：顺序保留（NO,NC 按分支里的先后进链）
   * ============================================================ */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'串联顺序',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct2',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}],
        [{id:'b1',type:'NO',operand:'I0.1',addr:'I0.1'},{id:'b2',type:'NC',operand:'I0.2',addr:'I0.2'},{id:'oe2',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);
  const dragGeo2 = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var og=net.querySelector('.lad-el[data-el="oe2"]');
    var s=og?(og.querySelector('.hit')||og):null;
    var hit=net.querySelector('[data-pin-port="ct2:R"]');
    if(!s||!hit) return JSON.stringify({ok:false});
    var a=s.getBoundingClientRect(), b=hit.getBoundingClientRect();
    return JSON.stringify({ok:true, fx:a.left+a.width/2, fy:a.top+a.height/2, tx:b.left+b.width/2, ty:b.top+b.height/2});
  })()`);
  let DG2 = {}; try { DG2 = JSON.parse(String(dragGeo2)); } catch (e) { }
  if (DG2.ok) {
    await drag(DG2.fx, DG2.fy, DG2.tx, DG2.ty);
    const res2 = await ev(`(function(){
      var cols=TIA.project.blocks[0].networks[0].columns, ct=null;
      for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
        for(var e=0;e<cols[c].branches[b].length;e++)
          if(cols[c].branches[b][e].id==='ct2') ct=cols[c].branches[b][e];
      var ch=(ct&&ct.pins&&ct.pins.R)||[];
      return JSON.stringify({ids:ch.map(function(x){return x.id;}), types:ch.map(function(x){return x.type;})});
    })()`);
    let R2 = {}; try { R2 = JSON.parse(String(res2)); } catch (e) { }
    ok(JSON.stringify(R2.ids) === JSON.stringify(['b1', 'b2']) &&
      JSON.stringify(R2.types) === JSON.stringify(['NO', 'NC']),
      '两个触点按分支顺序串进 R 链（b1→b2）', JSON.stringify(R2));
  } else {
    ok(false, '两个触点按分支顺序串进 R 链（b1→b2）', '找不到拖拽坐标');
  }

  /* ============================================================
   * 3. 边界拒绝：非触点 / 超 3 个 / 引脚名不存在（直接调 API，等价于松手那一步）
   * ============================================================ */
  const neg = await ev(`(function(){
    var out={};
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];

    // 3a. 分支里有 TON（非触点）→ 拒绝
    ob1.networks=[{title:'neg1',columns:[
      {branches:[[{id:'d1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct3',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}],
        [{id:'t1',type:'TON',instance:'TON_DB',params:{PT:'T#1s'}},{id:'oe3',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    out.nonContact = LadEdit.mergeOpenArrowToPin({net:0,col:1,row:1},{kind:'pin',elId:'ct3',pin:'R'});
    var ct3=null;
    var cols=ob1.networks[0].columns;
    for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
      for(var e=0;e<cols[c].branches[b].length;e++)
        if(cols[c].branches[b][e].id==='ct3') ct3=cols[c].branches[b][e];
    out.nonContactPins = ct3 ? !!ct3.pins : false;
    out.nonContactOpenKept = JSON.stringify(cols[1].branches[1].map(function(x){return x.type;}));

    // 3b. 已有 1 个触点 + 再并入 3 个 → 超上限，拒绝
    ob1.networks=[{title:'neg2',columns:[
      {branches:[[{id:'d2',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct4',type:'CTU',instance:'CTU_DB',params:{PV:'3'},
          pins:{R:[{id:'x1',type:'NO',operand:'I0.1',addr:'I0.1'}]}}],
        [{id:'n1',type:'NO',operand:'I0.2',addr:'I0.2'},{id:'n2',type:'NO',operand:'I0.3',addr:'I0.3'},
         {id:'n3',type:'NO',operand:'I0.4',addr:'I0.4'},{id:'oe4',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    out.overCap = LadEdit.mergeOpenArrowToPin({net:0,col:1,row:1},{kind:'pin',elId:'ct4',pin:'R'});
    var ct4=null;
    var cols2=ob1.networks[0].columns;
    for(var c2=0;c2<cols2.length;c2++) for(var b2=0;b2<cols2[c2].branches.length;b2++)
      for(var e2=0;e2<cols2[c2].branches[b2].length;e2++)
        if(cols2[c2].branches[b2][e2].id==='ct4') ct4=cols2[c2].branches[b2][e2];
    out.overCapN = ((ct4&&ct4.pins&&ct4.pins.R)||[]).length;

    // 3c. 引脚名不存在 → 拒绝
    out.badPin = LadEdit.mergeOpenArrowToPin({net:0,col:1,row:1},{kind:'pin',elId:'ct4',pin:'X'});

    // 3d. 空分支（只有开口箭头）→ 拒绝
    ob1.networks=[{title:'neg3',columns:[
      {branches:[[{id:'d3',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct5',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}],
        [{id:'oe5',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    out.empty = LadEdit.mergeOpenArrowToPin({net:0,col:1,row:1},{kind:'pin',elId:'ct5',pin:'R'});

    return JSON.stringify(out);
  })()`);
  let NG = {}; try { NG = JSON.parse(String(neg)); } catch (e) { }
  ok(NG.nonContact === false, '分支里有非触点（TON）→ 拒绝合并', JSON.stringify(NG.nonContact));
  ok(NG.nonContactPins === false && NG.nonContactOpenKept === '["TON","OPEN_END"]',
    '拒绝后分支原样保留、R 没被污染', JSON.stringify(NG.nonContactOpenKept));
  ok(NG.overCap === false && NG.overCapN === 1, '合入后超 3 个触点 → 拒绝（仍是 1 个）', 'n=' + NG.overCapN);
  ok(NG.badPin === false, '引脚名不存在（X）→ 拒绝', JSON.stringify(NG.badPin));
  ok(NG.empty === false, '只有开口箭头的空分支 → 拒绝', JSON.stringify(NG.empty));

  /* ============================================================
   * 4. 单个无地址触点接入后弹地址框（和拖触点接引脚的手感一致）
   * ============================================================ */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'addr',columns:[
      {branches:[[{id:'f1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'ct6',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}],
        [{id:'z1',type:'NO'},{id:'oe6',type:'OPEN_END'}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    LadEdit.mergeOpenArrowToPin({net:0,col:1,row:1},{kind:'pin',elId:'ct6',pin:'R'});
    return true;
  })()`);
  await sleep(500);
  const addrBox = await ev(`(function(){
    var has=!!document.querySelector('#inlineEdit input');
    var i=document.querySelector('#inlineEdit input');
    if(i){ i.value='I0.5'; i.dispatchEvent(new Event('input',{bubbles:true}));
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }
    return JSON.stringify({has:has});
  })()`);
  let AB = {}; try { AB = JSON.parse(String(addrBox)); } catch (e) { }
  ok(AB.has === true, '单个无地址触点接入后弹地址输入框', JSON.stringify(AB));
  await sleep(400);
  const addrSaved = await ev(`(function(){
    var cols=TIA.project.blocks[0].networks[0].columns, ct=null;
    for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
      for(var e=0;e<cols[c].branches[b].length;e++)
        if(cols[c].branches[b][e].id==='ct6') ct=cols[c].branches[b][e];
    var ch=(ct&&ct.pins&&ct.pins.R)||[];
    return JSON.stringify({operand:ch[0]?ch[0].operand:null, addr:ch[0]?ch[0].addr:null});
  })()`);
  let AS = {}; try { AS = JSON.parse(String(addrSaved)); } catch (e) { }
  ok(AS.operand === 'I0.5' || AS.addr === 'I0.5', '地址框填的值落进 R 支路触点', JSON.stringify(AS));

  console.log('');
  console.log('EXC 日志：', logs.length ? logs.join(' | ') : '（无）');
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  killTree(p);
  try { ws.close(); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
