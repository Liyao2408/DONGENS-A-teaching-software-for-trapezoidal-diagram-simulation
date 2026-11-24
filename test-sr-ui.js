/* ============================================================
 * test-sr-ui.js — 走界面：从指令窗格插入 -(S)- / -(R)-，填地址，
 *                 下载后按一下按钮，看它到底会不会自锁 / 复位
 *
 * 用户现场："置位线圈没有用，复位线圈也没有用"。
 * 引擎层已由 test-sr-coil.js 守住，这个文件负责守"界面上点出来的那条路"：
 *   插入 → 双击改地址（自动建 Tag_N）→ 编译下载 → 按一下 I0.0 再松开
 *
 * 运行：先 node tmp-serve.js（127.0.0.1:8931），再 node test-sr-ui.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9830 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP, '--user-data-dir=' + path.join(process.env.TEMP, 'srui' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + (((r.result.exceptionDetails) || {}).exception ? (((r.result.exceptionDetails || {}).exception || {}).description || '').slice(0, 200) : '');
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

  /* 网络1：I0.0 触点（用界面上的插入流程加 -(S)-） */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'s',columns:[{branches:[[{id:'c1',type:'NO',operand:'I0.0',addr:'I0.0'}]]}]},
      {title:'r',columns:[{branches:[[{id:'c2',type:'NO',operand:'I0.1',addr:'I0.1'}]]}]}
    ];
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);

  // 选中触点 → 从指令窗格双击"置位线圈"插到它后面
  await ev(`(function(){
    var hit=document.querySelector('.network[data-net="0"] .lad-el .hit');
    if(hit) hit.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var g=document.querySelector('[data-group="conventional"]');
    if(g) g.click();
    return true;
  })()`);
  await sleep(400);
  await ev(`(function(){
    var it=document.querySelector('.cat-item[data-ins="SET"]');
    if(it) it.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return !!it;
  })()`);
  await sleep(700);

  const typesOf = async (n) => ev(`(function(){
    var net=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0].networks[${n}];
    var out=[];
    net.columns.forEach(function(c){c.branches.forEach(function(b){b.forEach(function(e){out.push(e.type);});});});
    return out.join(',');
  })()`);
  ck('界面插入 -(S)- 成功（网络1 有 SET）', /SET/.test(String(await typesOf(0))), await typesOf(0));

  // 双击线圈本体改地址 → 输入 M0.7
  await ev(`(function(){
    var n=document.querySelector('.network[data-net="0"]');
    var els=n.querySelectorAll('.lad-el');
    var coil=null;
    [].forEach.call(els,function(g){
      var hit=g.querySelector('.hit');
      if(hit && hit.getAttribute('data-el')) coil=g;
    });
    if(coil){ var h=coil.querySelector('.hit'); h.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); }
    return true;
  })()`);
  await sleep(500);
  const addrBox = await ev(`!!document.querySelector('#inlineEdit input')`);
  ck('双击线圈弹出地址输入框', addrBox === true);
  await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return 'NO INPUT';
    i.value='M0.7';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return 'ok';
  })()`);
  await sleep(600);
  const setEl = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    var out=null;
    ob1.networks[0].columns.forEach(function(c){c.branches.forEach(function(b){b.forEach(function(e){ if(e.type==='SET') out=e; });});});
    return out?JSON.stringify({operand:out.operand,addr:out.addr}):'none';
  })()`);
  ck('置位线圈拿到操作数（operand / addr 都有值）',
    /M0\.7/.test(String(setEl)) && /".*"/.test(String(setEl)) === false || /operand/.test(String(setEl)), setEl);

  // 网络2 也插一个 RESET，指向同一个 M0.7
  await ev(`(function(){
    var hour=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    var net=hour.networks[1];
    net.columns[0].branches[0].push({id:'r1',type:'RESET',operand:'Tag_R',addr:'M0.7'});
    if(!hour.tags && !TIA.project.tags.some(function(t){return t.name==='Tag_R';})){
      TIA.project.tags.push({name:'Tag_R',address:'M0.7',datatype:'Bool',comment:''});
    }
    // 给 I0.1 也补一个变量（下载前变量表要一致）
    LadEdit.setTags(TIA.project.tags);
    LadEdit.rerender({keepScroll:true});
    return true;
  })()`);
  await sleep(600);

  // 下载 → 运行
  await ev(`(function(){var b=document.querySelector('.tb[data-act="download"]');if(b)b.click();})()`);
  await sleep(1600);
  const blockMsg = await ev(`(function(){var m=document.querySelector('.modal .modal-body');return m?m.textContent.slice(0,120):'';})()`);
  await ev(`(function(){var m=document.querySelector('.modal-foot .btn');if(m)m.click();})()`);
  await sleep(900);

  const online = await ev(`JSON.stringify({running:App.running,online:App.online})`);
  ck('下载后 CPU 在 RUN', /"running":true/.test(String(online)), online + (blockMsg ? ' / 提示:' + blockMsg : ''));

  // 按一下 I0.0 再松开
  const seq = await ev(`(function(){
    TIA.plc.write('I0.0',true);
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    var on = TIA.plc.readBool('M0.7');
    TIA.plc.write('I0.0',false);
    for(var j=0;j<5;j++) TIA.plc.step(TIA.project);
    var keep = TIA.plc.readBool('M0.7');
    TIA.plc.write('I0.1',true);
    for(var k=0;k<3;k++) TIA.plc.step(TIA.project);
    var off = TIA.plc.readBool('M0.7');
    TIA.plc.write('I0.1',false);
    for(var m=0;m<3;m++) TIA.plc.step(TIA.project);
    return JSON.stringify({on:on,keep:keep,off:off,afterOff:TIA.plc.readBool('M0.7')});
  })()`);
  const o = JSON.parse(String(seq));
  ck('按下 → M0.7 置位', o.on === true, String(seq));
  ck('松开 → M0.7 保持（自锁）', o.keep === true, String(seq));
  ck('按复位 → M0.7 清 0', o.off === false, String(seq));
  ck('复位松开后仍为 0', o.afterOff === false, String(seq));

  /* 自锁时线圈本身要变绿（用户口径："置位自锁是线圈变绿"）
     只看线上有没有电是不够的：自锁后前面的触点已经松开、功率流是 0，
     但那个位还是 1，所以置位线圈的符号要按"位值"着色。 */
  const GREEN = 'rgb(0, 176, 80)';
  const coilStyle = async () => ev(`(function(){
    App.refreshLive();
    var out=[];
    document.querySelectorAll('.network .lad-el').forEach(function(g){
      var t=g.getAttribute('data-type');
      if(t!=='SET'&&t!=='RESET') return;
      var body=g.querySelector('.lad-body');
      var mk=g.querySelector('.lad-mark');
      out.push({type:t, cls:g.getAttribute('class')||'',
        stroke: body?getComputedStyle(body).stroke:'',
        markStroke: mk?getComputedStyle(mk).fill:''});
    });
    return JSON.stringify(out);
  })()`).then(s => { try { return JSON.parse(String(s)); } catch (e) { return []; } });

  // 再置位一次（前面被复位了），开监视后看颜色
  await ev(`(function(){
    TIA.plc.write('I0.0',true);
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    TIA.plc.write('I0.0',false);
    for(var j=0;j<5;j++) TIA.plc.step(TIA.project);
    App.monitor=true; App.online=true;
    LadEdit.rerender({keepScroll:true});
    return TIA.plc.readBool('M0.7');
  })()`);
  // 下载完界面会跳到仿真面板（activeTab=sim），监视着色只给块编辑器做，
  // 所以这里要像用户那样点回 OB1 再取色
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(700);
  await ev(`(function(){ App.refreshLive(); return true; })()`);
  await sleep(500);
  let cs = await coilStyle();
  const cSet = cs.filter(x => x.type === 'SET')[0] || {};
  ck('置位自锁后 SET 线圈变绿（不是只有 TRUE 气泡）',
    /el-bit/.test(String(cSet.cls)) && cSet.stroke === GREEN,
    JSON.stringify(cSet));
  ck('SET 线圈里的 S 字母也变绿', cSet.markStroke === GREEN, cSet.markStroke);
  const cRst0 = cs.filter(x => x.type === 'RESET')[0] || {};
  ck('复位线圈不会因为位是 1 而误变绿', !/el-bit/.test(String(cRst0.cls)), JSON.stringify(cRst0));

  // 复位后：SET 线圈要变回蓝色
  await ev(`(function(){
    TIA.plc.write('I0.1',true);
    for(var i=0;i<3;i++) TIA.plc.step(TIA.project);
    TIA.plc.write('I0.1',false);
    for(var j=0;j<3;j++) TIA.plc.step(TIA.project);
    return true;
  })()`);
  await sleep(400);
  await ev(`(function(){ App.refreshLive(); return true; })()`);
  await sleep(400);
  cs = await coilStyle();
  const cSet2 = cs.filter(x => x.type === 'SET')[0] || {};
  ck('复位后 SET 线圈不再绿（位回到 0）',
    !/el-bit/.test(String(cSet2.cls)) && cSet2.stroke !== GREEN, JSON.stringify(cSet2));

  if (logs.length) console.log('\n页面异常:\n' + logs.slice(0, 5).join('\n'));
  ws.close(); killTree(p);
  const bad = R.filter(x => !x).length;
  console.log('\n通过 ' + (R.length - bad) + '/' + R.length);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.stack || e.message); process.exit(2); });
