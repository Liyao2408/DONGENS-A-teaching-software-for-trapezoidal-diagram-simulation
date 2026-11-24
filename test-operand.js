const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9600 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'op' + Date.now()),
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

  // ===== 1. 盒式指令（FB）：插入自动弹"调用选项"；参数对话框走右键"属性" =====
  await ev(`(function(){var g=document.querySelector('[data-group="timer"]'); if(g) g.click();})()`);
  await sleep(500);
  await ev(`(function(){
    var el=document.querySelector('.cat-item[data-ins="TON"]');
    if(el) el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(1000);

  // 对齐 TIA：插入 TON 自动弹出调用选项对话框
  ck('插入 TON 自动弹调用选项', await ev(`document.getElementById('modalMask').classList.contains('show')`));
  ck('调用选项含名称输入', await ev(`!!document.getElementById('callDbName')`));

  // 取消（不命名）：TON 保持 <???> 占位
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn:not(.primary)');if(b)b.click();})()`);
  await sleep(500);
  ck('取消可关闭调用选项', await ev(`!document.getElementById('modalMask').classList.contains('show')`));
  ck('未命名时实例占位符存在', await ev(`!!document.querySelector('[data-inst]')`));

  // 双击盒体 = 再次打开调用选项
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    var last=els[els.length-1];
    if(last) last.querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(800);
  ck('双击盒体打开调用选项', await ev(`!!document.getElementById('callDbName')`));
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn:not(.primary)');if(b)b.click();})()`);
  await sleep(500);

  // 右键 → 属性…：参数对话框（原双击弹窗已移到这里）
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    var last=els[els.length-1];
    if(last) last.querySelector('.hit').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
  })()`);
  await sleep(600);
  await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#ladMenu .lad-menu-row, #ladMenu div'));
    var hit=rows.filter(function(r){return r.textContent.indexOf('属性')>=0;})[0];
    if(hit) hit.click();
  })()`);
  await sleep(800);
  ck('右键属性打开参数对话框', await ev(`document.getElementById('modalMask').classList.contains('show')`));
  const prmRows = await ev(`document.querySelectorAll('.modal-body .prm').length`);
  ck('有参数输入行', prmRows >= 2, 'rows=' + prmRows);
  const prmSel = await ev(`document.querySelectorAll('.modal-body .prm-sel').length`);
  ck('每个参数都有符号下拉', prmSel === prmRows, 'sels=' + prmSel);
  const selOpts = await ev(`(function(){var s=document.querySelector('.modal-body .prm-sel');return s?s.options.length:0;})()`);
  ck('符号下拉含变量表内容', selOpts > 3, 'options=' + selOpts);

  await ev(`(function(){var b=document.querySelector('.modal-foot .btn:not(.primary)');if(b)b.click();})()`);
  await sleep(500);
  ck('取消可关闭对话框', await ev(`!document.getElementById('modalMask').classList.contains('show')`));

  // ===== 2. 触点/线圈：双击走内联编辑，不弹窗 =====
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    if(els.length) els[0].querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(700);

  ck('触点双击不弹模态框', await ev(`!document.getElementById('modalMask').classList.contains('show')`));
  ck('触点双击出现内联编辑框', await ev(`!!document.getElementById('inlineEdit')`));
  const ieSel = await ev(`!!document.querySelector('#inlineEdit .ie-sel')`);
  ck('内联编辑有下拉候选', ieSel === true);
  const ieOpts = await ev(`(function(){var s=document.querySelector('#inlineEdit .ie-sel');return s?s.options.length:0;})()`);
  ck('内联候选含变量表内容', ieOpts > 3, 'options=' + ieOpts);

  // ===== 3. 大写 + 回车提交 =====
  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    i.value='q0.5';
    i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(300);
  const upVal = await ev(`document.querySelector('#inlineEdit input').value`);
  ck('输入自动转大写', upVal === 'Q0.5', upVal);

  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await sleep(800);
  ck('回车后关闭编辑框', await ev(`!document.getElementById('inlineEdit')`));

  const firstEl = await ev(`(function(){
    var blk=TIA.project.blocks[0];
    var br=blk.networks[0].columns[0].branches[0];
    return br.length? JSON.stringify({addr:br[0].addr||'', sym:br[0].operand||''}) : 'NONE';
  })()`);
  console.log('第一个元件: ' + firstEl);
  ck('地址已写入 Q0.5', firstEl.indexOf('Q0.5') >= 0, firstEl);

  // ===== 4. Esc 取消不写入 =====
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    if(els.length) els[0].querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(600);
  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    i.value='M99.9';
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  })()`);
  await sleep(600);
  const afterEsc = await ev(`(function(){
    var blk=TIA.project.blocks[0];
    var br=blk.networks[0].columns[0].branches[0];
    return br.length? (br[0].addr||'') : 'NONE';
  })()`);
  ck('Esc 取消不写入', afterEsc === 'Q0.5', afterEsc);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/v24-operand.png', Buffer.from(shot.result.data, 'base64'));

  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 4).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + '/' + R.length);
  ws.close(); killTree(p); process.exit(pass === R.length ? 0 : 1);
})();
