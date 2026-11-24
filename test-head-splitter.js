/* ============================================================
 * test-head-splitter.js — 块头区 ↔ 网络区 的可拖分界线（V55）
 *
 * 用户现场：梯形图编辑器顶部"OB1 主程序 + 收藏夹 + 块标题/注释"这一块，
 * 要和下面"编译结果 / 诊断"一样可以上下调节：
 * 悬停在块头区下方的分界线上 → 光标变成 ⬍，按住左键上下拖动调节高度。
 *
 * 覆盖：
 *   · 分界线夹在块头区与网络区之间（lad-editor-root 内）
 *   · 悬停光标 = 自定义 ⬍（ns-resize 兜底）
 *   · 真实拖拽（CDP）：下拖 → 块头区变高（注释编辑区变大）、网络区变矮
 *   · 上拖 → 块头区变矮（更多梯形图空间）
 *   · 上下限：块头区 ≥ 96px（块头行 + 收藏栏完整可见），网络区 ≥ 120px
 *   · 双击复位默认（自动内容高度）
 *   · 拖拽中 body.head-resizing + dragging 生效，松手清除
 *   · 重绘（选中元件）后块头区高度保持
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-head-splitter.js
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'hsp' + Date.now()),
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
   * 1. 结构：分界线夹在块头区与网络区之间（lad-editor-root 内）
   * ============================================================ */
  const struct = await ev(`(function(){
    var root=document.querySelector('.lad-editor-root');
    var zone=document.getElementById('ladHeadZone');
    var sp=document.getElementById('headSplitter');
    var sc=document.querySelector('.lad-scroll');
    if(!root||!zone||!sp||!sc) return JSON.stringify({ok:false,root:!!root,zone:!!zone,sp:!!sp,sc:!!sc});
    var kids=[].map.call(root.children,function(c){return c.id||c.className;});
    var zi=kids.indexOf('ladHeadZone'), si=kids.indexOf('headSplitter');
    var sci=kids.findIndex(function(k){return String(k).indexOf('lad-scroll')>=0;});
    var inside=zone.contains(document.getElementById('favbarHost'))&&zone.contains(document.getElementById('blkTitleBlock'));
    return JSON.stringify({ok:true,kids:kids,order:(zi<si&&si<sci),inside:inside});
  })()`);
  let ST = {}; try { ST = JSON.parse(String(struct)); } catch (e) { }
  ok(ST.ok === true && ST.order === true && ST.inside === true,
    '分界线夹在块头区（含收藏栏/块标题）与网络区之间', JSON.stringify(ST));

  /* ============================================================
   * 2. 悬停光标 = 自定义 ⬍（data:image/svg+xml + ns-resize 兜底）
   * ============================================================ */
  const cur = await ev(`(function(){
    var sp=document.getElementById('headSplitter');
    var c=getComputedStyle(sp).cursor;
    return JSON.stringify({cursor:c, hasSvg:(c.indexOf('url(')===0&&c.indexOf('svg')>=0), hasNs:c.indexOf('ns-resize')>=0});
  })()`);
  let CU = {}; try { CU = JSON.parse(String(cur)); } catch (e) { }
  ok(CU.hasSvg === true && CU.hasNs === true,
    '悬停光标是自定义 ⬍ 图标（ns-resize 兜底）', String(CU.cursor).slice(0, 60) + '…');

  /* ============================================================
   * 3. 真实拖拽：下拖 → 块头区变高、网络区变矮（每次重新取坐标）
   * ============================================================ */
  const spXY = async () => {
    const g = await ev(`(function(){
      var sp=document.getElementById('headSplitter');
      var r=sp.getBoundingClientRect();
      return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});
    })()`);
    return JSON.parse(String(g));
  };
  const heights = async () => {
    const g = await ev(`(function(){
      var z=document.getElementById('ladHeadZone');
      var sc=document.querySelector('.lad-scroll');
      return JSON.stringify({
        zoneH:z.getBoundingClientRect().height,
        scrollH:sc.getBoundingClientRect().height,
        inline:z.style.height
      });
    })()`);
    return JSON.parse(String(g));
  };

  const G0 = await heights();
  ok(G0.zoneH > 0 && G0.scrollH > 0, '拿到拖拽前块头区 / 网络区的高度',
    'zone=' + G0.zoneH + ' scroll=' + G0.scrollH);

  let P = await spXY();
  await drag(P.x, P.y, P.x, P.y + 60);   // 向下拖 60px
  const G1 = await heights();
  ok(Math.abs(G1.zoneH - (G0.zoneH + 60)) < 2,
    '下拖 60px → 块头区变高 60px（注释编辑区变大）', 'zoneH ' + G0.zoneH + ' → ' + G1.zoneH);
  ok(Math.abs(G1.scrollH - (G0.scrollH - 60)) < 2,
    '下拖 60px → 网络区变矮 60px', 'scrollH ' + G0.scrollH + ' → ' + G1.scrollH);

  P = await spXY();
  await drag(P.x, P.y, P.x, P.y - 30);   // 上拖 30px 回去
  const G2 = await heights();
  ok(Math.abs(G2.zoneH - (G0.zoneH + 30)) < 2,
    '上拖回来 30px → 块头区变矮（更多梯形图空间）', 'zoneH ' + G1.zoneH + ' → ' + G2.zoneH);

  /* ============================================================
   * 4. 拖拽过程中 body.head-resizing + dragging 生效，松手清除
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
        resizing:document.body.classList.contains('head-resizing'),
        dragging:document.getElementById('headSplitter').classList.contains('dragging')
      });
    })()`);
    try { RES = JSON.parse(String(m)); } catch (e) { }
  }
  ok(RES.resizing === true && RES.dragging === true,
    '拖拽中 body.head-resizing + 分界线 dragging 生效', JSON.stringify(RES));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.x, y: P.y + 10, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
  await sleep(300);
  const released = await ev(`(function(){
    return JSON.stringify({
      resizing:document.body.classList.contains('head-resizing'),
      dragging:document.getElementById('headSplitter').classList.contains('dragging')
    });
  })()`);
  ok(String(released).indexOf('"resizing":false') >= 0 && String(released).indexOf('"dragging":false') >= 0,
    '松手后拖拽状态清除', String(released));

  /* ============================================================
   * 5. 下限：猛往上拖 → 块头区卡在 96px，块头行 + 收藏栏完整可见
   * ============================================================ */
  const curY = await ev(`(function(){
    var sp=document.getElementById('headSplitter');
    var r=sp.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});
  })()`);
  let CY = {}; try { CY = JSON.parse(String(curY)); } catch (e) { }
  await drag(CY.x, CY.y, CY.x, CY.y - 2000);      // 猛拖到顶
  const minRes = await ev(`(function(){
    var z=document.getElementById('ladHeadZone');
    var bh=z.querySelector('.blk-head'), fb=z.querySelector('.favbar-host');
    var zr=z.getBoundingClientRect(), br=bh.getBoundingClientRect(), fr=fb.getBoundingClientRect();
    return JSON.stringify({
      zoneH:zr.height,
      headVisible:(br.bottom<=zr.bottom+1),       // 块头行完整在区域内
      favVisible:(fr.bottom<=zr.bottom+1)         // 收藏栏完整在区域内
    });
  })()`);
  let MN = {}; try { MN = JSON.parse(String(minRes)); } catch (e) { }
  ok(MN.zoneH >= 95 && MN.zoneH <= 97,
    '猛拖到顶 → 块头区卡在下限 96px', 'zoneH=' + MN.zoneH);
  ok(MN.headVisible === true && MN.favVisible === true,
    '块头行 + 收藏栏仍完整可见（编译/收藏按钮不被裁掉）', JSON.stringify(MN));

  /* ============================================================
   * 6. 上限：猛往下拖 → 网络区卡在 120px 不再被挤没
   * ============================================================ */
  const curY2 = await ev(`(function(){
    var sp=document.getElementById('headSplitter');
    var r=sp.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});
  })()`);
  let CY2 = {}; try { CY2 = JSON.parse(String(curY2)); } catch (e) { }
  await drag(CY2.x, CY2.y, CY2.x, CY2.y + 2000);  // 猛拖到底
  const maxRes = await ev(`(function(){
    var sc=document.querySelector('.lad-scroll');
    return JSON.stringify({scrollH:sc.getBoundingClientRect().height});
  })()`);
  let MX = {}; try { MX = JSON.parse(String(maxRes)); } catch (e) { }
  ok(MX.scrollH >= 119,
    '猛拖到底 → 网络区不会被挤没（≥ 120px）', 'scrollH=' + MX.scrollH);

  /* ============================================================
   * 7. 双击分界线 → 复位默认（自动内容高度）
   * ============================================================ */
  await ev(`(function(){
    var sp=document.getElementById('headSplitter');
    var r=sp.getBoundingClientRect();
    sp.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+5,clientY:r.top+3}));
    return true;
  })()`);
  await sleep(300);
  const resetH = await ev(`(function(){
    var z=document.getElementById('ladHeadZone');
    return JSON.stringify({inline:z.style.height, zoneH:z.getBoundingClientRect().height});
  })()`);
  let RH = {}; try { RH = JSON.parse(String(resetH)); } catch (e) { }
  ok(RH.inline === '' && Math.abs(RH.zoneH - G0.zoneH) < 3,
    '双击分界线复位默认高度', JSON.stringify(RH));

  /* ============================================================
   * 8. 重绘后块头区高度保持（选中元件 → renderBlockEditor 重建 DOM）
   * ============================================================ */
  P = await spXY();
  await drag(P.x, P.y, P.x, P.y + 40);            // 调到一个自定义高度
  const beforeRerender = await heights();
  await ev(`(function(){ LadEdit.rerender({keepScroll:true}); return true; })()`);
  await sleep(400);
  const afterRerender = await ev(`(function(){
    var z=document.getElementById('ladHeadZone');
    return JSON.stringify({inline:z.style.height, zoneH:z.getBoundingClientRect().height});
  })()`);
  let AR = {}; try { AR = JSON.parse(String(afterRerender)); } catch (e) { }
  ok(Math.abs(AR.zoneH - beforeRerender.zoneH) < 2 && AR.inline !== '',
    '重绘后块头区高度保持', 'before=' + beforeRerender.zoneH + ' after=' + AR.zoneH + ' inline=' + AR.inline);

  console.log('');
  console.log('EXC 日志：', logs.length ? logs.join(' | ') : '（无）');
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail));
  killTree(p);
  try { ws.close(); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
