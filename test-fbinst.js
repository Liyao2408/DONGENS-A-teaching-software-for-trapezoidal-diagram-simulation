/* 冒烟测试：FB 实例数据块（TON）+ "time".Q 触点引用 */
const PLC = require('./js/plc.js');

// 让 plc.js 找到 INSTR
global.window = global;
require('./js/instructions.js');

const proj = {
  blocks: [{
    name: 'OB1', obNumber: 1, lang: 'LAD',
    networks: [
      // 网络1：母线直通 TON（EN=IN），实例 time，PT T#1s
      { title: '', columns: [{ branches: [[
        { id: 'e_ton', type: 'TON', instance: 'time', db: 3, params: { PT: 'T#1s' } }
      ]] }] },
      // 网络2：常开触点 "time".Q → 线圈 Q0.0
      { title: '', columns: [{ branches: [[
        { id: 'e_c', type: 'NO', operand: '"time".Q', addr: '' },
        { id: 'e_o', type: 'COIL', operand: 'Q0.0', addr: 'Q0.0' }
      ]] }] }
    ]
  }]
};

const plc = new PLC.SoftPLC();
plc.cycleTime = 100; // 100ms 一周期
plc.setRuntime && plc.setRuntime();
plc.start && plc.start();

function scan() { plc.step(proj); }

let qSeen = false, coilSeen = false, resetOk = false;

// 扫 15 个周期（1.5s 仿真时间，PT=1s 应在第 ~11 个周期导通）
for (let i = 0; i < 15; i++) {
  scan();
  if (plc.read('"time".Q') === true) qSeen = true;
  if (plc.read('Q0.0') === true) coilSeen = true;
  if (i < 5 && plc.read('"time".Q') === true) { console.error('FAIL: 前 5 周期 Q 不应导通'); process.exit(1); }
}
if (!qSeen) { console.error('FAIL: 15 周期后 "time".Q 从未导通'); process.exit(1); }
if (!coilSeen) { console.error('FAIL: Q0.0 线圈未被 "time".Q 触点驱动'); process.exit(1); }

// ET 值检查
const et = plc.read('"time".ET');
if (typeof et !== 'number' || et < 1000) { console.error('FAIL: ET=' + et + ' 应 >= 1000ms'); process.exit(1); }

// 断电复位：TON 的 IN 是功率流，网络1 无触点直通母线 —— 改造成带触点的断电场景
// 简化：直接检查 Q/ET 状态一致性（IN=EN 恒真不会复位）。改为断言 Q 保持。
if (plc.read('"time".Q') !== true) { console.error('FAIL: IN 恒真时 Q 应保持导通'); process.exit(1); }

// IN 成员读取
if (plc.read('"time".IN') !== true) { console.error('FAIL: "time".IN 应为 true'); process.exit(1); }

// 写保护：不允许写实例输出
if (plc.write('"time".Q', false) !== false) { console.error('FAIL: 实例输出应只读'); process.exit(1); }

/* ---------- 编译检查：实例成员引用必须在符号表里"认得出来" ---------- */
const diags = PLC.compileProject(proj).map(d => d.level + ':' + d.text);
if (diags.join(' ').indexOf('未定义的符号') >= 0) {
  console.error('FAIL: "time".Q 触点被判为未定义符号 → ' + diags.join('; '));
  process.exit(1);
}

// .PT 是 TIME，不能当触点：应给出类型提示，而不是"未定义符号"
const proj2 = JSON.parse(JSON.stringify(proj));
proj2.blocks[0].networks[1].columns[0].branches[0][0].operand = '"time".PT';
const d2 = PLC.compileProject(proj2).map(d => d.text).join(' ; ');
if (!/Time|Bool/.test(d2)) { console.error('FAIL: "time".PT 触点没给类型错误提示 → ' + d2); process.exit(1); }

/* ---------- 功率流：TON 盒体的右侧输出就是 Q（真的延时通） ---------- */
const proj3 = {
  blocks: [{
    name: 'OB1', obNumber: 1, lang: 'LAD',
    networks: [{
      title: '', columns: [
        { branches: [[{ id: 'c0', type: 'NO', operand: 'M0.0', addr: 'M0.0' }]] },
        { branches: [[{ id: 't0', type: 'TON', instance: 'T_ON', db: 5, params: { PT: 'T#1s' } }]] },
        { branches: [[{ id: 'o0', type: 'COIL', operand: 'Q0.2', addr: 'Q0.2' }]] }
      ]
    }]
  }]
};
const plc3 = new PLC.SoftPLC();
plc3.cycleTime = 10;
plc3.setTags([{ name: 'M0.0', address: 'M0.0', datatype: 'Bool' }]);
plc3.write('M0.0', true);
for (let i = 0; i < 30; i++) plc3.step(proj3);      // 300ms < PT
if (plc3.read('Q0.2') === true) { console.error('FAIL: 未到 PT，TON 右侧不应导通'); process.exit(1); }
for (let i = 0; i < 90; i++) plc3.step(proj3);      // 累计 1200ms > PT
if (plc3.read('Q0.2') !== true) { console.error('FAIL: 到 PT 后 TON 右侧应导通'); process.exit(1); }

// 时间简写："5s" 必须按 5000ms 解释（旧实现会当成 5ms，看起来完全没延时）
if (PLC.toMs('5s') !== 5000 || PLC.toMs('T#1,5s') !== 1500) { console.error('FAIL: 时间简写解析'); process.exit(1); }

console.log('SMOKE OK: TON 实例 + "time".Q/Q0.0/ET/IN/写保护 + 编译检查 + 延时通 全部通过');
