/* ============================================================
 * test-simvar.js — V35 变量驱动仿真面板 + 上线自动监视/面板
 *
 * 验证：
 *   1. 仿真面板的开关/灯数量完全由变量表里 Bool 类型的 I/Q/M 地址决定
 *      · 默认变量表：I0.0 / I0.1 / I0.2 + Q0.0 / Q0.1，MW10 / MW12 / MD20 不出现
 *   2. 变量表改成 I0.0、I0.1、Q0.1、M0.0 → 面板只剩 2 个 I、1 个 M 输入、
 *      1 个 Q、1 个 M 输出，并自动重建（不用手动关开面板）
 *   3. 输入（M）按住写 plc.mem.M，松开复位
 *   4. 输出（M）跟随程序写入的 M 值（只读）
 *   5. 点击"在线"自动开启监视 + 打开仿真面板
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9600 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'simvar' + Date.now()), '--window-size=1680,1000',
    'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list')); t = l.filter(x => x.url.includes('index.html')); if (t.length) break; } catch (e) { }
  }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 400));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300);
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');

  // ---- 进入工程 ----
  for (let k = 0; k < 40; k++) {
    await sleep(250);
    const r = await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
    if (r === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
  await sleep(1700);

  const R = []; const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  ck('SimPanel 已加载', await ev(`typeof SimPanel==='object'`));
  ck('在线按钮存在', await ev(`!!document.querySelector('.tb[data-act="online"]')`));
  ck('离线按钮存在', await ev(`!!document.querySelector('.tb[data-act="offline"]')`));

  // ---- 下载 → 自动在线 ----
  await ev(`document.querySelector('.tb[data-act="download"]').click()`);
  await sleep(2600);
  await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
  await sleep(1200);

  ck('下载后已在线', await ev(`TIA.online===true`));
  ck('下载后自动打开仿真面板', await ev(`TIA.activeTab && TIA.activeTab.kind==='sim'`),
    await ev(`TIA.activeTab?TIA.activeTab.kind:''`));

  // ===== 1. 默认变量表驱动的数量 =====
  const d = await ev(`(function(){
    function c(k){return document.querySelectorAll('#simBody .sim-node[data-kind="'+k+'"]').length;}
    return {I:c('I'),Q:c('Q'),MI:c('MI'),MQ:c('MQ'),
      iAddr:[].map.call(document.querySelectorAll('#simBody .sim-node[data-kind="I"]'),function(n){return n.dataset.addr;}),
      qAddr:[].map.call(document.querySelectorAll('#simBody .sim-node[data-kind="Q"]'),function(n){return n.dataset.addr;}),
      hasMW: !!document.querySelector('#simBody .sim-node[data-addr="MW10"]'),
      empty: document.querySelectorAll('#simBody .sim-empty').length};
  })()`);
  console.log('默认面板: ' + JSON.stringify(d));
  ck('默认变量表 → 输入（I）3 个', d.I === 3, d.I);
  ck('默认变量表 → 输出（Q）2 个', d.Q === 2, d.Q);
  ck('默认变量表 → 输入（M）0 个', d.MI === 0, d.MI);
  ck('默认变量表 → 输出（M）0 个', d.MQ === 0, d.MQ);
  ck('默认 I 地址就是 I0.0 / I0.1 / I0.2', d.iAddr.join(',') === 'I0.0,I0.1,I0.2', d.iAddr.join(','));
  ck('默认 Q 地址就是 Q0.0 / Q0.1', d.qAddr.join(',') === 'Q0.0,Q0.1', d.qAddr.join(','));
  ck('非 Bool / 整字地址（MW10）不生成开关', d.hasMW === false);
  ck('空组有提示文字（输入 M / 输出 M）', d.empty === 2, d.empty);

  // ===== 2. 变量表换成示例集合 → 面板自动重建 =====
  await ev(`(function(){window.__tagsBak=JSON.parse(JSON.stringify(TIA.project.tags));
    TIA.project.tags=[
      {name:'Btn_Start',address:'I0.0',datatype:'Bool',comment:'启动'},
      {name:'Btn_Stop',address:'I0.1',datatype:'Bool',comment:'停止'},
      {name:'Lamp',address:'Q0.1',datatype:'Bool',comment:'指示灯'},
      {name:'Flag_Auto',address:'M0.0',datatype:'Bool',comment:'自动标志'},
      {name:'Speed',address:'MD20',datatype:'DInt',comment:'设定转速'}
    ];return true;})()`);
  await sleep(900);   // 等扫描周期触发 refresh → 检测到指纹变化自动重建

  const e2 = await ev(`(function(){
    function c(k){return document.querySelectorAll('#simBody .sim-node[data-kind="'+k+'"]').length;}
    function a(k){return [].map.call(document.querySelectorAll('#simBody .sim-node[data-kind="'+k+'"]'),function(n){return n.dataset.addr;});}
    return {I:c('I'),Q:c('Q'),MI:c('MI'),MQ:c('MQ'),
      i:a('I'),q:a('Q'),mi:a('MI'),mq:a('MQ'),
      empty:document.querySelectorAll('#simBody .sim-empty').length};
  })()`);
  console.log('示例变量表: ' + JSON.stringify(e2));
  ck('示例变量表 → 输入（I）2 个', e2.I === 2, e2.I);
  ck('示例变量表 → 输入（M）1 个', e2.MI === 1, e2.MI);
  ck('示例变量表 → 输出（Q）1 个', e2.Q === 1, e2.Q);
  ck('示例变量表 → 输出（M）1 个', e2.MQ === 1, e2.MQ);
  ck('输入 M 就是 M0.0', e2.mi.join(',') === 'M0.0', e2.mi.join(','));
  ck('输出 M 就是 M0.0', e2.mq.join(',') === 'M0.0', e2.mq.join(','));
  ck('示例变量表 → 没有空组提示', e2.empty === 0, e2.empty);
  ck('MD20（DInt）没有变成开关', (await ev(`!!document.querySelector('#simBody .sim-node[data-addr="MD20"]')`)) === false);

  // ===== 3. 输入（M）按住写 M0.0，松开复位 =====
  await ev(`(function(){
    var n=document.querySelector('.sim-node[data-kind="MI"]');
    n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
  })()`);
  await sleep(350);
  ck('输入（M）按住 → M0.0 = TRUE', await ev(`TIA.plc.read('M0.0')===true`), await ev(`String(TIA.plc.read('M0.0'))`));
  ck('输入（M）圆形变绿', await ev(`document.querySelector('.sim-node[data-kind="MI"] .sn-circle').classList.contains('on')`) === true);

  await ev(`(function(){
    var n=document.querySelector('.sim-node[data-kind="MI"]');
    n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  })()`);
  await sleep(350);
  ck('输入（M）松开 → M0.0 = FALSE', await ev(`TIA.plc.read('M0.0')===false`), await ev(`String(TIA.plc.read('M0.0'))`));

  // ===== 4. 输出（M）只读跟随 =====
  ck('输出（M）是只读节点', await ev(`document.querySelector('.sim-node[data-kind="MQ"]').hasAttribute('data-readonly')`) === true);
  await ev(`TIA.plc.write('M0.0',true)`);
  await sleep(400);
  ck('程序写 M0.0 → 输出（M）灯亮', await ev(`document.querySelector('.sim-node[data-kind="MQ"] .sn-circle').classList.contains('on')`) === true);
  await ev(`TIA.plc.write('M0.0',false)`);
  await sleep(400);
  ck('M0.0 复位 → 输出（M）灯灭', await ev(`document.querySelector('.sim-node[data-kind="MQ"] .sn-circle').classList.contains('on')`) === false);

  // ===== 5. 点"在线"自动开监视 + 打开仿真面板 =====
  await ev(`document.querySelector('.tb[data-act="offline"]').click()`);
  await sleep(900);
  ck('离线后 monitor 关闭', await ev(`TIA.monitor===false`), await ev(`String(TIA.monitor)`));
  ck('离线后仿真面板已关闭', await ev(`!(TIA.activeTab && TIA.activeTab.kind==='sim')`));

  // 切到别的标签页，模拟"用户正在看梯形图"
  await ev(`(function(){var tr=document.querySelector('.tree-item[data-key^="block:"]')||document.querySelector('[data-key^="block:"]');if(tr)tr.click();return true;})()`);
  await sleep(600);

  // 点在线与读计数放在同一次求值里，避免扫描循环跑了几轮才读
  const on5 = await ev(`(function(){
    document.querySelector('.tb[data-act="online"]').click();
    return {online:TIA.online,monitor:TIA.monitor,run:TIA.running,
      tab:TIA.activeTab?TIA.activeTab.kind:'',cyc:TIA.plc.cycleCount};
  })()`);
  await sleep(400);
  console.log('点在线后: ' + JSON.stringify(on5));
  ck('点"在线"后已在线', on5.online === true);
  ck('点"在线"后 CPU 自动 RUN', on5.run === true);
  ck('点"在线"后自动开启监视', on5.monitor === true);
  ck('点"在线"后自动打开仿真面板', on5.tab === 'sim', on5.tab);
  ck('点"在线"后循环计数从 0 开始', on5.cyc <= 2, on5.cyc);

  // ---- 还原变量表 ----
  await ev(`(function(){if(window.__tagsBak)TIA.project.tags=window.__tagsBak;return true;})()`);

  const pass = R.filter(r => r.ok).length;
  console.log('\n===== ' + pass + ' / ' + R.length + ' 通过 =====');
  if (logs.length) console.log('页面异常:\n' + logs.join('\n'));
  if (pass !== R.length) { console.log('失败项: ' + R.filter(r => !r.ok).map(r => r.n).join(' | ')); }
  try { ws.close(); } catch (e) { }
  try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  process.exit(pass === R.length ? 0 : 1);
})();
