globalThis.window = globalThis;
require('./js/instructions.js');
const PLC = require('./js/plc.js');
PLC._setInstr(globalThis.INSTR);

function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('ok  : ' + msg);
}

/* ---------- 1. 地址解析 ---------- */
let a = PLC.parseAddr('I0.0');
assert(a && a.area === 'I' && a.size === 'X' && a.off === 0, '解析 I0.0');
a = PLC.parseAddr('MW10');
assert(a && a.size === 'W' && a.off === 10, '解析 MW10');
a = PLC.parseAddr('DB1.DBX0.3');
assert(a && a.kind === 'db' && a.db === 1 && a.bit === 3, '解析 DB1.DBX0.3');
a = PLC.parseAddr('DB2.DBD4');
assert(a && a.size === 'D' && a.off === 4, '解析 DB2.DBD4');
assert(PLC.parseAddr('foo bar') === null, '非法地址返回 null');

/* ---------- 2. 时间字面量 ---------- */
assert(PLC.toMs('T#5s') === 5000, 'T#5s = 5000ms');
assert(PLC.toMs('T#1s500ms') === 1500, 'T#1s500ms = 1500ms');
assert(PLC.toMs('T#2m') === 120000, 'T#2m');

/* ---------- 3. 内存读写 ---------- */
let plc = new PLC.SoftPLC();
plc.write('Q0.0', true);
assert(plc.read('Q0.0') === true, 'Q0.0 写 true 后读 true');
plc.write('MW10', -1234);
assert(plc.read('MW10') === -1234, 'MW10 负数读写');
plc.write('MD20', 123456);
assert(plc.read('MD20') === 123456, 'MD20 双字读写');
plc.write('M5.7', true);
assert(plc.read('M5.7') === true && plc.read('M5.0') === false, 'M5.7/M5.0 位独立');

/* ---------- 4. 符号表解析 ---------- */
plc.setTags([
  { name: 'StartBtn', address: 'I0.0', datatype: 'Bool' },
  { name: 'Motor', address: 'Q0.0', datatype: 'Bool' }
]);
plc.write('StartBtn', true);
assert(plc.read('I0.0') === true, '按符号名写入落到 I0.0');
plc.write('Q0.0', true);
assert(plc.read('Motor') === true, '按符号名 Motor 读到 Q0.0');
assert(plc.resolve('StartBtn').area === 'I', 'resolve 走符号表');

/* ---------- 5. 自锁电路 LAD ---------- */
// 网络: ( StartBtn ─┐ )──[ 停止常闭 ]──( Motor )
//       ( Motor常开 ─┘ )        ← 并联自锁
const latchProject = {
  name: 'P1',
  tags: [],
  blocks: [{
    name: 'OB1', lang: 'LAD', obNumber: 1,
    networks: [{
      columns: [
        { branches: [
          [{ id: 'a', type: 'NO', operand: 'I0.0' }],
          [{ id: 'b', type: 'NO', operand: 'Q0.0' }]
        ] },
        { branches: [[{ id: 'd', type: 'NC', operand: 'I0.2' }]] },
        { branches: [[{ id: 'e', type: 'COIL', operand: 'Q0.0' }]] }
      ]
    }]
  }]
};
plc = new PLC.SoftPLC();
for (let i = 0; i < 3; i++) plc.step(latchProject);
assert(plc.read('Q0.0') === false, '自锁：初始电机停止');
plc.write('I0.0', true);
for (let i = 0; i < 3; i++) plc.step(latchProject);
assert(plc.read('Q0.0') === true, '自锁：按下启动后电机运行');
plc.write('I0.0', false);
for (let i = 0; i < 3; i++) plc.step(latchProject);
assert(plc.read('Q0.0') === true, '自锁：松开启动仍保持');
plc.write('I0.2', true);
for (let i = 0; i < 3; i++) plc.step(latchProject);
assert(plc.read('Q0.0') === false, '自锁：停止按钮断开');

/* ---------- 6. 并联或逻辑 ---------- */
const orProject = {
  name: 'P2', tags: [],
  blocks: [{
    name: 'OB1', lang: 'LAD', obNumber: 1,
    networks: [{
      columns: [
        { branches: [
          [{ id: 'x1', type: 'NO', operand: 'I0.0' }],
          [{ id: 'x2', type: 'NO', operand: 'I0.1' }]
        ] },
        { branches: [[{ id: 'x3', type: 'COIL', operand: 'Q0.1' }]] }
      ]
    }]
  }]
};
plc = new PLC.SoftPLC();
plc.write('I0.1', true);
plc.step(orProject);
assert(plc.read('Q0.1') === true, '并联：任一分支导通即输出');

/* ---------- 7. TON 定时器 ---------- */
plc = new PLC.SoftPLC();
plc.cycleTime = 100;
// 真实 TIA 写法：IN 由左侧功率流给出，Q 参数直接接到输出地址
const tonProject = {
  name: 'P3', tags: [],
  blocks: [{
    name: 'OB1', lang: 'LAD', obNumber: 1,
    networks: [{
      columns: [
        { branches: [[{ id: 't0', type: 'NO', operand: 'I0.0' }]] },
        { branches: [[{ id: 't1', type: 'TON', params: { PT: 'T#500ms', Q: 'Q0.2', ET: 'MW30' } }]] }
      ]
    }]
  }]
};
plc.write('I0.0', true);
// 第 1 个扫描周期：IN 刚接通，ET 从 0 起算，Q 不应动作
plc.step(tonProject);
assert(plc.read('Q0.2') === false, 'TON 第 1 周期 Q 不动作');
assert(plc.read('MW30') === 0, 'TON 第 1 周期 ET=0');
// 第 2、3 周期：ET 累加到 200ms，仍未到 500ms
plc.step(tonProject);
plc.step(tonProject);
assert(plc.read('Q0.2') === false, 'TON 200ms 时 Q 仍不动作 (ET=' + plc.read('MW30') + ')');
assert(plc.read('MW30') === 200, 'TON ET 累加到 200ms (实际 ' + plc.read('MW30') + ')');
// 继续推进到 500ms 以上
for (let i = 0; i < 3; i++) plc.step(tonProject);
assert(plc.read('Q0.2') === true, 'TON 到达 500ms 后 Q 置位 (ET=' + plc.read('MW30') + ')');
plc.write('I0.0', false);
plc.step(tonProject);
assert(plc.read('Q0.2') === false, 'TON 输入断开后 Q 复位');
assert(plc.read('MW30') === 0, 'TON 输入断开后 ET 清零');

/* ---------- 8. SCL 编译 + 执行 ---------- */
const sclSrc = `
FUNCTION_BLOCK "FB_Motor"
VAR_INPUT
  Start : Bool;
  Stop : Bool;
END_VAR
VAR_OUTPUT
  Motor : Bool;
END_VAR
VAR
  Count : Int;
END_VAR
BEGIN
  IF Start AND NOT Stop THEN
    "Motor" := TRUE;
    Count := Count + 1;
  END_IF;
  IF Stop THEN
    "Motor" := FALSE;
    Count := 0;
  END_IF;
END_FUNCTION_BLOCK
`;
const comp = PLC.compileScl(sclSrc);
assert(comp.compiled === true, 'SCL FB 编译成功');
assert(comp.interface.inputs.length === 2, 'SCL 解析出 2 个输入');
assert(comp.interface.outputs.length === 1, 'SCL 解析出 1 个输出');

const sclProject = {
  name: 'P4', tags: [],
  blocks: [
    {
      name: 'OB1', lang: 'SCL', obNumber: 1,
      source: `VAR
  fb : Int;
END_VAR
BEGIN
  "Q0.0" := "I0.0";
  IF "I0.0" THEN
    "MW10" := "MW10" + 1;
  END_IF;
END`
    }
  ]
};
plc = new PLC.SoftPLC();
plc.write('I0.0', true);
plc.step(sclProject);
assert(plc.read('MW10') === 1, 'SCL 算术 MW10 累加（第 1 次扫描）');
plc.step(sclProject);
plc.step(sclProject);
assert(plc.read('MW10') === 3, 'SCL 算术 MW10 累加（第 3 次扫描）');
assert(plc.read('Q0.0') === true, 'SCL 位赋值 Q0.0 := I0.0');

/* ---------- 9. SCL 循环与比较 ---------- */
const loopSrc = `VAR
  i : Int;
  sum : Int;
END_VAR
BEGIN
  sum := 0;
  FOR i := 1 TO 10 DO
    sum := sum + i;
  END_FOR;
  "MW20" := sum;
END`;
const loopProj = { name: 'P5', tags: [], blocks: [{ name: 'OB1', lang: 'SCL', obNumber: 1, source: loopSrc }] };
plc = new PLC.SoftPLC();
plc.step(loopProj);
assert(plc.read('MW20') === 55, 'SCL FOR 循环求和 1..10 = 55');

/* ---------- 10. 编译诊断 ---------- */
const badProj = {
  name: 'Bad', tags: [],
  blocks: [{ name: 'OB1', lang: 'SCL', obNumber: 1, source: 'BEGIN\n IF TRUE THEN\n "x" := 1;\n' }]
};
let diags = PLC.compileProject(badProj);
assert(diags.some(d => d.level === 'error'), '缺少 END_IF 报编译错误');

const noOb1 = { name: 'NoOb', tags: [], blocks: [{ name: 'FB1', lang: 'SCL', obNumber: 0, source: 'BEGIN\n "x" := 1;\nEND' }] };
diags = PLC.compileProject(noOb1);
assert(diags.some(d => d.text.indexOf('OB1') >= 0), '缺少 OB1 报错');

const undefProj = {
  name: 'U', tags: [],
  blocks: [{ name: 'OB1', lang: 'LAD', obNumber: 1, networks: [{ columns: [{ branches: [[{ id: 'q', type: 'NO', operand: 'NotExist' }]] }] }] }]
};
diags = PLC.compileProject(undefProj);
assert(diags.some(d => d.text.indexOf('未定义的符号') >= 0), '未定义符号报错');

console.log('\n--- 测试结束 ---');
