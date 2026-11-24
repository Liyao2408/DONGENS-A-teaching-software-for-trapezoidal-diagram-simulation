/* ============================================================
 * plc.js — 软 PLC 内核
 * 内存区 I/Q/M + DB，扫描周期，LAD 网络求值，SCL 解释器，编译检查
 * 该文件同时可在 Node 下 require 用于自测
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 位/字节工具 ---------------- */
  function Bytes(n) { return new Uint8Array(n); }

  function getBit(arr, byteOff, bit) {
    return ((arr[byteOff] >> bit) & 1) === 1;
  }
  function setBit(arr, byteOff, bit, v) {
    if (v) arr[byteOff] |= (1 << bit);
    else arr[byteOff] &= ~(1 << bit);
  }

  /* ---------------- 地址解析 ---------------- */
  // I0.0 / Q0.1 / M10.2 / MW10 / MD4 / IB2 / IW4 / DB1.DBX0.0 / DB1.DBW2 / Timer1 / C1
  var RE_SIMPLE = /^(I|Q|M)([BWD]?)(\d+)(?:\.(\d+))?$/i;
  var RE_DB = /^DB(\d+)\.DB([XBWD])(\d+)(?:\.(\d+))?$/i;
  // FB 实例成员引用："time".Q / time.Q / "DB_1".ET
  var RE_INST = /^"?([^".]+?)"?\s*\.\s*([A-Za-z_]\w*)$/;

  function parseAddr(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    var m = RE_DB.exec(s);
    if (m) {
      return {
        kind: 'db', db: +m[1], size: m[2].toUpperCase(),
        off: +m[3], bit: m[4] === undefined ? 0 : +m[4], raw: s
      };
    }
    m = RE_SIMPLE.exec(s);
    if (m) {
      var size = (m[2] || 'X').toUpperCase();
      return {
        kind: 'mem', area: m[1].toUpperCase(), size: size,
        off: +m[3], bit: m[4] === undefined ? 0 : +m[4], raw: s
      };
    }
    return null;
  }

  /* ---------------- 软 PLC ---------------- */
  function SoftPLC() {
    this.mem = { I: Bytes(512), Q: Bytes(512), M: Bytes(2048) };
    this.db = {};                 // { 1: {bytes: Uint8Array} , 'inst_FB1': {fields:{}, bytes} }
    this.timers = {};             // key -> {prevIn, start, q, et}
    this.edges = {};              // key -> prev
    this.inst = {};               // 实例 DB 静态变量: name -> {var: value}
    this.tags = [];               // 符号表 [{name,address,datatype,comment}]
    this.tagIndex = {};
    this.trace = { elem: {}, net: {} };
    this.cycleCount = 0;
    this.lastCycleMs = 0;
    this.maxCycleMs = 0;
    this.runtime = false;
    this.clock = 0;               // 运行毫秒（仿真时间）
    this.logs = [];               // 诊断
    this.forced = {};             // 强制表 addr -> value
  }

  SoftPLC.prototype.log = function (level, text) {
    this.logs.push({ t: this.clock, level: level, text: text });
    if (this.logs.length > 500) this.logs.shift();
  };

  SoftPLC.prototype.setTags = function (tags) {
    this.tags = tags || [];
    this.tagIndex = {};
    for (var i = 0; i < this.tags.length; i++) {
      var t = this.tags[i];
      if (t && t.name) this.tagIndex[t.name] = t;
    }
  };

  // 名称 -> 解析后的地址对象（支持符号名、直接地址、DB 变量名、FB 实例成员）
  SoftPLC.prototype.resolve = function (name) {
    if (name == null) return null;
    var s = String(name).trim();
    if (!s) return null;
    var a = parseAddr(s);
    if (a) return a;
    // FB 实例成员："time".Q → 读该 TON/计数器实例的运行状态
    var im = RE_INST.exec(s);
    if (im && this.fbInst) {
      var rec = this.fbInst[im[1].trim()];
      if (rec) return { kind: 'inst', inst: rec, member: im[2].toUpperCase(), raw: s };
    }
    var t = this.tagIndex[s];
    if (t) return parseAddr(t.address);
    // TIA 里符号名是带引号写的（"Tag_6"）。界面上标签也带引号显示，
    // 用户常常照着敲，所以这里也认带引号的形式，去掉引号再查一次。
    if (s.length > 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      var q = s.slice(1, -1).trim();
      if (q) {
        var a2 = parseAddr(q);
        if (a2) return a2;
        var t2 = this.tagIndex[q];
        if (t2) return parseAddr(t2.address);
      }
    }
    return null;
  };

  SoftPLC.prototype._buf = function (a) {
    if (a.kind === 'db') {
      var d = this.db[a.db];
      if (!d) { d = this.db[a.db] = { bytes: Bytes(4096), fields: {} }; }
      return d.bytes;
    }
    return this.mem[a.area];
  };

  function readNumeric(buf, off, size) {
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    switch (size) {
      case 'X': return getBit(buf, off, 0) ? 1 : 0;
      case 'B': return buf[off];
      case 'W': return dv.getInt16(off, false);
      case 'D': return dv.getInt32(off, false);
      default: return getBit(buf, off, 0) ? 1 : 0;
    }
  }
  function writeNumeric(buf, off, size, val) {
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    switch (size) {
      case 'X': setBit(buf, off, 0, !!val); break;
      case 'B': buf[off] = val & 0xff; break;
      case 'W': dv.setInt16(off, val | 0, false); break;
      case 'D': dv.setInt32(off, val | 0, false); break;
    }
  }

  // 读：Bool 返回 boolean；字/双字返回 number
  SoftPLC.prototype.read = function (name) {
    var a = this.resolve(name);
    if (!a) return undefined;
    // FB 实例成员：读该实例的定时器/计数器状态
    if (a.kind === 'inst') {
      var st = this.timers[a.inst.key];
      if (!st) return 0;
      switch (a.member) {
        case 'Q': return !!st.q;
        case 'QU': return !!st.qu;
        case 'QD': return !!st.qd;
        case 'ET': return st.et !== undefined ? st.et : (st.acc || 0);
        case 'CV': return st.cnt || 0;
        case 'IN': return !!st.in;
        case 'PT': return st.pt || 0;
        default: return 0;
      }
    }
    var buf = this._buf(a);
    if (a.size === 'X') {
      if (a.kind === 'mem' && a.bit !== 0) return getBit(buf, a.off, a.bit);
      if (a.kind === 'db' && a.bit !== 0) return getBit(buf, a.off, a.bit);
      return getBit(buf, a.off, 0);
    }
    return readNumeric(buf, a.off, a.size);
  };

  SoftPLC.prototype.readBool = function (name) {
    var v = this.read(name);
    return typeof v === 'number' ? v !== 0 : !!v;
  };

  SoftPLC.prototype.write = function (name, val) {
    var a = this.resolve(name);
    if (!a) {
      // 写不进去以前是"静默失败"，线圈看起来就像没接上。
      // 这里留一条诊断，同一个名字只报一次，免得刷屏。
      this._writeMiss = this._writeMiss || {};
      var k = String(name);
      if (!this._writeMiss[k]) {
        this._writeMiss[k] = true;
        this.log('warning', '写入失败：无法解析操作数 "' + k + '"（检查变量表里是否有这个符号）');
      }
      return false;
    }
    // FB 实例成员是只读输出（Q/ET/CV…），不允许被线圈/指令写
    if (a.kind === 'inst') return false;
    var buf = this._buf(a);
    if (a.size === 'X') {
      var bit = a.bit || 0;
      setBit(buf, a.off, bit, !!val);
    } else {
      writeNumeric(buf, a.off, a.size, val);
    }
    return true;
  };

  SoftPLC.prototype.readRaw = function (addr) {
    // 直接按地址字符串读，不查符号
    var a = parseAddr(addr);
    if (!a) return undefined;
    var buf = this._buf(a);
    if (a.size === 'X') return getBit(buf, a.off, a.bit || 0);
    return readNumeric(buf, a.off, a.size);
  };

  SoftPLC.prototype.writeRaw = function (addr, val) {
    var a = parseAddr(addr);
    if (!a) return false;
    var buf = this._buf(a);
    if (a.size === 'X') setBit(buf, a.off, a.bit || 0, !!val);
    else writeNumeric(buf, a.off, a.size, val);
    return true;
  };

  /* ---------------- 第一次扫描初始化 ---------------- */
  SoftPLC.prototype.initOnce = function () {
    if (this._inited) return;
    this._inited = true;
    // 复位 Q 区
    this.mem.Q.fill(0);
    this.log('info', 'CPU 已切换到 RUN，开始循环扫描');
  };

  /* ---------------- LAD 求值 ---------------- */
  // 操作数读取：合法地址/符号取值，否则按字面量处理
  function readOperand(plc, ref, dflt) {
    if (ref === undefined || ref === null || ref === '') return dflt === undefined ? 0 : dflt;
    var s = String(ref).trim();
    if (s === '') return dflt === undefined ? 0 : dflt;
    // 布尔字面量
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    var v = plc.read(s);
    if (v !== undefined) return v;
    // 字面量（数字，可能带单位后缀）
    var n = parseFloat(s);
    if (!isNaN(n)) return n;
    return dflt === undefined ? 0 : dflt;
  }
  function readOperandBool(plc, ref) {
    var v = readOperand(plc, ref, false);
    return typeof v === 'number' ? v !== 0 : !!v;
  }

  // 判定单个元素是否导通（不含功率流），返回 {cond, draw}
  // 盒式指令统一交给 INSTR.runBox；触点/线圈在本文件内处理
  function evalElement(el, plc, key) {
    var I = (typeof window !== 'undefined' ? window.INSTR : (typeof globalThis !== 'undefined' ? globalThis.INSTR : null));
    if (!I) {
      // 指令目录未加载时的极简回退
      return { cond: el.type === 'NO' ? plc.readBool(el.operand) : true, draw: null };
    }
    var meta = I.info(el.type);
    var v, prev;

    switch (el.type) {
      case 'NO':
        return { cond: I.readB(plc, el, 'OPERAND'), draw: plc.read(el.operand) };
      case 'NC':
        return { cond: !I.readB(plc, el, 'OPERAND'), draw: plc.read(el.operand) };
      case 'P':
        v = I.readB(plc, el, 'OPERAND');
        prev = plc.edges[key] || false;
        plc.edges[key] = v;
        return { cond: v && !prev, draw: v };
      case 'N':
        v = I.readB(plc, el, 'OPERAND');
        prev = plc.edges[key] || false;
        plc.edges[key] = v;
        return { cond: !v && prev, draw: v };
      case 'EMPTY':
        return { cond: true, draw: null, empty: true };
    }

    if (meta && meta.kind === 'coil') {
      return { cond: true, draw: plc.read(el.operand), isCoil: true };
    }

    // 盒式指令：EN 由调用方传入（此处先返回 cond=true，由 execNetwork 控制 EN）
    return { cond: true, draw: null, isBox: true };
  }

  // 执行盒式指令（含 EN 门控）
  function execBox(el, plc, en, key, trace) {
    var I = (typeof window !== 'undefined' ? window.INSTR : (typeof globalThis !== 'undefined' ? globalThis.INSTR : null));
    if (!I) return { q: en, out: {} };
    var r = I.runBox(plc, el, en, key);
    // 输出写回规则：
    //  - 有状态指令（定时器/计数器/边沿）：即使 EN 为假也必须更新（复位 Q/ET），否则状态会卡住
    //  - 纯计算指令（数学/移动/转换）：EN 为假时不写，避免断电周期仍改写数据
    var meta = I.info(el.type);
    var stateful = !!(meta && meta.stateful) ||
      ['TON', 'TOF', 'TP', 'TONR', 'CTU', 'CTD', 'CTUD', 'PULSE',
        'RESET_TIMER', 'RESET_COUNTER'].indexOf(el.type) >= 0;
    if (r && r.out && (en || stateful)) {
      for (var k in r.out) {
        I.writeP(plc, el, k, r.out[k]);
      }
    }
    return r || { q: en, out: {} };
  }

  /* ---------------- 时间字面量 ----------------
   * 接受 TIA 写法与"只写单位"的简写，统一折算成毫秒：
   *   T#1s / T#500ms / T#1m30s / S5T#2h / LT#1d
   *   1s / 500ms / 1.5s / 2m（省略 T#，教学场景里很常见）
   *   1,5s（逗号当小数点）/ 纯数字（按毫秒）
   * 这样 PT 无论是 "T#5s" 还是 "5s"，定时器都能得到正确的 5000ms，
   * 而不会像旧实现那样把 "5s" 解析成 5ms（看起来"完全没有延时"）。
   * ------------------------------------------ */
  var TIME_UNIT = { D: 86400000, H: 3600000, M: 60000, S: 1000, MS: 1 };

  function timeBody(s) {
    var m = /^(?:T|TIME|S5T|LT|LTIME)#(.*)$/i.exec(s);
    return m ? m[1] : null;
  }

  function toMs(pt) {
    if (pt == null) return 0;
    if (typeof pt === 'number') return isFinite(pt) ? pt : 0;
    var s = String(pt).trim().replace(/\s+/g, '').replace(/，/g, ',').replace(/,/g, '.');
    if (!s) return 0;
    var body = timeBody(s);
    if (body === null) {
      // 纯数字：按毫秒（旧工程里 PT 可能存成 500）
      if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
      body = s;
    }
    if (!body) return 0;
    var re = /(\d+(?:\.\d+)?)(MS|D|H|M|S)/gi, total = 0, hit = false, m;
    while ((m = re.exec(body))) {
      total += parseFloat(m[1]) * TIME_UNIT[m[2].toUpperCase()];
      hit = true;
    }
    if (!hit) { var n = parseFloat(body); return isNaN(n) ? 0 : n; }
    return total;
  }

  // 毫秒 → 规范时间字面量（TIA 风格），用于回写/显示
  function msToTime(ms) {
    ms = Math.max(0, Math.round(ms || 0));
    if (ms === 0) return 'T#0ms';
    if (ms % 86400000 === 0) return 'T#' + (ms / 86400000) + 'd';
    if (ms % 3600000 === 0) return 'T#' + (ms / 3600000) + 'h';
    if (ms % 60000 === 0) return 'T#' + (ms / 60000) + 'm';
    if (ms % 1000 === 0) return 'T#' + (ms / 1000) + 's';
    if (ms < 1000) return 'T#' + ms + 'ms';
    // 1.5s / 1.234s 这类：秒 + 毫秒小数，去掉多余的 0
    var sec = (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return 'T#' + sec + 's';
  }

  // 任意时间写法 → 规范字面量（"5s" → "T#5s"）；无法识别时返回 ''
  function normTime(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isFinite(v) ? msToTime(v) : '';
    var s = String(v).trim();
    if (!s || !isTimeLiteral(s)) return '';
    return msToTime(toMs(s));
  }

  // 是否是可识别的时间写法（含 T# 或带时间单位）
  function isTimeLiteral(v) {
    if (v == null) return false;
    var s = String(v).trim().replace(/\s+/g, '').replace(/，/g, ',').replace(/,/g, '.');
    if (!s) return false;
    if (timeBody(s) !== null) return toMs(s) > 0 || /^(?:T|TIME|S5T|LT|LTIME)#\s*0*(?:ms|s|m|h|d)$/i.test(s);
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return true;
    return /^(?:\d+(?:\.\d+)?(?:ms|d|h|m|s))+$/i.test(s);
  }

  // 线圈类指令：出现在分支末尾时这一条分支就"收尾"了，不再往后汇合
  var COIL_TYPES = ['COIL', 'SET', 'RESET', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL'];

  // 线圈要写的目标：先试符号名 operand，符号表里没有就退回绝对地址 addr。
  // 这样即使变量表没同步 / 用户把符号名带引号写，置位、复位也不会静默失效。
  function coilTarget(plc, el) {
    var cands = [el.operand, el.addr];
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i] == null ? '' : String(cands[i]).trim();
      if (!s) continue;
      if (plc.resolve(s)) return s;
    }
    return el.operand || el.addr || '';
  }

  // 末端分支：以开口箭头（OPEN_END）或线圈收尾 —— 这类分支不汇合到右边，
  // 所以它的功率流不能并进下一列（否则开口分支会把电"漏"给后面的指令，
  // 表现为松开按钮后下一级定时器还在计数、看起来像自锁）
  function isTerminalBranch(br) {
    if (!br || !br.length) return true;
    var last = br[br.length - 1];
    if (!last) return true;
    return last.type === 'OPEN_END' || COIL_TYPES.indexOf(last.type) >= 0;
  }

  // 执行一个 LAD 网络
  // 网络结构: { columns: [ { branches: [ [el,el...], ... ] }, ... ] }
  // 盒式指令统一走 INSTR.runBox，EN=左侧功率流，输出参数写回，Q 决定右侧功率流
  SoftPLC.prototype.execNetwork = function (net, netIdx, blockName) {
    var plc = this;
    var trace = this.trace.net[netIdx] = { cols: [], elem: {}, pin: {} };
    var power = true; // 左侧母线
    var retFlag = false;

    /* ---- 引脚支路（V50）：计数器的 R / LD 可以接一条"母线 → 触点 → 引脚"的小支路。
     * 它不属于任何列/行，所以先单独走一遍：从母线（power = true）串过链上的触点，
     * 结果放进 plc._pinFlow[元件id:引脚名]，指令执行时直接取用。
     * 每遍扫描重算，链上触点的电位也写进 trace.elem，监视时能正常上色。 ---- */
    plc._pinFlow = {};
    for (var pc = 0; pc < net.columns.length; pc++) {
      var pcol = net.columns[pc];
      for (var pb = 0; pb < pcol.branches.length; pb++) {
        var pbr = pcol.branches[pb];
        for (var pe = 0; pe < pbr.length; pe++) {
          var pel = pbr[pe];
          if (!pel || !pel.pins) continue;
          for (var pn in pel.pins) {
            if (!Object.prototype.hasOwnProperty.call(pel.pins, pn)) continue;
            var chain = pel.pins[pn];
            if (!chain || !chain.length) continue;
            var pf = true;                       // 支路从左侧母线取电
            for (var pi = 0; pi < chain.length; pi++) {
              var ce = chain[pi];
              if (!ce || ce.type === 'EMPTY') continue;
              var cin = pf, cout = pf, cdraw = ce.operand ? plc.read(ce.operand) : null;
              if (ce.type === 'NO' || ce.type === 'NC' || ce.type === 'P' || ce.type === 'N') {
                var cr = evalElement(ce, plc,
                  blockName + ':pin:' + pn + ':' + pi + ':' + (ce.id || 'x'));
                cout = cin && cr.cond;
                cdraw = cr.draw;
              }
              trace.elem[ce.id || (pn + pi)] = { in: cin, out: cout, cond: cout, draw: cdraw };
              pf = cout;
            }
            plc._pinFlow[pel.id + ':' + pn] = pf;
            trace.pin[pel.id + ':' + pn] = pf;
          }
        }
      }
    }

    for (var c = 0; c < net.columns.length; c++) {
      var col = net.columns[c];
      var branchOut = [];
      var colTrace = { wires: [], verticals: [] };
      for (var b = 0; b < col.branches.length; b++) {
        var branch = col.branches[b];
        var p = power;
        var segTrace = [];
        for (var e = 0; e < branch.length; e++) {
          var el = branch[e];
          var key = blockName + ':' + netIdx + ':' + c + ':' + b + ':' + e + ':' + (el.id || 'x');
          var inp = p;
          var out = inp;
          var draw = null;
          var cond = true;

          if (el.type === 'EMPTY' || el.type === 'OPEN_END') {
            out = inp;   // 空位 / 开放分支的开口箭头：直通，不参与逻辑
          } else if (el.type === 'NO' || el.type === 'NC' || el.type === 'P' || el.type === 'N') {
            var r = evalElement(el, plc, key);
            cond = r.cond; draw = r.draw;
            out = inp && cond;
          } else if (el.type === 'COIL' || el.type === 'SET' || el.type === 'RESET' ||
            el.type === 'NEG_COIL' || el.type === 'POS_COIL' || el.type === 'NEG_EDGE_COIL') {
            // 线圈写谁：优先符号名（operand），符号表没同步时退回绝对地址（addr）。
            // 以前只认 operand，一旦符号名带引号/没进 plc.tags，write() 会静默返回 false，
            // 表现就是"置位线圈、复位线圈没反应"——这里必须兜住。
            var ctgt = coilTarget(plc, el);
            if (el.type === 'COIL') {
              plc.write(ctgt, inp);
            } else if (el.type === 'SET') {
              if (inp) plc.write(ctgt, true);         // 通一下电就置位，之后自己保持
            } else if (el.type === 'RESET') {
              if (inp) plc.write(ctgt, false);        // 通一下电就复位同名点位
            } else if (el.type === 'NEG_COIL') {
              plc.write(ctgt, !inp);
            } else if (el.type === 'POS_COIL' || el.type === 'NEG_EDGE_COIL') {
              var pk = key + ':ec';
              var pv = plc.edges[pk] || false;
              plc.edges[pk] = inp;
              if (el.type === 'POS_COIL' && inp && !pv) plc.write(ctgt, true);
              if (el.type === 'NEG_EDGE_COIL' && !inp && pv) plc.write(ctgt, true);
            }
            // 画面上要显示写完之后的状态（SET 刚置位就当拍变绿，不要慢一拍）
            draw = plc.read(ctgt);
            out = inp;
          } else if (el.type === 'CALL') {
            if (inp) plc.execFbCall(el, trace, key);
            out = inp;
          } else {
            // 通用盒式指令
            var br = execBox(el, plc, inp, key, trace);
            // 功率流判定：指令显式声明 q 时用它；否则 EN 直通 ENO（多数数据处理指令）
            out = (br && br.q !== undefined) ? !!br.q : inp;
            draw = (br && br.draw !== undefined) ? br.draw : null;
            if (br && br.ret) retFlag = true;
          }

          var trRec = { in: inp, out: out, cond: cond, draw: draw };
          trace.elem[el.id || key] = trRec;
          segTrace.push({ inp: inp, out: out, cond: cond, el: el });
          p = out;
        }
        branchOut.push(p);
        colTrace.wires.push({ in: power, out: p, segs: segTrace });
      }
      var colOut = false;
      if (col.branches.length <= 1) {
        // 单分支列：直接串到下一列（末列末端是开口箭头/线圈也一样，不影响右边封口）
        colOut = branchOut.length ? !!branchOut[0] : power;
      } else {
        // 多分支列：只有"真的汇合回来"的分支才算进列输出。
        // 开口分支（末尾 OPEN_END）和线圈收尾的分支不参与 OR —— 否则一条悬空支路
        // 就能把功率流带到右边，看上去像自锁。
        for (var i = 0; i < branchOut.length; i++) {
          if (isTerminalBranch(col.branches[i])) continue;
          if (branchOut[i]) colOut = true;
        }
      }
      if (col.branches.length === 0) colOut = power;
      colTrace.in = power;
      colTrace.out = colOut;
      trace.cols.push(colTrace);
      power = colOut;
      if (retFlag) break;
    }
    trace.final = power;
    return power;
  };

  SoftPLC.prototype.execFbCall = function (el, trace, key) {
    var fb = this._blocks ? this._blocks[el.blockName] : null;
    if (!fb || !fb.compiled) return;
    var instName = el.instance || ('inst_' + el.blockName);
    var scope = this.inst[instName] || (this.inst[instName] = {});
    var bind = el.params || {};
    var ctx = {
      plc: this,
      scope: scope,
      inputs: fb.interface, bind: bind, block: fb
    };
    // 绑定 IN，读实际值
    var env = { vars: {}, statics: scope };
    var iface = fb.interface;
    for (var i = 0; i < iface.inputs.length; i++) {
      var p = iface.inputs[i];
      var actualName = bind[p.name] || p.name;
      var v = this.read(actualName);
      env.vars[p.name] = (p.type === 'Bool') ? !!v : (v === undefined ? 0 : v);
    }
    for (var j = 0; j < iface.inouts.length; j++) {
      var q = iface.inouts[j];
      var an = bind[q.name] || q.name;
      var vv = this.read(an);
      env.vars[q.name] = q.type === 'Bool' ? !!vv : (vv || 0);
    }
    for (var t = 0; t < iface.temps.length; t++) env.vars[iface.temps[t].name] = iface.temps[t].type === 'Bool' ? false : 0;
    for (var s = 0; s < iface.statics.length; s++) {
      var sn = iface.statics[s].name;
      if (!(sn in scope)) scope[sn] = iface.statics[s].type === 'Bool' ? false : 0;
    }
    try {
      this.runStatements(fb.ast, env);
    } catch (err) {
      this.log('error', '调用 ' + el.blockName + ' 出错: ' + err.message);
    }
    for (var o = 0; o < iface.outputs.length; o++) {
      var op = iface.outputs[o];
      var target = bind[op.name] || op.name;
      this.write(target, env.vars[op.name]);
    }
    for (var io = 0; io < iface.inouts.length; io++) {
      var iop = iface.inouts[io];
      this.write(bind[iop.name] || iop.name, env.vars[iop.name]);
    }
    trace.elem[key] = { in: true, out: true, cond: true, fbCall: el.blockName };
  };

  /* ---------------- SCL 词法 ---------------- */
  var KW = {
    IF: 1, THEN: 1, ELSIF: 1, ELSE: 1, END_IF: 1, FOR: 1, TO: 1, BY: 1, DO: 1, END_FOR: 1,
    WHILE: 1, END_WHILE: 1, REPEAT: 1, UNTIL: 1, END_REPEAT: 1, RETURN: 1, BEGIN: 1, END: 1,
    AND: 1, OR: 1, XOR: 1, NOT: 1, MOD: 1, TRUE: 1, FALSE: 1,
    VAR: 1, VAR_INPUT: 1, VAR_OUTPUT: 1, VAR_IN_OUT: 1, VAR_TEMP: 1, VAR_STAT: 1, END_VAR: 1
  };

  function tokenize(src) {
    var out = [], i = 0, n = src.length, line = 1;
    while (i < n) {
      var ch = src[i];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
      // 注释
      if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (ch === '(' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === ')')) { if (src[i] === '\n') line++; i++; }
        i += 2; continue;
      }
      // 字符串
      if (ch === "'") {
        var s = ''; i++;
        while (i < n && src[i] !== "'") { s += src[i++]; }
        i++; out.push({ t: 'str', v: s, line: line }); continue;
      }
      // 数字
      if (/[0-9]/.test(ch)) {
        var num = '';
        while (i < n && /[0-9._]/.test(src[i])) { if (src[i] !== '_') num += src[i]; i++; }
        out.push({ t: 'num', v: parseFloat(num), line: line }); continue;
      }
      // 时间字面量 T#5s / S5T#...
      if (/[TtSs]#/.test(src.substr(i, 2)) || /^[A-Za-z]+#/.test(src.substr(i, 10))) {
        var m = /^(T|TIME|S5T|LT|LTIME)#([0-9A-Za-z._]+)/i.exec(src.substr(i));
        if (m) { out.push({ t: 'time', v: m[0], line: line }); i += m[0].length; continue; }
      }
      // 标识符 / 关键字
      if (/[A-Za-z_"]/.test(ch)) {
        var id = '';
        if (ch === '"') { i++; while (i < n && src[i] !== '"') id += src[i++]; i++; }
        else { while (i < n && /[A-Za-z0-9_.]/.test(src[i])) id += src[i++]; }
        var up = id.toUpperCase();
        out.push({ t: KW[up] ? 'kw' : 'id', v: KW[up] ? up : id, line: line });
        continue;
      }
      // 多字符运算符
      var three = src.substr(i, 3);
      if (three === '**=') { out.push({ t: 'op', v: '**=', line: line }); i += 3; continue; }
      var two = src.substr(i, 2);
      if ([':=', '<>', '<=', '>=', '**'].indexOf(two) >= 0) { out.push({ t: 'op', v: two, line: line }); i += 2; continue; }
      if ('+-*/=<>()[];,.:'.indexOf(ch) >= 0) { out.push({ t: 'op', v: ch, line: line }); i++; continue; }
      i++; // 忽略未知字符
    }
    out.push({ t: 'eof', v: null, line: line });
    return out;
  }

  /* ---------------- SCL 语法解析 ---------------- */
  function Parser(tokens) { this.ts = tokens; this.p = 0; }
  Parser.prototype.peek = function (k) { return this.ts[this.p + (k || 0)]; };
  Parser.prototype.next = function () { return this.ts[this.p++]; };
  Parser.prototype.isKw = function (v) { var t = this.peek(); return t && t.t === 'kw' && t.v === v; };
  Parser.prototype.isOp = function (v) { var t = this.peek(); return t && t.t === 'op' && t.v === v; };
  Parser.prototype.eatKw = function (v) { if (this.isKw(v)) { this.p++; return true; } return false; };
  Parser.prototype.eatOp = function (v) { if (this.isOp(v)) { this.p++; return true; } return false; };
  Parser.prototype.expectOp = function (v) {
    if (!this.eatOp(v)) throw new Error('语法错误：期望 "' + v + '" 但得到 "' + (this.peek() ? this.peek().v : 'EOF') + '" (行 ' + (this.peek() ? this.peek().line : '?') + ')');
  };

  // 语句块直到某个结束关键字
  Parser.prototype.parseStatements = function (terminators) {
    var list = [];
    while (true) {
      var t = this.peek();
      if (!t || t.t === 'eof') break;
      if (t.t === 'kw' && terminators.indexOf(t.v) >= 0) break;
      if (this.eatOp(';')) continue;
      list.push(this.parseStatement());
      this.eatOp(';');
    }
    return list;
  };

  Parser.prototype.parseStatement = function () {
    var t = this.peek();
    if (!t) throw new Error('意外结束');
    if (t.t === 'kw') {
      if (t.v === 'IF') return this.parseIf();
      if (t.v === 'FOR') return this.parseFor();
      if (t.v === 'WHILE') return this.parseWhile();
      if (t.v === 'REPEAT') return this.parseRepeat();
      if (t.v === 'RETURN') { this.next(); return { k: 'return' }; }
    }
    // 调用语句: name(args);
    if (t.t === 'id' && this.peek(1) && this.peek(1).t === 'op' && this.peek(1).v === '(') {
      // 可能是赋值给下标... 先试探：id( 
      var save = this.p;
      var callExpr = this.parseCallOrAssign();
      return callExpr;
    }
    var left = this.parseExpr();
    if (this.eatOp(':')) {
      // 类型声明残留，跳过
      if (this.peek() && this.peek().t === 'op' && this.peek().v === '=') this.next();
      return { k: 'empty' };
    }
    if (this.eatOp(':=')) {
      var right = this.parseExpr();
      return { k: 'assign', target: left, value: right, line: t.line };
    }
    return { k: 'expr', expr: left, line: t.line };
  };

  Parser.prototype.parseCallOrAssign = function () {
    var t = this.peek();
    var save = this.p;
    // 尝试解析成函数调用
    try {
      var e = this.parseExpr();
      return { k: 'expr', expr: e, line: t.line };
    } catch (err) {
      this.p = save;
      var left = this.parseExpr();
      if (this.eatOp(':=')) {
        return { k: 'assign', target: left, value: this.parseExpr(), line: t.line };
      }
      return { k: 'expr', expr: left, line: t.line };
    }
  };

  Parser.prototype.parseIf = function () {
    this.eatKw('IF');
    var branches = [];
    var cond = this.parseExpr();
    if (!this.eatKw('THEN')) throw new Error('IF 缺少 THEN (行 ' + this.peek().line + ')');
    var body = this.parseStatements(['ELSIF', 'ELSE', 'END_IF']);
    branches.push({ cond: cond, body: body });
    while (this.isKw('ELSIF')) {
      this.next();
      var c2 = this.parseExpr();
      if (!this.eatKw('THEN')) throw new Error('ELSIF 缺少 THEN');
      var b2 = this.parseStatements(['ELSIF', 'ELSE', 'END_IF']);
      branches.push({ cond: c2, body: b2 });
    }
    var elseBody = null;
    if (this.isKw('ELSE')) {
      this.next();
      elseBody = this.parseStatements(['END_IF']);
    }
    if (!this.eatKw('END_IF')) throw new Error('IF 缺少 END_IF (行 ' + this.peek().line + ')');
    this.eatOp(';');
    return { k: 'if', branches: branches, elseBody: elseBody };
  };

  Parser.prototype.parseFor = function () {
    this.eatKw('FOR');
    var v = this.next();
    var name = { k: 'name', name: v.v };
    this.expectOp(':=');
    var from = this.parseExpr();
    if (!this.eatKw('TO')) throw new Error('FOR 缺少 TO');
    var to = this.parseExpr();
    var by = null;
    if (this.eatKw('BY')) by = this.parseExpr();
    if (!this.eatKw('DO')) throw new Error('FOR 缺少 DO');
    var body = this.parseStatements(['END_FOR']);
    if (!this.eatKw('END_FOR')) throw new Error('FOR 缺少 END_FOR');
    this.eatOp(';');
    return { k: 'for', name: name, from: from, to: to, by: by, body: body };
  };

  Parser.prototype.parseWhile = function () {
    this.eatKw('WHILE');
    var cond = this.parseExpr();
    if (!this.eatKw('DO')) throw new Error('WHILE 缺少 DO');
    var body = this.parseStatements(['END_WHILE']);
    if (!this.eatKw('END_WHILE')) throw new Error('WHILE 缺少 END_WHILE');
    this.eatOp(';');
    return { k: 'while', cond: cond, body: body };
  };

  Parser.prototype.parseRepeat = function () {
    this.eatKw('REPEAT');
    var body = this.parseStatements(['UNTIL']);
    if (!this.eatKw('UNTIL')) throw new Error('REPEAT 缺少 UNTIL');
    var cond = this.parseExpr();
    if (!this.eatKw('END_REPEAT')) throw new Error('REPEAT 缺少 END_REPEAT');
    this.eatOp(';');
    return { k: 'repeat', cond: cond, body: body };
  };

  /* 表达式：优先级 低→高
     OR/XOR -> AND -> NOT -> 比较 -> 加减 -> 乘除/MOD -> 一元 -> 主 */
  Parser.prototype.parseExpr = function () { return this.parseOr(); };
  Parser.prototype.parseOr = function () {
    var l = this.parseXor();
    while (this.isKw('OR') || this.isOp('|')) {
      this.next();
      l = { k: 'bin', op: 'OR', l: l, r: this.parseXor() };
    }
    return l;
  };
  Parser.prototype.parseXor = function () {
    var l = this.parseAnd();
    while (this.isKw('XOR')) { this.next(); l = { k: 'bin', op: 'XOR', l: l, r: this.parseAnd() }; }
    return l;
  };
  Parser.prototype.parseAnd = function () {
    var l = this.parseNot();
    while (this.isKw('AND') || this.isOp('&')) {
      this.next();
      l = { k: 'bin', op: 'AND', l: l, r: this.parseNot() };
    }
    return l;
  };
  Parser.prototype.parseNot = function () {
    if (this.isKw('NOT')) { this.next(); return { k: 'un', op: 'NOT', e: this.parseNot() }; }
    if (this.isOp('-')) { this.next(); return { k: 'un', op: '-', e: this.parseNot() }; }
    if (this.isOp('+')) { this.next(); return this.parseNot(); }
    return this.parseCompare();
  };
  Parser.prototype.parseCompare = function () {
    var l = this.parseAdd();
    while (this.peek() && this.peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(this.peek().v) >= 0) {
      var op = this.next().v;
      l = { k: 'bin', op: op, l: l, r: this.parseAdd() };
    }
    return l;
  };
  Parser.prototype.parseAdd = function () {
    var l = this.parseMul();
    while (this.peek() && this.peek().t === 'op' && ['+', '-'].indexOf(this.peek().v) >= 0) {
      var op = this.next().v;
      l = { k: 'bin', op: op, l: l, r: this.parseMul() };
    }
    return l;
  };
  Parser.prototype.parseMul = function () {
    var l = this.parseUnary();
    while (true) {
      var t = this.peek();
      var op = null;
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) { op = t.v; this.next(); }
      else if (t && t.t === 'kw' && t.v === 'MOD') { op = 'MOD'; this.next(); }
      else break;
      l = { k: 'bin', op: op, l: l, r: this.parseUnary() };
    }
    return l;
  };
  Parser.prototype.parseUnary = function () {
    if (this.isOp('(')) {
      // 可能是函数调用 name(...) 已由 id 处理
      this.next();
      var e = this.parseExpr();
      this.expectOp(')');
      return e;
    }
    return this.parsePrimary();
  };
  Parser.prototype.parsePrimary = function () {
    var t = this.next();
    if (!t) throw new Error('表达式意外结束');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'time') return { k: 'text', v: t.v };
    if (t.t === 'str') return { k: 'text', v: t.v };
    if (t.t === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) return { k: 'bool', v: t.v === 'TRUE' };
    if (t.t === 'op' && t.v === '(') {
      var e = this.parseExpr();
      this.expectOp(')');
      return e;
    }
    if (t.t === 'id' || t.t === 'kw') {
      var name = t.v;
      // 函数调用 / 带命名参数的调用
      if (this.isOp('(')) {
        return this.parseCallArgs(name);
      }
      return { k: 'name', name: name };
    }
    throw new Error('无法解析的记号 "' + t.v + '" (行 ' + t.line + ')');
  };

  Parser.prototype.parseCallArgs = function (name) {
    this.expectOp('(');
    var args = [], named = {};
    while (!this.isOp(')') && this.peek().t !== 'eof') {
      // 判断是否 命名参数 := 
      var save = this.p;
      var isNamed = false;
      if (this.peek().t === 'id' && this.peek(1) && this.peek(1).t === 'op' && this.peek(1).v === ':=') {
        var pname = this.next().v;
        this.next(); // :=
        named[pname] = this.parseExpr();
        isNamed = true;
      }
      if (!isNamed) {
        args.push(this.parseExpr());
      }
      if (!this.isOp(',')) break;
      this.next();
    }
    this.expectOp(')');
    return { k: 'call', name: name, args: args, named: named };
  };

  /* ---------------- SCL 声明解析 ---------------- */
  function parseInterface(src) {
    var iface = { inputs: [], outputs: [], inouts: [], statics: [], temps: [] };
    var re = /VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT)?(\s[\s\S]*?)END_VAR/gi;
    var m;
    while ((m = re.exec(src))) {
      var kind = (m[1] || '_STAT').replace(/^_/, '').toUpperCase();
      var body = m[2];
      var lines = body.split(/;/);
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\/\/.*$/gm, '').trim();
        if (!ln) continue;
        var dm = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(ln);
        if (!dm) continue;
        var item = { name: dm[1], type: dm[2] };
        if (kind === 'INPUT') iface.inputs.push(item);
        else if (kind === 'OUTPUT') iface.outputs.push(item);
        else if (kind === 'IN_OUT') iface.inouts.push(item);
        else if (kind === 'STAT') iface.statics.push(item);
        else if (kind === 'TEMP') iface.temps.push(item);
      }
    }
    return iface;
  }

  function stripDeclaration(src) {
    // 去掉 VAR..END_VAR 与 FUNC 头，取 BEGIN 之后主体
    var idx = src.search(/\bBEGIN\b/i);
    if (idx >= 0) return src.slice(idx + 5);
    // 没有 BEGIN：去掉声明块
    return src.replace(/VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT)?[\s\S]*?END_VAR/gi, '');
  }

  function compileScl(src) {
    var iface = parseInterface(src);
    var bodySrc = stripDeclaration(src);
    var toks = tokenize(bodySrc);
    var p = new Parser(toks);
    var stmts = p.parseStatements([]);
    return { interface: iface, ast: stmts, compiled: true, error: null };
  }

  /* ---------------- SCL 解释执行 ---------------- */
  SoftPLC.prototype.runStatements = function (stmts, env) {
    for (var i = 0; i < stmts.length; i++) {
      var r = this.execStmt(stmts[i], env);
      if (r === 'return') return 'return';
    }
    return null;
  };

  SoftPLC.prototype.execStmt = function (s, env) {
    var self = this;
    switch (s.k) {
      case 'assign':
        var val = self.evalExpr(s.value, env);
        self.assignTo(s.target, val, env);
        return null;
      case 'expr': {
        var v = self.evalExpr(s.expr, env);
        return null;
      }
      case 'if': {
        for (var i = 0; i < s.branches.length; i++) {
          if (truthy(self.evalExpr(s.branches[i].cond, env))) {
            return self.runStatements(s.branches[i].body, env);
          }
        }
        if (s.elseBody) return self.runStatements(s.elseBody, env);
        return null;
      }
      case 'for': {
        var from = num(self.evalExpr(s.from, env));
        var to = num(self.evalExpr(s.to, env));
        var by = s.by ? num(self.evalExpr(s.by, env)) : 1;
        if (by === 0) by = 1;
        var cnt = 0;
        for (var ix = from; (by > 0 ? ix <= to : ix >= to); ix += by) {
          env.vars[s.name.name] = ix;
          var r = self.runStatements(s.body, env);
          if (r === 'return') return 'return';
          if (++cnt > 100000) throw new Error('FOR 循环次数超限，疑似死循环');
        }
        return null;
      }
      case 'while': {
        var guard = 0;
        while (truthy(self.evalExpr(s.cond, env))) {
          var r2 = self.runStatements(s.body, env);
          if (r2 === 'return') return 'return';
          if (++guard > 100000) throw new Error('WHILE 循环次数超限，疑似死循环');
        }
        return null;
      }
      case 'repeat': {
        var g2 = 0;
        do {
          var r3 = self.runStatements(s.body, env);
          if (r3 === 'return') return 'return';
          if (++g2 > 100000) throw new Error('REPEAT 循环次数超限');
        } while (!truthy(self.evalExpr(s.cond, env)));
        return null;
      }
      case 'return':
        return 'return';
      default:
        return null;
    }
  };

  SoftPLC.prototype.assignTo = function (target, val, env) {
    if (target.k === 'name') {
      var n = target.name;
      if (n in env.vars) { env.vars[n] = val; return; }
      if (env.statics && (n in env.statics)) { env.statics[n] = val; return; }
      // 落到 PLC 地址/符号
      this.write(n, val);
      env.vars[n] = val;
      return;
    }
    throw new Error('赋值目标无效');
  };

  SoftPLC.prototype.evalExpr = function (e, env) {
    var self = this;
    switch (e.k) {
      case 'num': return e.v;
      case 'bool': return e.v;
      case 'text': return e.v;
      case 'name': {
        var n = e.name;
        if (n in env.vars) return env.vars[n];
        if (env.statics && (n in env.statics)) return env.statics[n];
        var v = self.read(n);
        if (v === undefined) {
          // 未声明的标识符按 0 处理
          return 0;
        }
        return v;
      }
      case 'un': {
        var a = self.evalExpr(e.e, env);
        if (e.op === 'NOT') return !truthy(a);
        if (e.op === '-') return -num(a);
        return a;
      }
      case 'bin': {
        var l = self.evalExpr(e.l, env);
        if (e.op === 'AND') return truthy(l) && truthy(self.evalExpr(e.r, env));
        if (e.op === 'OR') return truthy(l) || truthy(self.evalExpr(e.r, env));
        if (e.op === 'XOR') return truthy(l) !== truthy(self.evalExpr(e.r, env));
        var r = self.evalExpr(e.r, env);
        switch (e.op) {
          case '+': return num(l) + num(r);
          case '-': return num(l) - num(r);
          case '*': return num(l) * num(r);
          case '/': return num(r) === 0 ? 0 : num(l) / num(r);
          case 'MOD': return num(r) === 0 ? 0 : num(l) % num(r);
          case '=': return eq(l, r);
          case '<>': return !eq(l, r);
          case '<': return num(l) < num(r);
          case '>': return num(l) > num(r);
          case '<=': return num(l) <= num(r);
          case '>=': return num(l) >= num(r);
        }
        return 0;
      }
      case 'call':
        return self.evalCall(e, env);
      default:
        return 0;
    }
  };

  SoftPLC.prototype.evalCall = function (e, env) {
    var name = String(e.name).toUpperCase();
    var args = {}, self = this;
    // 位置参数
    var pos = ['IN', 'PT', 'PV', 'CV'];
    for (var i = 0; i < e.args.length; i++) {
      args[pos[i] || ('A' + i)] = self.evalExpr(e.args[i], env);
    }
    for (var k in e.named) args[k.toUpperCase()] = self.evalExpr(e.named[k], env);

    // 内置：ABS MIN MAX LIMIT
    if (name === 'ABS') return Math.abs(num(args.IN !== undefined ? args.IN : args.A0));
    if (name === 'MIN') return Math.min(num(args.IN1 || 0), num(args.IN2 || 0));
    if (name === 'MAX') return Math.max(num(args.IN1 || 0), num(args.IN2 || 0));
    if (name === 'SQR') return Math.sqrt(num(args.IN || 0));
    if (name === 'TRUNC') return Math.trunc(num(args.IN || 0));

    // 定时器实例
    var st = this.timers['scl:' + e.name];
    if (name === 'TON' || name === 'TOF' || name === 'TP') {
      if (!st) st = this.timers['scl:' + e.name] = { start: null, q: false, et: 0 };
      var inV = !!args.IN, pt = toMs(args.PT);
      if (name === 'TON') {
        if (inV) {
          if (st.start === null) st.start = this.clock;
          st.et = Math.min(this.clock - st.start, pt);
          st.q = st.et >= pt;
        } else { st.start = null; st.et = 0; st.q = false; }
      } else if (name === 'TOF') {
        if (inV) { st.start = null; st.et = 0; st.q = true; }
        else {
          if (st.start === null) st.start = this.clock;
          st.et = Math.min(this.clock - st.start, pt);
          st.q = st.et < pt;
        }
      } else {
        if (inV && !st.prev) { st.start = this.clock; st.q = true; }
        st.prev = inV;
        if (st.start !== null) {
          st.et = this.clock - st.start;
          if (st.et >= pt) { st.q = false; st.start = null; }
        }
      }
      var bt = this.inst[e.name + '_TON'] || (this.inst[e.name + '_TON'] = {});
      bt.Q = st.q; bt.ET = st.et;
      this.mem._ton = this.mem._ton || {};
      return st.q;
    }
    if (name === 'CTU') {
      if (!st) st = this.timers['scl:' + e.name] = { cnt: 0, q: false, prev: false };
      var cu = !!args.CU;
      if (cu && !st.prev) st.cnt++;
      st.prev = cu;
      var pv = num(args.PV || 10);
      if (args.R) st.cnt = 0;
      st.q = st.cnt >= pv;
      var bt2 = this.inst[e.name + '_CTU'] || (this.inst[e.name + '_CTU'] = {});
      bt2.CV = st.cnt; bt2.Q = st.q;
      return st.cnt;
    }
    // 用户块调用（SCL 内调用 FB/FC）
    var blk = this._blocks ? this._blocks[e.name] : (this._blocks ? this._blocks[name] : null);
    if (blk && blk.compiled) {
      var scope = this.inst['inst:' + e.name] || (this.inst['inst:' + e.name] = {});
      var env2 = { vars: {}, statics: scope };
      var bi = blk.interface;
      for (var a = 0; a < bi.inputs.length; a++) {
        var pn = bi.inputs[a].name;
        env2.vars[pn] = args[pn.toUpperCase()] !== undefined ? args[pn.toUpperCase()] : 0;
      }
      for (var c = 0; c < bi.statics.length; c++) {
        var sn = bi.statics[c].name;
        if (!(sn in scope)) scope[sn] = bi.statics[c].type === 'Bool' ? false : 0;
      }
      this.runStatements(blk.ast, env2);
      var ret = env2.vars[blk.returnName] !== undefined ? env2.vars[blk.returnName] : 0;
      return ret;
    }
    return 0;
  };

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return !!v;
  }
  function num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function eq(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
    return num(a) === num(b);
  }

  /* ---------------- 编译检查 ---------------- */
  function PLC_compileSclInto(blk) {
    var r = compileScl(blk.source);
    blk.interface = r.interface;
    blk.ast = r.ast;
    blk.compiled = true;
    blk.returnName = 'RET_VAL';
    return blk;
  }

  function compileProject(project) {
    var diags = [];
    var blocks = project.blocks;
    var blkMap = {};
    for (var i = 0; i < blocks.length; i++) blkMap[blocks[i].name] = blocks[i];
    // 全项目的 FB 实例索引（实例名 → 指令类型/DB 号）
    // 触点/线圈/参数里写的 "name".Q 这类成员引用要靠它判定合法性
    var insts = instIndex(project);

    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var name = blk.name;
      if (blk.lang === 'SCL') {
        try {
          var r = compileScl(blk.source);
          blk.interface = r.interface;
          blk.ast = r.ast;
          blk.compiled = true;
          blk.returnName = 'RET_VAL';
        } catch (err) {
          blk.compiled = false;
          blk.ast = null;
          diags.push(mkDiag('error', name, err.message));
        }
      } else {
        // LAD
        blk.interface = blk.interface || { inputs: [], outputs: [], inouts: [], statics: [], temps: [] };        blk.compiled = true;
        var netCount = (blk.networks || []).length;
        if (netCount === 0) diags.push(mkDiag('warning', name, '块中没有任何网络'));
        for (var n = 0; n < netCount; n++) {
          var net = blk.networks[n];
          var colCount = net.columns.length;
          if (colCount === 0) {
            diags.push(mkDiag('warning', name + ' / 网络 ' + (n + 1), '网络为空'));
            continue;
          }
          var hasCoil = false;
          for (var c = 0; c < colCount; c++) {
            var col = net.columns[c];
            for (var br = 0; br < col.branches.length; br++) {
              var branch = col.branches[br];
              for (var e = 0; e < branch.length; e++) {
                var el = branch[e];
                if (['COIL', 'SET', 'RESET', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL',
                  'MOVE', 'MOVE_BLK', 'FILL_BLK', 'CALL'].indexOf(el.type) >= 0) hasCoil = true;
                // 通用盒式指令：有输出参数也算有输出
                if (typeof window !== 'undefined' && window.INSTR) {
                  var im = window.INSTR.info(el.type);
                  if (im && im.kind === 'box') {
                    var hasOut = (im.params || []).some(function (pp) { return pp.dir === 'out'; });
                    if (hasOut) hasCoil = true;
                  }
                }
                if (['NO', 'NC', 'COIL', 'SET', 'RESET', 'P', 'N'].indexOf(el.type) >= 0) {
                  checkOperand(project, el, name + ' / 网络 ' + (n + 1), insts, diags);
                }
                /* 引脚支路（计数器 R / LD 端接的触点）：它们不在列/行里，
                   但操作数一样要校验，否则下载时"地址写错"不会报错。 */
                if (el && el.pins) {
                  for (var pk in el.pins) {
                    if (!Object.prototype.hasOwnProperty.call(el.pins, pk)) continue;
                    var pch = el.pins[pk] || [];
                    for (var pj = 0; pj < pch.length; pj++) {
                      var pce = pch[pj];
                      if (pce && ['NO', 'NC', 'P', 'N'].indexOf(pce.type) >= 0) {
                        checkOperand(project, pce,
                          name + ' / 网络 ' + (n + 1) + ' / ' + pk + ' 端支路', insts, diags);
                      }
                    }
                  }
                }
                // 比较指令：盒体下方那个数字要能跟关联值比（类型/范围）
                if (el.type && el.type.indexOf('CMP') === 0 &&
                  typeof window !== 'undefined' && window.INSTR && window.INSTR.cmpInfo) {
                  var ci = window.INSTR.cmpInfo(el, project);
                  if (ci && ci.red) {
                    diags.push(mkDiag('error', name + ' / 网络 ' + (n + 1),
                      '比较指令 ' + el.type + '：' + ci.msg));
                  }
                }
                if (el.type === 'CALL') {
                  var tgt = blkMap[el.blockName];
                  if (!tgt) diags.push(mkDiag('error', name + ' / 网络 ' + (n + 1), '调用的块 "' + el.blockName + '" 不存在'));
                  else if (!tgt.compiled) diags.push(mkDiag('error', name + ' / 网络 ' + (n + 1), '被调用的块 "' + el.blockName + '" 编译失败'));
                }
                  if (['MATH', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'MIN', 'MAX', 'LIMIT', 'SHL', 'SHR',
                    'ROL', 'ROR', 'AND_W', 'OR_W', 'XOR_W', 'T_ADD', 'T_SUB', 'T_DIFF',
                    'CONCAT', 'LEFT', 'RIGHT', 'MID', 'FIND', 'EQ_STR', 'NE_STR', 'MOVE_BLK', 'FILL_BLK'].indexOf(el.type) >= 0) {
                    // 这些指令要求操作数可解析
                    var prms = (typeof window !== 'undefined' && window.INSTR) ? window.INSTR.info(el.type) : null;
                    if (prms && prms.params) {
                      prms.params.forEach(function (pd) {
                        if (pd.dir === 'out') return;
                        var val = (el.params && el.params[pd.n] !== undefined)
                          ? el.params[pd.n]
                          : (pd.n === 'IN1' ? (el.src1 || el.operand) : (pd.n === 'IN2' ? (el.src2 || el.operand2) : undefined));
                        if (val !== undefined && val !== '' && !isResolvableRef(project, val, insts)) {
                          diags.push(mkDiag('error', name + ' / 网络 ' + (n + 1),
                            '指令 ' + el.type + ' 的操作数 ' + pd.n + '="' + val + '" 未定义'));
                        }
                      });
                    }
                  }
              }
            }
          }
          if (!hasCoil) diags.push(mkDiag('warning', name + ' / 网络 ' + (n + 1), '网络中没有线圈输出（可能出现空操作）'));
        }
      }
    }
    // 检查 OB1 存在
    var hasOb1 = blocks.some(function (x) { return x.name === 'OB1' || x.obNumber === 1; });
    if (!hasOb1) diags.push(mkDiag('error', project.name, '缺少主程序 OB1，无法下载'));
    return diags;
  }

  function isTag(project, name) {
    for (var i = 0; i < project.tags.length; i++) if (project.tags[i].name === name) return true;
    return false;
  }

  // 取指令目录（INSTR）
  function ins() {
    return (typeof window !== 'undefined' ? window.INSTR
      : (typeof globalThis !== 'undefined' ? globalThis.INSTR : null));
  }

  // 全项目的 FB 实例索引：实例名 → { type, db, block, el }
  // （TON/TOF/CTU… 的实例数据块字段就是通过它被触点/线圈引用的）
  function instIndex(project) {
    var idx = {};
    var I = ins();
    var blocks = (project && project.blocks) || [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.lang !== 'LAD' || !blk.networks) continue;
      for (var n = 0; n < blk.networks.length; n++) {
        var net = blk.networks[n] || {};
        var cols = net.columns || [];
        for (var c = 0; c < cols.length; c++) {
          var brs = cols[c].branches || [];
          for (var r = 0; r < brs.length; r++) {
            var branch = brs[r] || [];
            for (var e = 0; e < branch.length; e++) {
              var el = branch[e];
              if (!el || !el.instance || !el.type) continue;
              var meta = I ? I.info(el.type) : null;
              if (!meta || !meta.fb) continue;
              idx[String(el.instance).trim()] = {
                type: el.type, db: el.db, block: blk.name, el: el
              };
            }
          }
        }
      }
    }
    return idx;
  }

  // 实例数据块成员的数据类型（bool 触点只能接 Bool 成员）
  function instanceMemberType(type, member) {
    var m = String(member || '').toUpperCase();
    var I = ins();
    var meta = I ? I.info(type) : null;
    if (m === 'PT' || m === 'ET') return (meta && meta.group === 'timer') ? 'Time' : 'Int';
    if (m === 'PV' || m === 'CV') return 'Int';
    return 'Bool';
  }

  // 解析 "name".MEMBER → { inst, member, type } | { inst, member, bad:true } | null
  function resolveInstMember(project, ref, insts) {
    var m = RE_INST.exec(String(ref).trim());
    if (!m) return null;
    var idx = insts || instIndex(project);
    var rec = idx[m[1].trim()];
    if (!rec) return null;
    var member = m[2].toUpperCase();
    var I = ins();
    var meta = I ? I.info(rec.type) : null;
    var ok = false;
    ((meta && meta.params) || []).forEach(function (p) {
      if (String(p.n).toUpperCase() === member) ok = true;
    });
    if (!ok) return { inst: rec, member: member, bad: true };
    return { inst: rec, member: member, type: instanceMemberType(rec.type, member) };
  }

  // 触点/线圈操作数检查：地址、符号、字面量，以及 "name".MEMBER 实例成员
  function checkOperand(project, el, where, insts, diags) {
    // 符号名没同步过来时，线圈至少还有绝对地址可以用（与线圈执行时的回退一致）
    var op = (el.operand !== undefined && el.operand !== null && String(el.operand).trim() !== '')
      ? el.operand : el.addr;
    if (op === undefined || op === null || String(op).trim() === '') {
      diags.push(mkDiag('error', where, '元素 "' + el.type + '" 缺少操作数'));
      return;
    }
    var s = String(op).trim();
    var isContact = ['NO', 'NC', 'P', 'N'].indexOf(el.type) >= 0;
    // 实例数据块成员引用（"TON_DB".Q）——先于普通符号判定
    if (!parseAddr(s) && RE_INST.test(s)) {
      var r = resolveInstMember(project, s, insts);
      if (!r) {
        diags.push(mkDiag('error', where,
          '未定义的符号 "' + s + '"（没有名为 "' + RE_INST.exec(s)[1].trim() + '" 的实例数据块）'));
        return;
      }
      if (r.bad) {
        var I0 = ins();
        var mm = I0 ? I0.info(r.inst.type) : null;
        var names = ((mm && mm.params) || []).map(function (p) { return p.n; }).join(' / ');
        diags.push(mkDiag('error', where,
          '实例 "' + RE_INST.exec(s)[1].trim() + '" 没有成员 ' + r.member +
          (names ? '（可用：' + names + '）' : '')));
        return;
      }
      if (r.type !== 'Bool') {
        diags.push(mkDiag('error', where,
          (isContact ? '触点' : '线圈') + '操作数 "' + s + '" 的类型是 ' + r.type +
          '，不是 Bool' + (isContact ? '（要取定时器输出请用 "' + RE_INST.exec(s)[1].trim() + '".Q）' : '')));
        return;
      }
      // 实例成员是定时器/计数器的运行状态，只读
      if (!isContact) {
        diags.push(mkDiag('error', where, '实例数据块成员 "' + s + '" 是只读输出，不能用线圈 / SET / RESET 赋值'));
      }
      return;
    }
    if (!isResolvableOperand(project, s)) {
      diags.push(mkDiag('error', where, '未定义的符号 "' + s + '"'));
    }
  }

  // 操作数是否为可解析引用（地址 / 符号 / 布尔或数字字面量）
  function isResolvableOperand(project, op) {
    if (op === undefined || op === null || String(op).trim() === '') return false;
    var s = String(op).trim();
    if (/^(true|false)$/i.test(s)) return true;
    if (!isNaN(parseFloat(s)) && /^-?[\d.]+$/.test(s)) return true;
    if (parseAddr(s)) return true;
    if (isTag(project, s)) return true;
    // "Tag_6" 这种带引号的符号名（TIA 的写法），去引号再认一次
    if (s.length > 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      var q = s.slice(1, -1).trim();
      if (q) return isResolvableOperand(project, q);
    }
    return false;
  }

  // 可解析引用（含 "name".MEMBER 实例成员）
  function isResolvableRef(project, op, insts) {
    if (isResolvableOperand(project, op)) return true;
    var s = String(op == null ? '' : op).trim();
    if (!s || parseAddr(s) || !RE_INST.test(s)) return false;
    var r = resolveInstMember(project, s, insts);
    return !!(r && !r.bad);
  }

  function mkDiag(level, where, text) {
    return { level: level, where: where, text: text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) };
  }

  /* ---------------- 系统存储器字节 + 时钟存储器字节 ---------------- */
  // 真实 TIA 的 CPU 属性里是两个独立配置：
  //   系统存储器字节：4 个固定功能位
  //     位 0  首次循环（FirstScan）
  //     位 1  诊断状态已更改
  //     位 2  始终为 1（高电平）
  //     位 3  始终为 0（低电平）
  //   时钟存储器字节：8 个不同频率的方波位
  var CLOCK_BITS = [
    { bit: 0, periodMs: 100 },    // 10 Hz
    { bit: 1, periodMs: 200 },    // 5 Hz
    { bit: 2, periodMs: 400 },    // 2.5 Hz
    { bit: 3, periodMs: 500 },    // 2 Hz
    { bit: 4, periodMs: 1000 },   // 1 Hz
    { bit: 5, periodMs: 2000 },   // 0.5 Hz
    { bit: 6, periodMs: 1600 },   // 0.625 Hz
    { bit: 7, periodMs: 3200 }    // 0.3125 Hz
  ];

  var SYS_BITS = [
    { bit: 0, key: 'firstScan', name: '首次循环' },
    { bit: 1, key: 'diagChanged', name: '诊断状态已更改' },
    { bit: 2, key: 'always1', name: '始终为 1（高电平）' },
    { bit: 3, key: 'always0', name: '始终为 0（低电平）' }
  ];

  // 每周期刷新系统存储器位 + 时钟位（覆盖用户程序写入，与真机一致）
  SoftPLC.prototype.updateSystemMemory = function () {
    // ---- 系统存储器字节 ----
    var sm = this.systemMemory;
    if (sm && sm.enabled) {
      var sb = sm.byte == null ? 0 : sm.byte;
      // 首次循环：只有 RUN 后的第一个周期为 1
      setBit(this.mem.M, sb, 0, !!this._firstScan);
      // 诊断状态已更改：诊断缓冲区条目数变化时置 1 一个周期
      var diagCount = this.logs.length;
      var changed = (this._lastDiagCount !== undefined && this._lastDiagCount !== diagCount);
      setBit(this.mem.M, sb, 1, changed);
      this._lastDiagCount = diagCount;
      // 始终为 1 / 始终为 0
      setBit(this.mem.M, sb, 2, true);
      setBit(this.mem.M, sb, 3, false);
    }
    // ---- 时钟存储器字节 ----
    var cm = this.clockMemory;
    if (cm && cm.enabled) {
      var cb2 = cm.byte == null ? 0 : cm.byte;
      for (var i = 0; i < CLOCK_BITS.length; i++) {
        var cb = CLOCK_BITS[i];
        var half = cb.periodMs / 2;
        var phase = this.clock % cb.periodMs;
        setBit(this.mem.M, cb2, cb.bit, phase < half);
      }
    }
  };

  // 兼容旧接口
  SoftPLC.prototype.updateClockMemory = function () {
    this.updateSystemMemory();
  };

  SoftPLC.prototype.setClockMemory = function (enabled, byteAddr) {
    this.clockMemory = { enabled: !!enabled, byte: byteAddr == null ? 0 : byteAddr };
  };

  SoftPLC.prototype.setSystemMemory = function (enabled, byteAddr) {
    this.systemMemory = { enabled: !!enabled, byte: byteAddr == null ? 0 : byteAddr };
  };

  // 给变量表用：系统存储器位清单
  SoftPLC.getSystemTagList = function (byteAddr) {
    var b = byteAddr == null ? 0 : byteAddr;
    return SYS_BITS.map(function (sb) {
      return {
        name: 'SysMem_' + sb.key,
        address: 'M' + b + '.' + sb.bit,
        datatype: 'Bool',
        comment: '系统存储器 ' + sb.name,
        isSystem: true
      };
    });
  };

  // 给变量表用：时钟存储器位清单
  SoftPLC.getClockTagList = function (byteAddr) {
    var b = byteAddr == null ? 0 : byteAddr;
    var names = ['10Hz', '5Hz', '2.5Hz', '2Hz', '1Hz', '0.5Hz', '0.625Hz', '0.3125Hz'];
    return CLOCK_BITS.map(function (cb, i) {
      return {
        name: 'Clock_' + names[i].replace(/\./g, '_'),
        address: 'M' + b + '.' + cb.bit,
        datatype: 'Bool',
        comment: '时钟存储器 ' + names[i],
        isClock: true
      };
    });
  };

  // 频率/地址对照表（属性页用）
  SoftPLC.CLOCK_TABLE = [
    { bit: 0, freq: '10 Hz', period: '100 ms' },
    { bit: 1, freq: '5 Hz', period: '200 ms' },
    { bit: 2, freq: '2.5 Hz', period: '400 ms' },
    { bit: 3, freq: '2 Hz', period: '500 ms' },
    { bit: 4, freq: '1 Hz', period: '1 s' },
    { bit: 5, freq: '0.5 Hz', period: '2 s' },
    { bit: 6, freq: '0.625 Hz', period: '1.6 s' },
    { bit: 7, freq: '0.3125 Hz', period: '3.2 s' }
  ];

  SoftPLC.SYS_TABLE = SYS_BITS;

  /* ---------------- 扫描周期 ---------------- */
  SoftPLC.prototype.step = function (project) {
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.initOnce();
    this._blocks = {};
    for (var i = 0; i < project.blocks.length; i++) {
      var bb = project.blocks[i];
      // 未编译的块自动编译一次（对应下载后 CPU 内的编译产物）
      if (!bb.compiled && bb.lang === 'SCL' && !bb.ast) {
        try { PLC_compileSclInto(bb); } catch (e) { /* 编译错误由诊断面板呈现 */ }
      }
      this._blocks[bb.name] = bb;
    }

    this.cycleCount++;
    // 强制表生效
    for (var f in this.forced) this.write(f, this.forced[f]);

    // 首次循环标志：cycleCount 已在函数开头自增，这里判断是否为 RUN 后的第一周期
    this._firstScan = (this.cycleCount === 1);

    // 系统存储器 + 时钟存储器：每周期刷新（覆盖用户写入，与真机行为一致）
    this.updateSystemMemory();

    var ob1 = null;
    for (var b = 0; b < project.blocks.length; b++) {
      if (project.blocks[b].obNumber === 1 || project.blocks[b].name === 'OB1') ob1 = project.blocks[b];
    }
    if (!ob1) return;

    if (ob1.lang === 'LAD') {
      this.trace = { elem: {}, net: {} };
      // 建立 FB 实例索引：实例名 -> { el, key }，供 "name".Q 之类的成员引用读取。
      // key 与 execNetwork 里的状态键公式一致，直接定位 plc.timers 里的运行状态。
      this.fbInst = {};
      for (var fi = 0; fi < ob1.networks.length; fi++) {
        var fNet = ob1.networks[fi];
        for (var fc = 0; fc < fNet.columns.length; fc++) {
          for (var fb2 = 0; fb2 < fNet.columns[fc].branches.length; fb2++) {
            var fBr = fNet.columns[fc].branches[fb2];
            for (var fe = 0; fe < fBr.length; fe++) {
              var fEl = fBr[fe];
              if (!fEl || !fEl.instance) continue;
              var fMeta = (typeof window !== 'undefined' && window.INSTR) ? window.INSTR.info(fEl.type) : null;
              if (!fMeta || !fMeta.fb) continue;
              this.fbInst[String(fEl.instance).trim()] = {
                el: fEl,
                key: ob1.name + ':' + fi + ':' + fc + ':' + fb2 + ':' + fe + ':' + (fEl.id || 'x')
              };
            }
          }
        }
      }
      for (var n = 0; n < ob1.networks.length; n++) {
        this.execNetwork(ob1.networks[n], n, ob1.name);
      }
    } else if (ob1.ast) {
      var env = { vars: {}, statics: this.inst['inst:OB1'] || (this.inst['inst:OB1'] = {}) };
      try { this.runStatements(ob1.ast, env); }
      catch (err) { this.log('error', 'OB1 运行异常: ' + err.message); }
    }

    var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastCycleMs = t1 - t0;
    if (this.lastCycleMs > this.maxCycleMs) this.maxCycleMs = this.lastCycleMs;
    this.clock += this.cycleTime || 10;
  };

  /* ---------------- 导出 ---------------- */
  var api = {
    SoftPLC: SoftPLC, parseAddr: parseAddr, tokenize: tokenize, compileScl: compileScl,
    compileProject: compileProject, toMs: toMs, parseInterface: parseInterface,
    msToTime: msToTime, normTime: normTime, isTimeLiteral: isTimeLiteral,
    instanceMemberType: instanceMemberType, instIndex: instIndex,
    _setInstr: function (I) { globalThis.INSTR = I; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PLC = api;

})(typeof window !== 'undefined' ? window : globalThis);
