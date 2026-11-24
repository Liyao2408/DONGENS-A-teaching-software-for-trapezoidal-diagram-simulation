/* ============================================================
 * test-ton-live.js — 在线监视时"值显示在哪儿" + 比较盒里的数字
 *
 * 用户现场（截图）：TON 的当前值跑到盒体上方一个浮框里，
 * PT 每周期都在变；比较指令填了数字，盒里还挂着 ???。
 *
 * 断言：
 *   1) 在线时 PT 保持设定值 T#4s（不倒数、不乱跑）
 *   2) ET 在 ET 引脚右侧显示已过时间（~3.3s）
 *   3) 盒体上方没有多出来的值气泡（.lad-val）
 *   4) 比较指令 IN2 填了 5，盒内显示 5（不再是 ???）
 *   5) 比较指令没选类型、也没填数字时，仍显示 ???
 *   6) 重渲染会收掉残留的内联编辑框
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-ton-live.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9880 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'tonlive' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + (((r.result.exceptionDetails || {}).exception || {}).description || '').slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');

  const R = [];
  const ck = (n, c, x) => { R.push(!!c); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  const setNets = async (json) => {
    await ev(`(function(){
      var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
      ob1.networks=${json};
      LadEdit.rerender({keepScroll:true});
      return true;
    })()`);
    await sleep(500);
  };

  /* ---------------- 1. 离线渲染：PT 就是设定值 ---------------- */
  await setNets(`[{title:'ton',columns:[{branches:[[{id:'t1',type:'TON',instance:'t1',db:1,params:{PT:'T#4s'}}]]}]}]`);

  /* ---------------- 2. 比较盒里的数字 ---------------- */
  await setNets(`[{title:'cmp',columns:[
    {branches:[[{id:'k1',type:'CMP',params:{IN1:'MW10',IN2:'5'}},
                {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}]`);
  const boxNum = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    if(!svg) return 'NO SVG';
    return [].map.call(svg.querySelectorAll('text'),function(x){return x.textContent;}).join('|');
  })()`);
  ck('IN2 填 5 后，盒内的 ??? 变成 5', String(boxNum).split('|').indexOf('5') >= 0 &&
    String(boxNum).split('|').indexOf('???') < 0, boxNum);
  ck('上方 IN1 仍然显示 MW10', String(boxNum).split('|').indexOf('MW10') >= 0, boxNum);

  // 没填数字、没选类型 → 还是 ???
  await setNets(`[{title:'cmp2',columns:[
    {branches:[[{id:'k2',type:'CMP',params:{IN1:'MW10'}},
                {id:'o2',type:'COIL',operand:'Q0.1',addr:'Q0.1'}]]}
  ]}]`);
  const boxQ = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    return svg?[].map.call(svg.querySelectorAll('text'),function(x){return x.textContent;}).join('|'):'NO SVG';
  })()`);
  ck('没填数字、没选类型 → 盒里还是 ???', String(boxQ).split('|').indexOf('???') >= 0, boxQ);

  // 选了类型 → 显示类型，不被数字顶掉
  await setNets(`[{title:'cmp3',columns:[
    {branches:[[{id:'k3',type:'CMP',params:{IN1:'MW10',IN2:'5',TYPE:'Int'}},
                {id:'o3',type:'COIL',operand:'Q0.2',addr:'Q0.2'}]]}
  ]}]`);
  const boxTy = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    return svg?[].map.call(svg.querySelectorAll('text'),function(x){return x.textContent;}).join('|'):'NO SVG';
  })()`);
  ck('选了 Int 就显示 Int（类型优先于数字）', String(boxTy).split('|').indexOf('Int') >= 0, boxTy);

  /* ---------------- 3. 残留内联编辑框 ---------------- */
  await ev(`(function(){
    var b=document.createElement('div'); b.id='inlineEdit'; document.body.appendChild(b);
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(400);
  ck('重渲染会收掉残留的内联编辑框', (await ev("!!document.getElementById('inlineEdit')")) === false);

  /* ---------------- 4. 在线：PT 不动、ET 在引脚旁 ---------------- */
  await ev(`(function(){
    var pr=TIA.project;
    var ob1=pr.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'在线',columns:[{branches:[[{id:'t1',type:'TON',instance:'t1',db:1,params:{PT:'T#1m'}}]]}]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(500);

  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1600);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(900);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  // 推进 3.37s（337 个 10ms 周期）
  await ev(`(function(){for(var i=0;i<337;i++){TIA.plc.step(TIA.project);}return true;})()`);
  // 真实流程里切监视会重绘编辑器（doToggleMonitor → renderEditor），这里照做
  await ev(`(function(){App.monitor=true;App.online=true;LadEdit.rerender({keepScroll:true});return true;})()`);
  await sleep(500);
  await ev(`(function(){if(window.LadLive&&LadLive.update)LadLive.update();return true;})()`);
  await sleep(700);

  const liveTx = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    if(!svg) return 'NO SVG';
    var o={};
    [].forEach.call(svg.querySelectorAll('text'),function(x){
      var p=x.getAttribute('data-prm')||'';
      if(/:PT$/.test(p)) o.PT=x.textContent;
      if(/:ET$/.test(p)) o.ET=x.textContent;
    });
    return JSON.stringify(o);
  })()`);
  const o = JSON.parse(String(liveTx));
  ck('在线时 PT 保持设定值 T#1m（不再倒计时乱跑）', o.PT === 'T#1m', o.PT);
  ck('在线时 ET 显示已过时间（随时间递增，不等于 PT）',
    /^T#/.test(String(o.ET)) && String(o.ET) !== 'T#1m', o.ET);

  const badges = await ev(`document.querySelectorAll('.network[data-net="0"] .lad-val').length`);
  ck('定时器盒体上方没有"气泡"式乱飘的值（.lad-val 不出现）', badges === 0, badges);

  /* 盒体上方的值框：要显示"经过的值" */
  const vbox = await ev(`(function(){
    var t=document.querySelector('.network[data-net="0"] [data-tvbox]');
    if(!t) return 'NONE';
    var r=t.getBoundingClientRect();
    var box=t.closest('.lad-el').querySelector('.hit');
    var rb=box?box.getBoundingClientRect():null;
    return JSON.stringify({txt:t.textContent, kind:t.getAttribute('data-kind'),
      above: rb ? (r.bottom <= rb.top) : null});
  })()`);
  const vb = (function(){ try { return JSON.parse(String(vbox)); } catch (e) { return {}; } })();
  ck('盒体上方有值框，内容是经过的值（T#…）', /^T#/.test(String(vb.txt)) && vb.kind === 'ET', vbox);
  ck('值框位于盒体上方（不是盒内、不是引脚旁）', vb.above === true, vbox);

  /* 计数器：值框显示当前计数 CV */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'ct',columns:[{branches:[[{id:'c1',type:'CTU',instance:'CTU_DB',db:2,params:{PV:'5'}}]]}]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  await ev(`(function(){
    for(var i=0;i<5;i++) TIA.plc.step(TIA.project);
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(400);
  const cvBox = await ev(`(function(){
    var t=document.querySelector('.network[data-net="0"] [data-tvbox]');
    return t?JSON.stringify({txt:t.textContent,kind:t.getAttribute('data-kind')}):'NONE';
  })()`);
  ck('计数器的值框显示当前计数（kind=CV）', /"kind":"CV"/.test(String(cvBox)), cvBox);

  /* 比较指令：不在指令上方加框；比较取的是关联实例"正在跑的那个数"
     用户口径：PT 设 T#10s、下方填 5 → 跑到 5s 时比较才闭合输出 */
  await ev(`(function(){
    var pr=TIA.project;
    var ob1=pr.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'ton',columns:[{branches:[[{id:'tz1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#10s'}}]]}]},
      {title:'cmp',columns:[{branches:[[
        {id:'k1',type:'CMP_GE',params:{IN1:'"TON_DB".PT',IN2:'5',TYPE:'Time'}},
        {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}
      ]]}]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);
  // 停掉后台扫描循环：不然每 50ms 还在自己 step，手动步进的秒数就对不上了
  await ev(`(function(){
    if(App.scanTimer){ clearInterval(App.scanTimer); App.scanTimer=null; }
    TIA.plc.cycleTime = 10;
    // 清掉这个定时器的运行状态，从 0 开始数（前面切网络时已经跑掉一点时间）
    for(var k in TIA.plc.timers){ if(k.indexOf('tz1')>=0) delete TIA.plc.timers[k]; }
    App.monitor=true; App.online=true;
    LadEdit.rerender({keepScroll:true});
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(600);

  const cmpBoxCount = await ev("document.querySelectorAll('[data-cmpbox]').length");
  ck('比较指令上方不再加值框（按用户要求去掉）', cmpBoxCount === 0, cmpBoxCount);

  // 走到 ~2.5s：还没到 5s，比较不成立，Q0.0 应断开
  await ev(`(function(){for(var i=0;i<250;i++) TIA.plc.step(TIA.project);return true;})()`);
  const at25 = await ev(`(function(){
    return JSON.stringify({et:TIA.plc.read('"TON_DB".ET'), q:TIA.plc.read('Q0.0')});
  })()`);
  const s25 = (function(){ try { return JSON.parse(String(at25)); } catch (e) { return {}; } })();
  ck('运行值 2.5s（PT 设 10s）时还没到 5s：比较断开，Q0.0=0',
    s25.et >= 2000 && s25.et < 5000 && s25.q === false, at25);

  // 再走到 ~5.5s：经过值到 5s 了，比较闭合
  await ev(`(function(){for(var i=0;i<300;i++) TIA.plc.step(TIA.project);return true;})()`);
  const at55 = await ev(`(function(){
    return JSON.stringify({et:TIA.plc.read('"TON_DB".ET'), q:TIA.plc.read('Q0.0')});
  })()`);
  const s55 = (function(){ try { return JSON.parse(String(at55)); } catch (e) { return {}; } })();
  ck('运行值到 5s 以后：比较闭合，Q0.0=1（取运行值而不是 PT 设定值）',
    s55.et >= 5000 && s55.q === true, at55);

  /* 计数器同理：写 .CV 取当前计数（PV 设 10、CV 现在 0 → 0 < 5 应成立） */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'ct',columns:[{branches:[[{id:'c1',type:'CTU',instance:'CTU_DB',db:2,params:{PV:'10'}}]]}]},
      {title:'cmp2',columns:[{branches:[[
        {id:'k2',type:'CMP_LT',params:{IN1:'"CTU_DB".CV',IN2:'5',TYPE:'Int'}},
        {id:'o2',type:'COIL',operand:'Q0.1',addr:'Q0.1'}
      ]]}]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  await ev(`(function(){for(var i=0;i<3;i++) TIA.plc.step(TIA.project);return true;})()`);
  const ctCmp = await ev(`(function(){
    return JSON.stringify({cv:TIA.plc.read('"CTU_DB".CV'), q:TIA.plc.read('Q0.1')});
  })()`);
  ck('计数器比较取当前计数 CV（CV<5 成立，不是拿 PV 设定值 10 去比）',
    (function () { try { var o = JSON.parse(String(ctCmp)); return o.cv >= 0 && o.cv < 5 && o.q === true; } catch (e) { return false; } })(),
    ctCmp);

  /* 两行定时器：下一行的值框不能压到上一行盒体上 */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'two',columns:[{branches:[
      [{id:'t1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#10s'}}],
      [{id:'t2',type:'TOF',instance:'TOF_DB',db:2,params:{PT:'T#4s'}}]
    ]}]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(700);
  await ev(`(function(){
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    if(window.LadLive&&LadLive.update) LadLive.update();
    return true;
  })()`);
  await sleep(500);
  const overlap = await ev(`(function(){
    var els=document.querySelectorAll('.network[data-net="0"] .lad-el');
    if(els.length<2) return 'LESS';
    var a=els[0], b=els[1];
    var ab=a.querySelector('.lad-body') ? a.querySelector('.lad-body').getBoundingClientRect() : a.getBoundingClientRect();
    var bb=b.getBoundingClientRect();
    var vbox=b.querySelector('.lad-vbox');
    var vb=vbox?vbox.getBoundingClientRect():null;
    return JSON.stringify({aBottom:Math.round(ab.bottom), bTop:Math.round(bb.top),
      vboxTop: vb?Math.round(vb.top):null, clear: vb ? (vb.top >= ab.bottom) : null});
  })()`);
  ck('第二行定时器的值框不压第一行盒体', /"clear":true/.test(String(overlap)), overlap);

  if (logs.length) console.log('\n页面异常:\n' + logs.slice(0, 5).join('\n'));
  ws.close(); killTree(p);
  const bad = R.filter(x => !x).length;
  console.log('\n通过 ' + (R.length - bad) + '/' + R.length);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.stack || e.message); process.exit(2); });
