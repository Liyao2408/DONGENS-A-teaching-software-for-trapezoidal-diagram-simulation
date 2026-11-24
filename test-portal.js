/* 门户与项目持久化测试（11 项）
   覆盖：启动显示门户 / 双击打开 / 单击+按钮打开 / 自动保存 / 新建 / 刷新后仍在 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9700 + Math.floor(Math.random() * 90);
const PORT = 8931;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
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
  if (!t || !t.length) { console.log('FAIL: 无法连接浏览器'); killTree(p); process.exit(1); }

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

  ck('启动时显示门户', await ev(`getComputedStyle(document.getElementById('portal')).display==='flex'`));
  ck('最近项目表有数据', (await ev(`document.querySelectorAll('#portalTable tr[data-id]').length`)) >= 1);
  ck('默认选中一项，打开按钮可用', await ev(`document.getElementById('btnOpen').disabled===false`));

  // 单击选中 + 点"打开"
  await ev(`(function(){
    var tr=document.querySelector('#portalTable tr[data-id]');
    tr.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  })()`);
  await sleep(250);
  const selOk = await ev(`document.querySelectorAll('#portalTable tr.sel').length===1`);
  ck('单击可选中项目行', selOk);

  await ev(`document.getElementById('btnOpen').click()`);
  await sleep(1000);
  ck('点“打开”可进入工程', await ev(`getComputedStyle(document.getElementById('portal')).display==='none'`));
  ck('工程已载入', await ev(`!!(TIA.project && TIA.project.blocks.length>0)`), await ev(`TIA.project?TIA.project.name:''`));
  ck('LAD 已渲染', (await ev(`document.querySelectorAll('.network').length`)) > 0);

  // 改动 -> 自动保存
  await ev(`(function(){
    TIA.project.blocks[0].networks[0].title='自动保存验证';
    TIA.openTabs.forEach(function(t){t.dirty=true;});
  })()`);
  await sleep(5400);
  const saved = await ev(`(function(){
    var list=ProjectStore.list();
    if(!list.length) return 'NO_LIST';
    var pr=ProjectStore.load(list[0].id);
    return pr ? pr.blocks[0].networks[0].title : 'LOAD_FAIL';
  })()`);
  ck('自动保存已落盘', saved === '自动保存验证', saved);

  // 新建第二个项目（V8：走门户表单，创建后停在新手上路页）
  await ev(`Portal.show('new')`); await sleep(450);
  await ev(`(function(){
    var i=document.getElementById('npName');
    if(i) i.value='持久化测试_项目B';
  })()`);
  await ev(`document.getElementById('btnCreateProject').click()`);
  await sleep(1300);   // 等 500ms 进度框 + 切视图

  ck('创建后停在新手上路页', await ev(`Portal.view()==='firststeps'`), await ev(`Portal.view()`));
  const pendingName = await ev(`(function(){var p=Portal.getPending();return p?p.name:'';})()`);
  ck('新建项目已创建（待进入）', pendingName === '持久化测试_项目B', pendingName);

  // 点"项目视图"进入工程
  await ev(`(function(){
    var s=document.querySelector('.fs-step[data-target="projectview"]');
    if(s) s.click();
  })()`);
  await sleep(1300);
  ck('从引导页进入工程', await ev(`TIA.project && TIA.project.name==='持久化测试_项目B'`),
    await ev(`TIA.project?TIA.project.name:''`));

  // 回门户看到 2 个（先切回 open 视图）
  await ev(`Portal.show('open')`); await sleep(500);
  const cnt = await ev(`document.querySelectorAll('#portalTable tr[data-id]').length`);
  ck('项目列表累计 2 个', cnt === 2, 'count=' + cnt);

  // 刷新后仍存在
  await send('Page.reload');
  await sleep(2800);
  const cnt2 = await ev(`document.querySelectorAll('#portalTable tr[data-id]').length`);
  ck('刷新后项目仍在（真持久化）', cnt2 === 2, 'count=' + cnt2);

  if (logs.length) { console.log('--- 运行时异常 ---'); logs.slice(0, 6).forEach(l => console.log(l)); }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    fs.writeFileSync('docs/v4-portal.png', Buffer.from(shot.result.data, 'base64'));
    console.log('ok   : 截图已保存 docs/v4-portal.png');
  }

  const pass = R.filter(x => x.ok).length;
  console.log('\n===== 汇总 =====');
  console.log('通过 ' + pass + '/' + R.length);
  ws.close(); killTree(p);
  process.exit(pass === R.length ? 0 : 1);
})();
