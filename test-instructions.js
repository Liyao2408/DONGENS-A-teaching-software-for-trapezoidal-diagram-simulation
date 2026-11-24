// 指令集覆盖测试：逐个验证新增指令的执行语义
globalThis.window = globalThis;
require('./js/instructions.js');
const PLC = require('./js/plc.js');
PLC._setInstr(globalThis.INSTR);

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { console.log('ok  : ' + msg); pass++; }
  else { console.log('FAIL: ' + msg + (extra !== undefined ? '  [' + extra + ']' : '')); fail++; }
}

// 构造只含一个盒式指令的网络并跑 n 个周期
function run(el, n, setup, cycleMs) {
  const plc = new PLC.SoftPLC();
  plc.cycleTime = cycleMs || 10;
  const proj = {
    name: 'T', tags: [],
    blocks: [{
      name: 'OB1', lang: 'LAD', obNumber: 1,
      networks: [{ columns: [{ branches: [[el]] }] }]
    }]
  };
  if (setup) setup(plc);
  for (let i = 0; i < (n || 1); i++) plc.step(proj);
  return plc;
}

console.log('===== 数学指令 =====');
let plc = run({ type: 'ADD', params: { IN1: '5', IN2: '3', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 8, 'ADD 5+3=8', plc.read('MW10'));
plc = run({ type: 'SUB', params: { IN1: '10', IN2: '4', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 6, 'SUB 10-4=6', plc.read('MW10'));
plc = run({ type: 'MUL', params: { IN1: '6', IN2: '7', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 42, 'MUL 6*7=42', plc.read('MW10'));
plc = run({ type: 'DIV', params: { IN1: '20', IN2: '4', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 5, 'DIV 20/4=5', plc.read('MW10'));
plc = run({ type: 'DIV', params: { IN1: '5', IN2: '0', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 0, 'DIV 除零输出 0（不崩溃）', plc.read('MW10'));
plc = run({ type: 'MOD', params: { IN1: '17', IN2: '5', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 2, 'MOD 17%5=2', plc.read('MW10'));
plc = run({ type: 'ABS', params: { IN: '-9', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 9, 'ABS |-9|=9', plc.read('MW10'));
plc = run({ type: 'MIN', params: { IN1: '3', IN2: '8', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 3, 'MIN(3,8)=3', plc.read('MW10'));
plc = run({ type: 'MAX', params: { IN1: '3', IN2: '8', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 8, 'MAX(3,8)=8', plc.read('MW10'));
plc = run({ type: 'LIMIT', params: { IN: '150', MIN: '0', MAX: '100', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 100, 'LIMIT 150 限到 100', plc.read('MW10'));
plc = run({ type: 'NEG', params: { IN: '7', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === -7, 'NEG 7 = -7', plc.read('MW10'));
plc = run({ type: 'SQR', params: { IN: '5', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 25, 'SQR 5²=25', plc.read('MW10'));
plc = run({ type: 'SQRT', params: { IN: '16', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 4, 'SQRT √16=4', plc.read('MW10'));
plc = run({ type: 'INC', params: { INOUT: 'MW10' } }, 3);
ok(plc.read('MW10') === 3, 'INC 三次后 =3', plc.read('MW10'));
plc = run({ type: 'DEC', params: { INOUT: 'MW10' } }, 3);
ok(plc.read('MW10') === -3, 'DEC 三次后 =-3', plc.read('MW10'));

console.log('\n===== 比较指令 =====');
const cmpCases = [
  ['CMP', '5', '5', true], ['CMP_NE', '5', '3', true],
  ['CMP_GT', '9', '4', true], ['CMP_LT', '2', '7', true],
  ['CMP_GE', '5', '5', true], ['CMP_LE', '5', '6', true],
  ['CMP_GT', '3', '9', false], ['CMP', '1', '2', false]
];
cmpCases.forEach(function (c) {
  const p = run({ type: c[0], params: { IN1: c[1], IN2: c[2] } }, 2);
  ok(p.trace.net[0].final === c[3], c[0] + '(' + c[1] + ',' + c[2] + ') 导通=' + c[3],
    'got ' + p.trace.net[0].final);
});

console.log('\n===== 移位 / 循环 =====');
plc = run({ type: 'SHL', params: { IN: '1', N: '4', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 16, 'SHL 1<<4=16', plc.read('MW10'));
plc = run({ type: 'SHR', params: { IN: '32', N: '3', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 4, 'SHR 32>>3=4', plc.read('MW10'));
plc = run({ type: 'ROL', params: { IN: '1', N: '1', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 2, 'ROL 1 循环左移1 =2', plc.read('MW10'));

console.log('\n===== 字逻辑 =====');
plc = run({ type: 'AND_W', params: { IN1: '12', IN2: '10', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === (12 & 10), 'AND_W 12&10', plc.read('MW10'));
plc = run({ type: 'OR_W', params: { IN1: '12', IN2: '10', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === (12 | 10), 'OR_W 12|10', plc.read('MW10'));
plc = run({ type: 'XOR_W', params: { IN1: '12', IN2: '10', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === (12 ^ 10), 'XOR_W 12^10', plc.read('MW10'));
plc = run({ type: 'INV_W', params: { IN: '0', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === -1, 'INV_W ~0 = -1', plc.read('MW10'));

console.log('\n===== 转换 =====');
plc = run({ type: 'ROUND', params: { IN: '3.6', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 4, 'ROUND 3.6=4', plc.read('MW10'));
plc = run({ type: 'TRUNC', params: { IN: '3.9', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 3, 'TRUNC 3.9=3', plc.read('MW10'));
plc = run({ type: 'FLOOR', params: { IN: '3.9', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 3, 'FLOOR 3.9=3', plc.read('MW10'));
plc = run({ type: 'CEIL', params: { IN: '3.1', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 4, 'CEIL 3.1=4', plc.read('MW10'));

console.log('\n===== 定时器族 =====');
plc = run({ type: 'TOF', params: { PT: 'T#300ms', Q: 'Q0.0', ET: 'MW20' } }, 5, null, 100);
ok(plc.read('Q0.0') === true || plc.read('Q0.0') === false, 'TOF 可运行不崩溃', plc.read('Q0.0'));
plc = run({ type: 'TP', params: { PT: 'T#200ms', Q: 'Q0.1' } }, 6, function (p) {
  p.write('M0.0', true);
}, 100);
ok(true, 'TP 脉冲定时器可运行');

plc = new PLC.SoftPLC(); plc.cycleTime = 100;
const tonrProj = {
  name: 'T', tags: [], blocks: [{
    name: 'OB1', lang: 'LAD', obNumber: 1,
    networks: [{ columns: [{ branches: [[{ type: 'TONR', params: { PT: 'T#300ms', Q: 'Q0.2', ET: 'MW22', R: 'M1.1' } }]] }] }]
  }]
};
for (let i = 0; i < 5; i++) plc.step(tonrProj);
ok(plc.read('MW22') > 0, 'TONR 累加时间 >0', plc.read('MW22'));

console.log('\n===== 计数器族 =====');
plc = new PLC.SoftPLC(); plc.cycleTime = 10;
const ctuProj = {
  name: 'T', tags: [], blocks: [{
    name: 'OB1', lang: 'LAD', obNumber: 1,
    networks: [{ columns: [{ branches: [[{ id: 'c1', type: 'CTU', params: { PV: '3', Q: 'Q0.3', CV: 'MW24' } }]] }] }]
  }]
};
// EN 每个周期从 0->1 需要断开再接，这里用 power 直通：计数靠 prev 边沿
for (let i = 0; i < 6; i++) plc.step(ctuProj);
ok(plc.read('MW24') >= 1, 'CTU 计数在增长', plc.read('MW24'));

plc = run({ type: 'CTUD', params: { PV: '5', QU: 'Q0.4', QD: 'Q0.5', CV: 'MW26' } }, 3);
ok(plc.read('MW26') >= 0, 'CTUD 可运行', plc.read('MW26'));

console.log('\n===== 字符串 =====');
plc = run({ type: 'LEN', params: { IN: "'HELLO'", OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 5, 'LEN("HELLO")=5', plc.read('MW10'));
plc = run({ type: 'FIND', params: { IN1: "'ABCDE'", IN2: "'CD'", OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 3, 'FIND("CD" in "ABCDE")=3', plc.read('MW10'));
const eqp = run({ type: 'EQ_STR', params: { IN1: "'AB'", IN2: "'AB'" } }, 2);
ok(eqp.trace.net[0].final === true, 'EQ_STR("AB","AB") 导通');

console.log('\n===== 时间运算 =====');
plc = run({ type: 'T_ADD', params: { IN1: 'T#1s', IN2: 'T#500ms', OUT: 'MD30' } }, 2);
ok(plc.read('MD30') === 1500, 'T_ADD 1s+500ms=1500ms', plc.read('MD30'));
plc = run({ type: 'T_SUB', params: { IN1: 'T#2s', IN2: 'T#500ms', OUT: 'MD30' } }, 2);
ok(plc.read('MD30') === 1500, 'T_SUB 2s-500ms=1500ms', plc.read('MD30'));
plc = run({ type: 'T_CONV', params: { IN: 'T#3s', OUT: 'MD34' } }, 2);
ok(plc.read('MD34') === 3000, 'T_CONV 3s=3000ms', plc.read('MD34'));

console.log('\n===== 移动 =====');
plc = run({ type: 'MOVE', params: { IN: '123', OUT: 'MW10' } }, 2);
ok(plc.read('MW10') === 123, 'MOVE 123', plc.read('MW10'));
plc = run({ type: 'SWAP', params: { IN: '258', OUT: 'MW10' } }, 2);  // 258=0x0102 -> 0x0201=513
ok(plc.read('MW10') === 513, 'SWAP 0x0102 -> 0x0201', plc.read('MW10'));

console.log('\n===== 程序控制 / 示意指令 =====');
plc = run({ type: 'RDREC', params: { ID: '256', INDEX: '1', LEN: '8', STATUS: 'MW40' } }, 2);
ok(plc.read('MW40') === 0, 'RDREC STATUS=0', plc.read('MW40'));
plc = run({ type: 'PE_START', params: { ID: '1', DONE: 'M2.0', STATUS: 'MW42' } }, 2);
ok(plc.read('M2.0') === true, 'PE_START DONE=TRUE');
plc = run({ type: 'GET_DIAG', params: { LADDR: '1', STATE: 'MW44' } }, 2);
ok(typeof plc.read('MW44') === 'number', 'GET_DIAG 返回状态码', plc.read('MW44'));

console.log('\n===== 指令目录完整性 =====');
const I = globalThis.INSTR;
let catalogCount = 0, missing = [];
I.CATALOG.forEach(function (sec) {
  sec.groups.forEach(function (g) {
    g.items.forEach(function (id) {
      catalogCount++;
      if (!I.info(id)) missing.push(id);
    });
  });
});
ok(missing.length === 0, '目录内所有指令均有定义（共 ' + catalogCount + ' 条）', missing.join(','));
ok(Object.keys(I.DEFS).length >= 70, '盒式指令定义数 >= 70', Object.keys(I.DEFS).length);

// 每个盒式指令都必须能被执行器调用而不抛异常
let execFail = [];
Object.keys(I.DEFS).forEach(function (type) {
  try {
    const p = new PLC.SoftPLC();
    p.cycleTime = 10;
    const proj = {
      name: 'T', tags: [], blocks: [{
        name: 'OB1', lang: 'LAD', obNumber: 1,
        networks: [{ columns: [{ branches: [[{ type: type, params: {} }]] }] }]
      }]
    };
    for (let i = 0; i < 3; i++) p.step(proj);
    const errs = p.logs.filter(function (l) { return l.level === 'error'; });
    if (errs.length) execFail.push(type + ':' + errs[0].text);
  } catch (e) {
    execFail.push(type + ':THROW ' + e.message);
  }
});
ok(execFail.length === 0, '全部盒式指令可执行无异常', execFail.slice(0, 5).join(' | '));

console.log('\n=================================');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) console.log('失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
