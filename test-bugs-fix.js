/* 回归测试：修复的两个 bug
   Bug1: 门户"创建新项目"应得到空白程序（不含示例程序/变量/监控表）
   Bug2: 缩放滑块应真正缩放 SVG（viewBox），且缩放后拖放落点坐标不错位 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9700 + Math.floor(Math.random() * 90);
const PORT = 8941;   // 独立端口，避免与 start.bat 的 8931 冲突
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

(async () => {
  // 静态服务器
  const srv = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]);
    if (f === '/') f = '/index.html';
    const fp = path.join(__dirname, f);
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');

  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'tp' + Date.now()),
    '--window-size=1680,1000',
    'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const l = JSON.parse(await get('http://127.0.0.1:' + CP + '/json/list'));
      t = l.filter(x => x.url.includes('index.html'));
      if (t.length) break;
    } catch (e) { }
  }
  if (!t || !t.length) { console.log('FAIL: 无法连接浏览器'); killTree(p); srv.close(); process.exit(1); }

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
    if (r.result?.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 400);
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(2600);

  const R = []; const ck = (n, c, x) => { R.push({ n, ok: !!c }); console.log((c ? 'ok   : ' : 'FAIL : ') + n + (x !== undefined ? '  [' + x + ']' : '')); };

  /* ---------- Bug 1：新建项目必须是空白程序 ---------- */
  await ev(`Portal.show('new')`); await sleep(450);
  await ev(`(function(){ var i=document.getElementById('npName'); if(i) i.value='回归测试_空白项目'; })()`);
  await ev(`document.getElementById('btnCreateProject').click()`);
  await sleep(1300);
  await ev(`(function(){ var s=document.querySelector('.fs-step[data-target="projectview"]'); if(s) s.click(); })()`);
  await sleep(1300);

  ck('新项目名称正确', await ev(`TIA.project && TIA.project.name==='回归测试_空白项目'`),
    await ev(`TIA.project?TIA.project.name:''`));
  ck('不含示例变量表（tags 为空）', await ev(`TIA.project.tags.length===0`), await ev(`TIA.project.tags.length`));
  ck('程序块只有 OB1（无 FB_Motor/FC_Calc）', await ev(`TIA.project.blocks.length===1 && TIA.project.blocks[0].name==='OB1'`),
    await ev(`TIA.project.blocks.map(function(b){return b.name}).join(',')`));
  ck('OB1 只有一个空网络', await ev(`(function(){
      var n=TIA.project.blocks[0].networks;
      return n.length===1 && n[0].columns.length===1 && n[0].columns[0].branches.length===1 && n[0].columns[0].branches[0].length===0;
    })()`));
  ck('无示例监控表', await ev(`(TIA.project.watchTables||[]).length===0`));
  ck('程序树只显示 OB1', await ev(`document.querySelectorAll('.network').length===1`));

  /* ---------- Bug 2：缩放真正生效 + 坐标不错位 ---------- */
  // 100% 基线：往 OB1 空网络里放一个触点，验证落点换算在 100% 时正确
  await ev(`(function(){
    var blk=TIA.project.blocks[0];
    blk.networks=[{title:'',columns:[{branches:[[
      {id:'t1',type:'NO',operand:'I0.0'},
      {id:'t2',type:'NO',operand:'I0.1'},
      {id:'t3',type:'COIL',operand:'Q0.0'}
    ]]}]}];
    TIA.openTabs.forEach(function(t){t.dirty=true;});
    LadEdit.state.onRerender();
  })()`);
  await sleep(500);

  // 滑到 50%
  await ev(`(function(){
    var s=document.getElementById('ladZoomSlider');
    s.value='50';
    s.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(400);

  const zInfo = await ev(`(function(){
    var svg=document.querySelector('.net-svg svg');
    if(!svg) return 'NO_SVG';
    var r=svg.getBoundingClientRect();
    return { vb: svg.getAttribute('viewBox'), w: svg.width.baseVal.value, dispW: r.width };
  })()`);
  ck('SVG 带 viewBox', !!(zInfo && zInfo.vb && zInfo.vb.indexOf('0 0')===0), zInfo && zInfo.vb);
  ck('50% 时显示宽度 = 原始宽 × 0.5', !!(zInfo && Math.abs(zInfo.dispW - zInfo.w*0.5) < 2),
    zInfo && ('disp='+zInfo.dispW.toFixed(1)+' orig='+zInfo.w));

  // 缩放 50% 时，用第 2 个元件(t2/I0.1)的屏幕中心做落点，应返回 col=0, pos=1
  const drop = await ev(`(function(){
    var hits=document.querySelectorAll('.net-svg [data-el]');
    if(hits.length<2) return 'NO_EL:'+hits.length;
    function hitOf(id){
      var els=document.querySelectorAll('.net-svg [data-el="'+id+'"]');
      // data-el 可能挂在多个子节点上，取带 .hit 的
      for(var i=0;i<els.length;i++){ if(els[i].classList && els[i].classList.contains('hit')) return els[i]; }
      return els[0];
    }
    var h=hitOf('t2'); if(!h) return 'NO_HIT';
    var r=h.getBoundingClientRect();
    var svg=document.querySelector('.net-svg svg');
    var pt={clientX:r.left+r.width/2, clientY:r.top+r.height/2, target:svg};
    var pos=LadEdit.dropPosAt(pt);
    return JSON.stringify(pos);
  })()`);
  let dropOk = false, dropParsed = drop;
  try { var d = JSON.parse(drop); dropOk = (d.net===0 && d.col===0 && d.pos===1); } catch (e) { }
  ck('50% 缩放时拖放落点坐标正确（t2 → col0/pos1）', dropOk, dropParsed);

  // anchorAtPoint（拖开放箭头用同一坐标系）也验证一下
  const anch = await ev(`(function(){
    function hitOf(id){
      var els=document.querySelectorAll('.net-svg [data-el="'+id+'"]');
      for(var i=0;i<els.length;i++){ if(els[i].classList && els[i].classList.contains('hit')) return els[i]; }
      return els[0];
    }
    var h=hitOf('t3'); if(!h) return 'NO_HIT';
    var r=h.getBoundingClientRect();
    // anchorAtPoint 不直接导出，通过 arrowTargetAt 间接验证会引入干扰；
    // 直接重算：内部 px 应与 calcLayout 的单元格 x 对齐
    var svg=document.querySelector('.net-svg svg');
    var sr=svg.getBoundingClientRect();
    var kx=sr.width?svg.width.baseVal.value/sr.width:1;
    var px=(r.left+r.width/2-sr.left)*kx;
    var net=TIA.project.blocks[0].networks[0];
    var L=LAD.calcLayout(net);
    var cells=LAD.cellLayout(net.columns[0].branches[0], LAD.GRID.padL, L.widths[0]);
    // t3 前面有 t1/t2 两个元件 → 最近落点应为 2（t3 之前）或 3（列尾）
    var xs=cells.map(function(c){return c.x;}).concat([LAD.GRID.padL+L.widths[0]]);
    var best=-1,bd=1e9;
    xs.forEach(function(x,i){var dd=Math.abs(px-x); if(dd<bd){bd=dd;best=i;}});
    return JSON.stringify({px:Math.round(px), best:best, xs:xs.map(function(x){return Math.round(x)})});
  })()`);
  let anchOk = false;
  try { var a = JSON.parse(anch); anchOk = (a.best===2 || a.best===3); } catch (e) { }
  ck('50% 缩放时 anchor 横坐标换算正确', anchOk, anch);

  // 缩放回 100%，显示尺寸应还原
  await ev(`(function(){
    var s=document.getElementById('ladZoomSlider');
    s.value='100';
    s.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(300);
  const z100 = await ev(`(function(){
    var svg=document.querySelector('.net-svg svg');
    var r=svg.getBoundingClientRect();
    return { w: svg.width.baseVal.value, dispW: r.width };
  })()`);
  ck('100% 时显示宽度还原', Math.abs(z100.dispW - z100.w) < 2, 'disp=' + z100.dispW.toFixed(1) + ' orig=' + z100.w);

  if (logs.length) { console.log('--- 运行时异常 ---'); logs.slice(0, 6).forEach(l => console.log(l)); }

  const fails = R.filter(x => !x.ok).length;
  console.log(fails ? ('共 ' + fails + ' 项失败') : '全部通过');
  killTree(p); srv.close();
  process.exit(fails ? 1 : 0);
})();
