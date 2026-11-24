/* E2E：定时器框外时间值在线刷新 —— ET 正数 / PT 倒数（对齐 TIA 在线视图） */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9800 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'fbl' + Date.now()),
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
    if (r.result?.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
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

  // ===== 1. 插入 TON，命名 time，PT 设 T#5s =====
  await ev(`(function(){var g=document.querySelector('[data-group="timer"]'); if(g) g.click();})()`);
  await sleep(500);
  await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="TON"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(1000);
  await ev(`(function(){var i=document.getElementById('callDbName');if(i){i.value='time';}})()`);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn.primary');if(b)b.click();})()`);
  await sleep(700);
  await ev(`(function(){var prm=document.querySelector('[data-prm$=":PT"]');if(prm)prm.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(600);
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i){i.value='T#5s';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`);
  await sleep(600);

  // 离线渲染检查：时间值在框外（有短引线、data-tv 标记）
  ck('PT 值在框外且带 data-tv', await ev(`(function(){
    var t=document.querySelector('[data-tv$=":PT"]');
    return t ? t.textContent==='T#5s' && t.getAttribute('data-preset')==='T#5s' : false;
  })()`));
  ck('ET 离线默认灰色 T#0ms', await ev(`(function(){
    var t=document.querySelector('[data-tv$=":ET"]');
    return t ? t.textContent==='T#0ms' && t.getAttribute('fill')==='#9a9a9a' : false;
  })()`));

  // ET 端双击也可编辑时间
  await ev(`(function(){var prm=document.querySelector('[data-prm$=":ET"]');if(prm)prm.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(600);
  ck('ET 双击出现内联编辑框', await ev(`!!document.getElementById('inlineEdit')`));
  await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i){i.value='T#2s';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`);
  await sleep(600);
  ck('ET 已改为 T#2s', await ev(`(function(){
    var t=document.querySelector('[data-tv$=":ET"]');
    return t ? t.textContent==='T#2s' : false;
  })()`));

  // 框外 PT 值不得越过左母线
  ck('PT 值不越左母线', await ev(`(function(){
    var rail=document.querySelector('.lad-rail');
    var pt=document.querySelector('[data-tv$=":PT"]');
    if(!rail||!pt) return false;
    var rr=rail.getBoundingClientRect(), pr=pt.getBoundingClientRect();
    return pr.left >= rr.right - 2;
  })()`));

  // 盒子变短：TON 盒体宽度 < 170px
  ck('FB 盒已变短', await ev(`(function(){
    var t=document.querySelector('[data-tv$=":PT"]');
    if(!t) return false;
    var g=t.closest('.lad-el');
    var hit=g.querySelector('.hit');
    return hit && hit.getAttribute('width') < 170;
  })()`));

  // 编辑/选中后滚动位置保持（不再跳到顶部）
  await ev(`(function(){var s=document.querySelector('.lad-scroll');s.scrollTop=400;s.scrollLeft=30;})()`);
  await sleep(200);
  await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    var last=els[els.length-1];
    if(last) last.querySelector('.hit').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(900);
  await ev(`(function(){if(document.getElementById('inlineEdit'))document.getElementById('inlineEdit').remove();})()`);
  const sc = await ev(`(function(){var s=document.querySelector('.lad-scroll');return s?s.scrollTop+'|'+s.scrollLeft:'NONE';})()`);
  ck('编辑后滚动位置保持', sc !== 'NONE' && +sc.split('|')[0] > 300, sc);

  // ===== 1b. 真实鼠标双击（走浏览器命中测试，复现用户实际操作）=====
  // 取 PT 文字右侧 1/4 处（笔画间隙最容易穿透到盒体的位置）
  const ptPt = await ev(`(function(){
    var t=document.querySelector('[data-prm$=":PT"]');
    if(!t) return null;
    var r=t.getBoundingClientRect();
    return JSON.stringify({x: r.left + r.width*0.85, y: r.top + r.height/2});
  })()`);
  if (ptPt && ptPt !== 'null') {
    const pos = JSON.parse(ptPt);
    for (var ci = 0; ci < 2; ci++) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: ci + 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: ci + 1 });
      await sleep(80);
    }
    await sleep(700);
    ck('真实双击 PT 打开时间编辑（非调用选项）', await ev(`!!document.getElementById('inlineEdit') && !document.getElementById('callDbName')`));
    await ev(`(function(){var b=document.getElementById('inlineEdit');if(b)b.remove();})()`);
    await sleep(300);
  } else {
    ck('真实双击 PT 打开时间编辑（非调用选项）', false, 'PT 元素未找到');
  }

  // 母线到第 1 列的连线无断口：在 FB 所在行的中线上，母线右缘与盒体左缘之间必须命中导线
  ck('母线到 FB 盒连线无断口', await ev(`(function(){
    var rail=document.querySelector('.lad-rail');
    var g=document.querySelector('[data-tv$=":PT"]');
    if(!rail||!g) return false;
    var rr=rail.getBoundingClientRect();
    var hit=g.closest('.lad-el').querySelector('.hit').getBoundingClientRect();
    var y=hit.top+hit.height/2;
    var midX=(rr.right+hit.left)/2;
    var el=document.elementFromPoint(midX,y);
    return !!el && (el.tagName==='line' || el.tagName==='path' ||
      (el.tagName==='rect' && !el.getAttribute('data-prm')));
  })()`));

  // ===== 2. 下载上线（自动 RUN + 扫描循环） =====
  await ev(`document.querySelector('.tb[data-act="download"]').click()`);
  await sleep(2600);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
  await sleep(900);

  // TON 在触点链之后，需要给首个 I 接口上电（自锁模式）才有功率流
  await ev(`SimPanel.setMode('latch')`);
  await sleep(300);
  await ev(`(function(){
    var host=document.getElementById('simBody');
    if(host&&window.SimPanel) SimPanel.render(host,{plc:TIA.plc,project:TIA.project});
  })()`);
  await sleep(500);
  await ev(`(function(){
    var n=document.querySelector('.sim-node[data-kind="I"]');
    n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
    n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  })()`);
  await sleep(400);

  // 回到 OB1 块编辑页并开启监视（工具栏监视按钮）
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(700);
  await ev(`(function(){var b=document.querySelector('.tb[data-act="monitor"]');if(b)b.click();})()`);
  await sleep(600);
  ck('监视已开启', await ev(`TIA.monitor===true`), await ev(`String(TIA.monitor)`));

  // 离线时 TON 无输入功率流，ET 保持 0。直接用 plc 写不合适 ——
  // TON 的 IN 走功率流（网络直通母线），上线即开始计时
  const s1 = await ev(`(function(){
    var pt=document.querySelector('[data-tv$=":PT"]'), et=document.querySelector('[data-tv$=":ET"]');
    return pt?pt.textContent+'|'+et.textContent:'NONE';
  })()`);
  await sleep(2200);
  const s2 = await ev(`(function(){
    var pt=document.querySelector('[data-tv$=":PT"]'), et=document.querySelector('[data-tv$=":ET"]');
    return pt?pt.textContent+'|'+et.textContent:'NONE';
  })()`);
  console.log('  t1: ' + s1 + '   t2(+2.2s): ' + s2);
  ck('时间值格式 T#…', /^T#[\d.]+m?s\|T#[\d.]+m?s$/.test(s2), s2);
  ck('在线值在刷新（两次读数不同）', s1 !== 'NONE' && s1 !== s2, s1 + ' vs ' + s2);

  // 解析毫秒比较：PT 递减、ET 递增
  const cmp = await ev(`(function(){
    function ms(s){var m=/^T#([\\d.]+)(ms|s|m)/.exec(s);if(!m)return 0;return parseFloat(m[1])*(m[2]==='ms'?1:m[2]==='s'?1000:60000);}
    var pt=document.querySelector('[data-tv$=":PT"]').textContent;
    var et=document.querySelector('[data-tv$=":ET"]').textContent;
    return ms(pt)+'|'+ms(et);
  })()`);
  const parts = String(cmp).split('|').map(Number);
  ck('ET 在正数（>0）', parts[1] > 0, 'ET=' + parts[1] + 'ms');
  ck('PT 在倒数（<5000ms）', parts[0] < 5000, 'PT=' + parts[0] + 'ms');

  killTree(p);
  const bad = R.filter(x => !x.ok);
  console.log('\n通过 ' + (R.length - bad.length) + '/' + R.length);
  if (logs.length) console.log('页面异常:\n' + logs.slice(0, 5).join('\n'));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(2); });
