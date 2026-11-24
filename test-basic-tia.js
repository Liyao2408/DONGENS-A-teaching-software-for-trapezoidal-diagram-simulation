/* ============================================================
 * test-basic-tia.js — "基本指令照搬博途"的回归测试
 *
 * 覆盖三件事：
 *   1) 比较指令是触点式的（无 EN/ENO、无 IN1/IN2 行），
 *      盒内是「比较符 + 数据类型」，两个操作数在盒体上/下方（未赋值是红 <???>）；
 *   2) 计数器 CTU/CTD/CTUD 是 TIA 的引脚（CU/R/PV | Q/CV），无 EN/ENO，
 *      PV 是整数（未赋值红 <???>，绝不能显示成 T#10ms），R/LD 未接线显示灰 false；
 *   3) 语义按 IEC：CU 每个上升沿 +1、按住不加、R 复位优先、CV>=PV 时 Q=1；
 *      比较指令真的按 IN1/IN2 决定功率流通断。
 *
 * 运行：先起本地服务（node tmp-serve.js 或 npx http-server -p 8931），再 node test-basic-tia.js
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9860 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'bt' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + ((r.result.exceptionDetails.exception || {}).description || '').slice(0, 300);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');

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

  // 直接改工程数据然后重渲染，避免依赖点击流程（点击流程另有测试覆盖）
  const setNets = async (json) => {
    await ev(`(function(){
      var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
      ob1.networks=${json};
      LadEdit.rerender({keepScroll:true});
      return true;
    })()`);
    await sleep(600);
  };
  // 取某个网络里所有文本（用来判断画了什么）
  const textsOf = async (netIdx) => ev(`(function(){
    var svg=document.querySelector('.network[data-net="${netIdx}"] .net-svg > svg');
    if(!svg) return 'NO SVG';
    return [].map.call(svg.querySelectorAll('text'),function(x){return x.textContent;}).join('|');
  })()`);
  const fillsOf = async (netIdx, word) => ev(`(function(){
    var svg=document.querySelector('.network[data-net="${netIdx}"] .net-svg > svg');
    if(!svg) return 'NO SVG';
    var out=[];
    [].forEach.call(svg.querySelectorAll('text'),function(x){
      if(x.textContent===${JSON.stringify(word)}) out.push(x.getAttribute('fill'));
    });
    return out.join(',');
  })()`);

  /* ================= 1. 比较指令：触点式 ================= */
  await setNets(`[{title:'cmp',columns:[
    {branches:[[{id:'k1',type:'CMP'},{id:'k2',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}]`);

  const tCmp = String(await textsOf(0));
  ck('比较指令没有 EN / ENO', !/EN/.test(tCmp.replace(/IN1|IN2/g, '')), tCmp);
  ck('比较指令没有 IN1 / IN2 行标签', tCmp.indexOf('IN1') < 0 && tCmp.indexOf('IN2') < 0, tCmp);
  ck('盒内显示比较符 ==', tCmp.split('|').indexOf('==') >= 0, tCmp);
  ck('数据类型未选时显示 ???', tCmp.split('|').indexOf('???') >= 0, tCmp);
  ck('两个操作数未赋值 → 上下各一个红色 <???>',
    (tCmp.match(/<\?\?\?>/g) || []).length === 2, tCmp);
  ck('比较指令占一个格子（宽度 ≤ 100）', (await ev(`LAD.elWidth({type:'CMP'})`)) <= 100);

  /* 赋值后：上面是 IN1、下面是 IN2，类型可选 */
  await setNets(`[{title:'cmp2',columns:[
    {branches:[[{id:'k1',type:'CMP_GT',params:{IN1:'MW10',IN2:'5',TYPE:'Int'}},{id:'k2',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}]`);
  const tCmp2 = String(await textsOf(0));
  ck('赋值的操作数显示在盒体上下（MW10 / 5）', tCmp2.indexOf('MW10') >= 0 && tCmp2.split('|').indexOf('5') >= 0, tCmp2);
  ck('选了类型就显示 Int（不再是 ???）', tCmp2.split('|').indexOf('Int') >= 0 && tCmp2.split('|').indexOf('???') < 0, tCmp2);
  ck('比较符换成 >', tCmp2.split('|').indexOf('>') >= 0, tCmp2);

  /* ================= 2. 比较指令语义 ================= */
  const cmpRun = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'k1',type:'CMP_GT',params:{IN1:'MW10',IN2:'5',TYPE:'Int'}},{id:'k2',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
    ]}];
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'MW10',address:'MW10',datatype:'Int'},{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    function run(v){ plc.write('MW10',v); for(var i=0;i<3;i++)plc.step(TIA.project); return plc.readBool('Q0.0'); }
    return 'MW10=10 → '+run(10)+' | MW10=5 → '+run(5)+' | MW10=3 → '+run(3);
  })()`);
  ck('比较指令真的决定通断（10>5 通，5>5 断，3>5 断）',
    /MW10=10 → true/.test(String(cmpRun)) && /MW10=5 → false/.test(String(cmpRun)) && /MW10=3 → false/.test(String(cmpRun)),
    cmpRun);

  /* ================= 3. 计数器 CTU：TIA 引脚 ================= */
  await setNets(`[{title:'ctu',columns:[
    {branches:[[{id:'i1',type:'NO',operand:'I0.0',addr:'I0.0'},
      {id:'c1',type:'CTU',instance:'CTU_DB',db:6,params:{}},
      {id:'o1',type:'COIL',operand:'Q0.2',addr:'Q0.2'}]]}
  ]}]`);
  const tCtu = String(await textsOf(0));
  ck('CTU 没有 EN / ENO', tCtu.indexOf('ENO') < 0 && tCtu.split('|').indexOf('EN') < 0, tCtu);
  ck('CTU 块头是助记符 + Int', tCtu.split('|').indexOf('CTU') >= 0 && tCtu.split('|').indexOf('Int') >= 0, tCtu);
  ck('CTU 引脚齐全（CU / R / PV / Q / CV）',
    ['CU', 'R', 'PV', 'Q', 'CV'].every(function (n) { return tCtu.split('|').indexOf(n) >= 0; }), tCtu);
  ck('PV 未赋值 → 红色 <???>（不是 T#10ms）',
    tCtu.split('|').indexOf('<???>') >= 0 && tCtu.indexOf('T#') < 0, tCtu);
  ck('R 未接线显示灰色 false',
    (await fillsOf(0, 'false')).toLowerCase().indexOf('gray') >= 0 || /#8|#9|#7/.test(await fillsOf(0, 'false')),
    await fillsOf(0, 'false'));
  ck('CU / Q 是功率流端子（没有 <???> 占位）',
    !(await ev(`document.querySelector('[data-prm$=":CU"]') || document.querySelector('[data-prm$=":Q"]')`)));

  /* ================= 4. 计数器语义 ================= */
  const ctuRun = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'i1',type:'NO',operand:'M0.0',addr:'M0.0'},
        {id:'c1',type:'CTU',instance:'C1',db:6,params:{PV:'3'}},
        {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
    ]}];
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'M0.0',address:'M0.0',datatype:'Bool'},{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    function cyc(n){ for(var i=0;i<n;i++)plc.step(TIA.project); }
    function press(){ plc.write('M0.0',true); cyc(3); plc.write('M0.0',false); cyc(3); }
    plc.write('M0.0',true); cyc(3);            // 按下一次（上升沿）
    var c1=plc.read('"C1".CV');
    cyc(12);                                   // 继续按住不放
    var hold=plc.read('"C1".CV');
    plc.write('M0.0',false); cyc(3);
    press(); press();                          // 再按两次 → 3
    var c3=plc.read('"C1".CV'), q3=plc.readBool('Q0.0');
    // 复位：把 R 接上 M0.1
    ob1.networks[0].columns[0].branches[0][1].params.R='M0.1';
    plc.write('M0.1',true); cyc(3);
    var cr=plc.read('"C1".CV'), qr=plc.readBool('Q0.0');
    plc.write('M0.1',false);
    return '1次='+c1+' 按住='+hold+' 3次='+c3+' Q='+q3+' 复位后='+cr+' Q='+qr;
  })()`);
  ck('CU 一次上升沿 = 计 1', /1次=1/.test(String(ctuRun)), ctuRun);
  ck('按住不放不会一直加（只认上升沿）', /按住=1/.test(String(ctuRun)), ctuRun);
  ck('计到 PV=3 时 Q=1、线圈得电', /3次=3 Q=true/.test(String(ctuRun)), ctuRun);
  ck('R=1 计数器复位（CV 归 0、Q 断开）', /复位后=0 Q=false/.test(String(ctuRun)), ctuRun);

  /* ================= 5. CTD / CTUD 引脚顺序 ================= */
  await setNets(`[{title:'ctd',columns:[
    {branches:[[{id:'c2',type:'CTD',instance:'CTD_DB',db:7,params:{PV:'2'}}]]}
  ]},
  {title:'ctud',columns:[
    {branches:[[{id:'c3',type:'CTUD',instance:'CTUD_DB',db:8,params:{PV:'2'}}]]}
  ]}]`);
  const tCtd = String(await textsOf(0));
  const tCtud = String(await textsOf(1));
  ck('CTD 引脚是 CD / LD / PV | Q / CV',
    ['CD', 'LD', 'PV', 'Q', 'CV'].every(function (n) { return tCtd.split('|').indexOf(n) >= 0; }), tCtd);
  ck('CTUD 引脚是 CU / CD / R / LD / PV | QU / QD / CV',
    ['CU', 'CD', 'R', 'LD', 'PV', 'QU', 'QD', 'CV'].every(function (n) { return tCtud.split('|').indexOf(n) >= 0; }), tCtud);
  ck('CTUD 没有 EN / ENO', tCtud.indexOf('ENO') < 0, tCtud);

  const ctdRun = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[{title:'',columns:[
      {branches:[[{id:'i1',type:'NO',operand:'M0.0',addr:'M0.0'},
        {id:'c1',type:'CTD',instance:'D1',db:7,params:{PV:'2',LD:'M0.1'}}]]}
    ]}];
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'M0.0',address:'M0.0',datatype:'Bool'},{name:'M0.1',address:'M0.1',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    function cyc(n){ for(var i=0;i<n;i++)plc.step(TIA.project); }
    plc.write('M0.1',true); cyc(3); plc.write('M0.1',false); cyc(2);   // 装载 PV=2
    var load=plc.read('"D1".CV');
    plc.write('M0.0',true); cyc(3); plc.write('M0.0',false); cyc(2);   // 减 1
    var d1=plc.read('"D1".CV');
    var q1=plc.read('"D1".Q');
    plc.write('M0.0',true); cyc(3); plc.write('M0.0',false); cyc(2);   // 减到 0
    return '装载='+load+' 减1次='+d1+' Q='+q1+' 减2次='+plc.read('"D1".CV')+' Q='+plc.read('"D1".Q');
  })()`);
  ck('LD=1 把 PV 装进 CV', /装载=2/.test(String(ctdRun)), ctdRun);
  ck('CD 每个上升沿 -1，到 0 时 Q=1',
    /减1次=1/.test(String(ctdRun)) && /减2次=0 Q=true/.test(String(ctdRun)), ctdRun);

  /* ================= 6. 定时器块头 ================= */
  await setNets(`[{title:'ton',columns:[
    {branches:[[{id:'t1',type:'TON',instance:'T1',db:1,params:{PT:'T#2s'}}]]}
  ]}]`);
  const tTon = String(await textsOf(0));
  ck('TON 块头是 TON + Time，且没有 EN / ENO',
    tTon.split('|').indexOf('TON') >= 0 && tTon.split('|').indexOf('Time') >= 0 && tTon.indexOf('ENO') < 0, tTon);
  ck('TON 引脚 IN / PT / Q / ET 齐全',
    ['IN', 'PT', 'Q', 'ET'].every(function (n) { return tTon.split('|').indexOf(n) >= 0; }), tTon);

  /* ================= 7. 数学指令块头 ================= */
  await setNets(`[{title:'add',columns:[
    {branches:[[{id:'a1',type:'ADD',params:{IN1:'MW10',IN2:'1',OUT:'MW12'}}]]}
  ]}]`);
  const tAdd = String(await textsOf(0));
  ck('ADD 块头是助记符 + Int，且保留 EN / ENO',
    tAdd.split('|').indexOf('ADD') >= 0 && tAdd.split('|').indexOf('Int') >= 0 && tAdd.indexOf('ENO') >= 0, tAdd);

  /* ================= 8. 比较指令可以引用实例成员 ================= */
  await setNets(`[{title:'ton2',columns:[
    {branches:[[{id:'i1',type:'NO',operand:'M0.0',addr:'M0.0'},
      {id:'t1',type:'TON',instance:'T2',db:1,params:{PT:'T#1s'}}]]}
  ]},
  {title:'cmp3',columns:[
    {branches:[[{id:'k1',type:'CMP_GE',params:{IN1:'"T2".ET',IN2:'T#500ms',TYPE:'Time'}},
      {id:'o1',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}]`);
  const diag = await ev(`JSON.stringify(PLC.compileProject(TIA.project).map(function(d){return d.level+':'+d.text;}))`);
  ck('比较操作数可以引用实例成员 "T2".ET（编译通过）',
    String(diag).indexOf('未定义的符号') < 0, diag);

  const cmpTime = await ev(`(function(){
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'M0.0',address:'M0.0',datatype:'Bool'},{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0]};
    plc.write('M0.0',true);
    for(var i=0;i<20;i++)plc.step(TIA.project);      // 200ms，ET < 500ms
    var early=plc.readBool('Q0.0');
    for(var j=0;j<50;j++)plc.step(TIA.project);      // 700ms，ET > 500ms
    var late=plc.readBool('Q0.0');
    return 'ET<500ms Q0.0='+early+' | ET>500ms Q0.0='+late;
  })()`);
  ck('比较定时器当前值（"T2".ET >= T#500ms）能真实动作',
    /ET<500ms Q0.0=false/.test(String(cmpTime)) && /ET>500ms Q0.0=true/.test(String(cmpTime)), cmpTime);

  /* ================= 9. 从指令窗格插入（不弹对话框）+ 就地编辑 ================= */
  await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks=[
      {title:'',columns:[{branches:[[]]}]},
      {title:'',columns:[{branches:[[{id:'t9',type:'TON',instance:'T9',db:9,params:{PT:'T#1s'}}]]}]}
    ];
    LadEdit.rerender({keepScroll:true}); return true;
  })()`);
  await sleep(600);
  await ev(`(function(){var g=document.querySelector('[data-group="compare"]');if(g)g.click();})()`);
  await sleep(400);
  await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="CMP_GT"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(800);

  const insOk = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    var hit=null;
    ob1.networks.forEach(function(n){n.columns.forEach(function(c){c.branches.forEach(function(b){
      b.forEach(function(e){ if(e.type==='CMP_GT') hit=e; });});});});
    return !!hit;
  })()`);
  ck('指令窗格双击 CMP_GT 就能插入（不像 FB 那样弹调用选项）', insOk === true);
  ck('插入后立刻是两个红色 <???>，等用户填操作数',
    (String(await textsOf(0)).match(/<\?\?\?>/g) || []).length === 2, await textsOf(0));

  await ev(`(function(){var t=document.querySelector('[data-prm$=":IN1"]');if(t)t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(450);
  ck('双击盒体上方的 <???> 就地编辑 IN1', await ev("!!document.querySelector('#inlineEdit input')"));
  const optTxt = await ev(`(function(){var s=document.querySelector('#inlineEdit select');
    return s?[].map.call(s.options,function(o){return o.textContent;}).join(' / '):'NO SELECT';})()`);
  ck('候选里有 FB 实例（可以挂定时器 / 计数器）', /T9|TON|CTU/.test(String(optTxt)), optTxt);

  // 选 FB 实例 → 二级菜单挑成员，写进 IN1
  const pickOk = await ev(`(function(){
    var s=document.querySelector('#inlineEdit select');
    if(!s) return 'NO SELECT';
    for(var i=0;i<s.options.length;i++){
      if(/T9/.test(s.options[i].textContent)){ s.selectedIndex=i; s.dispatchEvent(new Event('change',{bubbles:true})); return 'picked'; }
    }
    return 'NOT FOUND';
  })()`);
  await sleep(500);
  const menuTxt = await ev(`(function(){var m=document.querySelector('#ladMenu');
    return m?[].map.call(m.querySelectorAll('.lm-item,div'),function(x){return x.textContent||'';}).join(' / '):'NO MENU';})()`);
  ck('选了实例后弹出成员菜单（ET / Q …）', (pickOk === 'picked' || pickOk === 'NO SELECT') && /ET|Q/.test(String(menuTxt)), pickOk + ' / ' + menuTxt);

  const picked = await ev(`(function(){
    var m=document.querySelector('#ladMenu');
    if(!m) return 'NO MENU';
    var items=[].filter.call(m.children,function(x){return x.className.indexOf('lm-item')>=0 || x.tagName==='DIV';});
    for(var i=0;i<items.length;i++){
      if(/ET/.test(items[i].textContent)){ items[i].click(); return 'clicked'; }
    }
    return 'NO ET ITEM';
  })()`);
  await sleep(600);
  const in1 = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    var v='';
    ob1.networks.forEach(function(n){n.columns.forEach(function(c){c.branches.forEach(function(b){
      b.forEach(function(e){ if(e.type==='CMP_GT'&&e.params&&e.params.IN1) v=e.params.IN1; });});});});
    return v;
  })()`);
  ck('成员写进 IN1（形如 "T9".ET）', /^"T9"\.ET$/.test(String(in1)), in1);

  /* ================= 10. 比较指令下方那个"数字" ================= */
  // 网络 1：TON(PT=T#5s) 只作数据源；网络 2："T5".PT >= 5 → 接通
  // 口径（用户约定）：比较取的是 TON 盒体上方"正在跑的数"（经过值），
  // 不是数据块里冻结的设定值——所以 PT 设 5s、填 5，就是跑到 5s 才接通。
  const cmpNets = (in2, type, op) => `[
    {title:'',columns:[{branches:[[{id:'t5',type:'TON',instance:'T5',db:5,params:{PT:'T#5s'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'k5',type:${JSON.stringify(op || 'CMP')},params:{IN1:'"T5".PT',IN2:${JSON.stringify(in2)}${type ? ",TYPE:" + JSON.stringify(type) : ''}}},
      {id:'o5',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}]}
  ]`;

  const runSteps = (n) => `(function(){
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10;
    for(var i=0;i<${n};i++)plc.step(TIA.project);
    return JSON.stringify({et:plc.read('"T5".ET'), q:plc.readBool('Q0.0')});
  })()`;

  await setNets(cmpNets('5', 'Time', 'CMP_GE'));
  const runEarly = await ev(runSteps(200));
  ck('经过值 2s、下方填 5（秒）→ 还没到 5s，不接通',
    /"q":false/.test(String(runEarly)), runEarly);
  const runLate = await ev(runSteps(600));
  ck('经过值到 5s → 比较闭合接通（裸数字按秒，取运行值）',
    /"q":true/.test(String(runLate)), runLate);
  ck('填 5 不标红', (await ev("!!document.querySelector('.cmp-bad')")) === false);

  await setNets(cmpNets('5.25'));
  const runDec = await ev(`(function(){
    var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
    ob1.networks[1].columns[0].branches[0][0].type='CMP_GT';   // 40ms > 5.25s ?
    var plc=new PLC.SoftPLC();
    plc.setTags([{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc.cycleTime=10; plc._blocks={OB1:ob1};
    for(var i=0;i<5;i++)plc.step(TIA.project);
    var r1=plc.readBool('Q0.0');
    ob1.networks[1].columns[0].branches[0][0].type='CMP_LT';   // 40ms < 5.25s ?
    var plc2=new PLC.SoftPLC();
    plc2.setTags([{name:'Q0.0',address:'Q0.0',datatype:'Bool'}]);
    plc2.cycleTime=10; plc2._blocks={OB1:ob1};
    for(var j=0;j<5;j++)plc2.step(TIA.project);
    return '40ms>5.25 → '+r1+' | 40ms<5.25 → '+plc2.readBool('Q0.0');
  })()`);
  ck('支持两位小数（经过值 40ms 与 5.25s 能正确比较）',
    /40ms>5\.25 → false/.test(String(runDec)) && /40ms<5\.25 → true/.test(String(runDec)), runDec);

  // 超过关联值上限：PT=10s，等于 11 → 标红 + 编译错误
  await setNets(`[
    {title:'',columns:[{branches:[[{id:'t6',type:'TON',instance:'T6',db:6,params:{PT:'T#10s'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'k6',type:'CMP',params:{IN1:'"T6".PT',IN2:'11'}},
      {id:'o6',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}]}
  ]`);
  ck('PT=10s 填 11 → 数字标红', (await ev(`(function(){
    var t=document.querySelector('.cmp-bad'); return t?t.textContent:'NONE';})()`)) === '11',
    await ev(`(function(){var t=document.querySelector('.cmp-bad');return t?t.textContent:'NONE';})()`));
  const diagBad = await ev(`JSON.stringify(PLC.compileProject(TIA.project).map(function(d){return d.level+':'+d.text;}))`);
  ck('标红的同时编译报错（下载会被拦住）',
    /error/.test(String(diagBad)) && /永远不成立/.test(String(diagBad)), diagBad);

  // 边界：等于上限不算错
  await setNets(`[
    {title:'',columns:[{branches:[[{id:'t7',type:'TON',instance:'T7',db:7,params:{PT:'T#10s'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'k7',type:'CMP',params:{IN1:'"T7".PT',IN2:'10'}},
      {id:'o7',type:'COIL',operand:'Q1.0',addr:'Q1.0'}]]}]}
  ]`);
  ck('填 10（正好等于 PT=10s）不标红', (await ev("!!document.querySelector('.cmp-bad')")) === false);
  ck('正好等于上限时编译无错误',
    (await ev(`JSON.stringify(PLC.compileProject(TIA.project).filter(function(d){return d.level==='error';}))`)) === '[]');

  // 三位小数：报"最多两位"
  await setNets(`[
    {title:'',columns:[{branches:[[{id:'t8',type:'TON',instance:'T8',db:8,params:{PT:'T#10s'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'k8',type:'CMP',params:{IN1:'"T8".PT',IN2:'5.255'}},
      {id:'o8',type:'COIL',operand:'Q1.1',addr:'Q1.1'}]]}]}
  ]`);
  const diag3 = await ev(`JSON.stringify(PLC.compileProject(TIA.project).map(function(d){return d.text;}))`);
  ck('三位小数（5.255）被判为"最多两位小数"', /小数最多两位|两位小数/.test(String(diag3)), diag3);

  // 计数器按数字算：.CV 是 Int，不会被当成时间
  await setNets(`[
    {title:'',columns:[{branches:[[{id:'c9',type:'CTU',instance:'C9',db:9,params:{PV:'10'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'k9',type:'CMP_GE',params:{IN1:'"C9".CV',IN2:'100'}},
      {id:'o9',type:'COIL',operand:'Q1.2',addr:'Q1.2'}]]}]}
  ]`);
  ck('计数器 .CV 按普通整数比（100 不标红、不按时间算）',
    (await ev("!!document.querySelector('.cmp-bad')")) === false &&
    (await ev(`JSON.stringify(PLC.compileProject(TIA.project).filter(function(d){return d.level==='error';}))`)) === '[]',
    await ev(`JSON.stringify(PLC.compileProject(TIA.project).filter(function(d){return d.level==='error';}))`));

  /* 界面上真实打字也要生效：双击 IN2 敲 11 → 回车 → 立刻标红 */
  await setNets(`[
    {title:'',columns:[{branches:[[{id:'ta',type:'TON',instance:'TA',db:11,params:{PT:'T#10s'}}]]}]},
    {title:'',columns:[{branches:[[
      {id:'ka',type:'CMP',params:{IN1:'"TA".PT',TYPE:'Time'}},
      {id:'oa',type:'COIL',operand:'Q0.3',addr:'Q0.3'}]]}]}
  ]`);
  await ev(`(function(){var t=document.querySelector('.network[data-net="1"] [data-prm$=":IN2"]');if(t)t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await sleep(450);
  const typed = await ev(`(function(){
    var i=document.querySelector('#inlineEdit input');
    if(!i) return 'NO INPUT';
    i.value='11';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return 'typed';
  })()`);
  await sleep(800);
  const afterType = await ev(`(function(){var t=document.querySelector('.cmp-bad');return t?t.textContent:'NONE';})()`);
  ck('界面上双击 IN2 敲 11 回车 → 立刻标红', typed === 'typed' && String(afterType) === '11',
    typed + ' / ' + afterType);

  if (logs.length) console.log('\n页面异常:\n' + logs.slice(0, 6).join('\n'));
  ws.close(); killTree(p);
  const bad = R.filter(x => !x.ok);
  console.log('\n通过 ' + (R.length - bad.length) + '/' + R.length);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.stack || e.message); process.exit(2); });
