/* V31：盒式指令在分支行里不再被压扁 + 拖开口箭头到横线上合并
 *   node test-anchor.js   （需要 8931 端口的本地静态服务） */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9880 + Math.floor(Math.random() * 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('ok   : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'pb19' + Date.now()),
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
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }

  // ---------- 场景：分支行里放 TON，后面跟开口箭头 ----------
  await ev(`(function(){
    var blk=TIA.project.blocks[0], net=blk.networks[0];
    blk.networks=[net];
    net.title='盒式指令在分支行';
    net.columns=[
      { branches: [[{id:'b1',type:'NO',operand:'Start_Button',addr:'I0.0'}]] },
      { branches: [
        [{id:'b4',type:'NO',operand:'Stop_Button',addr:'I0.1'}],
        [{id:'b2',type:'TON',params:{IN:'Motor_Run',PT:'T#1s',ET:'MW14'}},{id:'b3',type:'OPEN_END'}]
      ] },
      { branches: [[{id:'b5',type:'COIL',operand:'Motor_Run',addr:'Q0.0'}]] }
    ];
    LadEdit.state.selId=null;LadEdit.state.selSeg=null;TIA.selSeg=null;TIA.selEl=null;
    LadEdit.mount(blk,TIA.activeTab,{});
    var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();
  })()`);
  await sleep(1000);

  // 1) cellLayout 比例：TON 应该拿到远大于 OPEN_END 的宽度
  const lay = await ev(`(function(){
    var net=TIA.project.blocks[0].networks[0];
    var br=net.columns[1].branches[1];
    var L=LAD.calcLayout(net);
    var cells=LAD.cellLayout(br,LAD.GRID.padL+L.widths[0]+LAD.GRID.gap,L.widths[1]);
    return JSON.stringify({colW:L.widths[1], cells:cells.map(function(c){return {x:Math.round(c.x),w:Math.round(c.w)};})});
  })()`);
  const L1 = JSON.parse(lay);
  ok(L1.cells[0].w > L1.cells[1].w * 3, '盒式指令单元格远宽于开口箭头',
    L1.cells[0].w + ' vs ' + L1.cells[1].w + ' / 列宽 ' + L1.colW);

  // 2) 实际盒子几何：宽度够、且不压在右侧汇合竖线上
  const geo = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg');
    var sr=svg.getBoundingClientRect();
    var body=document.querySelector('.network[data-net="0"] .lad-el[data-el="b2"] .lad-body');
    if(!body) return 'NOBOX';
    var r=body.getBoundingClientRect();
    var joins=[];
    document.querySelectorAll('.network[data-net="0"] .lad-join').forEach(function(l){
      var x=+l.getAttribute('x1')+sr.left;
      var y1=+l.getAttribute('y1')+sr.top, y2=+l.getAttribute('y2')+sr.top;
      if(r.top-2<y2 && r.bottom+2>y1) joins.push(Math.round(x));
    });
    return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),
      left:Math.round(r.left-sr.left),right:Math.round(r.right-sr.left),joins:joins});
  })()`);
  if (geo === 'NOBOX') { ok(false, '盒式元件有盒体', geo); }
  else {
    const G = JSON.parse(geo);
    ok(G.w >= 110, '盒式元件盒体没有被压扁', 'w=' + G.w + ' h=' + G.h);
    const collide = G.joins.some(j => j > G.left - 2 && j < G.right + 2);
    ok(!collide, '盒体没有压住汇合竖线', '盒 ' + G.left + '~' + G.right + ' / 竖线 ' + JSON.stringify(G.joins));
  }


  // 2.5) 选中开口箭头：那排落点小方块应立刻出现（对齐 TIA）
  await ev(`(function(){
    var hit=document.querySelector('.network[data-net="0"] .lad-el[data-el="b3"] .hit');
    var r=hit.getBoundingClientRect();
    document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)
      .dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  })()`);
  await sleep(500);
  ok(+(await ev(`document.querySelectorAll('.network[data-net="0"] .lad-anchor').length`)) > 0,
    '选中开口箭头后显示落点小方块');
  ok((await ev(`LadEdit.state.selId`)) === 'b3', '开口箭头处于选中态');

  // 取消选中 → 小方块消失
  await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg').getBoundingClientRect();
    var el=document.elementFromPoint(svg.left+6, svg.top+6) || document.querySelector('.lad-wrap');
    el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:svg.left+6,clientY:svg.top+6}));
  })()`);
  await sleep(500);
  ok(+(await ev(`document.querySelectorAll('.network[data-net="0"] .lad-anchor').length`)) === 0,
    '取消选中后小方块消失');

  // 重新选中，便于下面从箭头开始拖
  await ev(`(function(){
    var hit=document.querySelector('.network[data-net="0"] .lad-el[data-el="b3"] .hit');
    var r=hit.getBoundingClientRect();
    document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)
      .dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  })()`);
  await sleep(500);

  // ---------- 3) 拖开口箭头合并 ----------
  // 目标：把 (列1, 行1) 的开口箭头拖到 (列1, 行0) 第 1 个元件之后的方块
  const start = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg');
    var sr=svg.getBoundingClientRect();
    var hit=document.querySelector('.network[data-net="0"] .lad-el[data-el="b3"] .hit');
    if(!hit) return 'NOHIT';
    var r=hit.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
  })()`);
  if (start === 'NOHIT') { ok(false, '能定位到开口箭头', start); }
  else {
    const S = JSON.parse(start);
    const pd = `(function(){
      var el=document.elementFromPoint(${S.x},${S.y});
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:${S.x},clientY:${S.y},button:0,pointerId:1,isPrimary:true}));
      return el.className.baseVal||el.className||'';
    })()`;
    console.log('pointerdown 落点: ' + await ev(pd));
    ok(await ev('!!(LadEdit.state.adrag&&LadEdit.state.adrag.on)'), '在开口箭头上按下时进入"待拖"状态');

    // 小幅移动激活拖拽（>5px）
    await ev(`document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:${S.x + 12},clientY:${S.y - 12},pointerId:1,isPrimary:true}))`);
    await sleep(400);
    const anchors = +(await ev(`document.querySelectorAll('.network[data-net="0"] .lad-anchor').length`));
    ok(anchors > 0, '拖动时出现落点小方块', anchors + ' 个');

    // 找到目标方块 (1:1:0:1)
    const tgt = await ev(`(function(){
      var a=document.querySelector('.lad-anchor[data-anchor="0:1:0:1"]');
      if(!a) return 'NOANCHOR';
      var r=a.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`);
    if (tgt === 'NOANCHOR') { ok(false, '第 1 列主行第 1 个元件后有落点方块', tgt); }
    else {
      const T = JSON.parse(tgt);
      await ev(`document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:${T.x},clientY:${T.y},pointerId:1,isPrimary:true}))`);
      await sleep(400);
      const onCnt = +(await ev(`document.querySelectorAll('.lad-anchor.on').length`));
      ok(onCnt === 1, '悬停的落点方块高亮成绿色', onCnt + ' 个高亮');
      await ev(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:${T.x},clientY:${T.y},pointerId:1,isPrimary:true}))`);
      await sleep(700);

      const after = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.map(function(b){return b.map(function(e){return e.type;}).join(',');});}))`);
      const A = JSON.parse(after);
      ok(JSON.stringify(A) === JSON.stringify([['NO'], ['NO', 'TON'], ['COIL']]),
        '开口分支在切点处并入主线（不留空列）', JSON.stringify(A));
      ok(+(await ev(`document.querySelectorAll('.network[data-net="0"] .lad-openend').length`)) === 0,
        '合并后不再残留开口箭头');
      ok(+(await ev(`document.querySelectorAll('.lad-anchor').length`)) === 0,
        '松手后落点方块消失');
      const cerr = await ev(`(function(){try{return JSON.stringify(PLC.compileProject(TIA.project).filter(function(d){return d.level==='error';}))}catch(e){return 'ERR:'+e.message} })()`);
      ok(cerr === '[]', '合并后编译通过', cerr);
    }
  }


  // ---------- 4) 主线没接线圈：右侧拖一条悬空尾线 + »（对齐 TIA）----------
  const setNet = async (cols) => {
    await ev(`(function(){
      var net=TIA.project.blocks[0].networks[0];
      net.columns=${JSON.stringify(cols)};
      LadEdit.state.selId=null;LadEdit.state.selSeg=null;TIA.selSeg=null;TIA.selEl=null;
      LadEdit.mount(TIA.project.blocks[0],TIA.activeTab,{});
      var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();
    })()`);
    await sleep(600);
  };
  const dangleInfo = async () => JSON.parse(await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg');
    var d=svg.querySelector('.lad-dangle');
    var w=+svg.getAttribute('width');
    return JSON.stringify({has:!!d, svgW:w});
  })()`));

  // 4.1 两条并联支路、都没有线圈 → 收口处不能变成闭合方框
  await setNet([{ branches: [
    [{ id: 'd1', type: 'NO', operand: '%M0.0', addr: 'M0.0' }],
    [{ id: 'd2', type: 'NO', operand: '', addr: '' }]
  ] }]);
  let di = await dangleInfo();
  ok(di.has, '没有线圈的并联支路画出悬空尾线');
  ok(di.svgW > 260, '尾线把网络拉宽（不再在汇合竖线处收口）', 'svgW=' + di.svgW);

  // 4.2 主线接了线圈 → 不该有尾线
  await setNet([{ branches: [[{ id: 'e1', type: 'NO', operand: '%M0.0', addr: 'M0.0' }]] },
    { branches: [[{ id: 'e2', type: 'COIL', operand: 'Q0.0', addr: 'Q0.0' }]] }]);
  di = await dangleInfo();
  ok(!di.has, '主线以线圈收尾时不画悬空尾线', 'svgW=' + di.svgW);

  // 4.3 空网络：保持原来的短封口，不拉长
  await setNet([{ branches: [[]] }]);
  di = await dangleInfo();
  ok(!di.has, '空网络不画悬空尾线', 'svgW=' + di.svgW);

  const sv = await ev(`(function(){var s=document.querySelector('.network[data-net="0"] svg').getBoundingClientRect();
    return JSON.stringify({x:s.left,y:s.top,w:s.width,h:s.height});})()`);
  const sc = JSON.parse(sv);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(sc.x), y: Math.round(sc.y), width: Math.round(sc.w), height: Math.round(sc.h), scale: 3 } });
  require('fs').writeFileSync('docs/_p19.png', Buffer.from(shot.result.data, 'base64'));

  if (logs.length) console.log('页面异常: ' + logs.slice(0, 3).join(' | '));
  console.log('\n通过 ' + pass + '/' + (pass + fail));
  ws.close(); killTree(p); process.exit(fail ? 1 : 0);
})();
