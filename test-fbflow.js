/* E2E：FB 实例数据块完整流程（对齐 TIA 交互）
   插入 TON → 调用选项命名 time → 点 <???> 填 PT → 触点引用 "time".Q */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9700 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'fb' + Date.now()),
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

  // ===== 1. 插入 TON → 自动弹调用选项 → 命名 "time" =====
  await ev(`(function(){var g=document.querySelector('[data-group="timer"]'); if(g) g.click();})()`);
  await sleep(500);
  await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="TON"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(1000);
  ck('插入 TON 自动弹调用选项', await ev(`!!document.getElementById('callDbName')`));
  await ev(`(function(){var i=document.getElementById('callDbName');if(i){i.value='time';}})()`);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn.primary');if(b)b.click();})()`);
  await sleep(700);
  ck('实例头部已命名', await ev(`(function(){
    var t=document.querySelector('[data-inst]');
    return t ? /%DB1/.test(t.textContent) && /"time"/.test(t.parentNode.textContent) : false;
  })()`));

  // ===== 2. 点 PT 的 <???> 就地填 T#5s =====
  // TON 的 PT 有默认值 T#1s，先清掉再用 <???> 占位验证。直接双击 PT 值文本进入编辑。
  await ev(`(function(){
    var prm=document.querySelector('[data-prm$=":PT"]');
    if(prm) prm.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(600);
  ck('PT 出现内联编辑框', await ev(`!!document.getElementById('inlineEdit')`));
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i){i.value='T#5s';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`);
  await sleep(600);
  ck('PT 已写为 T#5s', await ev(`(function(){
    var prm=document.querySelector('[data-prm$=":PT"]');
    return prm ? prm.textContent === 'T#5s' : false;
  })()`));

  // ===== 3. 插入常开触点 + 线圈，触点引用 "time".Q =====
  await ev(`(function(){var g=document.querySelector('[data-group="contacts"],[data-group="bitlogic"]'); if(g) g.click();})()`);
  await sleep(500);
  await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="NO"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(800);
  // 双击触点 → 地址内联编辑 → 下拉里选 FB 实例 "time"
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    var last=els[els.length-1];
    if(last) last.querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(700);
  const fbOpt = await ev(`(function(){
    var s=document.querySelector('#inlineEdit .ie-sel');
    if(!s) return null;
    for(var i=0;i<s.options.length;i++) if(s.options[i].text.indexOf('time')>=0) return s.options[i].text;
    return null;
  })()`);
  ck('触点候选含 FB 实例 time', !!fbOpt, fbOpt);
  await ev(`(function(){
    var s=document.querySelector('#inlineEdit .ie-sel');
    if(!s) return;
    for(var i=0;i<s.options.length;i++){
      if(s.options[i].text.indexOf('time')>=0){ s.selectedIndex=i; s.dispatchEvent(new Event('change',{bubbles:true})); break; }
    }
  })()`);
  await sleep(700);
  // 二级菜单：选 Q
  const menuHasQ = await ev(`(function(){
    var m=document.getElementById('ladMenu'); if(!m) return null;
    var rows=[].slice.call(m.querySelectorAll('div'));
    var hit=rows.filter(function(r){return /^Q/.test(r.textContent.trim());})[0];
    if(hit){hit.click(); return true;} return null;
  })()`);
  ck('成员菜单出现并选中 Q', !!menuHasQ, menuHasQ);
  await sleep(700);
  ck('触点操作数显示 "time".Q', await ev(`(function(){
    var syms=[].slice.call(document.querySelectorAll('.lt-sym'));
    return syms.some(function(t){ return /time/.test(t.textContent) && /\.Q/.test(t.textContent); });
  })()`));
  ck('数据已写回触点', await ev(`(function(){
    if(!(window.LadEdit&&LadEdit.state&&LadEdit.state.blk)) return false;
    var found=false;
    LadEdit.state.blk.networks.forEach(function(n){n.columns.forEach(function(c){c.branches.forEach(function(b){
      b.forEach(function(e){ if(e.type==='NO'&&e.operand==='"time".Q') found=true; });
    });});});
    return found;
  })()`));

  // ===== 4. 重名检测：再插一个 TON 也命名 time → 两处标红 =====
  await ev(`(function(){var g=document.querySelector('[data-group="timer"]'); if(g) g.click();})()`);
  await sleep(400);
  await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="TON"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(1000);
  await ev(`(function(){var i=document.getElementById('callDbName');if(i){i.value='time';}})()`);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn.primary');if(b)b.click();})()`);
  await sleep(700);
  const dupRed = await ev(`(function(){
    var reds=[].slice.call(document.querySelectorAll('[data-inst]')).filter(function(t){
      return t.getAttribute('fill')==='#e0342f'||/e0342f/i.test(t.getAttribute('fill')||'');
    });
    return reds.length>=2;
  })()`);
  ck('重名实例标红（两处）', dupRed);

  killTree(p);
  const bad = R.filter(x => !x.ok);
  console.log('\n通过 ' + (R.length - bad.length) + '/' + R.length);
  if (logs.length) console.log('页面异常:\n' + logs.slice(0, 5).join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(2); });
