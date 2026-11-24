/* ============================================================
 * test-pinbranch.js — 计数器的 R / LD 接一条触点支路（V50）
 *
 * 用户现场："这里的 r 可以连接触点，就像这样"（附 TIA 截图：R 端接一条支路串触点）。
 *
 * 分两段测：
 *   A. 引擎：plc.js 按"母线 → 触点链"单独算引脚功率流
 *        · 按 3 次 CU → CV=3、Q=1
 *        · CU 断开时按 R 也能复位（R 是从母线取电，不被 CU 卡住）
 *        · 链上两个触点串联 = AND
 *        · 没接支路时行为不变（R 默认 false）
 *   B. 界面：右键计数器 →「R 端接一条触点支路…」→ 出现触点、弹出地址框
 *        · 几何：支路从母线画起，拐进盒体左边的 R 引脚
 *        · 右键支路上的触点 → 可改常闭 / 再加一个 / 删除
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-pinbranch.js
 * ============================================================ */
globalThis.window = globalThis;
require('./js/instructions.js');
const PLCNode = require('./js/plc.js');
PLCNode._setInstr(globalThis.INSTR);

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9830 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

const R = [];
const ck = (n, c, x) => { R.push(!!c); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

/* ============================================================
 * A. 引擎
 * ============================================================ */
(function engine() {
  const plc = new PLCNode.SoftPLC();
  plc.setTags([
    { name: 'CU_Button', address: 'I0.0', datatype: 'Bool' },
    { name: 'Rst_Button', address: 'I0.1', datatype: 'Bool' },
    { name: 'B', address: 'I0.2', datatype: 'Bool' }
  ]);

  const net = {
    columns: [
      { branches: [[{ id: 'c1', type: 'NO', operand: 'I0.0' }]] },
      {
        branches: [[{
          id: 'ct', type: 'CTU', instance: 'CTU_DB', params: { PV: '3' },
          pins: { R: [{ id: 'pr', type: 'NO', operand: 'I0.1' }] }
        }]]
      }
    ]
  };
  const key = 'OB1:0:1:0:0:ct';
  const st = () => plc.timers[key] || { cnt: 0, q: false };
  const pulse = () => { plc.write('I0.0', true); plc.execNetwork(net, 0, 'OB1'); plc.write('I0.0', false); plc.execNetwork(net, 0, 'OB1'); };

  for (let i = 0; i < 3; i++) pulse();
  ck('R 接了支路也不影响计数（3 次 → CV=3）', st().cnt === 3, 'CV=' + st().cnt);
  ck('CV 达到 PV 时 Q=1', st().q === true);

  plc.write('I0.0', false); plc.execNetwork(net, 0, 'OB1');
  plc.write('I0.1', true); plc.execNetwork(net, 0, 'OB1');
  ck('CU 断开时按 R 也能复位（R 从母线取电）', st().cnt === 0, 'CV=' + st().cnt);
  plc.write('I0.1', false); plc.execNetwork(net, 0, 'OB1');

  pulse(); pulse();
  ck('复位后继续计数（2 次 → CV=2）', st().cnt === 2, 'CV=' + st().cnt);

  // 没有引脚支路：行为不变
  const net2 = {
    columns: [
      { branches: [[{ id: 'c1', type: 'NO', operand: 'I0.0' }]] },
      { branches: [[{ id: 'ct2', type: 'CTU', instance: 'CTU_DB', params: { PV: '2' } }]] }
    ]
  };
  plc.timers = {};
  plc.write('I0.0', true); plc.execNetwork(net2, 1, 'OB1');
  plc.write('I0.0', false); plc.execNetwork(net2, 1, 'OB1');
  ck('没接支路时照常计数（1 次 → CV=1）', (plc.timers['OB1:1:1:0:0:ct2'] || {}).cnt === 1);

  // 两个触点串联 = AND
  const net3 = {
    columns: [
      { branches: [[{ id: 'c1', type: 'NO', operand: 'I0.0' }]] },
      {
        branches: [[{
          id: 'ct3', type: 'CTU', instance: 'CTU_DB', params: { PV: '9' },
          pins: { R: [{ id: 'p1', type: 'NO', operand: 'I0.1' }, { id: 'p2', type: 'NO', operand: 'I0.2' }] }
        }]]
      }
    ]
  };
  plc.timers = {};
  plc.write('I0.0', true); plc.execNetwork(net3, 2, 'OB1');
  plc.write('I0.0', false); plc.execNetwork(net3, 2, 'OB1');
  const k3 = 'OB1:2:1:0:0:ct3';
  plc.write('I0.1', true); plc.execNetwork(net3, 2, 'OB1');
  ck('串联支路：只闭合一个触点不复位', (plc.timers[k3] || {}).cnt === 1, 'CV=' + (plc.timers[k3] || {}).cnt);
  plc.write('I0.2', true); plc.execNetwork(net3, 2, 'OB1');
  ck('串联支路：两个都闭合才复位', (plc.timers[k3] || {}).cnt === 0, 'CV=' + (plc.timers[k3] || {}).cnt);

  // 常闭触点：不按就是 1 → R 常通 → 计数被压住
  const net4 = {
    columns: [
      { branches: [[{ id: 'c1', type: 'NO', operand: 'I0.0' }]] },
      {
        branches: [[{
          id: 'ct4', type: 'CTU', instance: 'CTU_DB', params: { PV: '5' },
          pins: { R: [{ id: 'p4', type: 'NC', operand: 'I0.2' }] }
        }]]
      }
    ]
  };
  plc.timers = {};
  plc.write('I0.2', false);
  plc.write('I0.0', true); plc.execNetwork(net4, 3, 'OB1');
  plc.write('I0.0', false); plc.execNetwork(net4, 3, 'OB1');
  ck('常闭触点接 R：一直复位，CV 保持 0', (plc.timers['OB1:3:1:0:0:ct4'] || { cnt: 0 }).cnt === 0,
    'CV=' + (plc.timers['OB1:3:1:0:0:ct4'] || {}).cnt);
})();

/* ============================================================
 * B. 界面
 * ============================================================ */
(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'pinu' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + String(((r.result.exceptionDetails || {}).exception || {}).description || '').slice(0, 200);
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

  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'u1',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);

  const boxLeft = async () => ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var svg=net.querySelector('svg');
    var r=svg.getBoundingClientRect();
    var b=[].filter.call(net.querySelectorAll('rect.lad-body'),function(x){
      return +x.getAttribute('height')>=40;
    })[0];
    if(!b) return null;
    return JSON.stringify({bx:+b.getAttribute('x'), by:+b.getAttribute('y'),
      bw:+b.getAttribute('width'), bh:+b.getAttribute('height')});
  })()`);

  ck('初始状态：计数器没有引脚支路', await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    return !u.pins;
  })()`) === true);

  /* R 脚的小方块（接线端子）：没接支路时是空心白块 */
  const padState = () => ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    if(!net) return JSON.stringify({found:false});
    var p=net.querySelector('rect.lad-pinport[data-pin-port]');
    if(!p) return JSON.stringify({found:false});
    var box=[].filter.call(net.querySelectorAll('rect.lad-body'),function(x){
      return +x.getAttribute('height')>=40;
    })[0];
    var bx=box?+box.getAttribute('x'):null;
    var rTxt=null;
    [].forEach.call(net.querySelectorAll('text'),function(t){
      if(!rTxt && t.textContent==='R') rTxt=t;
    });
    var ry=rTxt?+rTxt.getAttribute('y'):null;
    var w=+p.getAttribute('width'), h=+p.getAttribute('height');
    var stroke=p.getAttribute('stroke');
    return JSON.stringify({
      found:true, spec:p.getAttribute('data-pin-port'),
      cls:p.getAttribute('class'),
      connected:/connected/.test(String(p.getAttribute('class'))),
      fill:p.getAttribute('fill'), stroke:stroke,
      cx:+p.getAttribute('x')+w/2, cy:+p.getAttribute('y')+h/2,
      padRight:+p.getAttribute('x')+w,
      rtxtX:rTxt?+rTxt.getAttribute('x'):null,
      bx:bx, ry:ry
    });
  })()`);

  let P0 = {}; try { P0 = JSON.parse(String(await padState())); } catch (e) { }
  ck('R 脚上有一个小方块（data-pin-port = u1:R）', P0.found === true && P0.spec === 'u1:R',
    JSON.stringify(P0));
  ck('没接支路时小方块是空心的（白底 / 无 connected）',
    P0.connected === false && String(P0.fill).toLowerCase() === '#fff', JSON.stringify(P0));
  ck('小方块正好在 R 引脚那一行（居中于引脚引线）',
    P0.ry != null && Math.abs(P0.cy - (P0.ry - 3)) < 1.2,
    'padY=' + P0.cy + ' R基线=' + P0.ry);
  ck('小方块贴在盒体左边界外侧（右缘 = 盒体左边界）',
    P0.bx != null && Math.abs(P0.padRight - P0.bx) < 1.2,
    'padRight=' + P0.padRight + ' bx=' + P0.bx);
  ck('R 字在方块右侧，没有被遮挡',
    P0.rtxtX != null && P0.padRight != null && P0.rtxtX >= P0.padRight - 0.1,
    'R字x=' + P0.rtxtX + ' 方块右缘=' + P0.padRight);


  /* 右键计数器 → 菜单里应该有「R 端接一条触点支路…」 */
  const menu = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var g=[].filter.call(net.querySelectorAll('.lad-el'),function(x){
      return x.getAttribute('data-type')==='CTU';
    })[0];
    if(!g) return 'NO CTU';
    var hit=g.querySelector('.hit');
    var r=hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+10,clientY:r.top+10}));
    var m=document.getElementById('ladMenu');
    if(!m) return 'NO MENU';
    return [].map.call(m.querySelectorAll('*'),function(n){return n.textContent.trim();}).filter(function(s){return s.indexOf('R 端')===0;})[0]||'NO ITEM';
  })()`);
  ck('右键计数器有「R 端接一条触点支路…」', /R 端接一条触点支路/.test(String(menu)), menu);

  await ev(`(function(){
    var m=document.getElementById('ladMenu');
    if(!m) return false;
    var it=[].filter.call(m.querySelectorAll('*'),function(n){
      return n.children.length===0 && n.textContent.indexOf('R 端接一条触点支路')===0;
    })[0];
    if(it) it.click();
    return !!it;
  })()`);
  await sleep(600);

  const afterAdd = await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    var ch=(u.pins&&u.pins.R)||[];
    return JSON.stringify({n:ch.length,type:ch[0]?ch[0].type:null,
      editing:!!document.querySelector('#inlineEdit input')});
  })()`);
  let A = {}; try { A = JSON.parse(String(afterAdd)); } catch (e) { }
  ck('插入后 R 端有 1 个触点', A.n === 1, JSON.stringify(A));
  ck('插入后直接弹出地址输入框', A.editing === true);

  // 填地址 I0.1
  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return 'NO INPUT';
    i.value='I0.1';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return 'ok';
  })()`);
  await sleep(600);

  const addr = await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    var c=u.pins.R[0];
    return JSON.stringify({operand:c.operand, addr:c.addr});
  })()`);
  ck('支路触点记住了地址 I0.1', /I0\.1/.test(String(addr)), addr);

  /* 接上支路之后，R 脚的小方块变成"已连接"（实心） */
  let P1 = {}; try { P1 = JSON.parse(String(await padState())); } catch (e) { }
  ck('接上支路后小方块变成已连接状态（实心）',
    P1.connected === true && String(P1.fill).toLowerCase() !== '#fff', JSON.stringify(P1));
  ck('已连接的小方块仍在 R 引脚那一行',
    P1.ry != null && Math.abs(P1.cy - (P1.ry - 3)) < 1.2,
    'padY=' + P1.cy + ' R基线=' + P1.ry);

  /* 母线必须延伸到支路那一行，否则支路的起点悬在母线末端外面（用户反馈"触点悬空了"） */
  const railVsDot = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var rail=net?net.querySelector('line.lad-rail'):null;
    var dots=net?[].map.call(net.querySelectorAll('.lad-pindot'),function(c){
      return +c.getAttribute('cy');
    }):[];
    if(!rail||!dots.length) return JSON.stringify({ok:false});
    return JSON.stringify({
      x:+rail.getAttribute('x1'), y2:+rail.getAttribute('y2'),
      maxDot:Math.max.apply(null,dots),
      dotX:+net.querySelector('.lad-pindot').getAttribute('cx')
    });
  })()`);
  let RL = {}; try { RL = JSON.parse(String(railVsDot)); } catch (e) { }
  ck('母线一直画到引脚支路那一行（支路不悬空）',
    RL.ok !== false && RL.y2 >= RL.maxDot - 0.5,
    'railY2=' + RL.y2 + ' 支路Y=' + RL.maxDot);
  ck('支路起点的小圆点正好落在母线上', RL.ok !== false && Math.abs(RL.x - RL.dotX) < 0.6,
    'railX=' + RL.x + ' dotX=' + RL.dotX);

  /* 几何：支路从母线画起，拐进盒体左边的 R 引脚 */
  const geo = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var svg=net.querySelector('svg');
    var box=[].filter.call(net.querySelectorAll('rect.lad-body'),function(x){
      return +x.getAttribute('height')>=40;
    })[0];
    if(!box) return 'NO BOX';
    var bx=+box.getAttribute('x'), by=+box.getAttribute('y'), bh=+box.getAttribute('height');
    // R 标签的位置（盒内左侧第二行）
    var rTxt=[].filter.call(net.querySelectorAll('text'),function(t){
      return t.textContent==='R';
    })[0];
    var ry=rTxt?+rTxt.getAttribute('y'):null;
    var plines=[].filter.call(net.querySelectorAll('line.lad-pinwire'),function(l){
      return l.getAttribute('class').indexOf('lad-pinwire')>=0;
    }).map(function(l){
      return {x1:+l.getAttribute('x1'),y1:+l.getAttribute('y1'),x2:+l.getAttribute('x2'),y2:+l.getAttribute('y2')};
    });
    // 接进盒子的那一段：横线，终点停在 R 脚小方块的左边缘（方块宽 7，右缘贴 bx，故左缘 = bx-7）
    var into=plines.filter(function(l){
      return Math.abs(l.y1-l.y2)<0.5 && Math.abs(l.x2-(bx-7))<0.6;
    })[0]||null;
    // 竖钩
    var rise=plines.filter(function(l){
      return Math.abs(l.x1-l.x2)<0.5 && Math.abs(l.y1-l.y2)>5;
    })[0]||null;
    // 从母线出来的横线
    var fromRail=plines.filter(function(l){
      return Math.abs(l.y1-l.y2)<0.5 && Math.abs(l.x1-46)<0.6;
    })[0]||null;
    return JSON.stringify({bx:bx,by:by,bh:bh,ry:ry,into:into,rise:rise,fromRail:fromRail});
  })()`);
  let G = {}; try { G = JSON.parse(String(geo)); } catch (e) { }
  ck('支路横线停在 R 脚小方块的左边缘', !!G.into, JSON.stringify(G.into));
  ck('接进盒体的那段正好在 R 引脚那一行', G.into && G.ry != null && Math.abs(G.into.y1 - (G.ry - 3)) < 1.5,
    'lineY=' + (G.into && G.into.y1) + ' R基线=' + G.ry);
  ck('支路从左侧母线画起（x=46）', !!G.fromRail, JSON.stringify(G.fromRail));
  ck('中间有竖钩把支路拐到引脚高度', !!G.rise, JSON.stringify(G.rise));
  ck('竖钩落在盒体左边的留白里（不压盒体）', G.rise && G.rise.x1 < G.bx - 4,
    'riseX=' + (G.rise && G.rise.x1) + ' bx=' + G.bx);

  /* 右键支路上的触点：能改常闭 / 再加一个 / 删除 */
  const cmenu = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var g=[].filter.call(net.querySelectorAll('.lad-el'),function(x){
      var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
      var ch=(u.pins&&u.pins.R)||[];
      return ch[0] && x.getAttribute('data-el')===ch[0].id;
    })[0];
    if(!g) return 'NO CHAIN EL';
    var hit=g.querySelector('.hit');
    var r=hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+8,clientY:r.top+8}));
    var m=document.getElementById('ladMenu');
    if(!m) return 'NO MENU';
    var txt=m.textContent||'';
    return JSON.stringify({
      toNC: txt.indexOf('改为常闭')>=0,
      add: txt.indexOf('再加一个触点')>=0,
      del: txt.indexOf('删除这个触点')>=0,
      delAll: txt.indexOf('删除整条 R 端支路')>=0
    });
  })()`);
  let CM = {}; try { CM = JSON.parse(String(cmenu)); } catch (e) { }
  ck('右键支路触点：可以改为常闭', CM.toNC === true, JSON.stringify(CM));
  ck('右键支路触点：可以再串一个', CM.add === true);
  ck('右键支路触点：可以删除这个触点', CM.del === true);
  ck('右键支路触点：可以删除整条支路', CM.delAll === true);

  // 改成常闭 → 数据变了
  await ev(`(function(){
    var m=document.getElementById('ladMenu');
    var it=[].filter.call(m.querySelectorAll('*'),function(n){
      return n.children.length===0 && n.textContent.indexOf('改为常闭')===0;
    })[0];
    if(it) it.click();
    return !!it;
  })()`);
  await sleep(500);
  const nc = await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    return (u.pins.R[0]||{}).type;
  })()`);
  ck('改常闭后触点类型变 NC', nc === 'NC', nc);

  // 删除这个触点 → 整条支路消失
  await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    var cid=(u.pins.R||[])[0] && u.pins.R[0].id;
    LadEdit.setSelection(cid);
    LadEdit.deleteElement(cid);
    return true;
  })()`);
  await sleep(500);
  const gone = await ev(`(function(){
    var u=TIA.project.blocks[0].networks[0].columns[1].branches[0][0];
    return !u.pins;
  })()`);
  ck('删掉最后一个触点后引脚支路整个消失', gone === true);

  // 没接支路时，R 还是原来的 false 灰字（不能把参数显示弄丢）
  const backToFalse = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    return [].some.call(net.querySelectorAll('text'),function(t){
      return t.textContent==='false' && t.getAttribute('data-prm');
    });
  })()`);
  ck('删掉支路后 R 恢复显示 false', backToFalse === true);

  // 小方块也要退回到"空心"状态
  let P2 = {}; try { P2 = JSON.parse(String(await padState())); } catch (e) { }
  ck('删掉支路后小方块退回空心', P2.found === true && P2.connected === false &&
    String(P2.fill).toLowerCase() === '#fff', JSON.stringify(P2));

  /* ---------- 整机：编译下载后按按钮，计数器真的会被 R 支路复位 ---------- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'计数器',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'u1',type:'CTU',instance:'CTU_DB',params:{PV:'3'},
        pins:{R:[{id:'pr1',type:'NO',operand:'I0.1',addr:'I0.1'}]}}]]}
    ]}];
    LadEdit.setTags(TIA.project.tags);
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);

  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1600);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(900);

  const run = await ev(`(function(){
    var out={};
    TIA.plc.write('I0.1',false);
    var pulse=function(){
      TIA.plc.write('I0.0',true);
      for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
      TIA.plc.write('I0.0',false);
      for(var j=0;j<2;j++) TIA.plc.step(TIA.project);
    };
    pulse(); pulse(); pulse();
    var st=TIA.plc.timers['OB1:0:1:0:0:u1']||{};
    out.after3=st.cnt;
    // 只按复位（CU 已经断开）
    TIA.plc.write('I0.1',true);
    for(var k=0;k<2;k++) TIA.plc.step(TIA.project);
    out.afterR=(TIA.plc.timers['OB1:0:1:0:0:u1']||{}).cnt;
    return JSON.stringify(out);
  })()`);
  let RN = {}; try { RN = JSON.parse(String(run)); } catch (e) { }
  ck('整机：按 3 次 CU → CV=3', RN.after3 === 3, JSON.stringify(RN));
  ck('整机：按 R 支路上的触点 → CV=0', RN.afterR === 0, JSON.stringify(RN));

  /* 监视：支路通电时导线变绿（trace.pin） */
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(600);
  await ev(`(function(){
    TIA.plc.write('I0.1',true);
    for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
    App.monitor=true; App.online=true; App.running=true;
    LadEdit.rerender({keepScroll:true});
    App.refreshLive();
    return true;
  })()`);
  await sleep(600);
  const live = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var wires=[].filter.call(net.querySelectorAll('line.lad-pinwire'),function(l){
      return l.getAttribute('stroke')!=='';
    }).map(function(l){
      return {y:+l.getAttribute('y1'),stroke:getComputedStyle(l).stroke};
    });
    var greens=wires.filter(function(w){ return w.stroke==='rgb(0, 176, 80)'; }).length;
    return JSON.stringify({n:wires.length,greens:greens,first:wires[0]||null});
  })()`);
  let LV = {}; try { LV = JSON.parse(String(live)); } catch (e) { }
  ck('监视：R 接通后引脚支路的导线变绿', LV.greens > 0, JSON.stringify(LV));

  /* 动态刷新（不重绘 DOM）：断电 → 通电，导线要自己从蓝虚线变绿
     —— 用户反馈"触点闭合后这段线没有显示绿色"（导线只在渲染那一刻着色） */
  const pinStrokes = () => ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    return JSON.stringify([].map.call(net.querySelectorAll('line.lad-pinwire'),function(l){
      return getComputedStyle(l).stroke;
    }));
  })()`);
  await ev(`(function(){
    TIA.plc.write('I0.1',false);
    for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
    App.refreshLive();
    return true;
  })()`);
  await sleep(500);
  const offStrokes = String(await pinStrokes());
  await ev(`(function(){
    TIA.plc.write('I0.1',true);
    for(var i=0;i<2;i++) TIA.plc.step(TIA.project);
    App.refreshLive();      // 只刷新着色，不重建 DOM
    return true;
  })()`);
  await sleep(500);
  const onStrokes = String(await pinStrokes());
  let ON = [], OFF = [];
  try { ON = JSON.parse(onStrokes); OFF = JSON.parse(offStrokes); } catch (e) { }
  ck('断电时支路导线是蓝色（没通电）',
    OFF.length > 0 && OFF.every(s => s !== 'rgb(0, 176, 80)'), offStrokes);
  ck('触点闭合后（只刷新不重绘）支路导线自己变绿',
    ON.length > 0 && ON.every(s => s === 'rgb(0, 176, 80)'), onStrokes);

  /* CTUD / CTD 的引脚方块：R 和 LD 都要有，CTD 只有 LD；两条支路时母线要够长 */
  await ev(`(function(){
    App.monitor=false; App.online=false; App.running=false;
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'u2',type:'CTUD',instance:'CTUD_DB',params:{PV:'5'},
        pins:{R:[{id:'pr2',type:'NO',operand:'I0.1',addr:'I0.1'}],
              LD:[{id:'pr3',type:'NO',operand:'I0.2',addr:'I0.2'}]}}]]},
      {branches:[[{id:'u3',type:'CTD',instance:'CTD_DB',params:{PV:'5'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const pads = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    if(!net) return 'NO NET';
    return JSON.stringify([].map.call(net.querySelectorAll('[data-pin-port]'),function(p){
      return p.getAttribute('data-pin-port');
    }));
  })()`);
  let PD = []; try { PD = JSON.parse(String(pads)); } catch (e) { }
  ck('CTUD 有 R 和 LD 两个引脚方块', PD.indexOf('u2:R') >= 0 && PD.indexOf('u2:LD') >= 0,
    JSON.stringify(PD));
  ck('CTD 只有 LD 引脚方块', PD.indexOf('u3:LD') >= 0 && PD.indexOf('u3:R') < 0, JSON.stringify(PD));

  /* 两条子行（R + LD）时，母线要一直画到最下面那条 */
  const railTwo = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var rail=net?net.querySelector('line.lad-rail'):null;
    var dots=net?[].map.call(net.querySelectorAll('.lad-pindot'),function(c){
      return +c.getAttribute('cy');
    }):[];
    if(!rail||!dots.length) return JSON.stringify({ok:false,n:dots.length});
    return JSON.stringify({ok:true,n:dots.length,y2:+rail.getAttribute('y2'),
      maxDot:Math.max.apply(null,dots)});
  })()`);
  let R2 = {}; try { R2 = JSON.parse(String(railTwo)); } catch (e) { }
  ck('R + LD 各一条支路时，母线画到最下面那条子行',
    R2.ok === true && R2.n === 2 && R2.y2 >= R2.maxDot - 0.5,
    'railY2=' + R2.y2 + ' 最下支路Y=' + R2.maxDot + ' 圆点=' + R2.n);

  /* ============================================================
   * V52 — 绿框定位 / 拖拽接 R / R 不被遮挡
   * 用户现场："绿框定位不大准" / "希望通过拖拽来将触点和 r 端连接起来" / "这个 r 被遮挡了"
   * ============================================================ */

  /* --- 1. 绿框定位：高盒体网络里提示框要贴真实行（用 calcLayout 的 padT/rowH） --- */
  await ev(`(function(){
    App.monitor=false; App.online=false; App.running=false;
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'g1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[
        [{id:'g2',type:'TON',instance:'TON_DB',params:{PT:'T#5s'}}],
        [{id:'g3',type:'CTU',instance:'CTU_DB',params:{PV:'3'}}]
      ]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const hintAlign = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var svgWrap=net.querySelector('.net-svg');
    var svg=svgWrap.querySelector('svg');
    var sr=svg.getBoundingClientRect();
    var L=LAD.calcLayout(TIA.project.blocks[0].networks[0]);
    // 用 SVG 用户坐标里第 2 行（branch=1，CTU 那行）的中心反推屏幕坐标
    var rowCy = L.padT + 1*L.rowH + L.rowH/2;
    // dropPosAt 接受 {target, clientX, clientY}；target 给 svg 即可（不落在 port 上）
    var pt = { target: svg, clientX: sr.left + 200, clientY: sr.top + rowCy };
    var pos = window.LadEdit.dropPosAt(pt);
    var hr = window.LadEdit.hintRectAt(pos);
    var hintCy = hr ? hr.y + hr.h/2 : null;
    var oldRowCy = LAD.GRID.padT + 1*LAD.GRID.h + LAD.GRID.h/2;   // 修复前用的写死值
    return JSON.stringify({
      padT:L.padT, rowH:L.rowH, gridH:LAD.GRID.h, gridPadT:LAD.GRID.padT,
      rowCy:rowCy, pos:pos, hintCy:hintCy, oldRowCy:oldRowCy
    });
  })()`);
  let HA = {}; try { HA = JSON.parse(String(hintAlign)); } catch (e) { }
  ck('高盒体网络：行距确实比默认 GRID.h 大（证明用的是动态布局）',
    HA.rowH > HA.gridH, 'rowH=' + HA.rowH + ' gridH=' + HA.gridH);
  ck('绿框落点识别出第 2 行（branch=1）', HA.pos && HA.pos.branch === 1, JSON.stringify(HA.pos));
  ck('绿框垂直中心贴住真实行中心（不是写死的 GRID 值）',
    HA.hintCy != null && Math.abs(HA.hintCy - HA.rowCy) < 1.5,
    'hintCy=' + HA.hintCy + ' 真实行Cy=' + HA.rowCy + ' 旧值=' + HA.oldRowCy);
  ck('绿框确实没按旧 GRID 公式定位（否则会错位）',
    Math.abs(HA.oldRowCy - HA.rowCy) > 1.5, '旧Cy=' + HA.oldRowCy + ' 新Cy=' + HA.rowCy);

  /* --- 2. 拖到 R 小方块：dropPosAt 认出 kind:'pin'，提示框罩住方块 --- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'h1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'h2',type:'CTU',instance:'CTU_DB',params:{PV:'5'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const pinHit = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    // 命中区（透明 rect）比可见方块大，用户拖到附近就算命中
    var hit=net.querySelector('[data-pin-port="h2:R"]');
    if(!hit) return JSON.stringify({found:false});
    var r=hit.getBoundingClientRect();
    var pt={ target: hit, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
    var pos=window.LadEdit.dropPosAt(pt);
    var hr=window.LadEdit.hintRectAt(pos);
    // 可见方块本体
    var vis=net.querySelector('rect.lad-pinport[data-pin-port="h2:R"]');
    var vr=vis?vis.getBoundingClientRect():null;
    return JSON.stringify({found:true, pos:pos, hr:hr, vr:vr?{x:vr.left,y:vr.top,w:vr.width,h:vr.height}:null});
  })()`);
  let PH = {}; try { PH = JSON.parse(String(pinHit)); } catch (e) { }
  ck('拖到 R 小方块命中区 → dropPosAt 返回 kind:pin', PH.found === true && PH.pos &&
    PH.pos.kind === 'pin' && PH.pos.elId === 'h2' && PH.pos.pin === 'R', JSON.stringify(PH.pos));
  ck('引脚落点的绿框罩住小方块（不是整行框）',
    PH.hr != null && PH.vr != null &&
    PH.hr.w <= PH.vr.w + 24 && PH.hr.h <= PH.vr.h + 24,
    'hint=' + JSON.stringify(PH.hr) + ' 可见=' + JSON.stringify(PH.vr));

  /* --- 3. 从指令面板拖一个常开触点落到 R 小方块 → 接成支路 --- */
  const dropNew = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var hit=net.querySelector('[data-pin-port="h2:R"]');
    if(!hit) return 'NO HIT';
    var r=hit.getBoundingClientRect();
    var pt={ target: hit, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
    window.LadEdit.insertInstruction('NO', window.LadEdit.dropPosAt(pt));
    return true;
  })()`);
  await sleep(600);
  const afterDrop = await ev(`(function(){
    var u=null;
    var cols=TIA.project.blocks[0].networks[0].columns;
    for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
      for(var e=0;e<cols[c].branches[b].length;e++)
        if(cols[c].branches[b][e].id==='h2') u=cols[c].branches[b][e];
    var ch=(u&&u.pins&&u.pins.R)||[];
    return JSON.stringify({n:ch.length,type:ch[0]?ch[0].type:null,editing:!!document.querySelector('#inlineEdit input')});
  })()`);
  let AD = {}; try { AD = JSON.parse(String(afterDrop)); } catch (e) { }
  ck('面板拖常开触点到 R 小方块 → 接成支路（1 个触点）', AD.n === 1 && AD.type === 'NO', JSON.stringify(AD));
  ck('拖放接入后也会弹出地址输入框（和双击手感一致）', AD.editing === true);

  // 关掉地址框
  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(i){ i.value='I0.2'; i.dispatchEvent(new Event('input',{bubbles:true}));
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }
    return true;
  })()`);
  await sleep(500);

  /* --- 4. 非触点（线圈）拖到 R 端 → 拒绝，支路不增加 --- */
  const dropCoil = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var hit=net.querySelector('[data-pin-port="h2:R"]');
    var r=hit.getBoundingClientRect();
    var pt={ target: hit, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
    window.LadEdit.insertInstruction('COIL', window.LadEdit.dropPosAt(pt));
    var cols=TIA.project.blocks[0].networks[0].columns, u=null;
    for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
      for(var e=0;e<cols[c].branches[b].length;e++)
        if(cols[c].branches[b][e].id==='h2') u=cols[c].branches[b][e];
    return ((u.pins&&u.pins.R)||[]).length;
  })()`);
  await sleep(500);
  ck('线圈拖到 R 端被拒绝（支路仍是 1 个）', dropCoil === 1, 'n=' + dropCoil);

  /* --- 5. 同一端最多 3 个触点 --- */
  const capN = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var hit=net.querySelector('[data-pin-port="h2:R"]');
    var r=hit.getBoundingClientRect();
    var pt={ target: hit, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
    for(var i=0;i<3;i++) window.LadEdit.insertInstruction('NO', window.LadEdit.dropPosAt(pt));
    var cols=TIA.project.blocks[0].networks[0].columns, u=null;
    for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
      for(var e=0;e<cols[c].branches[b].length;e++)
        if(cols[c].branches[b][e].id==='h2') u=cols[c].branches[b][e];
    return ((u.pins&&u.pins.R)||[]).length;
  })()`);
  await sleep(600);
  ck('R 端最多串 3 个触点（多拖的被挡下）', capN === 3, 'n=' + capN);

  /* --- 6. 把主线上的触点拖到 R 小方块 → 挪过去（moveElement 路径） --- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'m1',type:'NO',operand:'I0.3',addr:'I0.3'}]]},
      {branches:[[{id:'m2',type:'CTU',instance:'CTU_DB',params:{PV:'5'}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const moveRes = await ev(`(function(){
    // 用真实指针拖拽：从 m1 触点中心拖到 R 小方块中心
    var net=document.querySelector('.network[data-net="0"]');
    var src=[].filter.call(net.querySelectorAll('.lad-el'),function(g){
      return g.getAttribute('data-el')==='m1';
    })[0];
    var hit=net.querySelector('[data-pin-port="m2:R"]');
    if(!src||!hit) return JSON.stringify({ok:false,src:!!src,hit:!!hit});
    var s=src.querySelector('.hit')||src;
    var a=s.getBoundingClientRect(), b=hit.getBoundingClientRect();
    var sx=a.left+a.width/2, sy=a.top+a.height/2;
    var tx=b.left+b.width/2, ty=b.top+b.height/2;
    // 直接驱动 DragLayer 的落点计算 + moveElement（等价于拖放收尾那一步）
    var pos=window.LadEdit.dropPosAt({target:hit,clientX:tx,clientY:ty});
    // moveElement 未导出，走拖拽内部：模拟 pointerdown→up 用 CDP 太慢，
    // 这里直接调 insertAtPoint 的对偶——先把原触点删掉再走 pin 落点插入同 id
    // 改用：定位 loc → 手动调用 dropContactOnPin 等价路径（moveElement 的 pin 分支）
    if(!pos||pos.kind!=='pin') return JSON.stringify({ok:false,pos:pos});
    // 公开等价入口：insertInstruction 会新建，这里要的是"移动"，
    // 用 LadEdit 内部一致性验证：先摘掉，再 dropPosAt + 内部 move
    // 简化：调用 deleteElement 不行（会丢 id），改走 moveElement 的等价公开验证：
    //   locate 摘除 + dropContactOnPin 由 moveElement 完成 —— 通过真实拖拽验证
    return JSON.stringify({ok:true,pos:pos,sx:sx,sy:sy,tx:tx,ty:ty});
  })()`);
  let MV = {}; try { MV = JSON.parse(String(moveRes)); } catch (e) { }
  ck('主线上触点拖到 R 小方块：落点识别为 pin', MV.ok === true && MV.pos && MV.pos.kind === 'pin',
    JSON.stringify(MV));
  // 真实指针拖拽走 DragLayer → moveElement
  if (MV.ok) {
    const drag = async (fx, fy, tx, ty) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
      await sleep(60);
      for (let i = 1; i <= 10; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx + (tx - fx) * i / 10, y: fy + (ty - fy) * i / 10, button: 'left', buttons: 1, pointerType: 'mouse' });
        await sleep(30);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
      await sleep(500);
    };
    await drag(MV.sx, MV.sy, MV.tx, MV.ty);
    const movedN = await ev(`(function(){
      var cols=TIA.project.blocks[0].networks[0].columns, u=null, mainHas=false;
      for(var c=0;c<cols.length;c++) for(var b=0;b<cols[c].branches.length;b++)
        for(var e=0;e<cols[c].branches[b].length;e++){
          if(cols[c].branches[b][e].id==='m2') u=cols[c].branches[b][e];
          if(cols[c].branches[b][e].id==='m1') mainHas=true;
        }
      var ch=(u&&u.pins&&u.pins.R)||[];
      return JSON.stringify({pinN:ch.length,pinId:ch[0]?ch[0].id:null,mainHas:mainHas});
    })()`);
    let MN = {}; try { MN = JSON.parse(String(movedN)); } catch (e) { }
    ck('真实拖拽后触点挪进了 R 支路', MN.pinN === 1 && MN.pinId === 'm1', JSON.stringify(MN));
    ck('原来那条主线上的触点已经不在了', MN.mainHas === false);
  }

  /* --- 7. R 字没有被小方块压住（用 getBBox 精确量） --- */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'o1',type:'NO',operand:'I0.0',addr:'I0.0'}]]},
      {branches:[[{id:'o2',type:'CTU',instance:'CTU_DB',params:{PV:'5'},
        pins:{R:[{id:'opr',type:'NO',operand:'I0.1',addr:'I0.1'}]}}]]}
    ]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const occ = await ev(`(function(){
    var net=document.querySelector('.network[data-net="0"]');
    var pad=net.querySelector('rect.lad-pinport[data-pin-port="o2:R"]');
    var rTxt=null;
    [].forEach.call(net.querySelectorAll('text'),function(t){
      if(!rTxt && t.textContent==='R') rTxt=t;
    });
    if(!pad||!rTxt) return JSON.stringify({found:false});
    var pb=pad.getBBox(), rb=rTxt.getBBox();
    // 遮挡判定：两个 bbox 在 x 上有重叠，且 y 上有重叠
    var overlap = pb.x < rb.x + rb.width && rb.x < pb.x + pb.width &&
                  pb.y < rb.y + rb.height && rb.y < pb.y + pb.height;
    return JSON.stringify({
      found:true, overlap:overlap,
      pad:{x:pb.x,w:pb.width,right:pb.x+pb.width},
      rt:{x:rb.x,w:rb.width},
      gap: rb.x - (pb.x + pb.width)
    });
  })()`);
  let OC = {}; try { OC = JSON.parse(String(occ)); } catch (e) { }
  ck('R 字与小方块 bbox 完全不重叠（R 没被遮挡）', OC.found === true && OC.overlap === false,
    JSON.stringify(OC));
  ck('小方块右缘与 R 字之间还有正的间隙', OC.gap >= -0.5, 'gap=' + OC.gap);


  console.log('');
  const bad = R.filter(x => !x).length;
  if (logs.length) { console.log('页面异常：'); logs.slice(0, 5).forEach(l => console.log('  ' + l)); }
  console.log((bad ? 'FAILED ' : 'PASS ') + (R.length - bad) + '/' + R.length);
  ws.close(); try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
