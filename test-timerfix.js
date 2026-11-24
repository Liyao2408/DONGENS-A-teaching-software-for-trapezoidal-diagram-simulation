/* ============================================================
 * test-timerfix.js — 定时器三项修复的回归测试（E2E）
 *   1) 定时器/计数器盒体上的 IN / Q 是功率流端子，不再显示红色 <???>
 *   2) PT 时间值编辑后不丢 T#（"5s" 统一存成 "T#5s"）
 *   3) 触点引用实例数据块成员（"TON_DB".Q）能编译、能真实延时通/延时断
 * 运行：先起本地服务（npx http-server -p 8931 -a 127.0.0.1），再 node test-timerfix.js
 * ============================================================ */
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'tf' + Date.now()),
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

  const R = [];
  const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 40; k++) {
    await sleep(250);
    if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length > 0") === true) break;
  }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  await sleep(1700);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);

  // 重建 OB1：只留一个空网络，便于从零搭
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];
    ob1.networks=[{title:'',columns:[{branches:[[]]}]}];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);

  const insert = async (ins) => {
    await ev(`(function(){
      var g=document.querySelector('[data-group="timer"]'); if(g) g.click();
    })()`);
    await sleep(300);
    await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="${ins}"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
    await sleep(800);
  };
  const setDbName = async (name) => {
    await ev(`(function(){var i=document.getElementById('callDbName');if(i){i.value=${JSON.stringify(name)};}})()`);
    await ev(`(function(){var b=document.querySelector('.modal-foot .btn.primary');if(b)b.click();})()`);
    await sleep(700);
  };

  /* ===== 1. TON：盒体不再出现 IN / Q 的问号 ===== */
  await insert('TON');
  await setDbName('TON_DB');
  ck('插入 TON 后实例名已显示', await ev(`(function(){
    var t=[].map.call(document.querySelectorAll('[data-inst]'),x=>x.textContent).join('|');
    return /TON_DB/.test(t) && /%DB1/.test(t);
  })()`));

  ck('TON 盒体无 <???> 占位（IN/Q 是接线端子）', await ev(`(function(){
    var g=document.querySelector('.lad-el'); if(!g) return false;
    var txt=[].map.call(g.querySelectorAll('text'),x=>x.textContent).join('|');
    return txt.indexOf('<?>')<0 && txt.indexOf('<???>')<0;
  })()`), await ev(`(function(){
    var g=document.querySelector('.lad-el');
    return g?[].map.call(g.querySelectorAll('text'),x=>x.textContent).join('|'):'NO EL';
  })()`));

  ck('IN/Q 行不再有可编辑命中区', await ev(`!document.querySelector('[data-prm$=":IN"]') && !document.querySelector('[data-prm$=":Q"]')`));
  ck('PT 仍可编辑（有命中区）', await ev(`!!document.querySelector('[data-prm$=":PT"]')`));

  /* ===== 2. PT 编辑不丢 T# ===== */
  const editPt = async (val) => {
    await ev(`(function(){var t=document.querySelector('[data-tv$=":PT"]')||document.querySelector('[data-prm$=":PT"]');if(t)t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
    await sleep(400);
    await ev(`(function(){var i=document.querySelector('#inlineEdit input');if(i){i.value=${JSON.stringify(val)};i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`);
    await sleep(500);
    return ev(`(function(){var t=document.querySelector('[data-tv$=":PT"]');return t?t.textContent:'NONE';})()`);
  };
  ck('输入 5s → 显示 T#5s', (await editPt('5s')) === 'T#5s', await ev(`(function(){var t=document.querySelector('[data-tv$=":PT"]');return t?t.textContent:'NONE';})()`));
  ck('输入 T#1S → 保留 T# 前缀', /^T#/.test(await editPt('T#1S')), await ev(`(function(){var t=document.querySelector('[data-tv$=":PT"]');return t?t.textContent:'NONE';})()`));
  ck('输入 1,5s → T#1.5s（逗号当小数点）', (await editPt('1,5s')) === 'T#1.5s');
  ck('PT 值存成规范字面量', (await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];var out='';
    ob1.networks.forEach(n=>n.columns.forEach(c=>c.branches.forEach(b=>b.forEach(e=>{if(e.type==='TON')out=String(e.params.PT);}))));
    return out;
  })()`)).indexOf('T#') === 0);

  /* ===== 3. 触点引用实例成员：可编译 ===== */
  // 网络 1：M10.5 触点 → TON → 线圈 Q0.0；网络 2："TON_DB".Q 触点 → 线圈 Q0.1
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];
    ob1.networks=[
      {title:'',columns:[
        {branches:[[{id:'cf1',type:'NO',operand:'M10.5',addr:'M10.5'}]]},
        {branches:[[{id:'ton1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#1s'}}]]},
        {branches:[[{id:'co1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
      ]},
      {title:'',columns:[
        {branches:[[{id:'cf2',type:'NO',operand:'"TON_DB".Q'}]]},
        {branches:[[{id:'co2',type:'COIL',operand:'Q0.1',addr:'Q0.1'}]]}
      ]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);
  const diagQ = await ev(`JSON.stringify(PLC.compileProject(TIA.project).map(d=>d.level+':'+d.text))`);
  ck('"TON_DB".Q 触点编译通过', String(diagQ).indexOf('未定义的符号') < 0, diagQ);

  // .PT 是 TIME，不能当触点：给出数据类型提示而不是"未定义符号"
  const diagPT = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];
    ob1.networks[1].columns[0].branches[0][0].operand='"TON_DB".PT';
    var d=PLC.compileProject(TIA.project).map(x=>x.text).join(' ; ');
    ob1.networks[1].columns[0].branches[0][0].operand='"TON_DB".Q';
    return d;
  })()`);
  ck('.PT 触点被识别为类型错误（并提示用 .Q）', /Time|Bool/.test(String(diagPT)) && /\.Q/.test(String(diagPT)), diagPT);

  /* ===== 4. 真实延时通 / 延时断 ===== */
  const tonRun = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'M0.0',addr:'M0.0'}]]},
      {branches:[[{id:'t1',type:'TON',instance:'T_ON',db:1,params:{PT:'T#1s'}}]]},
      {branches:[[{id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
    ]}];
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'M0.0',address:'M0.0',datatype:'Bool'},{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    plc.write('M0.0',true);
    for(var i=0;i<30;i++)plc.step(TIA.project);
    var early='@300ms Q0.0='+plc.readBool('Q0.0');
    for(var j=0;j<90;j++)plc.step(TIA.project);
    var late='@1200ms Q0.0='+plc.readBool('Q0.0');
    return early+' | '+late;
  })()`);
  ck('TON 真正延时通（<PT 不动作，>PT 动作）', /Q0.0=false/.test(String(tonRun)) && /Q0.0=true/.test(String(tonRun)), tonRun);

  const tofRun = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(b=>b.name==='OB1')[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'c1',type:'NO',operand:'M0.0',addr:'M0.0'}]]},
      {branches:[[{id:'t1',type:'TOF',instance:'T_OFF',db:2,params:{PT:'T#1s'}}]]},
      {branches:[[{id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
    ]}];
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'M0.0',address:'M0.0',datatype:'Bool'},{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    plc.write('M0.0',true);
    for(var i=0;i<20;i++)plc.step(TIA.project);
    var on='IN=1 Q0.0='+plc.readBool('Q0.0');
    plc.write('M0.0',false);
    for(var j=0;j<50;j++)plc.step(TIA.project);
    var hold='断500ms Q0.0='+plc.readBool('Q0.0');
    for(var k=0;k<70;k++)plc.step(TIA.project);
    var off='断1200ms Q0.0='+plc.readBool('Q0.0');
    return on+' | '+hold+' | '+off;
  })()`);
  ck('TOF 真正延时断（断电后保持 PT，再断开）',
    /IN=1 Q0.0=true/.test(String(tofRun)) && /断500ms Q0.0=true/.test(String(tofRun)) && /断1200ms Q0.0=false/.test(String(tofRun)),
    tofRun);

  ck('时间简写参与执行（5s = 5000ms）', (await ev(`PLC.toMs('5s')`)) === 5000 && (await ev(`PLC.toMs('T#1,5s')`)) === 1500);

  if (logs.length) console.log('\n页面异常:\n' + logs.slice(0, 6).join('\n'));
  killTree(p);
  const bad = R.filter(x => !x.ok);
  console.log('\n通过 ' + (R.length - bad.length) + '/' + R.length);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(2); });
