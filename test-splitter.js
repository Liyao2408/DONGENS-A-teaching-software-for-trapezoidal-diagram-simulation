/* ============================================================
 * test-splitter.js — 编辑区 ↔ 巡视窗口 的可拖分界线（V54）
 *
 * 用户现场：鼠标停在"编译结果 / 诊断"上方的分界线上 → 光标变成 ⬍，
 * 按住左键拖动即可上下调节两块区域的高度（往下拖 → 梯形图区域变大）。
 *
 * 覆盖：
 *   · 分界线夹在 editorArea 与 inspector 之间
 *   · 悬停光标 = 自定义 ⬍（ns-resize 兜底）
 *   · 真实拖拽（CDP）：下拖 → 巡视窗口变矮、梯形图变高；上拖 → 反之
 *   · 上下限：巡视窗口 ≥ 80px，梯形图区 ≥ 120px
 *   · 双击复位默认 190px
 *   · 折叠状态拖一下会重新展开
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-splitter.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9860 + Math.floor(Math.random() * 20);
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'spt' + Date.now()),
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
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(\".network\").length') > 0) break; }
  await sleep(500);

  // 通用：真实指针拖拽
  const drag = async (fx, fy, tx, ty) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(60);
    for (let i = 1; i <= 10; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx + (tx - fx) * i / 10, y: fy + (ty - fy) * i / 10, button: 'left', buttons: 1, pointerType: 'mouse' });
      await sleep(30);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(400);
  };

  /* ============================================================
   * 1. 分界线存在且夹在编辑区与巡视窗口之间
   * ============================================================ */
  const struct = await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var ed=document.getElementById('editorArea');
    var insp=document.getElementById('inspector');
    if(!sp||!ed||!insp) return JSON.stringify({ok:false,sp:!!sp,ed:!!ed,insp:!!insp});
    var ws=sp.parentElement;
    var kids=[].map.call(ws.children,function(c){return c.id||c.className;});
    var spIdx=kids.indexOf('inspSplitter'), edIdx=kids.indexOf('editorArea'), inIdx=kids.indexOf('inspector');
    return JSON.stringify({ok:true, kids:kids, order:(edIdx<spIdx&&spIdx<inIdx)});
  })()`);
  let ST = {}; try { ST = JSON.parse(String(struct)); } catch (e) { }
  ok(ST.ok === true && ST.order === true,
    '分界线夹在 editorArea 与 inspector 之间', JSON.stringify(ST));

  /* ============================================================
   * 2. 悬停光标 = 自定义 ⬍（data:image/svg+xml + ns-resize 兜底）
   * ============================================================ */
  const cur = await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var c=getComputedStyle(sp).cursor;
    return JSON.stringify({cursor:c, hasSvg:(c.indexOf('url(')===0&&c.indexOf('svg')>=0), hasNs:c.indexOf('ns-resize')>=0});
  })()`);
  let CU = {}; try { CU = JSON.parse(String(cur)); } catch (e) { }
  ok(CU.hasSvg === true && CU.hasNs === true,
    '悬停光标是自定义 ⬍ 图标（ns-resize 兜底）', String(CU.cursor).slice(0, 60) + '…');

  /* ============================================================
   * 3. 真实拖拽：下拖 → 巡视窗口变矮、梯形图变高
   *    （每次拖拽前都重新取分界线当前位置 —— 拖完它会移位）
   * ============================================================ */
  const spXY = async () => {
    const g = await ev(`(function(){
      var sp=document.getElementById('inspSplitter');
      var r=sp.getBoundingClientRect();
      return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});
    })()`);
    return JSON.parse(String(g));
  };
  const heights = async () => {
    const g = await ev(`(function(){
      var ed=document.getElementById('editorArea');
      var insp=document.getElementById('inspector');
      return JSON.stringify({
        edH:ed.getBoundingClientRect().height,
        inspH:insp.getBoundingClientRect().height
      });
    })()`);
    return JSON.parse(String(g));
  };

  const G0 = await heights();
  ok(G0.inspH > 0 && G0.edH > 0, '拿到拖拽前两块区域的高度',
    'editor=' + G0.edH + ' inspector=' + G0.inspH);

  let P = await spXY();
  await drag(P.x, P.y, P.x, P.y + 60);   // 向下拖 60px（不触发下限钳制）
  const G1 = await heights();
  ok(Math.abs(G1.inspH - (G0.inspH - 60)) < 2,
    '下拖 60px → 巡视窗口变矮 60px', 'inspH ' + G0.inspH + ' → ' + G1.inspH);
  ok(Math.abs(G1.edH - (G0.edH + 60)) < 2,
    '下拖 60px → 梯形图区域变高 60px（更多梯形图空间）', 'edH ' + G0.edH + ' → ' + G1.edH);

  P = await spXY();
  await drag(P.x, P.y, P.x, P.y - 30);   // 向上拖 30px 回去
  const G2 = await heights();
  ok(Math.abs(G2.inspH - (G0.inspH - 30)) < 2,
    '上拖回来 30px → 巡视窗口相应变高', 'inspH ' + G1.inspH + ' → ' + G2.inspH);

  /* ============================================================
   * 4. 拖拽过程中 body 有 insp-resizing（光标跟随 + 禁止选中）
   * ============================================================ */
  let RES = {};
  P = await spXY();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P.x, y: P.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P.x, y: P.y + 10, button: 'left', buttons: 1, pointerType: 'mouse' });
  await sleep(150);
  {
    const m = await ev(`(function(){
      return JSON.stringify({
        resizing:document.body.classList.contains('insp-resizing'),
        dragging:document.getElementById('inspSplitter').classList.contains('dragging')
      });
    })()`);
    try { RES = JSON.parse(String(m)); } catch (e) { }
  }
  ok(RES.resizing === true && RES.dragging === true,
    '拖拽中 body.insp-resizing + 分界线 dragging 生效', JSON.stringify(RES));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.x, y: P.y + 10, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
  await sleep(300);
  const released = await ev(`(function(){
    return JSON.stringify({
      resizing:document.body.classList.contains('insp-resizing'),
      dragging:document.getElementById('inspSplitter').classList.contains('dragging')
    });
  })()`);
  ok(String(released).indexOf('"resizing":false') >= 0 && String(released).indexOf('"dragging":false') >= 0,
    '松手后拖拽状态清除', String(released));

  /* ============================================================
   * 5. 下限：继续往下拖 → 巡视窗口卡在 80px 不再变矮
   * ============================================================ */
  const curY = await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var r=sp.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2, inspH:document.getElementById('inspector').getBoundingClientRect().height});
  })()`);
  let CY = {}; try { CY = JSON.parse(String(curY)); } catch (e) { }
  await drag(CY.x, CY.y, CY.x, CY.y + 2000);      // 猛拖到底
  const minRes = await ev(`(function(){
    var insp=document.getElementById('inspector');
    var ed=document.getElementById('editorArea');
    return JSON.stringify({inspH:insp.getBoundingClientRect().height, edH:ed.getBoundingClientRect().height});
  })()`);
  let MN = {}; try { MN = JSON.parse(String(minRes)); } catch (e) { }
  ok(MN.inspH >= 79.5 && MN.inspH <= 81,
    '猛拖到底 → 巡视窗口卡在下限 80px', 'inspH=' + MN.inspH);
  ok(MN.edH >= 119,
    '梯形图区域不会被挤没（仍有足够空间）', 'edH=' + MN.edH);

  /* ============================================================
   * 6. 上限：往上拖 → 梯形图区卡在 120px 不再变矮
   * ============================================================ */
  const curY2 = await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var r=sp.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});
  })()`);
  let CY2 = {}; try { CY2 = JSON.parse(String(curY2)); } catch (e) { }
  await drag(CY2.x, CY2.y, CY2.x, CY2.y - 2000);  // 猛拖到顶
  const maxRes = await ev(`(function(){
    var insp=document.getElementById('inspector');
    var ed=document.getElementById('editorArea');
    return JSON.stringify({inspH:insp.getBoundingClientRect().height, edH:ed.getBoundingClientRect().height});
  })()`);
  let MX = {}; try { MX = JSON.parse(String(maxRes)); } catch (e) { }
  ok(MX.edH >= 119.5 && MX.edH <= 121,
    '猛拖到顶 → 梯形图区卡在下限 120px', 'edH=' + MX.edH);

  /* ============================================================
   * 7. 双击分界线 → 复位默认 190px
   * ============================================================ */
  await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var r=sp.getBoundingClientRect();
    sp.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+5,clientY:r.top+3}));
    return true;
  })()`);
  await sleep(300);
  const resetH = await ev(`document.getElementById('inspector').getBoundingClientRect().height`);
  ok(Math.abs(Number(resetH) - 190) < 2,
    '双击分界线复位默认高度 190px', 'inspH=' + resetH);

  /* ============================================================
   * 8. 折叠巡视窗口后拖分界线 → 自动重新展开
   * ============================================================ */
  await ev(`(function(){
    var insp=document.getElementById('inspector');
    insp.classList.add('collapsed');
    insp.style.height='';
    return true;
  })()`);
  await sleep(200);
  const cgeo = await ev(`(function(){
    var sp=document.getElementById('inspSplitter');
    var r=sp.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2, collapsed:document.getElementById('inspector').classList.contains('collapsed')});
  })()`);
  let CG = {}; try { CG = JSON.parse(String(cgeo)); } catch (e) { }
  ok(CG.collapsed === true, '折叠状态确认', JSON.stringify(CG));
  await drag(CG.x, CG.y, CG.x, CG.y + 40);
  const uncoll = await ev(`(function(){
    var insp=document.getElementById('inspector');
    return JSON.stringify({collapsed:insp.classList.contains('collapsed'), inspH:insp.getBoundingClientRect().height});
  })()`);
  ok(String(uncoll).indexOf('"collapsed":false') >= 0,
    '拖一下折叠的分界线 → 自动重新展开', String(uncoll));

  console.log('');
  console.log('EXC 日志：', logs.length ? logs.join(' | ') : '（无）');
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  killTree(p);
  try { ws.close(); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
