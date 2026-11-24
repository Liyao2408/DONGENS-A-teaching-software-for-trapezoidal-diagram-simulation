/* 回归测试：开口分支（OPEN_END 收尾）不参与列输出的功率流汇合
 *
 * 背景：并联分支里如果一条支路以"开口箭头"收尾（没汇合回主线），它的功率流
 * 不能并进下一列。旧实现把所有分支的输出做 OR，于是开口支路（例如一个还在
 * 断开延时里的 TOF）会把电"漏"给后面的指令 —— 现象就是松开按钮后下一级
 * 定时器仍在计数、看起来像自锁。
 */
const PLC = require('./js/plc.js');

global.window = global;
require('./js/instructions.js');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('ok   : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL : ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

function mk(columns) {
  return {
    blocks: [{
      name: 'OB1', obNumber: 1, lang: 'LAD',
      networks: [{ title: '', columns: columns }]
    }]
  };
}

/* ---------- 1. 开口分支不把功率流带到下一列 ---------- */
const projOpen = mk([
  { branches: [[{ id: 'c0', type: 'NO', operand: 'M0.0', addr: 'M0.0' }]] },
  {
    branches: [
      [{ id: 'q1', type: 'NO', operand: 'M9.1', addr: 'M9.1' }],                  // 主线：不通
      [{ id: 'tf', type: 'TOF', instance: 'TOF_DB', db: 2, params: { PT: 'T#2s' } },
      { id: 'oe', type: 'OPEN_END' }]                                              // 开口支路：TOF.Q 通
    ]
  },
  { branches: [[{ id: 'tn', type: 'TON', instance: 'TON_DB', db: 1, params: { PT: 'T#1s' } }]] },
  { branches: [[{ id: 'co', type: 'COIL', operand: 'Q0.1', addr: 'Q0.1' }]] }
]);

const plc1 = new PLC.SoftPLC();
plc1.cycleTime = 100;
plc1.setTags([{ name: 'M0.0', address: 'M0.0', datatype: 'Bool' },
{ name: 'M9.1', address: 'M9.1', datatype: 'Bool' }]);
plc1.write('M0.0', true);
plc1.write('M9.1', false);

for (let i = 0; i < 5; i++) plc1.step(projOpen);

ck('开口支路里的 TOF.Q 确实为 1（作为对照）', plc1.read('"TOF_DB".Q') === true,
  String(plc1.read('"TOF_DB".Q')));
ck('多分支列：只有开口支路导通时，列输出应为 0',
  plc1.trace.net[0].cols[1].out === false, String(plc1.trace.net[0].cols[1].out));
ck('开口支路不漏电给下一级 TON（ET 不涨）',
  (plc1.read('"TON_DB".ET') || 0) === 0, String(plc1.read('"TON_DB".ET')));
ck('后续线圈保持断电', plc1.read('Q0.1') !== true, String(plc1.read('Q0.1')));

/* 主线导通时列输出必须为 1（别把正常并联合并也一起干掉） */
plc1.write('M9.1', true);
for (let i = 0; i < 3; i++) plc1.step(projOpen);
ck('主线导通后列输出为 1', plc1.trace.net[0].cols[1].out === true,
  String(plc1.trace.net[0].cols[1].out));
for (let i = 0; i < 12; i++) plc1.step(projOpen);   // 累计 1.2s > PT 1s
ck('主线导通后 TON 正常计时导通', plc1.read('Q0.1') === true, String(plc1.read('Q0.1')));

/* ---------- 2. 单分支列：末端是开口箭头也照样直通（不改既有行为） ---------- */
const projSingle = mk([
  { branches: [[{ id: 'c0', type: 'NO', operand: 'M0.0', addr: 'M0.0' }]] },
  { branches: [[{ id: 'oe', type: 'OPEN_END' }]] },
  { branches: [[{ id: 'co', type: 'COIL', operand: 'Q0.2', addr: 'Q0.2' }]] }
]);
const plc2 = new PLC.SoftPLC();
plc2.cycleTime = 100;
plc2.setTags([{ name: 'M0.0', address: 'M0.0', datatype: 'Bool' }]);
plc2.write('M0.0', true);
plc2.step(projSingle);
ck('单分支列末端的开口箭头仍直通', plc2.trace.net[0].cols[1].out === true,
  String(plc2.trace.net[0].cols[1].out));
ck('单分支列末端开口箭头后面还能带线圈', plc2.read('Q0.2') === true, String(plc2.read('Q0.2')));

/* ---------- 3. 并联两条闭合分支：仍然是 OR ---------- */
const projOr = mk([
  {
    branches: [
      [{ id: 'a1', type: 'NO', operand: 'M1.1', addr: 'M1.1' }],
      [{ id: 'a2', type: 'NO', operand: 'M1.2', addr: 'M1.2' }]
    ]
  },
  { branches: [[{ id: 'co', type: 'COIL', operand: 'Q0.3', addr: 'Q0.3' }]] }
]);
const plc3 = new PLC.SoftPLC();
plc3.cycleTime = 100;
plc3.setTags([{ name: 'M1.1', address: 'M1.1', datatype: 'Bool' },
{ name: 'M1.2', address: 'M1.2', datatype: 'Bool' }]);
plc3.write('M1.1', false); plc3.write('M1.2', true);
plc3.step(projOr);
ck('两条闭合分支仍是 OR（第二条通即可）', plc3.read('Q0.3') === true, String(plc3.read('Q0.3')));
plc3.write('M1.2', false);
plc3.step(projOr);
ck('两条都断则输出断', plc3.read('Q0.3') !== true, String(plc3.read('Q0.3')));

/* ---------- 4. 多分支列里线圈收尾的分支也不参与汇合 ---------- */
const projCoilBr = mk([
  {
    branches: [
      [{ id: 'b1', type: 'NO', operand: 'M2.1', addr: 'M2.1' }, { id: 'k1', type: 'COIL', operand: 'Q0.4', addr: 'Q0.4' }],
      [{ id: 'b2', type: 'NO', operand: 'M2.2', addr: 'M2.2' }]
    ]
  },
  { branches: [[{ id: 'k2', type: 'COIL', operand: 'Q0.5', addr: 'Q0.5' }]] }
]);
const plc4 = new PLC.SoftPLC();
plc4.cycleTime = 100;
plc4.setTags([{ name: 'M2.1', address: 'M2.1', datatype: 'Bool' },
{ name: 'M2.2', address: 'M2.2', datatype: 'Bool' }]);
plc4.write('M2.1', true); plc4.write('M2.2', false);
plc4.step(projCoilBr);
ck('线圈收尾的分支不把功率流带给下一列', plc4.trace.net[0].cols[0].out === false,
  String(plc4.trace.net[0].cols[0].out));
ck('但它自己的线圈照常得电', plc4.read('Q0.4') === true, String(plc4.read('Q0.4')));
ck('下一列的线圈不得电', plc4.read('Q0.5') !== true, String(plc4.read('Q0.5')));

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
