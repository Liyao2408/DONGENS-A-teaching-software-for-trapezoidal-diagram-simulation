/* V34：在线/离线按钮 + 在线只读
 *   node test-offline.js   （需要 8931 端口的本地静态服务） */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9896;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('ok   : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'of' + Date.now()),
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
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
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length>0")) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }

  // ---------- 1. 按钮存在 ----------
  ok(await ev(`!!document.querySelector('.tb[data-act="offline"]')`), '工具栏有「离线」按钮');
  ok(await ev(`(function(){var b=document.querySelector('.tb[data-act="offline"]');return b?b.textContent.indexOf('离线')>=0:false;})()`), '按钮文字是「离线」');

  // ---------- 2. 下载 → 在线 + RUN + 仿真面板 ----------
  await ev(`document.querySelector('.tb[data-act="download"]').click()`);
  await sleep(2800);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
  await sleep(1500);
  ok(await ev(`TIA.online===true && TIA.running===true`), '下载后在线且 RUN');
  ok(await ev(`TIA.openTabs.some(function(t){return t.kind==='sim';})`), '下载后打开了仿真面板');

  // ---------- 3. 点「在线」：循环计数清零 ----------
  await sleep(600);
  const cycBefore = await ev(`TIA.plc.cycleCount`);
  const cycAfter = await ev(`(function(){
    document.querySelector('.tb[data-act="online"]').click();
    return TIA.plc.cycleCount;
  })()`);
  ok(cycBefore > 0 && cycAfter === 0, '点「在线」后循环计数从 0 重新开始', cycBefore + ' → ' + cycAfter);

  // ---------- 4. 在线只读：外观 ----------
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();return 1;})()`);
  await sleep(900);
  ok(await ev(`(function(){var w=document.querySelector('.lad-wrap');return !!w&&w.classList.contains('lad-readonly');})()`), '梯形图进入只读外观（lad-readonly）');
  ok(await ev(`(function(){var d=document.querySelector('.drag-dot');return !d||getComputedStyle(d).display==='none';})()`), '只读时隐藏拖拽圆点');

  // ---------- 5. 在线只读：点元件不选中 ----------
  await ev(`(function(){var h=document.querySelector('.lad-el .hit');h.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
  await sleep(200);
  ok(await ev(`document.querySelectorAll('.selbox').length===0`), '在线时点元件不会出现选中框');
  ok(await ev(`LadEdit.state.selId===null`), '在线时不会记录选中');

  // ---------- 6. 在线只读：双击不进入编辑 ----------
  await ev(`(function(){var h=document.querySelector('.lad-el .hit');h.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(250);
  ok(await ev(`document.querySelectorAll('.edit-hl').length===0`), '在线时双击不进入编辑态');

  // ---------- 7. 在线只读：Delete 不删元件 ----------
  const elCount0 = await ev(`document.querySelectorAll('.lad-el[data-el]').length`);
  await ev(`(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));})()`);
  await sleep(250);
  const elCount1 = await ev(`document.querySelectorAll('.lad-el[data-el]').length`);
  ok(elCount0 === elCount1, '在线时 Delete 不删除元件', elCount0 + ' → ' + elCount1);

  // ---------- 8. 在线只读：插入分支被拒 ----------
  const brBefore = await ev(`TIA.project.blocks[0].networks[0].columns[0].branches.length`);
  await ev(`(function(){var b=document.querySelector('[data-net-addbranch]');if(b)b.click();})()`);
  await sleep(250);
  const brAfter = await ev(`TIA.project.blocks[0].networks[0].columns[0].branches.length`);
  ok(brBefore === brAfter, '在线时「新增分支」被拒绝', brBefore + ' → ' + brAfter);

  // ---------- 9. 在线只读 + 监视：按住触点仍可改状态 ----------
  await ev(`(function(){TIA.monitor=true;TIA.refreshLive();return 1;})()`);
  await sleep(300);
  const hitId = await ev(`(function(){var g=document.querySelector('.lad-el[data-el]');
    var h=g.querySelector('.hit');var r=h.getBoundingClientRect();
    return JSON.stringify({id:h.dataset.el,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  const PT = JSON.parse(hitId);
  const tp = await ev(`(function(){var l=LadEdit.locate(LadEdit.state.blk,'${PT.id}');return l?l.el.type+'|'+l.el.addr:'?';})()`);
  if (String(tp).indexOf('NO') === 0) {
    const v0 = await ev(`TIA.plc.read('${String(tp).split('|')[1]}')`);
    await ev(`(function(){var el=document.elementFromPoint(${PT.x},${PT.y});
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:${PT.x},clientY:${PT.y},button:0,pointerId:1,isPrimary:true}));return 1;})()`);
    await sleep(250);
    const v1 = await ev(`TIA.plc.read('${String(tp).split('|')[1]}')`);
    await ev(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,isPrimary:true}))`);
    await sleep(250);
    ok(v0 !== v1, '在线监视下按住触点仍能改状态', String(v0) + ' → ' + String(v1));
  } else {
    ok(false, '在线监视下按住触点仍能改状态', '首个元件不是 NO：' + tp);
  }

  // ---------- 10. 点「离线」：全部回位 ----------
  await ev(`document.querySelector('.tb[data-act="offline"]').click()`);
  await sleep(800);
  const after = JSON.parse(await ev(`JSON.stringify({
    online:TIA.online, run:TIA.running, mon:TIA.monitor, runtime:TIA.plc.runtime,
    cycle:TIA.plc.cycleCount,
    sim:TIA.openTabs.some(function(t){return t.kind==='sim';}),
    q:TIA.plc.read('Q0.0'), m:TIA.plc.read('M0.0')
  })`));
  ok(after.online === false, '离线后 online = false');
  ok(after.run === false && after.runtime === false, '离线后 CPU STOP', 'run=' + after.run + ' runtime=' + after.runtime);
  ok(after.mon === false, '离线后监视关闭');
  ok(after.sim === false, '离线后仿真面板已关闭');
  ok(after.cycle === 0, '离线后循环计数归零', after.cycle);
  ok(after.q === false && after.m === false, '离线后 Q/M 已复位', 'Q=' + after.q + ' M=' + after.m);
  ok(await ev(`(function(){var b=document.querySelector('.tb[data-act="offline"]');return !!b&&b.classList.contains('active');})()`), '离线按钮高亮');

  // ---------- 11. 离线后恢复可编辑 ----------
  ok(await ev(`(function(){var w=document.querySelector('.lad-wrap');return !w||!w.classList.contains('lad-readonly');})()`), '离线后退出只读外观');
  await ev(`(function(){var h=document.querySelector('.lad-el .hit');h.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
  await sleep(250);
  ok(await ev(`document.querySelectorAll('.selbox').length===1`), '离线后点元件恢复选中');

  // ---------- 12. 再点「在线」：自动 RUN，计数从 0 ----------
  const re = JSON.parse(await ev(`(function(){
    document.querySelector('.tb[data-act="online"]').click();
    return JSON.stringify({online:TIA.online,run:TIA.running,cycle:TIA.plc.cycleCount});
  })()`));
  ok(re.online === true && re.run === true, '再点「在线」自动进入 RUN', 'online=' + re.online + ' run=' + re.run);
  ok(re.cycle === 0, '再次上线后循环计数从 0 开始', re.cycle);

  // ---------- 13. 标签不再压到器件 ----------
  // 上线会自动跳到仿真面板，先切回梯形图页再量标签
  await ev(`(function(){
    var n=document.querySelector('#treeBody .node[data-node="block:OB1"]')||document.querySelector('[data-key^="block:"]');
    if(n)n.click();return true;})()`);
  await sleep(800);
  const labelGap = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg'); if(!svg) return 'no svg';
    var bad=0, minGap=99;
    svg.querySelectorAll('.lad-el').forEach(function(g){
      var hit=g.querySelector('.hit'); if(!hit) return;
      var cy=+hit.getAttribute('y') + +hit.getAttribute('height')/2;
      var sym=g.querySelector('.lt-sym');
      if(sym){ var b=sym.getBBox(); var gap=Math.round((cy-9)-(b.y+b.height)); if(gap<minGap)minGap=gap; if(gap<0)bad++; }
    });
    return bad+'|'+minGap;
  })()`);
  const [lbad, lgap] = String(labelGap).split('|');
  ok(Number(lbad) === 0, '符号名标签不再压住触点符号', '最小间隙 ' + lgap + 'px');

  ok(logs.length === 0, '无运行时异常', logs.join(' | ') || '无');
  console.log('\n通过 ' + pass + '/' + (pass + fail));
  spawn('taskkill', ['/PID', String(p.pid), '/T', '/F']);
  setTimeout(() => process.exit(fail ? 1 : 0), 400);
})();
