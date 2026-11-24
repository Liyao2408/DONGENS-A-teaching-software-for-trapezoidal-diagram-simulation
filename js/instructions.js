/* ============================================================
 * instructions.js — LAD 指令目录与执行器
 * 分组对齐 DSI Platform V17 指令窗格：
 *   收藏夹 / 基本指令（常规·位逻辑·定时器·计数器·比较·数学）
 *   扩展指令（日期时间·字符串·分布式IO·PROFIenergy·中断·报警·诊断·脉冲·移位·转换·程序控制）
 * 每个指令声明 params（决定渲染布局）与 run（决定执行语义）
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 取值助手 ---------------- */
  function num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function bool(v) { return typeof v === 'number' ? v !== 0 : !!v; }

  // 从元素取参数：新格式 params{}，旧格式回落到 operand/operand2/src1/src2/dest/pt/pv
  // 这样旧工程 JSON 与新插入的指令都能被同一套执行器处理
  function P(el, name) {
    if (el.params && el.params[name] !== undefined && el.params[name] !== '') return el.params[name];
    switch (name) {
      case 'IN': case 'IN1':
        if (el.src1 !== undefined && el.src1 !== '') return el.src1;
        if (el.operand !== undefined && el.operand !== '') return el.operand;
        break;
      case 'IN2':
        if (el.src2 !== undefined && el.src2 !== '') return el.src2;
        if (el.operand2 !== undefined && el.operand2 !== '') return el.operand2;
        break;
      case 'OUT':
        if (el.dest !== undefined && el.dest !== '') return el.dest;
        break;
      case 'PT':
        if (el.pt !== undefined && el.pt !== '') return el.pt;
        break;
      case 'PV':
        if (el.pv !== undefined && el.pv !== '') return el.pv;
        break;
      case 'OPERAND':
      case 'INOUT':
        if (el.operand !== undefined && el.operand !== '') return el.operand;
        break;
      case 'CU':
        if (el.operand !== undefined && el.operand !== '') return el.operand;
        break;
      case 'IN' + 'PUT':
        return el.operand;
    }
    if (el.params && el.params[name] !== undefined) return el.params[name];
    return el[name];
  }

  // 定时器/计数器的输入信号判定：
  // 只有显式写了 params.IN（或对应输入参数）才算"外部接线"，
  // 旧格式里 operand 存的是实例名（如 T1），绝不能当作输入信号。
  function hasWired(el, name) {
    if (!el.params) return false;
    var v = el.params[name];
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  // 读参数值：地址/符号优先，否则当字面量
  function readP(plc, el, name, dflt) {
    var ref = P(el, name);
    if (ref === undefined || ref === null || String(ref).trim() === '') {
      return dflt === undefined ? 0 : dflt;
    }
    var s = String(ref).trim();
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^'/.test(s)) return s.replace(/^'|'$/g, '');
    // 时间字面量（T#xx）直接走 toMs，不能当作地址或普通数字
    if (/^(T|TIME|S5T|LT|LTIME)#/i.test(s)) return toMs(s);
    var v = plc.read(s);
    if (v !== undefined) return v;
    var n = parseFloat(s);
    if (!isNaN(n)) return n;
    return dflt === undefined ? 0 : dflt;
  }

  // 读时间参数：地址/符号取数值，字面量按 T# 解析
  function readTime(plc, el, name, dflt) {
    var ref = P(el, name);
    if (ref === undefined || ref === null || String(ref).trim() === '') return dflt || 0;
    var s = String(ref).trim();
    if (/^(T|TIME|S5T|LT|LTIME)#/i.test(s)) return toMs(s);
    var v = plc.read(s);
    if (v !== undefined) return toMs(v);
    return toMs(s);
  }
  function readB(plc, el, name) { return bool(readP(plc, el, name, false)); }

  /* ---------------- 引脚支路（V50） ----------------
   * TIA 里计数器的 R / LD 这类布尔输入，除了填一个操作数，还可以**接一条触点支路**：
   * 从左侧母线拉一条线、串几个触点、直接进盒体左边的引脚。
   * 这种支路不属于任何"列/行"，所以单独挂在元件上：el.pins = { R: [触点…] }，
   * 由 plc.js 每遍扫描按"母线 → 触点链"的功率流算出来，放在 plc._pinFlow 里。
   * 没接支路时返回 null（调用方再回退到"填的操作数 / 默认值"）。
   */
  function pinFlowOf(plc, el, name) {
    if (!plc || !plc._pinFlow || !el || !el.id) return null;
    var k = el.id + ':' + name;
    return (k in plc._pinFlow) ? !!plc._pinFlow[k] : null;
  }


  // 写参数：仅当地址有效时写
  function writeP(plc, el, name, val) {
    var ref = P(el, name);
    if (ref === undefined || ref === null || String(ref).trim() === '') return false;
    return plc.write(String(ref).trim(), val);
  }

  /* ---------------- 实例状态助手（定时器/计数器/边沿） ---------------- */
  function instState(plc, key, init) {
    var s = plc.timers[key];
    if (!s) { s = plc.timers[key] = init(); }
    return s;
  }

  function toMs(pt) {
    // 统一走 plc.js 的实现（接受 T#5s / 5s / 500ms / 1,5s / 纯数字毫秒）
    if (root.PLC && root.PLC.toMs) return root.PLC.toMs(pt);
    if (pt == null) return 0;
    if (typeof pt === 'number') return pt;
    var s = String(pt).trim().replace(/\s+/g, '').replace(/,/g, '.');
    var m = /^(?:T|TIME|S5T|LT|LTIME)#(.*)$/i.exec(s);
    var body = m ? m[1] : s;
    if (/^-?\d+(?:\.\d+)?$/.test(body)) return parseFloat(body);
    var re = /(\d+(?:\.\d+)?)(MS|D|H|M|S)/gi, total = 0, hit = false, mm;
    var unit = { D: 86400000, H: 3600000, M: 60000, S: 1000, MS: 1 };
    while ((mm = re.exec(body))) { total += parseFloat(mm[1]) * unit[mm[2].toUpperCase()]; hit = true; }
    if (!hit) { var n = parseFloat(body); return isNaN(n) ? 0 : n; }
    return total;
  }

  /* ============================================================
   *  指令定义
   *  params: [{n:'名', dir:'in|out|inout', d:'默认', w:1}]  w 用于估算宽度
   *  run(ctx) -> { out: {参数名: 值}, q: 是否导通 }
   * ============================================================ */
  var DEFS = {};

  function def(id, o) {
    o.id = id;
    o.params = o.params || [];
    o.hasEN = o.hasEN !== false;
    o.hasENO = o.hasENO !== false;
    DEFS[id] = o;
    return o;
  }

  /* ---------- 常规 / 位逻辑（接触类，非盒式） ---------- */
  // 接触类与线圈类在 lad.js 中单独绘制，这里只登记元数据
  var CONTACTS = {
    NO: { name: '常开触点', sym: '─┤├─', kind: 'contact' },
    NC: { name: '常闭触点', sym: '─┤/├─', kind: 'contact' },
    P: { name: '上升沿触点', sym: '─┤P├─', kind: 'contact' },
    N: { name: '下降沿触点', sym: '─┤N├─', kind: 'contact' },
    P_TRIG: { name: '上升沿检测', sym: '─┤P├─', kind: 'contact' },
    N_TRIG: { name: '下降沿检测', sym: '─┤N├─', kind: 'contact' }
  };
  var COILS = {
    COIL: { name: '线圈', sym: '─( )─' },
    SET: { name: '置位线圈', sym: '─(S)─' },
    RESET: { name: '复位线圈', sym: '─(R)─' },
    NEG_COIL: { name: '取反线圈', sym: '─(/)─' },
    POS_COIL: { name: '正跳变线圈', sym: '─(P)─' },
    NEG_EDGE_COIL: { name: '负跳变线圈', sym: '─(N)─' }
  };

  /* ---------- 定时器 ---------- */
  // fb:true = 需要实例数据块（调用选项对话框 + <???> 实例名 + "name".Q 触点引用）
  // flow: 框体上的功率流端子（对齐 TIA）——它们靠"接线"取值，不是手填的操作数，
  //       所以画面上不出现红色 <???> 占位；右侧 Q 就是盒子的输出端：
  //       只有 Q=1 时功率流才继续往右走（这才叫真正的延时通 / 延时断）。
  def('TON', {
    // 对齐 TIA：块头只写助记符 TON + 数据类型 Time，不画 EN/ENO
    title: '接通延时', mnemonic: 'TON', typeText: 'Time',
    group: 'timer', w: 92, fb: true, flow: ['IN', 'Q'], hasEN: false, hasENO: false,
    params: [{ n: 'IN', dir: 'in' }, { n: 'PT', dir: 'in', d: 'T#1s' }, { n: 'Q', dir: 'out' }, { n: 'ET', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { start: null, q: false, et: 0 }; });
      // 显式连了 params.IN 才按参数取；否则按 LAD 惯例用左侧功率流作为 IN
      var inSig = hasWired(c.el, 'IN') ? readB(c.plc, c.el, 'IN') : c.en;
      var pt = readTime(c.plc, c.el, 'PT', 0);
      st.in = inSig; st.pt = pt;   // 记录当前输入/设定值，供 "实例".IN / "实例".PT 引用
      if (inSig) {
        if (st.start === null) st.start = c.plc.clock;
        st.et = Math.min(c.plc.clock - st.start, pt);
        st.q = st.et >= pt;
      } else {
        st.start = null; st.et = 0; st.q = false;
      }
      // 右侧功率流 = Q（EN 断电则无流）
      return { q: c.en && st.q, out: { Q: st.q, ET: st.et }, draw: st.et };
    }
  });

  def('TOF', {
    title: '断开延时', mnemonic: 'TOF', typeText: 'Time',
    group: 'timer', w: 92, fb: true, flow: ['IN', 'Q'], hasEN: false, hasENO: false,
    params: [{ n: 'IN', dir: 'in' }, { n: 'PT', dir: 'in', d: 'T#1s' }, { n: 'Q', dir: 'out' }, { n: 'ET', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { start: null, q: false, et: 0 }; });
      var inSig = hasWired(c.el, 'IN') ? readB(c.plc, c.el, 'IN') : c.en;
      var pt = readTime(c.plc, c.el, 'PT', 0);
      st.in = inSig; st.pt = pt;
      if (inSig) { st.start = null; st.et = 0; st.q = true; }
      else {
        if (st.start === null) st.start = c.plc.clock;
        st.et = Math.min(c.plc.clock - st.start, pt);
        st.q = st.et < pt;
      }
      // 右侧功率流 = Q（断电延时期间 Q 仍为 1，延时到才断开）
      return { q: st.q, out: { Q: st.q, ET: st.et }, draw: st.et };
    }
  });

  def('TP', {
    title: '脉冲定时器', mnemonic: 'TP', typeText: 'Time',
    group: 'timer', w: 92, fb: true, flow: ['IN', 'Q'], hasEN: false, hasENO: false,
    params: [{ n: 'IN', dir: 'in' }, { n: 'PT', dir: 'in', d: 'T#1s' }, { n: 'Q', dir: 'out' }, { n: 'ET', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { start: null, q: false, et: 0, prev: false }; });
      var inSig = hasWired(c.el, 'IN') ? readB(c.plc, c.el, 'IN') : c.en;
      var pt = readTime(c.plc, c.el, 'PT', 0);
      st.in = inSig; st.pt = pt;
      if (inSig && !st.prev) { st.start = c.plc.clock; st.q = true; }
      st.prev = inSig;
      if (st.start !== null) {
        st.et = c.plc.clock - st.start;
        if (st.et >= pt) { st.q = false; st.start = null; }
      }
      return { q: st.q, out: { Q: st.q, ET: st.et }, draw: st.et };
    }
  });

  def('TONR', {
    title: '时间累加器', mnemonic: 'TONR', typeText: 'Time',
    group: 'timer', w: 96, fb: true, flow: ['IN', 'Q'], hasEN: false, hasENO: false,
    // R 是 Bool 引脚：没接线时 TIA 显示灰色 false，不是红 <???>
    params: [{ n: 'IN', dir: 'in' }, { n: 'R', dir: 'in', d: 'false', soft: true },
      { n: 'PT', dir: 'in', d: 'T#1s' }, { n: 'Q', dir: 'out' }, { n: 'ET', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { acc: 0, last: null, q: false }; });
      var pt = readTime(c.plc, c.el, 'PT', 0);
      st.in = c.en; st.pt = pt;
      if (readB(c.plc, c.el, 'R')) { st.acc = 0; st.q = false; }
      else if (c.en) {
        if (st.last !== null) st.acc += c.plc.clock - st.last;
        st.q = st.acc >= pt;
      }
      st.last = c.en ? c.plc.clock : null;
      return { q: c.en && st.q, out: { Q: st.q, ET: st.acc }, draw: st.acc };
    }
  });

  /* ---------- 计数器 ---------- */
  /* ---------- 计数器（对齐 TIA / IEC 61131-3 的 CTU / CTD / CTUD） ----------
   * 引脚就是 TIA 的引脚，语义也照搬：
   *   CTU ：CU 每来一个上升沿，CV 加 1；R=1 时 CV 清 0（R 优先）；
   *         CV >= PV 时 Q=1；CV 是可以读的当前值（"CTU_DB".CV）。
   *   CTD ：CD 每来一个上升沿，CV 减 1；LD=1 时把 PV 装进 CV；CV <= 0 时 Q=1。
   *   CTUD：CU/CD 分别加减，R 清 0，LD 装载 PV；QU = CV>=PV，QD = CV<=0。
   * 和 TIA 一样不画 EN/ENO；CU/CD 是功率流端子（左侧导线），
   * R/LD 未接线时按默认值 false，PV 未赋值时显示红色 <???>（它是 Int，不是时间！）。
   */
  def('CTU', {
    title: '加计数器', mnemonic: 'CTU', typeText: 'Int',
    group: 'counter', w: 96, fb: true, flow: ['CU', 'Q'], hasEN: false, hasENO: false,
    // R 是布尔输入引脚：可以双击填操作数，也可以接一条触点支路（对齐 TIA）
    pinBranches: ['R'],
    params: [
      { n: 'CU', dir: 'in' },
      { n: 'R', dir: 'in', d: 'false', soft: true },
      { n: 'PV', dir: 'in' },
      { n: 'Q', dir: 'out' },
      { n: 'CV', dir: 'out' }
    ],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { cnt: 0, q: false, prev: false, pv: 0 }; });
      var wiredCu = hasWired(c.el, 'CU');
      var wiredR = hasWired(c.el, 'R');
      var wiredPv = hasWired(c.el, 'PV');
      var cu = wiredCu ? readB(c.plc, c.el, 'CU') : c.en;   // 未接线时：左侧功率流就是 CU
      // R：接了引脚支路就按支路的功率流，否则按填的操作数 / 默认 false
      var pinR = pinFlowOf(c.plc, c.el, 'R');
      var r = (pinR !== null) ? pinR : (wiredR ? readB(c.plc, c.el, 'R') : false);
      var pv = wiredPv ? num(readP(c.plc, c.el, 'PV', 0)) : 0;
      st.pv = pv;
      if (r) {
        st.cnt = 0;                 // 复位优先
      } else if (cu && !st.prev) {
        st.cnt = Math.min(st.cnt + 1, 32767);
      }
      st.prev = cu;                 // 只认上升沿：按住不放不会一直加
      st.q = wiredPv ? (st.cnt >= pv) : false;
      return { q: st.q, out: { Q: st.q, CV: st.cnt }, draw: st.cnt };
    }
  });

  def('CTD', {
    title: '减计数器', mnemonic: 'CTD', typeText: 'Int',
    group: 'counter', w: 96, fb: true, flow: ['CD', 'Q'], hasEN: false, hasENO: false,
    pinBranches: ['LD'],
    params: [
      { n: 'CD', dir: 'in' },
      { n: 'LD', dir: 'in', d: 'false', soft: true },
      { n: 'PV', dir: 'in' },
      { n: 'Q', dir: 'out' },
      { n: 'CV', dir: 'out' }
    ],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { cnt: 0, q: false, prev: false, pv: 0 }; });
      var wiredCd = hasWired(c.el, 'CD');
      var wiredLd = hasWired(c.el, 'LD');
      var wiredPv = hasWired(c.el, 'PV');
      var cd = wiredCd ? readB(c.plc, c.el, 'CD') : c.en;
      var pinLd = pinFlowOf(c.plc, c.el, 'LD');
      var ld = (pinLd !== null) ? pinLd : (wiredLd ? readB(c.plc, c.el, 'LD') : false);
      var pv = wiredPv ? num(readP(c.plc, c.el, 'PV', 0)) : 0;
      st.pv = pv;
      if (ld) {
        st.cnt = pv;                // 装载优先
      } else if (cd && !st.prev) {
        st.cnt = Math.max(st.cnt - 1, -32768);
      }
      st.prev = cd;
      st.q = st.cnt <= 0;
      return { q: st.q, out: { Q: st.q, CV: st.cnt }, draw: st.cnt };
    }
  });

  def('CTUD', {
    title: '加减计数器', mnemonic: 'CTUD', typeText: 'Int',
    // QU/QD 是 Bool 状态输出：和 TIA 一样不要求赋值，也不画红色 <???>
    group: 'counter', w: 104, fb: true, flow: ['CU', 'CD', 'QU', 'QD'], hasEN: false, hasENO: false,
    pinBranches: ['R', 'LD'],
    params: [
      { n: 'CU', dir: 'in' },
      { n: 'CD', dir: 'in' },
      { n: 'R', dir: 'in', d: 'false', soft: true },
      { n: 'LD', dir: 'in', d: 'false', soft: true },
      { n: 'PV', dir: 'in' },
      { n: 'QU', dir: 'out' },
      { n: 'QD', dir: 'out' },
      { n: 'CV', dir: 'out' }
    ],
    run: function (c) {
      var st = instState(c.plc, c.key, function () {
        return { cnt: 0, qu: false, qd: false, pu: false, pd: false, pv: 0 };
      });
      var wired = function (n) { return hasWired(c.el, n); };
      var cu = wired('CU') ? readB(c.plc, c.el, 'CU') : c.en;
      var cd = wired('CD') ? readB(c.plc, c.el, 'CD') : false;   // CU 占着左侧功率流，CD 必须显式接线
      var pinR = pinFlowOf(c.plc, c.el, 'R');
      var pinLd = pinFlowOf(c.plc, c.el, 'LD');
      var r = (pinR !== null) ? pinR : (wired('R') ? readB(c.plc, c.el, 'R') : false);
      var ld = (pinLd !== null) ? pinLd : (wired('LD') ? readB(c.plc, c.el, 'LD') : false);
      var pv = wired('PV') ? num(readP(c.plc, c.el, 'PV', 0)) : 0;
      st.pv = pv;
      if (r) st.cnt = 0;
      else if (ld) st.cnt = pv;
      else {
        var up = cu && !st.pu, dn = cd && !st.pd;
        if (up && !dn) st.cnt = Math.min(st.cnt + 1, 32767);
        else if (dn && !up) st.cnt = Math.max(st.cnt - 1, -32768);
      }
      st.pu = cu; st.pd = cd;
      st.qu = wired('PV') ? (st.cnt >= pv) : false;
      st.qd = st.cnt <= 0;
      return { q: st.qu, out: { QU: st.qu, QD: st.qd, CV: st.cnt }, draw: st.cnt };
    }
  });

  def('RESET_TIMER', {
    title: '复位定时器', group: 'timer', w: 88,
    params: [{ n: 'T', dir: 'in' }],
    run: function (c) {
      if (c.en) {
        var k = String(P(c.el, 'T') || '');
        for (var key in c.plc.timers) {
          if (key.indexOf(k) >= 0) delete c.plc.timers[key];
        }
      }
      return { q: c.en, out: {} };
    }
  });

  def('RESET_COUNTER', {
    title: '复位计数器', group: 'counter', w: 92,
    params: [{ n: 'C', dir: 'in' }],
    run: function (c) {
      if (c.en) {
        var k = String(P(c.el, 'C') || '');
        for (var key in c.plc.timers) {
          if (key.indexOf(k) >= 0) delete c.plc.timers[key];
        }
      }
      return { q: c.en, out: {} };
    }
  });

  /* ---------- 位逻辑：置位/复位位域、SR/RS 触发器 ---------- */
  def('SET_BF', {
    title: '置位位域', group: 'bitlogic', w: 108,
    params: [{ n: 'OUT', dir: 'out' }, { n: 'N', dir: 'in', d: '1' }],
    run: function (c) {
      var n = Math.max(1, num(readP(c.plc, c.el, 'N', 1)));
      var base = String(P(c.el, 'OUT') || '');
      if (c.en && base) {
        // 从 base 起连续置位 n 个位
        var m = /^(.*?)(\d+)\.(\d+)$/.exec(base);
        if (m) {
          var area = m[1], byte = +m[2], bit = +m[3], total = byte * 8 + bit;
          for (var i = 0; i < n; i++) {
            var t = total + i;
            c.plc.write(area + Math.floor(t / 8) + '.' + (t % 8), true);
          }
        } else {
          c.plc.write(base, true);
        }
      }
      return { q: c.en, out: {} };
    }
  });

  def('RESET_BF', {
    title: '复位位域', group: 'bitlogic', w: 108,
    params: [{ n: 'OUT', dir: 'out' }, { n: 'N', dir: 'in', d: '1' }],
    run: function (c) {
      var n = Math.max(1, num(readP(c.plc, c.el, 'N', 1)));
      var base = String(P(c.el, 'OUT') || '');
      if (c.en && base) {
        var m = /^(.*?)(\d+)\.(\d+)$/.exec(base);
        if (m) {
          var area = m[1], byte = +m[2], bit = +m[3], total = byte * 8 + bit;
          for (var i = 0; i < n; i++) {
            var t = total + i;
            c.plc.write(area + Math.floor(t / 8) + '.' + (t % 8), false);
          }
        } else {
          c.plc.write(base, false);
        }
      }
      return { q: c.en, out: {} };
    }
  });

  // SR：置位优先触发器（S 有效则置位，否则 R 有效则复位）
  def('SR', {
    title: 'SR 触发器', group: 'bitlogic', w: 96,
    params: [{ n: 'S', dir: 'in' }, { n: 'R', dir: 'in' }, { n: 'Q', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { q: false }; });
      var s = readB(c.plc, c.el, 'S');
      var r = readB(c.plc, c.el, 'R');
      if (c.en) {
        if (s) st.q = true;
        else if (r) st.q = false;
        writeP(c.plc, c.el, 'Q', st.q);
      }
      return { q: c.en, out: { Q: st.q }, draw: st.q };
    }
  });

  // RS：复位优先触发器
  def('RS', {
    title: 'RS 触发器', group: 'bitlogic', w: 96,
    params: [{ n: 'R', dir: 'in' }, { n: 'S', dir: 'in' }, { n: 'Q', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { q: false }; });
      var s = readB(c.plc, c.el, 'S');
      var r = readB(c.plc, c.el, 'R');
      if (c.en) {
        if (r) st.q = false;
        else if (s) st.q = true;
        writeP(c.plc, c.el, 'Q', st.q);
      }
      return { q: c.en, out: { Q: st.q }, draw: st.q };
    }
  });
  /* ---------- 比较（触点式，无 EN/ENO） ----------
   * 对齐 TIA：比较指令是"串在功率流里的触点"，左进右出、结果是 Bool，
   * 所以没有 EN/ENO，也不占两行 IN1/IN2：
   *   盒内只有两行 ——  比较符（==、<>、>、<、>=、<=） + 数据类型（Int / Real / Time…）
   *   两个操作数分别显示在盒体上方（IN1）和下方（IN2），
   *   未赋值时是红色 <???>；数据类型没选时盒内也显示 ???。
   * 操作数可以是普通地址/常量，也可以是实例成员（"time".ET），
   * 所以比较定时器/计数器的当前值是直接可用的。
   */
  var CMP_TYPES = ['Int', 'DInt', 'Real', 'Time', 'Bool'];

  /* 比较指令取"实例正在跑的那个数"
   * 用户口径（也是看盒体上方那个值框）：比较的不是数据块里冻结的设定值，
   * 而是这一刻已经跑出来的当前值：
   *   定时器 → 经过值 ET（用户习惯写 "TON_DB".PT，这里同样按运行值取）
   *   计数器 → 当前计数 CV（写 .PV 也按当前值取）
   * 所以 TON 的 PT 设 10s、比较框里填 5，就是"跑到 5s 时比较成立"。
   * 实例还没执行过（plc.timers 里没有状态）时返回 null，走普通读取。
   */
  function cmpLiveInst(plc, ref) {
    var r = cmpMemberRef(ref);
    if (!r || !plc || !plc.fbInst || !plc.timers) return null;
    var rec = plc.fbInst[r.name];
    if (!rec || !rec.el) return null;
    var st = plc.timers[rec.key];
    if (!st) return null;
    var meta = (root.INSTR && root.INSTR.info) ? root.INSTR.info(rec.el.type) : null;
    var grp = meta ? meta.group : '';
    if (grp === 'timer') {
      if (r.member === 'PT' || r.member === 'ET') return st.et || 0;
    } else if (grp === 'counter') {
      if (r.member === 'CV' || r.member === 'PV') return st.cnt || 0;
    }
    return null;
  }

  // 比较取值：常量（含 T# 时间）、地址、实例成员都能读；Bool 按 1/0
  // Time 比较里裸数字按"秒"算（PT = T#5s 时填 5 就是相等）——用户约定的口径
  function cmpVal(plc, el, name, type) {
    var ref = P(el, name);
    if (ref === undefined || ref === null || String(ref).trim() === '') return 0;
    var s = String(ref).trim();
    // 实例成员先按"运行值"取（定时器 → ET，计数器 → CV）
    var live = cmpLiveInst(plc, s);
    if (live !== null) return live;
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s) ? 1 : 0;
    if (/^(T|TIME|S5T|LT|LTIME)#/i.test(s)) return toMs(s);
    var v = plc.read(s);
    if (v !== undefined) {
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (type === 'TIME') return toMs(v);
      return v;
    }
    var n = parseFloat(s);
    if (isNaN(n)) return 0;
    if (type === 'TIME' && /^-?\d+(?:\.\d+)?$/.test(s)) return n * 1000;
    return n;
  }

  /* ---------- 比较指令的"数字"校验 ----------
   * 用户口径：盒体下方那个框填的是要跟关联值比的数字。
   *   · 关联 Time（"TON_DB".PT / .ET）时，裸数字按【秒】算：PT = T#5s 就填 5；
   *   · 关联计数器 / 整字（.CV / MW10）时就是普通整数，不做单位换算；
   *   · 填的数超出关联值能取到的范围（PT 最大就是 PT 本身，ET 不会超过 PT），
   *     且这个比较永远不可能成立（==、>、>=）时，数字标红、编译报错、拦住下载。
   */
  var CMP_OP = { CMP: '==', CMP_NE: '<>', CMP_GT: '>', CMP_LT: '<', CMP_GE: '>=', CMP_LE: '<=' };

  // "T1".PT → { name:'T1', member:'PT' }
  function cmpMemberRef(s) {
    var m = /^"?([^".]+?)"?\s*\.\s*([A-Za-z_]\w*)$/.exec(String(s == null ? '' : s).trim());
    return m ? { name: m[1].trim(), member: m[2].toUpperCase() } : null;
  }

  function cmpFmt(ms) {
    var f = root.PLC && root.PLC.msToTime;
    return f ? f(ms) : (ms + 'ms');
  }

  /* 比较的数据类型：显式 TYPE 优先；否则从操作数反推。
   * 反推是"免查项目"的（运行期每个扫描周期都会调，不能每次去遍历所有块）：
   *   .PT / .ET → Time（只有定时器有这两个成员）
   *   .CV / .PV → Int （计数器按数字算）
   *   .Q / .QU / .QD → Bool
   *   T#… 字面量 → Time
   */
  function cmpTypeOf(el, project) {
    var p = (el && el.params) || {};
    var ty = String(p.TYPE || '').trim().toUpperCase();
    if (ty) return ty === 'LTIME' ? 'TIME' : ty;
    var ref = String(p.IN1 || '').trim() || String(p.IN2 || '').trim();
    var r = cmpMemberRef(ref);
    if (r) {
      if (r.member === 'PT' || r.member === 'ET') return 'TIME';
      if (r.member === 'CV' || r.member === 'PV') return 'INT';
      if (r.member === 'Q' || r.member === 'QU' || r.member === 'QD') return 'BOOL';
    }
    if (/^(?:T|TIME|S5T|LT|LTIME)#/i.test(String(p.IN1 || '').trim()) ||
      /^(?:T|TIME|S5T|LT|LTIME)#/i.test(String(p.IN2 || '').trim())) return 'TIME';
    // 兜底：查项目里的实例成员真实类型（仅编辑器/编译路径传了 project 才走）
    if (project && r && root.PLC && root.PLC.instIndex) {
      var rec = root.PLC.instIndex(project)[r.name];
      if (rec && root.PLC.instanceMemberType) {
        var t = root.PLC.instanceMemberType(rec.type, r.member);
        if (t === 'Time') return 'TIME';
        if (t === 'Bool') return 'BOOL';
        return 'INT';
      }
    }
    return 'INT';
  }

  // 返回 { type, in1, in2, red, msg, maxMs, op }
  function cmpInfo(el, project) {
    el = el || {};
    var p = el.params || {};
    var in1 = String(p.IN1 == null ? '' : p.IN1).trim();
    var in2 = String(p.IN2 == null ? '' : p.IN2).trim();
    var ty = String(p.TYPE || '').trim().toUpperCase();
    var prj = project || (root.TIA && root.TIA.project) || null;

    if (!ty) ty = cmpTypeOf(el, prj);
    if (ty === 'LTIME') ty = 'TIME';

    // 需要实例索引才能知道 PT 设了多少（上限判断用），实现在 plc.js 里
    var idx = null;
    function instMap() {
      if (!idx) idx = (prj && root.PLC && root.PLC.instIndex) ? root.PLC.instIndex(prj) : {};
      return idx;
    }

    var out = {
      type: ty, in1: in1, in2: in2, red: false, msg: '',
      maxMs: null, op: CMP_OP[el.type] || '=='
    };

    // 关联值的上限：PT 就是设定值本身，ET 也不会超过 PT
    function maxOfRef(ref) {
      var r = cmpMemberRef(ref);
      if (!r || (r.member !== 'PT' && r.member !== 'ET')) return null;
      var rec = instMap()[r.name];
      if (!rec || !rec.el || !rec.el.params) return null;
      var pt = rec.el.params.PT;
      if (!pt) return null;
      var ms = toMs(pt);
      return ms > 0 ? ms : null;
    }
    out.maxMs = maxOfRef(in1) || maxOfRef(in2);

    if (!in2) return out;   // 还没填，不报错

    if (ty === 'TIME') {
      var ms = null;
      var num2 = in2.replace(',', '.');          // 5,25 当 5,25
      if (/^(?:T|TIME|S5T|LT|LTIME)#/i.test(num2)) ms = toMs(num2);
      else if (/^\d+(?:\.\d+)?(?:ms|s|m|h|d)$/i.test(num2)) ms = toMs(num2);
      else if (/^-?\d+(?:\.\d+)?$/.test(num2)) {
        if (/\.\d{3,}$/.test(num2)) {
          out.red = true;
          out.msg = '小数最多两位（例如 5.25）';
          return out;
        }
        ms = parseFloat(num2) * 1000;            // 裸数字 = 秒
      }
      if (ms === null) {
        out.red = true;
        out.msg = '不是有效的时间值（写 T#5s，或直接写 5 表示 5 秒）';
        return out;
      }
      out.ms = ms;
      if (out.maxMs !== null) {
        var m = out.maxMs, op = out.op;
        // 关联值最多只能到 max，这几种比较就永远不成立
        var never = (op === '==') ? (ms > m) : (op === '>=') ? (ms > m) : (op === '>') ? (ms >= m) : false;
        if (never) {
          out.red = true;
          out.msg = '关联值最大只有 ' + cmpFmt(m) + '，填 ' + cmpFmt(ms) + ' 时 "' + op + '" 永远不成立';
        }
      }
      return out;
    }

    if (ty === 'BOOL') {
      if (!/^(true|false|0|1)$/i.test(in2)) {
        out.red = true;
        out.msg = 'Bool 只能和 true / false（或 1 / 0）比较';
      }
      return out;
    }

    // Int / DInt / Real：计数器按数字算，不做单位换算
    var n2 = in2.replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(n2)) {
      out.red = true;
      out.msg = '不是有效数字';
      return out;
    }
    if (/\.\d{3,}$/.test(n2)) {
      out.red = true;
      out.msg = '小数最多两位（例如 5.25）';
      return out;
    }
    var n = parseFloat(n2);
    var lim = ty === 'DINT' ? 2147483647 : (ty === 'REAL' ? Infinity : 32767);
    if (lim !== Infinity && Math.abs(n) > lim) {
      out.red = true;
      out.msg = ty + ' 的范围是 ±' + lim + '，填 ' + n + ' 超了';
    }
    return out;
  }

  [['CMP', '=='], ['CMP_NE', '<>'], ['CMP_GT', '>'], ['CMP_LT', '<'], ['CMP_GE', '>='], ['CMP_LE', '<=']]
    .forEach(function (pair) {
      def(pair[0], {
        title: '比较 ' + pair[1], mnemonic: pair[1], cmp: pair[1], group: 'compare',
        kind: 'compare',            // 触点式：lad.js 用 drawCompare 画
        hasEN: false, hasENO: false,
        params: [
          { n: 'IN1', dir: 'in' },
          { n: 'IN2', dir: 'in' },
          { n: 'TYPE', dir: 'in', ui: 'type' }   // 不占行，画在盒内第二行
        ],
        run: function (c) {
          // 类型决定"裸数字"怎么解释：Time 按秒、Int 按原数
          var type = cmpTypeOf(c.el);
          var a = cmpVal(c.plc, c.el, 'IN1', type);
          var b = cmpVal(c.plc, c.el, 'IN2', type);
          var r = false;
          switch (pair[1]) {
            case '==': r = a === b; break;
            case '<>': r = a !== b; break;
            case '>': r = a > b; break;
            case '<': r = a < b; break;
            case '>=': r = a >= b; break;
            case '<=': r = a <= b; break;
          }
          // 触点语义：只有比较成立时功率流才通过
          return { q: c.en && r, out: {}, cond: r };
        }
      });
    });

  /* ---------- 数学 ---------- */
  def('ADD', {
    title: '加', group: 'math', w: 100, math: '+',
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = num(readP(c.plc, c.el, 'IN1', 0)) + num(readP(c.plc, c.el, 'IN2', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('SUB', {
    title: '减', group: 'math', w: 100, math: '-',
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = num(readP(c.plc, c.el, 'IN1', 0)) - num(readP(c.plc, c.el, 'IN2', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('MUL', {
    title: '乘', group: 'math', w: 100, math: '*',
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = num(readP(c.plc, c.el, 'IN1', 0)) * num(readP(c.plc, c.el, 'IN2', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('DIV', {
    title: '除', group: 'math', w: 100, math: '/',
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var b = num(readP(c.plc, c.el, 'IN2', 1));
      var ok = b !== 0;
      var r = ok ? Math.trunc(num(readP(c.plc, c.el, 'IN1', 0)) / b) : 0;
      if (c.en && ok) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en && ok, out: { OUT: r }, draw: r };
    }
  });
  def('MOD', {
    title: '取模', group: 'math', w: 100, math: 'MOD',
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var b = num(readP(c.plc, c.el, 'IN2', 1));
      var ok = b !== 0;
      var r = ok ? (num(readP(c.plc, c.el, 'IN1', 0)) % b) : 0;
      if (c.en && ok) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en && ok, out: { OUT: r }, draw: r };
    }
  });
  def('ABS', {
    title: '绝对值', group: 'math', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = Math.abs(num(readP(c.plc, c.el, 'IN', 0)));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('MIN', {
    title: '最小值', group: 'math', w: 96,
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = Math.min(num(readP(c.plc, c.el, 'IN1', 0)), num(readP(c.plc, c.el, 'IN2', 0)));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('MAX', {
    title: '最大值', group: 'math', w: 96,
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = Math.max(num(readP(c.plc, c.el, 'IN1', 0)), num(readP(c.plc, c.el, 'IN2', 0)));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('LIMIT', {
    title: '限值', group: 'math', w: 104,
    params: [{ n: 'IN', dir: 'in' }, { n: 'MIN', dir: 'in' }, { n: 'MAX', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var v = num(readP(c.plc, c.el, 'IN', 0));
      var lo = num(readP(c.plc, c.el, 'MIN', 0));
      var hi = num(readP(c.plc, c.el, 'MAX', 100));
      var r = Math.min(Math.max(v, lo), hi);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('NEG', {
    title: '取负', group: 'math', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = -num(readP(c.plc, c.el, 'IN', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('INC', {
    title: '递增', group: 'math', w: 88,
    params: [{ n: 'INOUT', dir: 'inout' }],
    run: function (c) {
      var v = num(readP(c.plc, c.el, 'INOUT', 0)) + 1;
      if (c.en) writeP(c.plc, c.el, 'INOUT', v);
      return { q: c.en, out: { INOUT: v }, draw: v };
    }
  });
  def('DEC', {
    title: '递减', group: 'math', w: 88,
    params: [{ n: 'INOUT', dir: 'inout' }],
    run: function (c) {
      var v = num(readP(c.plc, c.el, 'INOUT', 0)) - 1;
      if (c.en) writeP(c.plc, c.el, 'INOUT', v);
      return { q: c.en, out: { INOUT: v }, draw: v };
    }
  });
  def('SQR', {
    title: '平方', group: 'math', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = Math.pow(num(readP(c.plc, c.el, 'IN', 0)), 2);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('SQRT', {
    title: '平方根', group: 'math', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var v = num(readP(c.plc, c.el, 'IN', 0));
      var ok = v >= 0;
      var r = ok ? Math.sqrt(v) : 0;
      if (c.en && ok) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en && ok, out: { OUT: r }, draw: r };
    }
  });

  /* ---------- 移动 ---------- */
  def('MOVE', {
    title: '移动值', group: 'move', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var v = readP(c.plc, c.el, 'IN', 0);
      if (c.en) writeP(c.plc, c.el, 'OUT', v);
      return { q: c.en, out: { OUT: v }, draw: v };
    }
  });
  def('MOVE_BLK', {
    title: '块移动', group: 'move', w: 104,
    params: [{ n: 'IN', dir: 'in' }, { n: 'COUNT', dir: 'in', d: '10' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var n = num(readP(c.plc, c.el, 'COUNT', 10));
      var src = String(P(c.el, 'IN') || '');
      var dst = String(P(c.el, 'OUT') || '');
      if (c.en && src && dst) {
        for (var i = 0; i < n; i++) {
          var sv = c.plc.readRaw(src.replace(/(\d+)$/, function (m) { return String(+m + i); }));
          if (sv !== undefined) {
            c.plc.writeRaw(dst.replace(/(\d+)$/, function (m) { return String(+m + i); }), sv);
          }
        }
      }
      return { q: c.en, out: { COUNT: n }, draw: n };
    }
  });
  def('FILL_BLK', {
    title: '块填充', group: 'move', w: 104,
    params: [{ n: 'IN', dir: 'in' }, { n: 'COUNT', dir: 'in', d: '10' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var n = num(readP(c.plc, c.el, 'COUNT', 10));
      var v = readP(c.plc, c.el, 'IN', 0);
      var dst = String(P(c.el, 'OUT') || '');
      if (c.en && dst) {
        for (var i = 0; i < n; i++) {
          c.plc.writeRaw(dst.replace(/(\d+)$/, function (m) { return String(+m + i); }), v);
        }
      }
      return { q: c.en, out: { COUNT: n }, draw: n };
    }
  });
  def('SWAP', {
    title: '字节交换', group: 'move', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var v = num(readP(c.plc, c.el, 'IN', 0)) & 0xffff;
      var r = ((v & 0xff) << 8) | ((v >> 8) & 0xff);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });

  /* ---------- 移位 / 循环 ---------- */
  ['SHL', 'SHR', 'ROL', 'ROR'].forEach(function (op) {
    def(op, {
      title: { SHL: '左移', SHR: '右移', ROL: '循环左移', ROR: '循环右移' }[op],
      group: 'shift', w: 100,
      params: [{ n: 'IN', dir: 'in' }, { n: 'N', dir: 'in', d: '1' }, { n: 'OUT', dir: 'out' }],
      run: function (c) {
        var v = num(readP(c.plc, c.el, 'IN', 0)) >>> 0;
        var n = num(readP(c.plc, c.el, 'N', 1)) & 31;
        var r = 0;
        switch (op) {
          case 'SHL': r = (v << n) >>> 0; break;
          case 'SHR': r = v >>> n; break;
          case 'ROL': r = ((v << n) | (v >>> (32 - n))) >>> 0; break;
          case 'ROR': r = ((v >>> n) | (v << (32 - n))) >>> 0; break;
        }
        if (c.en) writeP(c.plc, c.el, 'OUT', r | 0);
        return { q: c.en, out: { OUT: r | 0 }, draw: r | 0 };
      }
    });
  });

  /* ---------- 字逻辑 ---------- */
  ['AND', 'OR', 'XOR'].forEach(function (op) {
    def(op + '_W', {
      title: '字逻辑 ' + op, group: 'bitlogic', w: 100,
      params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
      run: function (c) {
        var a = num(readP(c.plc, c.el, 'IN1', 0)) | 0;
        var b = num(readP(c.plc, c.el, 'IN2', 0)) | 0;
        var r = op === 'AND' ? (a & b) : (op === 'OR' ? (a | b) : (a ^ b));
        if (c.en) writeP(c.plc, c.el, 'OUT', r);
        return { q: c.en, out: { OUT: r }, draw: r };
      }
    });
  });
  def('INV_W', {
    title: '字取反', group: 'bitlogic', w: 92,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = ~num(readP(c.plc, c.el, 'IN', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });

  /* ---------- 转换 ---------- */
  ['CONVERT', 'ROUND', 'TRUNC', 'CEIL', 'FLOOR'].forEach(function (op) {
    def(op, {
      title: { CONVERT: '类型转换', ROUND: '四舍五入', TRUNC: '取整', CEIL: '向上取整', FLOOR: '向下取整' }[op],
      group: 'convert', w: 100,
      params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
      run: function (c) {
        var v = num(readP(c.plc, c.el, 'IN', 0));
        var r = v;
        if (op === 'ROUND') r = Math.round(v);
        else if (op === 'TRUNC') r = Math.trunc(v);
        else if (op === 'CEIL') r = Math.ceil(v);
        else if (op === 'FLOOR') r = Math.floor(v);
        if (c.en) writeP(c.plc, c.el, 'OUT', r);
        return { q: c.en, out: { OUT: r }, draw: r };
      }
    });
  });

  /* ---------- 日期与时间 ---------- */
  def('T_ADD', {
    title: '时间加', group: 'datetime', w: 104,
    params: [{ n: 'IN1', dir: 'in', d: 'T#0s' }, { n: 'IN2', dir: 'in', d: 'T#1s' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = readTime(c.plc, c.el, 'IN1', 0) + readTime(c.plc, c.el, 'IN2', 0);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r + 'ms' };
    }
  });
  def('T_SUB', {
    title: '时间减', group: 'datetime', w: 104,
    params: [{ n: 'IN1', dir: 'in', d: 'T#0s' }, { n: 'IN2', dir: 'in', d: 'T#1s' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = readTime(c.plc, c.el, 'IN1', 0) - readTime(c.plc, c.el, 'IN2', 0);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r + 'ms' };
    }
  });
  def('T_DIFF', {
    title: '时间差', group: 'datetime', w: 104,
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = Math.abs(readTime(c.plc, c.el, 'IN1', 0) - readTime(c.plc, c.el, 'IN2', 0));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r + 'ms' };
    }
  });
  def('T_CONV', {
    title: '时间转数值', group: 'datetime', w: 104,
    params: [{ n: 'IN', dir: 'in', d: 'T#1s' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = readTime(c.plc, c.el, 'IN', 0);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r + 'ms' };
    }
  });
  def('RTC', {
    title: '读取系统时间', group: 'datetime', w: 100,
    params: [{ n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = c.plc.clock;
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });

  /* ---------- 字符串 ---------- */
  def('LEN', {
    title: '字符串长度', group: 'string', w: 96,
    params: [{ n: 'IN', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var s = String(readP(c.plc, c.el, 'IN', ''));
      var r = s.length;
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  def('CONCAT', {
    title: '连接字符串', group: 'string', w: 108,
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var r = String(readP(c.plc, c.el, 'IN1', '')) + String(readP(c.plc, c.el, 'IN2', ''));
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r.slice(0, 10) };
    }
  });
  ['LEFT', 'RIGHT'].forEach(function (op) {
    def(op, {
      title: op === 'LEFT' ? '左侧子串' : '右侧子串', group: 'string', w: 100,
      params: [{ n: 'IN', dir: 'in' }, { n: 'L', dir: 'in', d: '1' }, { n: 'OUT', dir: 'out' }],
      run: function (c) {
        var s = String(readP(c.plc, c.el, 'IN', ''));
        var n = num(readP(c.plc, c.el, 'L', 1));
        var r = op === 'LEFT' ? s.slice(0, n) : s.slice(-n);
        if (c.en) writeP(c.plc, c.el, 'OUT', r);
        return { q: c.en, out: { OUT: r }, draw: r.slice(0, 10) };
      }
    });
  });
  def('MID', {
    title: '中间子串', group: 'string', w: 108,
    params: [{ n: 'IN', dir: 'in' }, { n: 'L', dir: 'in', d: '1' }, { n: 'P', dir: 'in', d: '1' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var s = String(readP(c.plc, c.el, 'IN', ''));
      var l = num(readP(c.plc, c.el, 'L', 1));
      var p = num(readP(c.plc, c.el, 'P', 1));
      var r = s.substr(Math.max(0, p - 1), l);
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r.slice(0, 10) };
    }
  });
  def('FIND', {
    title: '查找字符串', group: 'string', w: 104,
    params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var s = String(readP(c.plc, c.el, 'IN1', ''));
      var sub = String(readP(c.plc, c.el, 'IN2', ''));
      var r = s.indexOf(sub) + 1;
      if (c.en) writeP(c.plc, c.el, 'OUT', r);
      return { q: c.en, out: { OUT: r }, draw: r };
    }
  });
  [['EQ_STR', true], ['NE_STR', false]].forEach(function (pair) {
    def(pair[0], {
      title: pair[1] ? '字符串相等' : '字符串不等', group: 'string', w: 100,
      params: [{ n: 'IN1', dir: 'in' }, { n: 'IN2', dir: 'in' }],
      run: function (c) {
        var a = String(readP(c.plc, c.el, 'IN1', ''));
        var b = String(readP(c.plc, c.el, 'IN2', ''));
        var r = (a === b) === pair[1];
        return { q: c.en && r, out: {}, cond: r };
      }
    });
  });

  /* ---------- 脉冲 ---------- */
  def('PULSE', {
    title: '脉冲输出', group: 'pulse', w: 100,
    params: [{ n: 'IN', dir: 'in' }, { n: 'N', dir: 'in', d: '3' }, { n: 'OUT', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { left: 0, prev: false }; });
      if (c.en && !st.prev) st.left = num(readP(c.plc, c.el, 'N', 3));
      st.prev = c.en;
      var q = st.left > 0;
      if (q) st.left--;
      if (c.en && q) writeP(c.plc, c.el, 'OUT', true);
      else if (c.en && !q) writeP(c.plc, c.el, 'OUT', false);
      return { q: c.en, out: { OUT: q }, draw: st.left };
    }
  });

  /* ---------- 程序控制 ---------- */
  def('RET', {
    title: '返回', group: 'prog', w: 80,
    params: [], hasENO: false,
    run: function (c) { return { q: c.en, out: {}, ret: c.en }; }
  });
  def('JMP', {
    title: '跳转', group: 'prog', w: 92,
    params: [{ n: 'LABEL', dir: 'in', d: 'L1' }], hasENO: false,
    run: function (c) { return { q: c.en, out: {} }; }
  });
  def('LABEL', {
    title: '标签', group: 'prog', w: 84,
    params: [{ n: 'NAME', dir: 'in', d: 'L1' }],
    run: function (c) { return { q: true, out: {} }; }
  });

  /* ---------- 工艺指令（运动控制） ---------- */
  def('MC_POWER', {
    title: 'MC_Power 使能轴', group: 'tech', w: 120, sim: false,
    params: [{ n: 'Axis', dir: 'in', d: 'Axis_1' }, { n: 'Enable', dir: 'in' },
      { n: 'Status', dir: 'out' }, { n: 'Error', dir: 'out' }],
    run: function (c) {
      var en = readB(c.plc, c.el, 'Enable');
      var st = instState(c.plc, c.key, function () { return { on: false }; });
      if (c.en) {
        st.on = en;
        writeP(c.plc, c.el, 'Status', st.on);
        writeP(c.plc, c.el, 'Error', false);
      }
      return { q: c.en, out: { Status: st.on, Error: false }, draw: st.on };
    }
  });

  def('MC_MoveAbsolute', {
    title: 'MC_MoveAbsolute 绝对定位', group: 'tech', w: 128, sim: false,
    params: [{ n: 'Axis', dir: 'in', d: 'Axis_1' }, { n: 'Execute', dir: 'in' },
      { n: 'Position', dir: 'in', d: '100.0' }, { n: 'Done', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var ex = readB(c.plc, c.el, 'Execute');
      if (ex && !st.prev) st.done = true;
      if (!ex) st.done = false;
      st.prev = ex;
      if (c.en) writeP(c.plc, c.el, 'Done', st.done);
      return { q: c.en, out: { Done: st.done }, draw: st.done };
    }
  });

  def('MC_Home', {
    title: 'MC_Home 回原点', group: 'tech', w: 112, sim: false,
    params: [{ n: 'Axis', dir: 'in', d: 'Axis_1' }, { n: 'Execute', dir: 'in' },
      { n: 'Done', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var ex = readB(c.plc, c.el, 'Execute');
      if (ex && !st.prev) st.done = true;
      if (!ex) st.done = false;
      st.prev = ex;
      if (c.en) writeP(c.plc, c.el, 'Done', st.done);
      return { q: c.en, out: { Done: st.done }, draw: st.done };
    }
  });

  def('MC_Halt', {
    title: 'MC_Halt 停止轴', group: 'tech', w: 108, sim: false,
    params: [{ n: 'Axis', dir: 'in', d: 'Axis_1' }, { n: 'Execute', dir: 'in' },
      { n: 'Done', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var ex = readB(c.plc, c.el, 'Execute');
      if (ex && !st.prev) st.done = true;
      if (!ex) st.done = false;
      st.prev = ex;
      if (c.en) writeP(c.plc, c.el, 'Done', st.done);
      return { q: c.en, out: { Done: st.done }, draw: st.done };
    }
  });

  /* ---------- 通信指令 ---------- */
  def('TSEND_C', {
    title: 'TSEND_C 发送数据', group: 'comm', w: 120, sim: true,
    params: [{ n: 'REQ', dir: 'in' }, { n: 'CONNECT', dir: 'in' },
      { n: 'DATA', dir: 'in' }, { n: 'DONE', dir: 'out' }, { n: 'ERROR', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var req = readB(c.plc, c.el, 'REQ');
      if (req && !st.prev) st.done = true;
      if (!req) st.done = false;
      st.prev = req;
      if (c.en) { writeP(c.plc, c.el, 'DONE', st.done); writeP(c.plc, c.el, 'ERROR', false); }
      return { q: c.en, out: { DONE: st.done, ERROR: false }, draw: st.done };
    }
  });

  def('TRCV_C', {
    title: 'TRCV_C 接收数据', group: 'comm', w: 120, sim: true,
    params: [{ n: 'EN_R', dir: 'in' }, { n: 'CONNECT', dir: 'in' },
      { n: 'DATA', dir: 'out' }, { n: 'NDR', dir: 'out' }, { n: 'ERROR', dir: 'out' }],
    run: function (c) {
      if (c.en) { writeP(c.plc, c.el, 'NDR', false); writeP(c.plc, c.el, 'ERROR', false); }
      return { q: c.en, out: { NDR: false, ERROR: false }, draw: false };
    }
  });

  def('GET', {
    title: 'GET 读取远程', group: 'comm', w: 112, sim: true,
    params: [{ n: 'REQ', dir: 'in' }, { n: 'ADDR', dir: 'in' },
      { n: 'RD', dir: 'out' }, { n: 'NDR', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var req = readB(c.plc, c.el, 'REQ');
      if (req && !st.prev) st.done = true;
      if (!req) st.done = false;
      st.prev = req;
      if (c.en) writeP(c.plc, c.el, 'NDR', st.done);
      return { q: c.en, out: { NDR: st.done }, draw: st.done };
    }
  });

  def('PUT', {
    title: 'PUT 写入远程', group: 'comm', w: 112, sim: true,
    params: [{ n: 'REQ', dir: 'in' }, { n: 'ADDR', dir: 'in' },
      { n: 'SD', dir: 'in' }, { n: 'DONE', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var req = readB(c.plc, c.el, 'REQ');
      if (req && !st.prev) st.done = true;
      if (!req) st.done = false;
      st.prev = req;
      if (c.en) writeP(c.plc, c.el, 'DONE', st.done);
      return { q: c.en, out: { DONE: st.done }, draw: st.done };
    }
  });

  def('MB_CLIENT', {
    title: 'MB_CLIENT Modbus 客户端', group: 'comm', w: 128, sim: true,
    params: [{ n: 'REQ', dir: 'in' }, { n: 'IP', dir: 'in' },
      { n: 'PORT', dir: 'in', d: '502' }, { n: 'DONE', dir: 'out' }, { n: 'ERROR', dir: 'out' }],
    run: function (c) {
      var st = instState(c.plc, c.key, function () { return { done: false, prev: false }; });
      var req = readB(c.plc, c.el, 'REQ');
      if (req && !st.prev) st.done = true;
      if (!req) st.done = false;
      st.prev = req;
      if (c.en) { writeP(c.plc, c.el, 'DONE', st.done); writeP(c.plc, c.el, 'ERROR', false); }
      return { q: c.en, out: { DONE: st.done, ERROR: false }, draw: st.done };
    }
  });

  def('MB_SERVER', {
    title: 'MB_SERVER Modbus 服务器', group: 'comm', w: 128, sim: true,
    params: [{ n: 'DISCONNECT', dir: 'in' }, { n: 'MB_HOLD_REG', dir: 'in' },
      { n: 'NDR', dir: 'out' }],
    run: function (c) {
      if (c.en) writeP(c.plc, c.el, 'NDR', false);
      return { q: c.en, out: { NDR: false }, draw: false };
    }
  });
  /* ---------- 分布式 I/O / PROFIenergy / 中断 / 报警 / 诊断（示意实现） ---------- */
  def('RDREC', {
    title: '读取数据记录', group: 'io', w: 112, sim: true,
    params: [{ n: 'ID', dir: 'in', d: '256' }, { n: 'INDEX', dir: 'in', d: '1' },
      { n: 'LEN', dir: 'in', d: '8' }, { n: 'RECORD', dir: 'out' }, { n: 'STATUS', dir: 'out' }],
    run: function (c) {
      if (c.en) { writeP(c.plc, c.el, 'STATUS', 0); }
      return { q: c.en, out: { STATUS: 0 }, draw: 0 };
    }
  });
  def('WRREC', {
    title: '写入数据记录', group: 'io', w: 112, sim: true,
    params: [{ n: 'ID', dir: 'in', d: '256' }, { n: 'INDEX', dir: 'in', d: '1' },
      { n: 'RECORD', dir: 'in' }, { n: 'STATUS', dir: 'out' }],
    run: function (c) {
      if (c.en) writeP(c.plc, c.el, 'STATUS', 0);
      return { q: c.en, out: { STATUS: 0 }, draw: 0 };
    }
  });
  def('PE_START', {
    title: 'PROFIenergy 启动', group: 'io', w: 112, sim: true,
    params: [{ n: 'ID', dir: 'in' }, { n: 'DONE', dir: 'out' }, { n: 'STATUS', dir: 'out' }],
    run: function (c) {
      if (c.en) { writeP(c.plc, c.el, 'DONE', true); writeP(c.plc, c.el, 'STATUS', 0); }
      return { q: c.en, out: { DONE: c.en }, draw: c.en };
    }
  });
  def('PE_END', {
    title: 'PROFIenergy 结束', group: 'io', w: 112, sim: true,
    params: [{ n: 'ID', dir: 'in' }, { n: 'DONE', dir: 'out' }, { n: 'STATUS', dir: 'out' }],
    run: function (c) {
      if (c.en) { writeP(c.plc, c.el, 'DONE', true); writeP(c.plc, c.el, 'STATUS', 0); }
      return { q: c.en, out: { DONE: c.en }, draw: c.en };
    }
  });
  def('ATTACH', {
    title: '连接中断', group: 'intr', w: 104, sim: true,
    params: [{ n: 'OB', dir: 'in', d: 'OB40' }, { n: 'EVENT', dir: 'in' }, { n: 'RET', dir: 'out' }],
    run: function (c) {
      if (c.en) writeP(c.plc, c.el, 'RET', 0);
      return { q: c.en, out: { RET: 0 }, draw: 0 };
    }
  });
  def('DETACH', {
    title: '分离中断', group: 'intr', w: 104, sim: true,
    params: [{ n: 'OB', dir: 'in', d: 'OB40' }, { n: 'RET', dir: 'out' }],
    run: function (c) {
      if (c.en) writeP(c.plc, c.el, 'RET', 0);
      return { q: c.en, out: { RET: 0 }, draw: 0 };
    }
  });
  def('SET_ALARM', {
    title: '触发报警', group: 'alarm', w: 104, sim: true,
    params: [{ n: 'ID', dir: 'in', d: '1' }],
    run: function (c) {
      if (c.en) {
        var k = 'alarm:' + num(readP(c.plc, c.el, 'ID', 1));
        if (!c.plc.timers[k]) {
          c.plc.timers[k] = { on: true };
          c.plc.log('warning', 'HMI 报警触发 ID=' + num(readP(c.plc, c.el, 'ID', 1)));
        }
      }
      return { q: c.en, out: {} };
    }
  });
  def('GET_ALARM', {
    title: '读取报警', group: 'alarm', w: 104, sim: true,
    params: [{ n: 'ID', dir: 'in', d: '1' }, { n: 'ACTIVE', dir: 'out' }],
    run: function (c) {
      var k = 'alarm:' + num(readP(c.plc, c.el, 'ID', 1));
      var on = !!c.plc.timers[k];
      if (c.en) writeP(c.plc, c.el, 'ACTIVE', on);
      return { q: c.en, out: { ACTIVE: on }, draw: on };
    }
  });
  def('GET_DIAG', {
    title: '读取诊断', group: 'diag', w: 104, sim: true,
    params: [{ n: 'LADDR', dir: 'in' }, { n: 'STATE', dir: 'out' }],
    run: function (c) {
      var s = c.plc.logs.filter(function (l) { return l.level === 'error'; }).length > 0 ? 1 : 0;
      if (c.en) writeP(c.plc, c.el, 'STATE', s);
      return { q: c.en, out: { STATE: s }, draw: s };
    }
  });
  def('LED', {
    title: '设置 LED', group: 'diag', w: 96, sim: true,
    params: [{ n: 'STATE', dir: 'in', d: '1' }], hasENO: false,
    run: function (c) { return { q: c.en, out: {} }; }
  });

  /* ============================================================
   *  目录（用于右侧指令面板渲染）
   * ============================================================ */
  var CATALOG = [
    {
      id: 'basic', name: '基本指令', open: true, groups: [
        { id: 'conventional', name: '常规', items: ['SET_BF', 'RESET_BF', 'SR', 'RS', 'P', 'N', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL', 'NO', 'NC', 'COIL', 'SET', 'RESET', 'P_TRIG', 'N_TRIG'] },
        { id: 'bitlogic', name: '位逻辑运算', items: ['AND_W', 'OR_W', 'XOR_W', 'INV_W', 'P_TRIG', 'N_TRIG'] },
        { id: 'timer', name: '定时器操作', items: ['TON', 'TOF', 'TP', 'TONR', 'RESET_TIMER'] },
        { id: 'counter', name: '计数器操作', items: ['CTU', 'CTD', 'CTUD', 'RESET_COUNTER'] },
        { id: 'compare', name: '比较操作', items: ['CMP', 'CMP_NE', 'CMP_GT', 'CMP_LT', 'CMP_GE', 'CMP_LE'] },
        { id: 'math', name: '数学函数', items: ['ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'ABS', 'MIN', 'MAX', 'LIMIT', 'NEG', 'INC', 'DEC', 'SQR', 'SQRT'] }
      ]
    },
    {
      id: 'extended', name: '扩展指令', open: true, groups: [
        { id: 'datetime', name: '日期和时间', items: ['T_ADD', 'T_SUB', 'T_DIFF', 'T_CONV', 'RTC'] },
        { id: 'string', name: '字符串 + 字符', items: ['LEN', 'CONCAT', 'LEFT', 'RIGHT', 'MID', 'FIND', 'EQ_STR', 'NE_STR'] },
        { id: 'io', name: '分布式 I/O', items: ['RDREC', 'WRREC', 'PE_START', 'PE_END'] },
        { id: 'intr', name: '中断', items: ['ATTACH', 'DETACH'] },
        { id: 'alarm', name: '报警', items: ['SET_ALARM', 'GET_ALARM'] },
        { id: 'diag', name: '诊断', items: ['GET_DIAG', 'LED'] },
        { id: 'pulse', name: '脉冲', items: ['PULSE'] },
        { id: 'shift', name: '移位和循环', items: ['SHL', 'SHR', 'ROL', 'ROR'] },
        { id: 'convert', name: '转换操作', items: ['CONVERT', 'ROUND', 'TRUNC', 'CEIL', 'FLOOR'] },
        { id: 'move', name: '移动操作', items: ['MOVE', 'MOVE_BLK', 'FILL_BLK', 'SWAP'] },
        { id: 'prog', name: '程序控制', items: ['RET', 'JMP', 'LABEL'] },
        { id: 'tech', name: '工艺', items: ['MC_POWER', 'MC_MoveAbsolute', 'MC_Home', 'MC_Halt'] },
        { id: 'comm', name: '通信', items: ['TSEND_C', 'TRCV_C', 'GET', 'PUT', 'MB_CLIENT', 'MB_SERVER'] },
        { id: 'optpkg', name: '选件包', items: [] }
      ]
    }
  ];

  // 收藏夹默认项
  var DEFAULT_FAVORITES = ['NO', 'NC', 'COIL', 'SET', 'RESET', 'P'];

  /* 指令元信息查询（供渲染与面板共用） */
  // 块头第二行的数据类型默认值：数学运算在 TIA 里都会显示 Int（可后续按数据类型细化）
  var GROUP_TYPE = { math: 'Int' };

  function info(type) {
    if (CONTACTS[type]) {
      return {
        type: type, name: CONTACTS[type].name, sym: CONTACTS[type].sym,
        kind: 'contact', params: [{ n: 'OPERAND', dir: 'in' }]
      };
    }
    if (COILS[type]) {
      return {
        type: type, name: COILS[type].name, sym: COILS[type].sym,
        kind: 'coil', params: [{ n: 'OPERAND', dir: 'out' }]
      };
    }
    var d = DEFS[type];
    if (!d) return null;
    return {
      type: type, name: d.title,
      mnemonic: d.mnemonic || d.id,        // 画在盒体标题栏上的助记符（TON / CTU / ADD / >）
      typeText: d.typeText || GROUP_TYPE[d.group] || '',   // 标题下方的数据类型小框（Time / Int …）
      kind: d.kind || 'box',               // contact | coil | box | compare
      w: d.w || 100,
      params: d.params, hasEN: d.hasEN, hasENO: d.hasENO,
      sim: !!d.sim, group: d.group, cmp: d.cmp, math: d.math,
      fb: !!d.fb,          // 需要实例数据块（调用选项 / <???> 实例名 / "name".Q 引用）
      pinBranches: d.pinBranches || [],  // 可接触点支路的布尔输入引脚（计数器的 R / LD）
      flow: d.flow || []   // 框体功率流端子（IN/Q…）：靠接线取值，不画 <???> 占位
    };
  }

  function isKnown(type) {
    return !!(CONTACTS[type] || COILS[type] || DEFS[type]);
  }

  /* 执行一个盒式指令 */
  function runBox(plc, el, en, key) {
    var d = DEFS[el.type];
    if (!d) return { q: en, out: {}, unknown: true };
    try {
      return d.run({ plc: plc, el: el, en: en, key: key });
    } catch (err) {
      plc.log('error', '指令 ' + el.type + ' 执行异常: ' + err.message);
      return { q: false, out: {} };
    }
  }

  root.INSTR = {
    DEFS: DEFS, CONTACTS: CONTACTS, COILS: COILS, CATALOG: CATALOG,
    DEFAULT_FAVORITES: DEFAULT_FAVORITES,
    info: info, isKnown: isKnown, runBox: runBox, CMP_TYPES: CMP_TYPES,
    cmpInfo: cmpInfo, cmpTypeOf: cmpTypeOf,
    P: P, hasWired: hasWired, readP: readP, readTime: readTime, readB: readB, writeP: writeP, toMs: toMs, num: num
  };

})(typeof window !== 'undefined' ? window : globalThis);




