/* 门户三视图测试：创建表单 / 进度框 / 新手上路 / 底部路径 / 标题栏 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP = 9100 + Math.floor(Math.random() * 90);
const PORT = 8931;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); });
function killTree(p) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }

(async () => {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CP,
    '--user-data-dir=' + path.join(process.env.TEMP, 'pv' + Date.now()),
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

  /* ---------- 1. 视图切换 ---------- */
  ck('启动默认在"打开现有项目"视图', await ev(`Portal.view()==='open'`));
  ck('打开视图可见', await ev(`getComputedStyle(document.querySelector('[data-view="open"]')).display!=='none'`));
  ck('其它视图隐藏', await ev(`getComputedStyle(document.querySelector('[data-view="new"]')).display==='none' &&
    getComputedStyle(document.querySelector('[data-view="firststeps"]')).display==='none'`));

  // 点"创建新项目"
  await ev(`document.getElementById('actNewProject').click()`);
  await sleep(400);
  ck('点"创建新项目"切到表单视图', await ev(`Portal.view()==='new'`));
  ck('表单视图可见', await ev(`getComputedStyle(document.querySelector('[data-view="new"]')).display!=='none'`));
  ck('动作项高亮同步', await ev(`document.getElementById('actNewProject').classList.contains('active')`));

  /* ---------- 2. 表单字段 ---------- */
  ck('5 个字段齐全', await ev(`!!(document.getElementById('npName') && document.getElementById('npPath') &&
    document.getElementById('npVersion') && document.getElementById('npAuthor') &&
    document.getElementById('npComment'))`));
  ck('版本默认 V16', (await ev(`document.getElementById('npVersion').value`)) === 'V16');
  ck('路径默认值正确', (await ev(`document.getElementById('npPath').value`)).indexOf('Automation') >= 0);
  ck('作者默认 Administrator', (await ev(`document.getElementById('npAuthor').value`)) === 'Administrator');
  ck('名称已自动选中', await ev(`(function(){
    var el=document.getElementById('npName');
    return document.activeElement===el && el.selectionStart===0 && el.selectionEnd===el.value.length;
  })()`));
  const defaultName = await ev(`document.getElementById('npName').value`);
  ck('默认名为"项目N"格式', /^项目\d+$/.test(defaultName), defaultName);

  /* ---------- 3. 校验 ---------- */
  await ev(`(function(){var e=document.getElementById('npName'); e.value='';})()`);
  await ev(`document.getElementById('btnCreateProject').click()`);
  await sleep(250);
  const errEmpty = await ev(`document.getElementById('npError').textContent`);
  ck('空名称有提示', errEmpty.indexOf('名称') >= 0, errEmpty);

  await ev(`(function(){var e=document.getElementById('npName'); e.value='非法/名称';})()`);
  await ev(`document.getElementById('btnCreateProject').click()`);
  await sleep(250);
  const errBad = await ev(`document.getElementById('npError').textContent`);
  ck('非法字符有提示', errBad.indexOf('不能包含') >= 0, errBad);

  /* ---------- 4. 创建流程：进度框 → 新手上路 ---------- */
  const testName = '三视图测试_' + Date.now().toString(36);
  await ev(`(function(){
    document.getElementById('npName').value=${JSON.stringify(testName)};
    document.getElementById('npComment').value='这是注释';
  })()`);

  // 点创建，立刻探测进度框是否存在（500ms 窗口）
  const progSeen = await ev(`(function(){
    document.getElementById('btnCreateProject').click();
    return !!document.getElementById('createProgress');
  })()`);
  ck('出现"正在创建项目..."进度框', progSeen === true);

  const progPath = await ev(`(function(){
    var el=document.querySelector('#createProgress .cp-path');
    return el ? el.textContent : '';
  })()`);
  ck('进度框显示完整路径', progPath.indexOf(testName) >= 0, progPath);

  await sleep(1200);   // 等进度框消失 + 切换视图

  ck('进度框已自动关闭', await ev(`!document.getElementById('createProgress')`));
  ck('创建后停在新手上路页', await ev(`Portal.view()==='firststeps'`), await ev(`Portal.view()`));
  ck('新手上路视图可见', await ev(`getComputedStyle(document.querySelector('[data-view="firststeps"]')).display!=='none'`));

  const intro = await ev(`document.getElementById('fsIntro').textContent`);
  ck('引导页文案含项目名', intro.indexOf(testName) >= 0, intro);

  /* ---------- 5. 底部状态栏 & 标题栏 ---------- */
  const openedTxt = await ev(`document.getElementById('pfOpened').textContent`);
  ck('底部显示完整路径', openedTxt.indexOf(testName) >= 0 && openedTxt.indexOf('已打开的项目') >= 0, openedTxt);

  /* ---------- 6. 引导页入口 ---------- */
  const stepCount = await ev(`document.querySelectorAll('.fs-step').length`);
  ck('引导页有 6 个入口', stepCount === 6, 'steps=' + stepCount);

  // 未实现模块应弹提示（用 dialog 拦截）
  await ev(`window.__alertMsg=''; window.alert=function(m){window.__alertMsg=m;};`);
  await ev(`(function(){var s=document.querySelector('.fs-step[data-target="motion"]'); s.click();})()`);
  await sleep(250);
  const motionMsg = await ev(`window.__alertMsg`);
  ck('未实现模块有明确提示', motionMsg && motionMsg.indexOf('尚未实现') >= 0, (motionMsg || '').slice(0, 30));

  /* ---------- 7. 点"项目视图"进入工程 ---------- */
  await ev(`window.__alertMsg='';`);
  await ev(`(function(){var s=document.querySelector('.fs-step[data-target="projectview"]'); s.click();})()`);
  await sleep(1300);

  ck('点"项目视图"进入工程', await ev(`getComputedStyle(document.getElementById('portal')).display==='none'`));
  ck('工程已载入', await ev(`!!(TIA.project && TIA.project.blocks.length>0)`), await ev(`TIA.project?TIA.project.name:''`));
  ck('载入的是刚创建的项目', (await ev(`TIA.project?TIA.project.name:''`)) === testName);
  ck('LAD 已渲染', (await ev(`document.querySelectorAll('.network').length`)) > 0);

  const titleTxt = await ev(`document.getElementById('titleDoc').textContent`);
  ck('标题栏显示 Siemens - 路径', titleTxt.indexOf('Siemens') >= 0 && titleTxt.indexOf(testName) >= 0, titleTxt);

  const projPath = await ev(`TIA.project.path || ''`);
  ck('项目路径含项目名', projPath.indexOf(testName) >= 0, projPath);

  /* ---------- 8. 打开已有项目仍直接进工程 ---------- */
  await ev(`Portal.show('open')`);
  await sleep(500);
  ck('可回到打开视图', await ev(`Portal.view()==='open'`));
  await ev(`(function(){
    var tr=document.querySelector('#portalTable tr[data-id]');
    if(tr) tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await sleep(1300);
  ck('双击已有项目直接进工程', await ev(`getComputedStyle(document.getElementById('portal')).display==='none'`));

  if (logs.length) { console.log('--- 运行时异常 ---'); logs.slice(0, 6).forEach(l => console.log(l)); }

  // 截图：创建表单 + 新手上路
  await ev(`Portal.show('new')`);
  await sleep(600);
  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/v8-create-form.png', Buffer.from(s1.result.data, 'base64'));

  await ev(`(function(){
    Portal.setPending(TIA.project);
    Portal.switchView('firststeps');
  })()`);
  await sleep(500);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/v8-firststeps.png', Buffer.from(s2.result.data, 'base64'));
  console.log('ok   : 截图已保存');

  const pass = R.filter(x => x.ok).length;
  console.log('\n===== 汇总 =====');
  console.log('通过 ' + pass + '/' + R.length);
  if (pass !== R.length) R.filter(x => !x.ok).forEach(x => console.log('  FAIL: ' + x.n));

  ws.close(); killTree(p);
  process.exit(pass === R.length ? 0 : 1);
})();
