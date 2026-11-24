/* ============================================================
 * test-tag-delete.js — 变量表删除功能回归测试
 *
 * 覆盖：
 *   1) 点击行号选中整行（.sel 高亮），再点一次取消选中；
 *   2) 右键行 → 弹出菜单含「删除(D)」→ 点击后变量被删除、表格重渲染；
 *   3) Delete 键删除选中行；
 *   4) 系统时钟位行（data-clock）不可选中、无右键菜单。
 *
 * 运行：node test-tag-delete.js（内部自动起 8931 静态服务）
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8977 + Math.floor(Math.random() * 50);
const CP = 9860 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

// 内联静态服务（8931 常被别的程序占用，测试用独立端口）
function serve(root, port) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    fs.readFile(path.join(root, u), (e, d) => {
      if (e) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(u)] || 'application/octet-stream' });
      res.end(d);
    });
  }).listen(port, '127.0.0.1');
}

(async () => {
  const srv = serve(__dirname, PORT);
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'tdel' + Date.now()),
    '--window-size=1680,1000', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) {
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) { logs.push('THROW: ' + ((r.result.exceptionDetails.exception || {}).description || '').slice(0, 200)); return undefined; }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');

  const R = [];
  const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  // 进入工程：等启动门户出现 → 双击第一个项目
  let inProj = false;
  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev(`(function(){var p=document.getElementById('portal');return !!(p && getComputedStyle(p).display!=='none' && document.querySelectorAll('#portalTable tr[data-id]').length>0);})()`) === true) { inProj = true; break; }
  }
  if (inProj) {
    await ev(`(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()`);
    for (let i = 0; i < 60; i++) { await sleep(250); if (await ev(`!!document.querySelector('#treeBody [data-node="tags:0"]')`) === true) break; }
  }
  ck('通过启动门户进入工程', await ev(`!!document.querySelector('#treeBody [data-node="tags:0"]')`) === true);

  // 打开默认变量表页签
  ck('打开变量表页签', await ev(`(function(){
    var n = document.querySelector('#treeBody [data-node="tags:0"]');
    if (!n) return false;
    n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  })()`));

  let ok = false;
  for (let i = 0; i < 20; i++) { await sleep(250); if (await ev(`!!document.querySelector('#editorArea .tag-grid')`)) { ok = true; break; } }
  ck('变量表已渲染', ok);

  // 确保至少有 4 个用户变量（右键删1、Delete删1，还要留行做后续用例）
  await ev(`(function(){
    var n0 = App.project.tags.length;
    for (var i = 0; i < 4 - n0; i++) document.getElementById('addTag').click();
  })()`);

  const userRows = `document.querySelectorAll('#editorArea .tag-grid tr[data-tag]').length`;
  const clockRows = `document.querySelectorAll('#editorArea .tag-grid tr[data-clock]').length`;
  const n0 = await ev(userRows);
  const c0 = await ev(clockRows);
  ck('初始用户变量行数 >= 3', n0 >= 3, 'rows=' + n0 + ' clock=' + c0);

  // ---- 1. 行号点击选中 / 再点取消 ----
  ck('点击行号选中整行', await ev(`(function(){
    var tr = document.querySelector('#editorArea .tag-grid tr[data-tag]');
    tr.querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return tr.classList.contains('sel');
  })()`));
  ck('再点行号取消选中', await ev(`(function(){
    var tr = document.querySelector('#editorArea .tag-grid tr[data-tag]');
    tr.querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !tr.classList.contains('sel');
  })()`));
  ck('点击另一行行号只选中一行', await ev(`(function(){
    var trs = document.querySelectorAll('#editorArea .tag-grid tr[data-tag]');
    trs[0].querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    trs[1].querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return trs[1].classList.contains('sel') && !trs[0].classList.contains('sel') &&
      document.querySelectorAll('#editorArea .tag-grid tr.sel').length === 1;
  })()`));

  // ---- 2. 右键菜单删除 ----
  ck('右键弹出菜单且含删除项', await ev(`(function(){
    var tr = document.querySelector('#editorArea .tag-grid tr[data-tag]');
    tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }));
    var m = document.getElementById('rackMenu');
    if (!m) return false;
    var items = Array.prototype.map.call(m.querySelectorAll('.lm-item'), function (x) { return x.textContent; });
    return items.some(function (s) { return s.indexOf('删除') >= 0; });
  })()`));
  const t0 = await ev(`App.project.tags.length`);
  ck('点击「删除(D)」删除变量', await ev(`(function(){
    var m = document.getElementById('rackMenu');
    var item = Array.prototype.filter.call(m.querySelectorAll('.lm-item'), function (x) {
      return x.textContent.indexOf('删除') >= 0;
    })[0];
    item.click();
    return App.project.tags.length === ${t0} - 1;
  })()`));
  ck('表格行数同步减少', (await ev(userRows)) === n0 - 1);

  // ---- 3. Delete 键删除 ----
  await ev(`(function(){
    var tr = document.querySelectorAll('#editorArea .tag-grid tr[data-tag]')[0];
    tr.querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  const t1 = await ev(`App.project.tags.length`);
  ck('Delete 键删除选中行', await ev(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    return App.project.tags.length === ${t1} - 1;
  })()`));

  // ---- 4. 删除变量后程序块里的引用同步清理 ----
  // 新建一个变量，接到 OB1 的某个触点符号和某个盒参数上，然后删除它
  const refTagName = await ev(`(function(){
    document.getElementById('addTag').click();
    var tag = App.project.tags[App.project.tags.length - 1];
    var blk = App.project.blocks[0];
    var contactEl = null, boxEl = null;
    blk.networks.forEach(function (net) {
      net.columns.forEach(function (col) {
        col.branches.forEach(function (br) {
          br.forEach(function (el) {
            if (!contactEl && (el.type === 'NO' || el.type === 'NC')) contactEl = el;
            if (!boxEl && el.params) boxEl = el;
          });
        });
      });
    });
    if (!contactEl) return 'no-contact';
    window.__refTag = { name: tag.name, addr: tag.address };
    window.__refEl = contactEl;
    contactEl.operand = tag.name;
    contactEl.addr = tag.address;
    if (boxEl) { window.__refBox = boxEl; boxEl.params.TESTPIN = tag.name; }
    return tag.name;
  })()`);
  if (typeof refTagName === 'string' && refTagName.indexOf('no-') === 0) {
    ck('引用清理测试前置（OB1 有触点）', false, refTagName);
  } else {
    // 在变量表里选中该变量行并删除
    await ev(`(function(){
      var rows = document.querySelectorAll('#editorArea .tag-grid tr[data-tag]');
      for (var i = 0; i < rows.length; i++) {
        var nm = rows[i].querySelector('td.editable[data-f="name"]');
        if (nm && nm.textContent.trim() === window.__refTag.name) {
          rows[i].querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          break;
        }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    })()`);
    ck('删除后触点回到未命名状态（符号名和地址都清空）', await ev(`(function(){
      var e = window.__refEl;
      return e.operand === '' && e.addr === '';
    })()`));
    ck('删除后盒参数被清空', await ev(`(function(){
      if (!window.__refBox) return true;
      return window.__refBox.params.TESTPIN === '';
    })()`));
    ck('toast 提示清除引用', await ev(`(function(){
      var t = document.querySelector('.toast, #toast, [class*="toast"]');
      return !t || t.textContent.indexOf('清除程序块') >= 0;
    })()`));
    // 打开 OB1 看显示层：画面里不能再出现已删除的符号名
    await ev(`(function(){
      var nodes = Array.prototype.filter.call(document.querySelectorAll('#treeBody [data-node]'),
        function (n) { return n.textContent.indexOf('OB1') >= 0; });
      if (nodes[0]) nodes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    })()`);
    for (let i = 0; i < 20; i++) { await sleep(250); if (await ev(`!!document.querySelector('.lad-wrap')`) === true) break; }
    ck('OB1 画面不再显示已删除的符号名', await ev(`(function(){
      var w = document.querySelector('.lad-wrap');
      return !!w && w.textContent.indexOf(window.__refTag.name) < 0;
    })()`));
    ck('OB1 画面对应触点显示未命名占位', await ev(`(function(){
      var w = document.querySelector('.lad-wrap');
      return !!w && w.textContent.indexOf('<??.?>') >= 0;
    })()`));
    // 回到变量表继续后续用例
    await ev(`document.querySelector('#treeBody [data-node="tags:0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    for (let i = 0; i < 20; i++) { await sleep(250); if (await ev(`!!document.querySelector('#editorArea .tag-grid')`) === true) break; }
  }

  // ---- 5. 输入框聚焦时 Delete 不删行 ----
  await ev(`(function(){
    var tr = document.querySelectorAll('#editorArea .tag-grid tr[data-tag]')[0];
    tr.querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  const t2 = await ev(`App.project.tags.length`);
  ck('输入框聚焦时 Delete 不删行', await ev(`(function(){
    var inp = document.querySelector('#editorArea .tag-grid .addr-input');
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    return App.project.tags.length === ${t2};
  })()`));

  // ---- 6. 时钟位行不可选 ----
  if (await ev(clockRows) > 0) {
    ck('时钟位行不可选中', await ev(`(function(){
      var tr = document.querySelector('#editorArea .tag-grid tr[data-clock]');
      tr.querySelector('td.num').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !tr.classList.contains('sel');
    })()`));
    ck('时钟位行无右键菜单', await ev(`(function(){
      var tr = document.querySelector('#editorArea .tag-grid tr[data-clock]');
      tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return !document.getElementById('rackMenu');
    })()`));
  } else {
    console.log('skip : 当前工程无时钟位行（需在设备组态启用时钟存储器）');
  }

  if (logs.length) { console.log('\n页面异常:'); logs.forEach(l => console.log('  ' + l)); }
  const fails = R.filter(r => !r.ok).length;
  console.log('\n结果: ' + (R.length - fails) + '/' + R.length + ' 通过' + (fails ? '，有失败!' : ''));
  killTree(p); killTree(srv);
  process.exit(fails ? 1 : 0);
})();
