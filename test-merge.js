const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9960;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'mg2' + Date.now()),
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

  // 只数"汇合竖线"（data-live = colout:*）。左侧"分出竖线"是 colin:*，
  // 开放分支本来就该有分出竖线，混在一起数会把这次的分支算成"画了汇合竖线"。
  const joinBefore = +(await ev(`document.querySelectorAll('.network[data-net="0"] .lad-join[data-live^="colout:"]').length`));

  // 收藏夹箭头建分支
  await ev(`(function(){
    var cells=document.querySelectorAll('#fbCells .fb-cell');
    for(var i=0;i<cells.length;i++){
      if(cells[i].dataset.fbtype==='OPEN_BRANCH'){ cells[i].click(); return; }
    }
  })()`);
  await sleep(700);

  const R = [];
  const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  // 汇合竖线
  const joins = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.network[data-net="0"] .lad-join[data-live^="colout:"]').forEach(function(l){
      out.push({x:+l.getAttribute('x1'), y1:+l.getAttribute('y1'), y2:+l.getAttribute('y2')});
    });
    return JSON.stringify(out);
  })()`);
  console.log('汇合竖线: ' + joins);
  const jArr = JSON.parse(joins);
  ck('有汇合竖线', jArr.length >= 1, jArr.length + ' 根');

  // 全部 seg 键 + 开放分支（开口箭头）
  const allKeys = await ev(`JSON.stringify([].map.call(document.querySelectorAll('.network[data-net="0"] .lad-seg'),function(s){
    return s.getAttribute('data-seg')||'(空)';
  }))`);
  console.log('全部 lad-seg 键: ' + allKeys);
  const openEndCnt = await ev(`(function(){
    var n=0;
    document.querySelectorAll('.network[data-net="0"] .lad-openend').forEach(function(){n++;});
    return n;
  })()`);
  console.log('开口箭头数: ' + openEndCnt);
  ck('插入分支后生成开放分支（有开口箭头）', openEndCnt >= 1, openEndCnt + ' 个');

  // 开放分支：右侧不画汇合竖线
  const joinRows = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.network[data-net="0"] .lad-join[data-live^="colout:"]').forEach(function(l){
      out.push({x:+l.getAttribute('x1'), y1:+l.getAttribute('y1'), y2:+l.getAttribute('y2')});
    });
    return JSON.stringify(out);
  })()`);
  console.log('汇合竖线(插入分支后): ' + joinRows);
  ck('开放分支不画汇合竖线', joinBefore === JSON.parse(joinRows).length,
    joinBefore + ' -> ' + JSON.parse(joinRows).length);

  // 开放分支可以选中开口箭头
  const oeHit = await ev(`(function(){
    var hit=null;
    document.querySelectorAll('.lad-el .hit').forEach(function(h){
      var l=LadEdit.locate(LadEdit.state.blk,h.dataset.el);
      if(l && l.el.type==='OPEN_END' && !hit) hit=h;
    });
    if(!hit) return 'NONE';
    var b=hit.getBoundingClientRect();
    return JSON.stringify({x:Math.round(b.left+b.width-12),y:Math.round(b.top+b.height/2)});
  })()`);
  console.log('开口箭头可点: ' + oeHit);
  if (oeHit !== 'NONE') {
    const pk = JSON.parse(oeHit);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(600);
    const tp = await ev(`(function(){var l=LadEdit.locate(LadEdit.state.blk,LadEdit.state.selId);return l?l.el.type:'null';})()`);
    ck('开口箭头可选中', tp === 'OPEN_END', tp);
  } else { ck('开口箭头可选中', false, 'NONE'); }

  // 汇合竖线：Delete 只断开分支，不删除分支（对齐 TIA 图7→图8）
  const vHit = await ev(`(function(){
    var hs=[].filter.call(document.querySelectorAll('.lad-hit'),function(x){
      return (x.getAttribute('data-seg')||'').indexOf(':vseg:')>=0;
    });
    for(var i=0;i<hs.length;i++){
      var x=hs[i];
      var x1=+x.getAttribute('x1'), y1=+x.getAttribute('y1'), y2=+x.getAttribute('y2');
      var svg=x.closest('svg'); var r=svg.getBoundingClientRect();
      for(var yy=r.top+y1+2; yy<r.top+y2-2; yy+=4){
        if(yy<60||yy>window.innerHeight-60) continue;
        var el=document.elementFromPoint(r.left+x1, yy);
        if(el===x) return JSON.stringify({x:Math.round(r.left+x1),y:Math.round(yy),seg:x.getAttribute('data-seg')});
      }
    }
    return 'NONE';
  })()`);
  console.log('竖线可点: ' + vHit);
  if (vHit !== 'NONE') {
    const pk = JSON.parse(vHit);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(600);
    const sel = await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`);
    ck('竖线可选中', sel === pk.seg, sel);
    const before = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.length;}))`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
    await sleep(700);
    const after = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.length;}))`);
    const hasOpen = await ev(`(function(){
      var nets=TIA.project.blocks[0].networks[0].columns, found=false;
      nets.forEach(function(c){ c.branches.forEach(function(br){
        if(br.length && br[br.length-1].type==='OPEN_END') found=true; }); });
      return found;
    })()`);
    ck('Delete 汇合竖线只断开分支（分支数不变）', after === before, before + ' -> ' + after);
    ck('断开后成为开放分支', hasOpen === true, String(hasOpen));
  } else { ck('竖线可选中', false, 'NONE'); ck('Delete 删除分支', false, '跳过'); }

  // 点导线（同一列里两个器件之间）：应选中"线段"——新增的 span 命中层
  const leadPt = await ev(`(function(){
    var spans=[].slice.call(document.querySelectorAll('.network[data-net="0"] .lad-span'));
    for(var i=0;i<spans.length;i++){
      var l=spans[i];
      var x1=+l.getAttribute('x1'), x2=+l.getAttribute('x2'), y=+l.getAttribute('y1');
      var svg=l.closest('svg'); var r=svg.getBoundingClientRect();
      for(var x=x1+6;x<x2-6;x+=4){
        var cx=r.left+x, cy=r.top+y;
        if(cy<60||cy>window.innerHeight-60) continue;
        var under=document.elementsFromPoint(cx,cy), hasEl=false;
        for(var k=0;k<under.length;k++){
          if(under[k].classList && under[k].classList.contains('hit')) hasEl=true;
        }
        if(!hasEl) return JSON.stringify({x:Math.round(cx), y:Math.round(cy), seg:l.getAttribute('data-seg')});
      }
    }
    return 'NONE';
  })()`);
  console.log('导线可点: ' + leadPt);
  if (leadPt !== 'NONE') {
    const pk = JSON.parse(leadPt);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pk.x, y: pk.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(600);
    const sel = await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`);
    const selEl = await ev(`String(LadEdit.state.selId||'')`);
    console.log('导线选中结果: selSeg=' + sel + ' selEl=' + selEl);
    ck('点两器件之间的导线可选中线段', sel.length > 0, sel);
    // 只高亮"光标点中的那一段"，同一列的其它空档不能被一起点亮
    const selCnt = await ev(`document.querySelectorAll('.lad-seg.sel').length`);
    ck('只高亮选中的那一段导线', selCnt === 1, '高亮段数=' + selCnt);
  } else { ck('点两器件之间的导线可选中线段', false, 'NONE'); }

  // ===== 选中"列内某一段导线"再点分支：分支必须落在这一段处（不能跑到整列前面）=====
  await ev(`(function(){
    var blk = TIA.project.blocks[0], net = blk.networks[0];
    blk.networks = [net];
    net.columns = [{ branches: [[
      {id:'sfa', type:'NO', operand:'Start_Button', addr:'I0.0'},
      {id:'sfb', type:'NO', operand:'Motor_Run', addr:'Q0.0'},
      {id:'sfc', type:'NC', operand:'Stop_Button', addr:'I0.1'}
    ]] }];
    LadEdit.state.selId = null; LadEdit.state.selSeg = null;
    TIA.selSeg = null; TIA.selEl = null;
    LadEdit.mount(blk, TIA.activeTab, {});
    var tn=document.querySelector('#treeBody .node[data-node="block:OB1"]'); if(tn) tn.click();  // 强制真实重绘
  })()`);
  await sleep(900);
  const midPt = await ev(`(function(){
    var spans=[].slice.call(document.querySelectorAll('.network[data-net="0"] .lad-span'));
    for(var i=0;i<spans.length;i++){
      var l=spans[i], key=l.getAttribute('data-seg')||'';
      if(key.slice(-11)!==':span:0:0:1') continue;         // A 与 B 之间那一段
      var x1=+l.getAttribute('x1'), x2=+l.getAttribute('x2'), y=+l.getAttribute('y1');
      var svg=l.closest('svg'), r=svg.getBoundingClientRect();
      for(var x=x1+6;x<x2-6;x+=4){
        var cx=r.left+x, cy=r.top+y;
        if(cy<60||cy>window.innerHeight-60) continue;
        if(document.elementFromPoint(cx,cy)===l) return JSON.stringify({x:Math.round(cx),y:Math.round(cy),seg:key});
      }
    }
    return 'NONE';
  })()`);
  console.log('中间段: ' + midPt);
  if (midPt !== 'NONE') {
    const mp = JSON.parse(midPt);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mp.x, y: mp.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mp.x, y: mp.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(500);
    await ev(`(function(){
      var cells=document.querySelectorAll('#fbCells .fb-cell');
      for(var i=0;i<cells.length;i++){ if(cells[i].dataset.fbtype==='OPEN_BRANCH'){ cells[i].click(); return; } }
    })()`);
    await sleep(700);
    const fk = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){
      return c.branches.map(function(br){ return br.map(function(e){return e.type;}).join(','); });
    }))`);
    console.log('切列结果: ' + fk);
    const fa = JSON.parse(fk);
    ck('选中线段处点分支 -> 在该处切列', fa.length === 2, fa.length + ' 列');
    ck('切点左边只留 A', fa.length === 2 && fa[0][0] === 'NO', fa.length === 2 ? fa[0][0] : '-');
    ck('切点右边是 B,C', fa.length === 2 && fa[1][0] === 'NO,NC', fa.length === 2 ? fa[1][0] : '-');
    ck('开放分支挂在切点右边的新列', fa.length === 2 && fa[1].length === 2 && fa[1][1].indexOf('OPEN_END') >= 0,
      fa.length === 2 ? fa[1].join(' | ') : '-');
  } else { ck('选中线段处点分支 -> 在该处切列', false, 'NONE'); }

  // ===== 开口箭头不能"切一次裂成两个"，也不能留在主干上 =====
  const setupOpen = async function () {
    await ev(`(function(){
      var blk = TIA.project.blocks[0], net = blk.networks[0];
      blk.networks = [net];
      net.columns = [
        { branches: [
          [{id:'oeA', type:'NO', operand:'Start_Button', addr:'I0.0'}],
          [{id:'oeB', type:'NO', operand:'Motor_Run', addr:'Q0.0'}, {id:'oeEnd', type:'OPEN_END'}]
        ] },
        { branches: [[{id:'oeC', type:'COIL', operand:'Motor_Run', addr:'Q0.0'}]] }
      ];
      LadEdit.state.selId = null; LadEdit.state.selSeg = null;
      TIA.selSeg = null; TIA.selEl = null;
      LadEdit.mount(blk, TIA.activeTab, {});
      var tn=document.querySelector('#treeBody .node[data-node="block:OB1"]'); if(tn) tn.click();
    })()`);
    await sleep(900);
  };
  const arrowCnt = () => ev(`document.querySelectorAll('.network[data-net="0"] .lad-openend').length`);
  const typeDump = () => ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){
    return c.branches.map(function(br){ return br.map(function(e){return e.type;}).join(','); });
  }))`);

  await setupOpen();
  ck('正常开放分支仍显示开口箭头', (await arrowCnt()) === 1, (await arrowCnt()) + ' 个');

  // 点开放分支里 B 与箭头之间的那一段，再点「分支」
  const oePt = await ev(`(function(){
    var spans=[].slice.call(document.querySelectorAll('.network[data-net="0"] .lad-span'));
    for(var i=0;i<spans.length;i++){
      var l=spans[i], key=l.getAttribute('data-seg')||'';
      if(key!=='0:span:0:1:1') continue;
      var x1=+l.getAttribute('x1'), x2=+l.getAttribute('x2'), y=+l.getAttribute('y1');
      var svg=l.closest('svg'), r=svg.getBoundingClientRect();
      // 这一段可能很窄（元件挨得近），所以按 1px 步进找可点位置
      for(var x=x1+1;x<x2;x+=1){
        var cx=r.left+x, cy=r.top+y;
        if(cy<60||cy>window.innerHeight-60) continue;
        if(document.elementFromPoint(cx,cy)===l) return JSON.stringify({x:Math.round(cx),y:Math.round(cy),seg:key});
      }
    }
    return 'NONE';
  })()`);
  console.log('开放分支里的段: ' + oePt);
  if (oePt !== 'NONE') {
    const op = JSON.parse(oePt);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: op.x, y: op.y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: op.x, y: op.y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
    await sleep(500);
    await ev(`(function(){
      var cells=document.querySelectorAll('#fbCells .fb-cell');
      for(var i=0;i<cells.length;i++){ if(cells[i].dataset.fbtype==='OPEN_BRANCH'){ cells[i].click(); return; } }
    })()`);
    await sleep(800);
    const od = await typeDump();
    console.log('开放分支切列后: ' + od);
    const oa = JSON.parse(od);
    const arrows = await arrowCnt();
    ck('切开放分支不会切出两个箭头', arrows === 1, arrows + ' 个 / ' + od);
    ck('主干里没有开口箭头', oa.every(c => !c[0] || c[0].indexOf('OPEN_END') < 0), od);
  } else { ck('切开放分支不会切出两个箭头', false, 'NONE'); }

  // ===== 老工程遗留：主线里带 OPEN_END → 渲染时清掉，主干不画箭头 =====
  await ev(`(function(){
    var blk = TIA.project.blocks[0], net = blk.networks[0];
    net.columns = [
      { branches: [[{id:'lgA', type:'NO', operand:'Start_Button', addr:'I0.0'}, {id:'lgOE', type:'OPEN_END'}]] },
      { branches: [[{id:'lgC', type:'COIL', operand:'Motor_Run', addr:'Q0.0'}]] }
    ];
    blk.networks = [net];
    LadEdit.state.selId = null; LadEdit.state.selSeg = null;
    TIA.selSeg = null; TIA.selEl = null;
    LadEdit.mount(blk, TIA.activeTab, {});
    var tn=document.querySelector('#treeBody .node[data-node="block:OB1"]'); if(tn) tn.click();
  })()`);
  await sleep(900);
  const lgDump = await typeDump();
  console.log('主线残留 OPEN_END 处理后: ' + lgDump);
  ck('主干里残留的 OPEN_END 被清掉', lgDump.indexOf('OPEN_END') < 0, lgDump);
  ck('主干不再画箭头', (await arrowCnt()) === 0, (await arrowCnt()) + ' 个');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('docs/v26-merge.png', Buffer.from(shot.result.data, 'base64'));

  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 4).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + '/' + R.length);
  ws.close(); killTree(p); process.exit(pass === R.length ? 0 : 1);
})();
