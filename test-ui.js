// 自动化功能测试：用 CDP 驱动无头 Edge，验证核心交互链路
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8931;
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);   // 随机端口，避免连到残留实例

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

function killTree(p) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      p.kill('SIGKILL');
    }
  } catch (e) { }
}

async function main() {
  const userData = path.join(process.env.TEMP, 'cdptest_' + Date.now());
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userData}`,
    '--window-size=1600,1000',
    `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const raw = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = JSON.parse(raw);
      targets = list.filter(t => t.type === 'page' && t.url.includes('index.html'));
      if (targets.length) break;
    } catch (e) { }
  }
  if (!targets || !targets.length) {
    console.log('FAIL: 无法连接 CDP');
    killTree(proc);
    process.exit(1);
  }

  const WebSocket = require('ws');
const { enterViaPortal } = require('./test-helper.js');
  let ws;
  try { ws = new WebSocket(targets[0].webSocketDebuggerUrl); }
  catch (e) { console.log('NO ws module: ' + e.message); killTree(proc); process.exit(2); }

  let msgId = 0;
  const pending = new Map();
  const logs = [];

  await new Promise(r => ws.on('open', r));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ||
        m.params.exceptionDetails.text));
    }
  });

  function send(method, params) {
    return new Promise(res => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.result?.exceptionDetails) {
      return { err: r.result.exceptionDetails.exception?.description || 'ERR' };
    }
    return { v: r.result?.result?.value };
  }

  await send('Runtime.enable');
  await send('Page.enable');

  // __PORTAL_ENTRY__
  // 先通过启动门户进入工程
  {
    let ok = false;
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      const r = await evalJs("(function(){var p=document.getElementById('portal');return !!(p && getComputedStyle(p).display!=='none' && document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
      if (r.v === true) { ok = true; break; }
    }
    if (ok) {
      await evalJs("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
    }
  }
  // 等待应用完成首次渲染（DOMContentLoaded + boot + 初次编译）
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const rr = await evalJs('document.querySelectorAll(".network").length');
    if (rr.v > 0) { ready = true; break; }
  }
  if (!ready) {
    console.log('WARN: 应用未在预期时间内完成首屏渲染，继续测试');
  }
  await sleep(400);

  const results = [];
  function check(name, cond, extra) {
    results.push({ name, ok: !!cond, extra: extra || '' });
    console.log((cond ? 'ok   : ' : 'FAIL : ') + name + (extra ? '  [' + extra + ']' : ''));
  }

  // 1. 页面基础
  let r = await evalJs('document.querySelectorAll(".node").length');
  check('项目树节点已渲染', r.v > 8, 'nodes=' + r.v);

  r = await evalJs('document.querySelectorAll(".network").length');
  check('LAD 网络已渲染', r.v === 4, 'networks=' + r.v);

  r = await evalJs('document.querySelectorAll("svg .lad-el").length');
  check('LAD 元件已绘制', r.v > 8, 'els=' + r.v);

  // 2. 编译
  r = await evalJs('TIA && typeof TIA.project === "object"');
  check('TIA 全局对象存在', r.v === true);

  r = await evalJs(`(function(){
    document.querySelector('.tb[data-act="compile"]').click();
    return TIA.diags.length;
  })()`);
  const errCount = await evalJs('TIA.diags.filter(d=>d.level==="error").length');
  check('编译无错误', errCount.v === 0, 'errors=' + errCount.v);

  // 3. 下载
  await evalJs(`document.querySelector('.tb[data-act="download"]').click()`);
  await sleep(2200);
  r = await evalJs('TIA.online && TIA.running');
  check('下载后 CPU 在线且 RUN', r.v === true, 'online/run');

  // 4. 扫描在跑
  await sleep(600);
  r = await evalJs('TIA.plc.cycleCount');
  check('循环扫描正在运行', r.v > 3, 'cycles=' + r.v);

  // 5. I0.0 置位 -> Q0.0 跟随（自锁电路）
  await evalJs('TIA.plc.write("I0.0", true)');
  await sleep(300);
  r = await evalJs('TIA.plc.read("Q0.0")');
  check('启动按钮触发电机输出 Q0.0', r.v === true, 'Q0.0=' + r.v);

  await evalJs('TIA.plc.write("I0.0", false)');
  await sleep(200);
  r = await evalJs('TIA.plc.read("Q0.0")');
  check('松开启动后自锁保持', r.v === true, 'Q0.0=' + r.v);

  await evalJs('TIA.plc.write("I0.1", true)');
  await sleep(250);
  r = await evalJs('TIA.plc.read("Q0.0")');
  check('停止按钮切断电机', r.v === false, 'Q0.0=' + r.v);

  // 6. 计数网络：I0.2 上升沿触发 Part_Count（ADD 由 P 触点门控，只在边沿累加）
  await evalJs('TIA.plc.write("MW12", 0)');
  // 先让 PLC 空跑几个周期确认不误计数
  await sleep(300);
  const idle = await evalJs('TIA.plc.read("MW12")');
  check('无输入时累加器保持 0', idle.v === 0, 'MW12=' + idle.v);

  const pulse = async () => {
    await evalJs('TIA.plc.write("I0.2", true)');
    await sleep(260);   // 至少覆盖数个扫描周期
    await evalJs('TIA.plc.write("I0.2", false)');
    await sleep(260);
  };
  await pulse(); await pulse(); await pulse();
  r = await evalJs('TIA.plc.read("MW12")');
  check('3 次上升沿累加到 3', r.v === 3, 'Part_Count=' + r.v);

  // 7. 监视模式
  await evalJs(`document.querySelector('.tb[data-act="monitor"]').click()`);
  await sleep(400);
  r = await evalJs('TIA.monitor');
  check('监视模式已开启', r.v === true);
  // 下载后会自动打开仿真面板，先切回 OB1 再检查着色
  await evalJs(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
  await sleep(900);
  r = await evalJs('document.querySelectorAll(".el-true, .el-false").length');
  check('LAD 在线着色已应用', r.v > 0, 'colored=' + r.v);

  // 8. SCL 块
  r = await evalJs(`(function(){
    var fb = TIA.project.blocks.filter(b=>b.name==="FB_Motor")[0];
    TIA.openTabs.length=0;
    document.querySelector('[data-node="block:FB_Motor"]').click();
    return !!document.querySelector('#sclTa');
  })()`);
  check('SCL 编辑器已打开', r.v === true);

  r = await evalJs('document.querySelector("#sclTa").value.length');
  check('SCL 源码已载入', r.v > 100, 'len=' + r.v);

  // 9. 变量表
  r = await evalJs(`(function(){
    document.querySelector('[data-node="tags:0"]').click();
    return document.querySelectorAll('#editorArea tbody tr').length;
  })()`);
  check('变量表已渲染', r.v === 8, 'rows=' + r.v);

  // 10. 监控表写入
  r = await evalJs(`(function(){
    document.querySelector('[data-node="watchlist"]').click();
    return document.querySelectorAll('#editorArea tbody tr').length;
  })()`);
  check('监控表已渲染', r.v === 5, 'rows=' + r.v);

  // 11. 诊断页
  r = await evalJs(`(function(){
    document.querySelector('[data-node="diagnostics"]').click();
    return document.querySelector('#editorArea').innerHTML.indexOf('RUN') >= 0;
  })()`);
  check('诊断页显示运行状态', r.v === true);

  // 12. 串行化 / XML
  r = await evalJs(`(function(){
    var s = JSON.stringify(TIA.project);
    return s.length;
  })()`);
  check('工程可序列化', r.v > 2000, 'json=' + r.v);

  // 13. 无运行时报错
  const errLogs = logs.filter(l => l.indexOf('EXCEPTION') >= 0);
  check('无运行时异常', errLogs.length === 0, errLogs.slice(0, 3).join(' | '));

  // 14. 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'shot-live.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('ok   : 截图已保存 shot-live.png');
  }

  console.log('\n===== 汇总 =====');
  const pass = results.filter(x => x.ok).length;
  console.log(`通过 ${pass}/${results.length}`);
  if (pass !== results.length) {
    console.log('失败项：');
    results.filter(x => !x.ok).forEach(x => console.log('  - ' + x.name + ' ' + x.extra));
  }

  ws.close(); killTree(proc);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(e => { console.log('ERROR: ' + e.message + '\n' + e.stack); process.exit(3); });






