/* V32：监视模式下的导线通电着色 + 按住触点改状态
 *   node test-live.js   （需要 8931 端口的本地静态服务） */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9884;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'lv' + Date.now()),
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
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('document.querySelectorAll(".network").length') > 0) break; }

  // 场景：主线 NO(I0.0 断开) + 分支 NO(M0.0 闭合) → 列输出仍为 1
  //       → 汇合竖线、列间连线应该是绿；主线 I0.0 后面那段应该是暗的
  await ev(`(function(){
    var blk=TIA.project.blocks[0], net=blk.networks[0];
    blk.networks=[net];
    net.title='监视着色';
    net.columns=[
      { branches: [
        [{id:'m1',type:'NO',operand:'Start_Button',addr:'I0.0'}],
        [{id:'m2',type:'NO',operand:'M0.0',addr:'M0.0'}]
      ]},
      { branches: [[{id:'m3',type:'NC',operand:'Stop_Button',addr:'I0.1'}]] },
      { branches: [[{id:'m4',type:'COIL',operand:'Motor_Run',addr:'Q0.0'}]] }
    ];
    LadEdit.state.selId=null;LadEdit.state.selSeg=null;TIA.selSeg=null;TIA.selEl=null;
    LadEdit.mount(blk,TIA.activeTab,{});
    var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();
  })()`);
  await sleep(700);

  // 进入在线 + 监视
  await ev(`(function(){
    TIA.online=true; TIA.monitor=true; TIA.plc.runtime=true;
    TIA.plc.write('I0.0', false); TIA.plc.write('I0.1', false); TIA.plc.write('M0.0', true);
    TIA.plc.step(TIA.project); TIA.plc.step(TIA.project);
    TIA.refreshLive();
  })()`);
  await sleep(600);

  const strokeOf = async (sel) => ev(`(function(){var l=document.querySelector('${sel}');return l?l.getAttribute('stroke'):'MISSING';})()`);
  const clsOf = async (id) => ev(`(function(){var g=document.querySelector('.lad-el[data-el="${id}"]');return g?g.getAttribute('class'):'MISSING';})()`);

  const joinR = await strokeOf('.network[data-net="0"] .lad-join[data-live="colout:0:1"]');
  ok(joinR === '#00b050', '分支汇合竖线通电变绿', joinR);

  const link = await strokeOf('.network[data-net="0"] [data-live="link:0"]');
  ok(link === '#00b050', '列间连线通电变绿', link);

  const m1 = await clsOf('m1');
  ok(/out-dead/.test(m1) && /in-live/.test(m1), '断开的常开触点：进线绿、出线暗', m1);
  const m1lead = await strokeOf('.lad-el[data-el="m1"] > .lad-wire[data-lead$=":R"]');
  ok(m1lead === '#1a6fa8', '未通电的引线仍是暗色', m1lead);

  const m2 = await clsOf('m2');
  ok(/out-live/.test(m2), '闭合的分支触点出线为绿', m2);

  const m4v = await ev(`TIA.plc.read('Q0.0')`);
  ok(m4v === true || m4v === 1, '线圈得电', String(m4v));

  // ---------- 值气泡：必须在符号下方，不能压住地址/符号名标签 ----------
  const badgeInfo = JSON.parse(await ev(`(function(){
    var svg=document.querySelector('.network[data-net="0"] svg');
    var vals=Array.prototype.slice.call(svg.querySelectorAll('.lad-val'));
    var labels=Array.prototype.slice.call(svg.querySelectorAll('.lt-addr,.lt-sym'));
    var bad=[], below=true;
    vals.forEach(function(v){
      var a=v.getBBox();
      labels.forEach(function(t){
        var b=t.getBBox();
        if(a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height){
          bad.push(v.textContent+'×'+t.textContent);
        }
      });
      // 气泡整体应该在导线（元件 hit 中线）下方
      var id=v.getAttribute('data-el');
      var hit=id?svg.querySelector('.lad-el[data-el="'+id+'"] .hit'):null;
      if(hit && a.y < (+hit.getAttribute('y') + +hit.getAttribute('height')/2)) below=false;
    });
    return JSON.stringify({n:vals.length, bad:bad, below:below, txt: vals.map(function(v){return v.textContent;})});
  })()`));
  ok(badgeInfo.n > 0, '监视时画出值气泡', badgeInfo.n + ' 个 ' + JSON.stringify(badgeInfo.txt));
  ok(badgeInfo.bad.length === 0, '值气泡不与地址/符号名标签重叠', badgeInfo.bad.join(',') || '无重叠');
  ok(badgeInfo.below === true, '值气泡在导线下方', badgeInfo.below);

  // 截图（监视着色）
  const shot = async (f) => {
    const sc = JSON.parse(await ev(`(function(){var s=document.querySelector('.network[data-net="0"] svg').getBoundingClientRect();
      return JSON.stringify({x:s.left,y:s.top,w:s.width,h:s.height});})()`));
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(sc.x), y: Math.round(sc.y), width: Math.round(sc.w), height: Math.round(sc.h), scale: 3 } });
    require('fs').writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  };
  await shot('docs/v32-live-wire.png');

  // ---------- 按住触点改状态 ----------
  const hitPt = async (id) => JSON.parse(await ev(`(function(){var h=document.querySelector('.lad-el[data-el="${id}"] .hit');
    var r=h.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));
  const P = await hitPt('m1');
  const down = async (pt) => ev(`(function(){var el=document.elementFromPoint(${pt.x},${pt.y});
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:${pt.x},clientY:${pt.y},button:0,pointerId:1,isPrimary:true}));
    return el.getAttribute('class')||el.className.baseVal||'';})()`);
  const up = async (pt) => ev(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:${pt.x},clientY:${pt.y},pointerId:1,isPrimary:true}))`);

  await down(P);
  await sleep(300);
  ok(await ev(`TIA.plc.read('I0.0')`) === true || await ev(`TIA.plc.read('I0.0')`) === 1,
    '按住常开触点：该位被强制为 1', String(await ev(`TIA.plc.read('I0.0')`)));
  const m1held = await clsOf('m1');
  ok(/out-live/.test(m1held), '按住时常开触点导通（出线变绿）', m1held);
  await shot('docs/v32-force-contact.png');

  await up(P);
  await sleep(300);
  const afterUp = await ev(`TIA.plc.read('I0.0')`);
  ok(afterUp === false || afterUp === 0, '松开后该位复位', String(afterUp));
  const m1back = await clsOf('m1');
  ok(/out-dead/.test(m1back), '松开后常开触点恢复断开', m1back);

  // 常闭触点：按住 → 位变 1 → 触点断开
  const P3 = await hitPt('m3');
  await down(P3);
  await sleep(300);
  ok(await ev(`TIA.plc.read('I0.1')`) === true || await ev(`TIA.plc.read('I0.1')`) === 1,
    '按住常闭触点：该位被强制为 1', String(await ev(`TIA.plc.read('I0.1')`)));
  await up(P3);
  await sleep(250);
  ok(await ev(`TIA.plc.read('I0.1')`) === false, '常闭触点松开后复位');

  // 线圈：按住不应改值
  const P4 = await hitPt('m4');
  const qBefore = await ev(`TIA.plc.read('Q0.0')`);
  await down(P4);
  await sleep(200);
  const qHeld = await ev(`TIA.plc.read('Q0.0')`);
  await up(P4);
  ok(qBefore === qHeld, '线圈上按住不改值（只对 NO/NC 生效）', qBefore + '→' + qHeld);

  // 离线时按住不该改值
  await ev(`(function(){TIA.monitor=false;})()`);
  const P5 = await hitPt('m1');
  await down(P5);
  await sleep(200);
  ok(await ev(`TIA.plc.read('I0.0')`) === false, '关掉监视后按住触点不改值');
  await up(P5);

  if (logs.length) console.log('页面异常: ' + logs.slice(0, 3).join(' | '));
  console.log('\n通过 ' + pass + '/' + (pass + fail));
  ws.close(); killTree(p); process.exit(fail ? 1 : 0);
})();
