// 用 CDP Input.dispatchMouseEvent 发送真实鼠标事件（走浏览器命中测试，等同真人操作）
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { enterViaPortal } = require('./test-helper.js');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9200 + Math.floor(Math.random() * 150);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'pt' + Date.now()),
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

  const R = []; const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  // __PORTAL_ENTRY__
  {
    let ok = false;
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      const r = await ev("(function(){var p=document.getElementById('portal');return !!(p && getComputedStyle(p).display!=='none' && document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
      if (r === true) { ok = true; break; }
    }
    if (ok) {
      await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
    }
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await ev('document.querySelectorAll(".network").length') > 0) break;
    }
  }
;

  // 取某个元件的屏幕坐标
  async function centerOf(sel) {
    return await ev(`(function(){
      var el=document.querySelector(${JSON.stringify(sel)});
      if(!el) return null;
      var r=el.getBoundingClientRect();
      return {x: r.left + r.width/2, y: r.top + r.height/2, w:r.width, h:r.height};
    })()`);
  }

  async function realDrag(from, to, steps) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(60);
    const n = steps || 8;
    for (let i = 1; i <= n; i++) {
      const x = from.x + (to.x - from.x) * i / n;
      const y = from.y + (to.y - from.y) * i / n;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'mouse' });
      await sleep(35);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(350);
  }

  // ---- 1. 确认 SVG 元件确实可拖（DragLayer 存在且 draggable 不依赖） ----
  ck('DragLayer 已加载', await ev('typeof DragLayer === "object"'));

  // ---- 2. 真实拖拽：把网络1 的线圈拖到第 1 列 ----
  const before = await ev('JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(c=>c.branches.map(b=>b.map(e=>e.type))))');
  console.log('拖前: ' + before);

  const coilSel = '.network[data-net="0"] .lad-el:nth-of-type(1)';
  // 精确定位：取网络1 中最后一个 lad-el（线圈）
  const src = await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    if(!els.length) return null;
    var el=els[els.length-1];
    var r=el.querySelector('.hit').getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};
  })()`);
  const dst = await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    if(!els.length) return null;
    var el=els[0];
    var r=el.querySelector('.hit').getBoundingClientRect();
    return {x:r.left+r.width*0.25, y:r.top+r.height/2};
  })()`);
  console.log('src=' + JSON.stringify(src) + ' dst=' + JSON.stringify(dst));

  if (src && dst) {
    await realDrag(src, dst, 10);
    const after = await ev('JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(c=>c.branches.map(b=>b.map(e=>e.type))))');
    console.log('拖后: ' + after);
    ck('真实鼠标拖拽可移动元件', before !== after, before === after ? '无变化' : '已变化');
  } else {
    ck('真实鼠标拖拽可移动元件', false, '未取到坐标');
  }

  // ---- 3. 面板拖拽到梯形图（先展开定时器分组，保证目标可见） ----
  await ev("(function(){var g=document.querySelector('[data-group=\"timer\"]'); if(g) g.click();})()");
  await sleep(400);
  const panelItem = await ev(`(function(){
    var el=document.querySelector('.cat-item[data-ins="TOF"]');
    if(!el) return null;
    var r=el.getBoundingClientRect();
    if(r.width===0) return null;
    return {x:r.left+r.width/2, y:r.top+r.height/2};
  })()`);
  const target = await ev(`(function(){
    var el=document.querySelector('.net-svg svg');
    if(!el) return null;
    var r=el.getBoundingClientRect();
    return {x:r.left+r.width-30, y:r.top+50};
  })()`);
  if (panelItem && target) {
    await realDrag(panelItem, target, 12);
    const hasMul = await ev(`JSON.stringify(TIA.project.blocks[0]).indexOf('"TOF"')>=0`);
    ck('面板拖拽插入指令（真实鼠标）', hasMul === true, 'TOF=' + hasMul);
  } else {
    ck('面板拖拽插入指令（真实鼠标）', false, '未取到坐标');
  }

  // ---- 4. 变量表下拉框 ----
  await ev(`document.querySelector('[data-node="tags:0"]').click()`);
  await sleep(400);
  const selCount = await ev('document.querySelectorAll(".tag-grid .cell-sel").length');
  ck('变量表有下拉框', selCount >= 16, 'selects=' + selCount);
  const dataTypeOpts = await ev(`(function(){
    var s=document.querySelector('.cell-sel[data-f="datatype"]');
    return s ? s.options.length : 0;
  })()`);
  ck('数据类型下拉有多个选项', dataTypeOpts >= 8, 'options=' + dataTypeOpts);

  // ---- 5. 新增变量地址递增 ----
  const addrProbe = await ev(`(function(){
    // 造两个测试变量：最后一个为 M1.0，新增应为 M1.1
    TIA.project.tags.length = 0;
    TIA.project.tags.push({name:'t1',address:'M1.0',datatype:'Bool',comment:''});
    document.querySelector('#addTag').click();
    var a1 = TIA.project.tags[TIA.project.tags.length-1].address;
    // 再放一个 Q1.0
    TIA.project.tags.push({name:'t2',address:'Q1.0',datatype:'Bool',comment:''});
    document.querySelector('#addTag').click();
    var a2 = TIA.project.tags[TIA.project.tags.length-1].address;
    return JSON.stringify({fromM10:a1, fromQ10:a2});
  })()`);
  const ap = JSON.parse(addrProbe);
  ck('M1.0 -> 新增 M1.1', ap.fromM10 === 'M1.1', ap.fromM10);
  ck('Q1.0 -> 新增 Q1.1', ap.fromQ10 === 'Q1.1', ap.fromQ10);

  // ---- 6. 删除后不留 EMPTY ----
  const emptyProbe = await ev(`(function(){
    var blk=TIA.project.blocks[0];
    // 在当前网络第一列构造两个元件
    blk.networks[0].columns[0].branches[0]=[
      {id:'tt1',type:'NO',operand:'I0.0'},
      {id:'tt2',type:'NO',operand:'I0.1'}
    ];
    LadEdit.mount(blk,TIA.activeTab,{});
    LadEdit.deleteElement('tt1');
    var br=blk.networks[0].columns[0].branches[0];
    return JSON.stringify(br.map(function(e){return e.type;}));
  })()`);
  ck('删除后不留 EMPTY 占位', emptyProbe.indexOf('EMPTY') < 0, emptyProbe);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('docs/v3-drag.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved docs/v3-drag.png');

  ws.close(); killTree(p);
  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 5).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + '/' + R.length);
  process.exit(pass === R.length ? 0 : 1);
})();




