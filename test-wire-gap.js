/* E2E：逐行检查水平导线有没有断口
 *
 * 断口的两类来源（都实际出现过）：
 *   1) 元件按自然宽度排版后，行尾（列内最后一段）没人补导线 → 元件后面空一截；
 *   2) 分支行跨列时，列与列之间的 30px 空档只有主线画了连线 → 分支行断开。
 *
 * 判定口径：
 *   - 元件单元格内部 always 算连通（触点中间的两根竖线、线圈的弧线本来就是符号，不是导线）；
 *   - 所以真正的断口只可能出现在：元件与元件之间、最后一格与列右边界之间、列与列之间。
 *   覆盖 = 该行所有水平导线段 ∪ 该行所有元件单元格。缺一段就说明图上是断的。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9520 + Math.floor(Math.random() * 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'wgap' + Date.now()), '--window-size=1500,1000',
    'http://127.0.0.1:8931/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 70; i++) {
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || '').slice(0, 300));
  });
  const send = (m2, p2 = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: p2 })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'THROW: ' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || '').slice(0, 300);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');
  const R = []; const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  for (let k = 0; k < 60; k++) { await sleep(250); if (await ev("document.querySelectorAll('#portalTable tr[data-id]').length>0") === true) break; }
  await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }
  await ev("(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()");
  await sleep(300);
  await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(600);

  // 在浏览器里跑一遍"逐行查断口"，返回每行的诊断
  const scan = async () => ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    if(!svg) return 'no svg';
    var net=TIA.project.blocks[0].networks[0];
    var L=LAD.calcLayout(net);
    var G=LAD.GRID, rowH=L.rowH||G.h, padT=L.padT||G.padT;
    var colXs=[], cx=G.padL;
    net.columns.forEach(function(c,i){ colXs.push(cx); cx += (L.widths[i]||G.cellW)+G.gap; });

    // 该行所有水平实线导线段（透明命中区不算导线）
    var hseg=[];
    svg.querySelectorAll('line').forEach(function(l){
      if(l.getAttribute('y1')!==l.getAttribute('y2')) return;
      var st=l.getAttribute('stroke');
      if(st==='transparent'||st==='none') return;
      if((l.getAttribute('class')||'').indexOf('lad-hit')>=0) return;
      var a=Math.min(+l.getAttribute('x1'),+l.getAttribute('x2'));
      var b=Math.max(+l.getAttribute('x1'),+l.getAttribute('x2'));
      if(b-a<0.5) return;
      hseg.push({y:+(+l.getAttribute('y1')).toFixed(1), a:a, b:b});
    });

    var isTerm=function(br){
      if(!br||!br.length) return true;
      var t=br[br.length-1].type;
      return t==='OPEN_END'||['COIL','SET','RESET','NEG_COIL','POS_COIL','NEG_EDGE_COIL'].indexOf(t)>=0;
    };
    var mergeIv=function(list){
      list=list.slice().sort(function(p,q){return p[0]-q[0];});
      var out=[];
      list.forEach(function(iv){
        var last=out[out.length-1];
        if(last && iv[0]<=last[1]+1.6){ if(iv[1]>last[1]) last[1]=iv[1]; }
        else out.push([iv[0],iv[1]]);
      });
      return out;
    };
    var holesIn=function(ivs,a,b){          // [a,b] 内没被覆盖的区段
      var cur=a, miss=[];
      ivs.forEach(function(iv){
        if(iv[1]<a || iv[0]>b) return;
        if(iv[0]>cur+1.6) miss.push([cur, iv[0]]);
        if(iv[1]>cur) cur=iv[1];
      });
      if(cur<b-1.6) miss.push([cur,b]);
      return miss.filter(function(m){return m[1]-m[0]>1.6;});
    };

    var bad=[], rows=1;
    net.columns.forEach(function(c){ rows=Math.max(rows, c.branches.length); });
    for(var r=0;r<rows;r++){
      var y=+(padT+r*rowH+rowH/2).toFixed(1);
      var wires=hseg.filter(function(s){return Math.abs(s.y-y)<1.2;})
        .map(function(s){return [s.a,s.b];});
      var holes=[];

      // 1) 列内：导线 ∪ 元件单元格，必须从列左边线一路连到列右边线
      for(var c=0;c<net.columns.length;c++){
        var br=net.columns[c].branches[r];
        if(!br) continue;                     // 这一列没有这行
        var cs=colXs[c], cw=(L.widths[c]||G.cellW), ce=cs+cw;
        var cells=LAD.cellLayout(br, cs, cw)||[];
        var ivs=mergeIv(wires.concat(cells.map(function(cl){return [cl.x, cl.x+cl.w];})));
        holesIn(ivs, cs, ce).forEach(function(m){
          holes.push('列'+(c+1)+'内 '+m[0].toFixed(0)+'~'+m[1].toFixed(0));
        });
      }
      // 2) 列间：只认导线；左列这行到元件/箭头收尾就不再连
      for(var c2=0;c2<net.columns.length-1;c2++){
        var br2=net.columns[c2].branches[r];
        var nb=net.columns[c2+1] && net.columns[c2+1].branches[r];
        if(!br2 || !nb) continue;
        if(isTerm(br2)) continue;
        var b0=colXs[c2]+(L.widths[c2]||G.cellW), b1=colXs[c2+1];
        if(b1-b0<=1) continue;
        holesIn(mergeIv(wires), b0, b1).forEach(function(m){
          holes.push('列'+(c2+1)+'→'+(c2+2)+' '+m[0].toFixed(0)+'~'+m[1].toFixed(0));
        });
      }
      if(holes.length) bad.push('行'+(r+1)+': '+holes.join(', '));
    }
    return bad.length? bad.join(' | ') : '';
  })()`);

  const setNet = async (json) => {
    await ev(`(function(){
      var ob1=TIA.project.blocks.filter(function(b){return b.name==='OB1';})[0];
      ob1.networks=[${json}];
      LadEdit.rerender({keepScroll:true}); return true;
    })()`);
    await sleep(600);
  };

  // 场景 1：主线 5 个元件 + 3 行并联（对应截图 1）
  await setNet(`{title:'n1',columns:[
    {branches:[[{id:'a0',type:'NO',operand:'M0.0',addr:'M0.0'},{id:'a1',type:'NO',operand:'M0.1',addr:'M0.1'}]]},
    {branches:[
      [{id:'d0',type:'NC',operand:'M0.3',addr:'M0.3'}],
      [{id:'b0',type:'NO',operand:'Q0.1',addr:'Q0.1'},{id:'b1',type:'OPEN_END'}],
      [{id:'c0',type:'NO',operand:'"TON_DB".Q'},{id:'c1',type:'OPEN_END'}]
    ]},
    {branches:[[{id:'g0',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}`);
  let r1 = await scan();
  console.log('场景1: ' + (r1 || '无断口'));
  ck('场景1（主线 + 3 行并联）无断线', r1 === '', r1);

  // 场景 2：主线 TON / 支路 3 触点 + TOF（对应截图 2）
  await setNet(`{title:'n2',columns:[
    {branches:[[{id:'p0',type:'NO',operand:'M1.0',addr:'M1.0'}]]},
    {branches:[
      [{id:'p1',type:'TON',instance:'TON_DB',db:1,params:{PT:'T#1s'}}],
      [{id:'q1',type:'NO',operand:'M1.1',addr:'M1.1'},{id:'q2',type:'NO',operand:'M1.2',addr:'M1.2'},
       {id:'q3',type:'NO',operand:'M1.3',addr:'M1.3'},
       {id:'qt',type:'TOF',instance:'TOF_DB',db:2,params:{PT:'T#1s'}},{id:'qo',type:'OPEN_END'}]
    ]}
  ]}`);
  let r2 = await scan();
  console.log('场景2: ' + (r2 || '无断口'));
  ck('场景2（主线 TON / 长支路 TOF）无断线', r2 === '', r2);

  // 场景 3：分支跨三列（验证列间连线补到分支行）
  await setNet(`{title:'n3',columns:[
    {branches:[[{id:'x0',type:'NO',operand:'M2.0',addr:'M2.0'}],
               [{id:'y0',type:'NO',operand:'M2.1',addr:'M2.1'}]]},
    {branches:[[{id:'x1',type:'NO',operand:'M2.2',addr:'M2.2'}],
               [{id:'y1',type:'NO',operand:'M2.3',addr:'M2.3'}]]},
    {branches:[[{id:'x2',type:'COIL',operand:'Q0.2',addr:'Q0.2'}],
               [{id:'y2',type:'COIL',operand:'Q0.3',addr:'Q0.3'}]]}
  ]}`);
  let r3 = await scan();
  console.log('场景3: ' + (r3 || '无断口'));
  ck('场景3（两行各跨三列）无断线', r3 === '', r3);

  // 场景 4：空分支 + 开口分支混排
  await setNet(`{title:'n4',columns:[
    {branches:[[{id:'z0',type:'NO',operand:'M3.0',addr:'M3.0'}]]},
    {branches:[[{id:'z1',type:'NO',operand:'M3.1',addr:'M3.1'}],[{id:'z2',type:'OPEN_END'}]]},
    {branches:[[{id:'z3',type:'COIL',operand:'Q0.4',addr:'Q0.4'}]]}
  ]}`);
  let r4 = await scan();
  console.log('场景4: ' + (r4 || '无断口'));
  ck('场景4（主行 + 一条空的开口分支）无断线', r4 === '', r4);

  // 反向自检：把场景1某条"列内行尾导线"删掉，扫描器必须报断口。
  // 没有这一步的话，"全部通过"可能只是扫描器什么都没查。
  await setNet(`{title:'n1',columns:[
    {branches:[[{id:'a0',type:'NO',operand:'M0.0',addr:'M0.0'},{id:'a1',type:'NO',operand:'M0.1',addr:'M0.1'}]]},
    {branches:[
      [{id:'d0',type:'NC',operand:'M0.3',addr:'M0.3'}],
      [{id:'b0',type:'NO',operand:'Q0.1',addr:'Q0.1'},{id:'b1',type:'OPEN_END'}],
      [{id:'c0',type:'NO',operand:'"TON_DB".Q'},{id:'c1',type:'OPEN_END'}]
    ]},
    {branches:[[{id:'g0',type:'COIL',operand:'Q0.0',addr:'Q0.0'}]]}
  ]}`);
  const del = await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] .net-svg > svg');
    var net=TIA.project.blocks[0].networks[0], L=LAD.calcLayout(net), G=LAD.GRID;
    var colXs=[], cx=G.padL;
    net.columns.forEach(function(c,i){ colXs.push(cx); cx += (L.widths[i]||G.cellW)+G.gap; });
    var inCol=function(x1,x2){
      for(var i=0;i<net.columns.length;i++){
        var cs=colXs[i], ce=cs+(L.widths[i]||G.cellW);
        if(x1>=cs-0.5 && x2<=ce+0.5) return true;
      }
      return false;
    };
    var y=+((L.padT||G.padT)+(L.rowH||G.h)/2).toFixed(1);
    var cand=[].slice.call(svg.querySelectorAll('line')).filter(function(l){
      if(l.getAttribute('y1')!==l.getAttribute('y2')) return false;
      if(Math.abs(+l.getAttribute('y1')-y)>=1.2) return false;
      if((l.getAttribute('class')||'')!=='lad-wire') return false;
      return inCol(+l.getAttribute('x1'), +l.getAttribute('x2'));
    });
    if(!cand.length) return 'no-tail-wire';
    cand[0].parentNode.removeChild(cand[0]);
    return 'ok';
  })()`);
  let rn = await scan();
  console.log('自检: ' + del + ' / ' + (rn || '仍然无断口'));
  ck('反向自检：删掉行尾导线后必须报断口', del === 'ok' && rn !== '', del + ' / ' + rn);

  ws.close(); killTree(p);
  if (logs.length) { console.log('--- 异常 ---'); logs.slice(0, 5).forEach(l => console.log(l)); }
  const pass = R.filter(x => x.ok).length;
  console.log('\n通过 ' + pass + ' / ' + R.length);
  process.exit(pass === R.length ? 0 : 1);
})();
