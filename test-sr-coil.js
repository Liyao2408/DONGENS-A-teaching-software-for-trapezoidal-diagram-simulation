/* ============================================================
 * test-sr-coil.js — 置位 / 复位线圈（-(S)- / -(R)-）回归
 *
 * 用户现场："置位线圈没有用，复位线圈也没有用"。
 * 语义按博途（IEC）：
 *   · -(S)- 通一下电就把点位置 1，之后自己保持（哪怕前面断电）
 *   · -(R)- 通一下电就把同名点位清 0，把置位"解开"
 *   · 普通 -( )- 必须每周期跟随功率流，不能被这次改动连累
 *
 * 另外守住两条容易踩的坑：
 *   · 符号名带引号（TIA 写法 "Tag_6"）也要能写进去
 *   · 只有绝对地址、没有符号名的线圈也要能写进去
 *   以前这两种情况 plc.write() 会静默返回 false，线圈就"没反应"。
 *
 * 运行：node test-sr-coil.js
 * ============================================================ */
const PLC = require('./js/plc.js');
global.window = global;
require('./js/instructions.js');

const R = [];
function ck(name, cond, extra) {
  R.push(!!cond);
  console.log((cond ? 'ok   : ' : 'FAIL : ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
}

// 造一台 CPU：S 网络 / R 网络 / 读回网络
function makePlc(tags) {
  const plc = new PLC.SoftPLC();
  plc.setTags(tags);
  plc.cycleTime = 10;
  return plc;
}
function net(elems) { return { title: '', columns: [{ branches: [elems] }] }; }
function scan(plc, nets, n) {
  const proj = { tags: plc.tags, blocks: [{ name: 'OB1', obNumber: 1, lang: 'LAD', networks: nets }] };
  for (let i = 0; i < (n || 1); i++) plc.step(proj);
  return proj;
}

/* ---------------- 1. 基本：S 自锁、R 复位 ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's1', type: 'SET', operand: 'Tag_6', addr: 'M0.7' }]),
    net([{ id: 'c2', type: 'NO', operand: 'I0.1', addr: 'I0.1' },
    { id: 'r1', type: 'RESET', operand: 'Tag_6', addr: 'M0.7' }]),
    net([{ id: 'c3', type: 'NO', operand: 'Tag_6', addr: 'M0.7' },
    { id: 'o1', type: 'COIL', operand: 'Q0.0', addr: 'Q0.0' }])
  ];
  const plc = makePlc([
    { name: 'I0.0', address: 'I0.0', datatype: 'Bool' },
    { name: 'I0.1', address: 'I0.1', datatype: 'Bool' },
    { name: 'Tag_6', address: 'M0.7', datatype: 'Bool' },
    { name: 'Q0.0', address: 'Q0.0', datatype: 'Bool' }
  ]);
  scan(plc, nets, 1);
  ck('初始 M0.7 = 0', plc.readBool('M0.7') === false);

  plc.write('I0.0', true); scan(plc, nets, 1);
  ck('S 通一下电 → M0.7 = 1', plc.readBool('M0.7') === true);

  plc.write('I0.0', false); scan(plc, nets, 5);
  ck('S 松开后自锁保持 → M0.7 仍 = 1', plc.readBool('M0.7') === true);
  ck('自锁期间 Q0.0 = 1（触点在用 M0.7）', plc.readBool('Q0.0') === true);

  plc.write('I0.1', true); scan(plc, nets, 1);
  ck('R 通一下电 → M0.7 = 0', plc.readBool('M0.7') === false);

  plc.write('I0.1', false); scan(plc, nets, 5);
  ck('R 松开后保持断开 → M0.7 仍 = 0', plc.readBool('M0.7') === false);
  ck('复位后 Q0.0 = 0', plc.readBool('Q0.0') === false);
}

/* ---------------- 2. 带引号的符号名（TIA 写法） ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's1', type: 'SET', operand: '"Tag_6"', addr: 'M0.7' }])
  ];
  const plc = makePlc([
    { name: 'I0.0', address: 'I0.0', datatype: 'Bool' },
    { name: 'Tag_6', address: 'M0.7', datatype: 'Bool' }
  ]);
  ck('带引号符号可解析："Tag_6" → M0.7',
    !!plc.resolve('"Tag_6"') && plc.resolve('"Tag_6"').area === 'M');

  plc.write('I0.0', true);
  scan(plc, nets, 1);
  plc.write('I0.0', false);
  scan(plc, nets, 3);
  ck('带引号的 SET 也能自锁（以前静默失败）', plc.readBool('M0.7') === true);
}

/* ---------------- 3. 只有 addr、没有 operand ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's1', type: 'SET', operand: '', addr: 'M1.3' }])
  ];
  const plc = makePlc([{ name: 'I0.0', address: 'I0.0', datatype: 'Bool' }]);
  plc.write('I0.0', true);
  scan(plc, nets, 1);
  plc.write('I0.0', false);
  scan(plc, nets, 2);
  ck('只有 addr 的 SET 也生效（M1.3 保持 1）', plc.readBool('M1.3') === true);
}

/* ---------------- 4. 普通线圈必须每周期跟随 ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 'o1', type: 'COIL', operand: 'Q0.1', addr: 'Q0.1' }])
  ];
  const plc = makePlc([
    { name: 'I0.0', address: 'I0.0', datatype: 'Bool' },
    { name: 'Q0.1', address: 'Q0.1', datatype: 'Bool' }
  ]);
  plc.write('I0.0', true); scan(plc, nets, 1);
  const on = plc.readBool('Q0.1');
  plc.write('I0.0', false); scan(plc, nets, 1);
  const off = plc.readBool('Q0.1');
  ck('普通线圈跟随输入（通→1，断→0），不会被当成自锁', on === true && off === false, on + ' / ' + off);
}

/* ---------------- 5. M 区与 Q 区都能自锁 ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's1', type: 'SET', operand: 'M10.0', addr: 'M10.0' }]),
    net([{ id: 'c2', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's2', type: 'SET', operand: 'Q0.2', addr: 'Q0.2' }])
  ];
  const plc = makePlc([
    { name: 'I0.0', address: 'I0.0', datatype: 'Bool' },
    { name: 'M10.0', address: 'M10.0', datatype: 'Bool' },
    { name: 'Q0.2', address: 'Q0.2', datatype: 'Bool' }
  ]);
  plc.write('I0.0', true); scan(plc, nets, 1);
  plc.write('I0.0', false); scan(plc, nets, 4);
  ck('M 区置位后保持（M10.0 = 1）', plc.readBool('M10.0') === true);
  ck('Q 区置位后也保持（Q0.2 = 1）', plc.readBool('Q0.2') === true);
}

/* ---------------- 6. S 后 R 同名：复位优先（同周期） ---------------- */
{
  const nets = [
    net([{ id: 'c1', type: 'NO', operand: 'I0.0', addr: 'I0.0' },
    { id: 's1', type: 'SET', operand: 'M2.0', addr: 'M2.0' }]),
    net([{ id: 'c2', type: 'NO', operand: 'I0.1', addr: 'I0.1' },
    { id: 'r1', type: 'RESET', operand: 'M2.0', addr: 'M2.0' }])
  ];
  const plc = makePlc([
    { name: 'I0.0', address: 'I0.0', datatype: 'Bool' },
    { name: 'I0.1', address: 'I0.1', datatype: 'Bool' },
    { name: 'M2.0', address: 'M2.0', datatype: 'Bool' }
  ]);
  plc.write('I0.0', true); plc.write('I0.1', true);
  scan(plc, nets, 1);
  ck('S、R 同一周期都为 1 时，后面的 R 生效（扫描顺序）', plc.readBool('M2.0') === false);
}

const bad = R.filter(x => !x).length;
console.log('\n通过 ' + (R.length - bad) + '/' + R.length);
process.exit(bad ? 1 : 0);
