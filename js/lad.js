/* ============================================================
   lad.js — LAD 梯形图 SVG 渲染器（V2）
   支持：触点/线圈/任意盒式指令、并联分支、在线监视、
         拖拽命中几何、导线端点手柄
   ============================================================ */
(function (root) {
  'use strict';

  var GRID = { h: 96, cellW: 110, gap: 30, padL: 46, padT: 34 };
  var SYM = {
    body: '#1a6fa8',
    text: '#1e1e1e',
    gray: '#9a9a9a',
    dim: '#c0c0c0',
    sim: '#8a6d3b',
    addr: '#0a7a8c'      // 绝对地址的青绿色（对齐 TIA）
  };

  /* ---------------- 开放分支（Open Branch） ----------------
   * 对齐 TIA：分支行的最后一个"元件"是 OPEN_END 时，该分支是开放分支
   *  · 右端不汇合回主线（不画汇合竖线）
   *  · 末端画一个开口箭头，表示"这里可以继续放指令 / 可以接线圈"
   * 行列结构不变，OPEN_END 只是一个占位标记，仿真时直接直通。
   * -------------------------------------------------------- */
  var COIL_TYPES = ['COIL', 'SET', 'RESET', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL'];
  function isCoilType(t) { return COIL_TYPES.indexOf(t) >= 0; }
  function isOpenEndEl(el) { return !!el && el.type === 'OPEN_END'; }
  function isOpenBranch(br) { return !!(br && br.length && isOpenEndEl(br[br.length - 1])); }
  /* 末端分支：以开口箭头或线圈收尾 —— 这类分支不画汇合竖线（线圈就是分支终点）
     空分支（[]）同样视为末端（不该画成"空闭合环"） */
  function isTerminalBranch(br) {
    if (!br || !br.length) return true;
    var last = br[br.length - 1];
    return isOpenEndEl(last) || isCoilType(last.type);
  }

  /* 把元件拆成"绝对地址 + 符号名"两段，供两行标签显示 */
  function labelParts(el) {
    var op = el.operand == null ? '' : String(el.operand);
    var addr = el.addr == null ? '' : String(el.addr);
    // operand 本身就是绝对地址（如 I0.0 / MW10 / DB1.DBX0.0）时，当作地址显示
    if (!addr && /^([IQM][BWD]?\d+(\.\d+)?|DB\d+\.DB[XBWD]\d+(\.\d+)?)$/i.test(op)) {
      addr = op; op = '';
    }
    return { addr: addr, sym: op };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fit(txt, max) {
    txt = String(txt == null ? '' : txt);
    max = max || 13;
    if (txt.length <= max) return txt;
    return txt.slice(0, max - 1) + '…';
  }

  // 毫秒 → T# 时间字面量（在线显示用：ET 正数 / PT 倒数）
  function fmtTime(ms) {
    ms = Math.max(0, Math.round(ms || 0));
    if (ms < 1000) return 'T#' + ms + 'ms';
    if (ms < 60000) return 'T#' + (Math.round(ms / 100) / 10) + 's';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return 'T#' + m + 'm' + (s ? s + 's' : '');
  }

  function INSTR() {
    return (typeof window !== 'undefined' ? window.INSTR : null);
  }

  /* ---------------- 导线命中分段 ----------------
   * 横向导线要能"点线选线"，但元件符号本身仍要"点符号选元件"。
   * 于是按每个元件符号的命中框把整段线切成小段，只在元件之间的空档放命中线。
   * -------------------------------------------------------- */
  function spanHit(x1, x2, y, key) {
    return '<line class="lad-hit lad-span" x1="' + x1 + '" y1="' + y + '" x2="' + x2 +
      '" y2="' + y + '" stroke="transparent" stroke-width="16" data-seg="' + key +
      '" style="cursor:pointer"/>';
  }

  // 元件符号命中框的横向范围（与 drawElement 里 .hit 的算法保持一致）
  function symbolHitRange(el, x, w) {
    if (!el) return null;
    // 开口箭头：整格都可点（选中它按 Delete 就是"闭合分支"）
    if (el.type === 'OPEN_END') return [x, x + Math.max(w, 20)];
    var I = INSTR();
    var meta = I ? I.info(el.type) : null;
    if (!meta) return null;          // 未知类型 / EMPTY：不占命中，交给导线
    if (meta.kind === 'box') {
      var hw = Math.max(w - 12, 76);
      return [x + (w - hw) / 2, x + (w + hw) / 2];
    }
    if (meta.kind === 'contact' || meta.kind === 'coil') {
      var hw2 = Math.min(w, 44);
      return [x + w / 2 - hw2 / 2, x + w / 2 + hw2 / 2];
    }
    return [x, x + w];
  }

  /* ---------------- 布局计算 ---------------- */  function calcLayout(net) {
    var rows = 1;
    var tall = false;
    var maxBh = 0;
    for (var c = 0; c < net.columns.length; c++) {
      rows = Math.max(rows, net.columns[c].branches.length);
      // 本网络里有没有定时器/计数器那种高盒体
      for (var tb = 0; tb < net.columns[c].branches.length; tb++) {
        var tbr = net.columns[c].branches[tb] || [];
        for (var te = 0; te < tbr.length; te++) {
          if (isTallBox(tbr[te])) tall = true;
          var m0 = INSTR() && tbr[te] ? INSTR().info(tbr[te].type) : null;
          if (m0 && m0.kind === 'box') maxBh = Math.max(maxBh, boxHeightOf(m0));
        }
      }
    }
    // 每列宽度按该列最长指令盒估算
    var widths = [];
    var total = 0;
    for (var i = 0; i < net.columns.length; i++) {
      var w = GRID.cellW;
      for (var b = 0; b < net.columns[i].branches.length; b++) {
        var br = net.columns[i].branches[b];
        var sum = 0;
        for (var e = 0; e < br.length; e++) {
          sum += elWidth(br[e]);
        }
        if (sum > w) w = sum;
      }
      widths.push(w);
      total += w;
    }
    // 含高盒体的网络：行距加高，给盒体上方的实例名（%DBn + "name" 两行）和相邻行留出空隙
    // 含高盒体的网络：行距要放得下「盒体 + 上方值框(46) + %DBn/实例名(22)」外加空隙。
    // 以前固定 +24，遇到 TOF 排在 TON 下面时，值框会压到上一行的盒体底边上。
    var rowH = tall ? Math.max(GRID.h + 24, maxBh + 62) : GRID.h;
    // 首行上方还要放实例名，顶部留白也要跟着加大，否则 %DBn 会顶出网络边框
    var padT = tall ? GRID.padT + 12 : GRID.padT;
    var h = padT + rows * rowH + 14;
    // 列间距：每两列之间加 gap
    var gaps = Math.max(0, widths.length - 1) * GRID.gap;
    return {
      w: Math.max(GRID.padL + total + gaps + 34, 460),
      h: h, rows: rows, widths: widths, rowH: rowH, padT: padT
    };
  }

  // 定时器 / 计数器这类 FB 盒体较高，上方还要画 %DBn "name" 两行：
  // 这种网络的行距要加高，否则盒体会顶到上一行、标题也会撞到网络边框
  function isTallBox(el) {
    var I = INSTR();
    if (!I || !el || !el.type) return false;
    var m = I.info(el.type);
    return !!(m && m.fb && (m.group === 'timer' || m.group === 'counter'));
  }

  // 盒体高度（与 drawBox 里的算法保持一致）。
  // 布局要用它算行距：定时器/计数器盒体上方有「值框 + %DBn + 实例名」三层，
  // 行距不够就会压到上一行的盒体上（TOF 压在 TON 底边就是这么来的）。
  function boxHeightOf(meta) {
    if (!meta) return 44;
    var ins = 0, outs = 0;
    (meta.params || []).forEach(function (p) {
      if (p.dir === 'out') outs++; else ins++;
    });
    var maxRows = Math.max(ins, outs, 1);
    var tallFB = meta.fb && (meta.group === 'timer' || meta.group === 'counter');
    var typeH = meta.typeText ? 14 : 0;
    var rowH = tallFB ? 17 : 15;
    return tallFB ? Math.max(64, 30 + typeH + maxRows * rowH)
      : Math.max(44, 24 + typeH + maxRows * rowH);
  }

  /* 引脚支路（R / LD 端的触点链）要占的宽度：
     它从母线画到盒体左边，所以盒体左边的留白要跟着变宽，格子也要跟着变宽。 */
  function pinChainW(el) {
    if (!el || !el.pins) return 0;
    var I = INSTR();
    var meta = I && el.type ? I.info(el.type) : null;
    var pins = (meta && meta.pinBranches) || [];
    var w = 0;
    pins.forEach(function (pn) {
      var ch = el.pins[pn];
      if (ch && ch.length) w = Math.max(w, ch.length * 62 + 8);
    });
    return w;
  }

  /* 盒体几何（左右留白 / 盒宽 / 盒左边界）。
     drawBox 和"引脚支路"（接到 R / LD 的触点支路）必须用同一份算法，
     否则支路会停在盒子外面或者戳进盒子里。 */
  function boxGeo(meta, x, w, el) {
    var tallFB = !!(meta && meta.fb && (meta.group === 'timer' || meta.group === 'counter'));
    var LEAD = Math.min(12, Math.max(4, w * 0.08));
    var leadL = (tallFB ? 56 : LEAD) + pinChainW(el);
    var leadR = tallFB ? 44 : LEAD;
    var bw = Math.max(w - leadL - leadR, 60);
    var bx = tallFB ? x + leadL : x + (w - bw) / 2;
    return { tallFB: tallFB, leadL: leadL, leadR: leadR, bw: bw, bx: bx };
  }

  /* 某个输入引脚"引线"所在的高度（= 参数行基线 - 3，和 drawBox 里那根短引线一致）。
     引脚支路要正好接在这条线上，所以两边共用这一个函数。 */
  function pinWireY(meta, cy, name) {
    if (!meta) return cy;
    var idx = -1, n = 0;
    (meta.params || []).forEach(function (p) {
      if (p.dir === 'out') return;
      if (p.n === name) idx = n;
      n++;
    });
    if (idx < 0) return cy;
    var tallFB = !!(meta.fb && (meta.group === 'timer' || meta.group === 'counter'));
    var bh = boxHeightOf(meta);
    var titleH = tallFB ? 22 : 18;
    var typeH = meta.typeText ? 14 : 0;
    var rowH = tallFB ? 17 : 15;
    return cy - bh / 2 + titleH + typeH + 1 + idx * rowH + 9;
  }

  function elWidth(el) {    // 开口箭头只需要一小段宽度
    if (el && el.type === 'OPEN_END') return 34;
    var I = INSTR();
    if (!I) return GRID.cellW;
    var meta = I.info(el.type);
    if (!meta) return GRID.cellW;
    if (meta.kind === 'contact') return 82;
    if (meta.kind === 'coil') return 88;
    // 比较指令是触点式的窄框：一个格子就够（操作数写在框外上下）
    if (meta.kind === 'compare') return 86;

    // 盒式：左侧（输入参数）与右侧（输出参数）宽度相加，才是盒子真正需要的宽度
    function pxOf(s) { return String(s).length * 5.4; }
    function isOutsideParam(m, pn) {
      return m.fb && ((m.group === 'timer' && (pn === 'PT' || pn === 'ET')) ||
        (m.group === 'counter' && (pn === 'PV' || pn === 'CV')));
    }
    var leftW = 0, rightW = 0;
    (meta.params || []).forEach(function (p) {
      var v = '';
      if (el.params && el.params[p.n] !== undefined) v = String(el.params[p.n]);
      else if (p.n === 'IN1') v = String(el.src1 || el.operand || '');
      else if (p.n === 'IN2') v = String(el.src2 || el.operand2 || '');
      else if (p.n === 'PT') v = String(el.pt || '');
      else if (p.n === 'OUT') v = String(el.dest || '');
      // 框外参数（PT/PV/ET/CV）只占参数名宽度，值画在盒外
      var outside = isOutsideParam(meta, p.n);
      var one = pxOf(p.n) + (!outside && v ? pxOf(v.slice(0, 10)) + 6 : 0) + 10;
      if (p.dir === 'out') rightW = Math.max(rightW, one);
      else leftW = Math.max(leftW, one);
    });
    var both = leftW + rightW + 18;
    var byTitle = String(meta.mnemonic || meta.name || el.type).length * 9.5 + 48;
    var need = Math.max(meta.w || 110, both, byTitle, 116);
    // 定时器/计数器 FB：做短一点（值在框外，盒内只放参数名）。
    // 框外要写 PT / ET（计数器是 PV / CV），左右各留出这些字的宽度：
    // 左 52（PT 值 + 短引线）、右 44（ET 值）。留不够的话值会溢出格子、
    // 压到左边那条分支竖线上（"TON 被分支压住"就是这么来的）。
    if (meta.fb && (meta.group === 'timer' || meta.group === 'counter')) {
      need = Math.max(Math.min(need, 100), 84) + 100;
      need += pinChainW(el);   // 接了 R / LD 触点支路：左边要给它让出位置
    }
    // 盒式元件两侧要留引线（drawBox 里的 LEAD），这部分宽度不能从盒体里扣，
    // 否则分支行里的盒式指令会被压扁（V31 修复）
    if (meta.kind === 'box') need += 30;
    return need;
  }

  /* 一行里各元件的单元格划分：按"这个元件需要多宽"从左往右排，不按比例把行撑满。
     列宽由这一列里最长的那条分支决定；短分支如果被拉伸去填满列宽，元件就会被推到
     列尾、前面留一大段空线 —— 表现出来就是"在下面的分支里加一个器件，上面那行的
     器件却整体往后挪、上面空出一大片"。多出来的宽度留在行尾当导线走（和 TIA 一致）。
     （只有当自然总宽超过列宽时才压缩，正常不会发生，因为列宽就是取的最大值。） */
  function cellLayout(branch, cX, colW) {
    var n = branch ? branch.length : 0;
    if (!n) return [];
    var need = [], natural = 0;
    for (var i = 0; i < n; i++) {
      // 每个元件至少给 20，避免 OPEN_END 之类的窄件把别的挤爆
      var w = Math.max(20, elWidth(branch[i]));
      need.push(w);
      natural += w;
    }
    var scale = (natural > colW && natural > 0) ? colW / natural : 1;
    var out = [], x = cX;
    for (var j = 0; j < n; j++) {
      var cw = need[j] * scale;
      out.push({ x: x, w: cw });
      x += cw;
    }
    // 末端是开口箭头时，箭头要落在这一列的右边界上（对齐 TIA：开口分支画到汇合点为止），
    // 否则短分支的箭头会停在半路上，右边留一段空白像断线
    var tail = branch[n - 1];
    if (tail && tail.type === 'OPEN_END' && out.length && scale === 1) {
      var roomGap = cX + colW - x;
      if (roomGap > 0.5) { out[out.length - 1].w += roomGap; x = cX + colW; }
    }
    return out;
  }

  /* ============================================================
   * 元素绘制
   * ============================================================ */
  function drawElement(e, x, y, w, h, ctx) {
    var I = INSTR();
    var meta = I ? I.info(e.type) : null;
    var cx = x + w / 2, cy = y + h / 2;
    var g = '<g class="lad-el" data-el="' + esc(e.id) + '" data-type="' + esc(e.type) + '">';

    // 开放分支的开口箭头（不是真元件，只画一段导线 + 箭头）
    if (e.type === 'OPEN_END') {
      // 主线（第 1 行）永远连到线圈，不可能"在这里结束"：
      // 万一老数据里主线还留着 OPEN_END，就只画直线、绝不画箭头，
      // 免得主干导线中间凭空冒出一个箭头。
      if (ctx.noArrow) {
        g += '<line class="lad-wire" x1="' + x + '" y1="' + cy + '" x2="' + (x + w) +
          '" y2="' + cy + '" stroke="' + SYM.body + '" stroke-width="1.6"/>';
        g += '<rect class="hit" x="' + x + '" y="' + (y + 4) + '" width="' + Math.max(w, 20) +
          '" height="' + (h - 8) + '" fill="transparent" data-el="' + esc(e.id) + '"/>';
        g += '</g>';
        return g;
      }
      // 箭头收在离列右边线还有一小段的位置，避免看起来与汇合竖线相连
      var ax = Math.max(x + 6, x + w - 26);        // 箭头起点
      g += '<line class="lad-wire lad-openwire" x1="' + x + '" y1="' + cy + '" x2="' + (ax + 2) +
        '" y2="' + cy + '" stroke="' + SYM.body + '" stroke-width="1.6"/>';
      // » 双箭头（和主线悬空端、TIA 的开口端标记保持一致）
      g += '<path class="lad-openend" d="M ' + (ax - 1) + ' ' + (cy - 5.5) + ' L ' + (ax + 7) +
        ' ' + cy + ' L ' + (ax - 1) + ' ' + (cy + 5.5) +
        ' M ' + (ax + 7) + ' ' + (cy - 5.5) + ' L ' + (ax + 15) + ' ' + cy +
        ' L ' + (ax + 7) + ' ' + (cy + 5.5) + '" fill="none" stroke="' + SYM.body +
        '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      g += '<rect class="hit" x="' + x + '" y="' + (y + 4) + '" width="' + Math.max(w, 20) +
        '" height="' + (h - 8) + '" fill="transparent" data-el="' + esc(e.id) + '"/>';
      if (ctx.sel) {
        g += '<rect class="selbox" x="' + (x + 1) + '" y="' + (cy - 13) + '" width="' +
          Math.max(w - 2, 20) + '" height="26" fill="rgba(26,111,168,.10)" stroke="#1a6fa8" ' +
          'stroke-width="1.4" stroke-dasharray="4 2" rx="2" pointer-events="none"/>';
      }
      g += '</g>';
      return g;
    }

    // 命中区只覆盖"元件符号本身"，不含左右两侧的引线导线，
    // 这样导线仍可点选（对齐 TIA：点线选线，点元件选元件）
    var hitW, hitX;
    if (meta && meta.kind === 'box') {
      hitW = Math.max(w - 12, 76);
      hitX = x + (w - hitW) / 2;
    } else if (meta && (meta.kind === 'contact' || meta.kind === 'coil')) {
      hitW = Math.min(w, 44);            // 触点/线圈符号宽度
      hitX = cx - hitW / 2;
    } else {
      hitW = w;
      hitX = x;
    }
    var hitY = y + 4;
    var hitH = h - 8;
    g += '<rect class="hit" x="' + hitX + '" y="' + hitY + '" width="' + hitW +
      '" height="' + hitH + '" fill="transparent" data-el="' + esc(e.id) + '"/>';

    if (ctx.sel) {
      g += '<rect class="selbox" x="' + (x + 2) + '" y="' + (y + 3) + '" width="' + (w - 4) +
        '" height="' + (h - 6) + '" fill="rgba(26,111,168,.10)" stroke="#1a6fa8" ' +
        'stroke-width="1.4" stroke-dasharray="4 2" rx="2" pointer-events="none"/>';
    }

    // EMPTY = 空位：只画一段导线，绝不画方框/文字（对齐 TIA 删除后的直通效果）
    if (e.type === 'EMPTY') {
      g += line(x, cy, x + w, cy);
      g += '</g>';
      return g;
    }

    if (!meta) {
      // 未知类型：画一个明确的错误标记，方便排查（不应出现在正常流程里）
      g += line(x, cy, x + w, cy);
      g += rect(cx - 26, cy - 11, 52, 22, 'lad-body');
      g += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="9" fill="#c00">' +
        esc(fit(e.type, 9)) + '</text>';
      g += '</g>';
      return g;
    }

    if (meta.kind === 'contact') {
      return drawContact(e, x, y, w, h, g, ctx || {});
    }
    if (meta.kind === 'coil') {
      return drawCoil(e, x, y, w, h, g);
    }
    if (meta.kind === 'compare') {
      return drawCompare(e, x, y, w, h, g, meta, ctx || {});
    }    return drawBox(e, x, y, w, h, g, meta, ctx || {});
  }

  /* ---------- 触点 ---------- */
  // 布局对齐 TIA：上方 "地址" + 下方 "符号名"（带引号），中间是触点符号
  // 两行分别带 data-part 标记，供双击时区分改地址 / 改符号名
  /* 操作数标签（地址 / 符号名两行，画在符号上方）
     V34：整体再上移 6px —— 以前 sym 基线 cy-8，文字下沿约 cy-6，
     而触点符号顶在 cy-9，两行字的底边正好啃在横线/竖笔上，看着像字压在器件上。
     现在 addr cy-26 / sym cy-14，文字下沿到 cy-12，和符号顶留出 3px 空隙。 */
  function operandLabels(e, cx, cy, color) {
    var L = labelParts(e);
    var out = '';
    if (L.addr) {
      out += '<text class="lt-addr" data-part="addr" data-el="' + esc(e.id) + '" ' +
        'x="' + cx + '" y="' + (cy - 26) + '" text-anchor="middle" ' +
        'font-size="10.5" font-weight="700" fill="' + SYM.addr + '" ' +
        'font-family="Segoe UI, Microsoft YaHei">' + esc(fit(L.addr, 13)) + '</text>';
    }
    if (L.sym) {
      var y2 = L.addr ? (cy - 14) : (cy - 20);
      // FB 实例成员引用（"time".Q）自带引号，不再包一层
      var quoted = /^"/.test(L.sym);
      out += '<text class="lt-sym" data-part="sym" data-el="' + esc(e.id) + '" ' +
        'x="' + cx + '" y="' + y2 + '" text-anchor="middle" ' +
        'font-size="10" fill="' + SYM.text + '" font-family="Segoe UI, Microsoft YaHei">' +
        (quoted ? '' : '"') + esc(fit(L.sym, 13)) + (quoted ? '' : '"') + '</text>';
    }
    if (!L.addr && !L.sym) {
      // 对齐 TIA：未填操作数时显示红色尖括号占位 <??.?>
      out += '<text class="lt-addr lt-ph" data-part="addr" data-el="' + esc(e.id) + '" ' +
        'x="' + cx + '" y="' + (cy - 22) + '" text-anchor="middle" ' +
        'font-size="9.5" fill="#e0006c" font-style="italic" ' +
        'font-family="Segoe UI, Microsoft YaHei">&lt;??.?&gt;</text>';
    }
    return out;
  }

  // 双击进入编辑态时的蓝色填充（对齐 TIA：双击后元件变蓝底可改）
  function editHighlight(e, x, y, w, h) {
    return '<rect class="edit-hl" x="' + (x + 2) + '" y="' + (y + h / 2 - 13) + '" ' +
      'width="' + (w - 4) + '" height="26" fill="#1a6fa8" opacity="0.85" rx="2" ' +
      'pointer-events="none"/>';
  }

  function drawContact(e, x, y, w, h, g, ctx) {
    var compact = !!(ctx && ctx.compact);      // 引脚支路上的紧凑触点（R / LD 端）
    var cx = x + w / 2, cy = y + h / 2, half = compact ? 7 : 10;   // 中线必须与其他元素一致（不能 +6）
    var typ = e.type;
    // 左右引线：单独成组并带 data-seg，可点选（用于插入分支）
    g += '<line class="lad-wire lad-lead" x1="' + x + '" y1="' + cy +
      '" x2="' + (cx - half) + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':L"/>';
    g += '<line class="lad-wire lad-lead" x1="' + (cx + half) + '" y1="' + cy +
      '" x2="' + (x + w) + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':R"/>';
    g += line(cx - half, cy - 9, cx - half, cy + 9, 'lad-body');
    g += line(cx + half, cy - 9, cx + half, cy + 9, 'lad-body');

    if (typ === 'NC') {
      g += '<line class="lad-body" x1="' + (cx - half - 1) + '" y1="' + (cy + (compact ? 6 : 8)) +
        '" x2="' + (cx + half + 1) + '" y2="' + (cy - (compact ? 6 : 8)) + '" stroke="' + SYM.body +
        '" stroke-width="1.6"/>';
    }
    if (typ === 'P' || typ === 'P_TRIG') {
      g += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="10" ' +
        'font-weight="700" fill="' + SYM.body + '">P</text>';
    }
    if (typ === 'N' || typ === 'N_TRIG') {
      g += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="10" ' +
        'font-weight="700" fill="' + SYM.body + '">N</text>';
    }

    // 两行标签（地址 / 符号名）
    // 紧凑模式（引脚支路）上方没有地方，改成符号下方一行小字
    g += compact ? compactLabel(e, cx, cy) : operandLabels(e, cx, cy, SYM.body);

    // 拖拽手柄（紧凑触点不用：它不在列/行里，不能拖）
    if (!compact) {
      g += '<circle class="drag-dot" cx="' + (x + 4) + '" cy="' + (cy - 18) +
        '" r="4" fill="#fff" stroke="#1a6fa8" stroke-width="1.2" data-handle="drag" ' +
        'data-el="' + esc(e.id) + '" style="cursor:move"/>';
    }
    g += '</g>';
    return g;
  }

  /* 引脚支路触点的标签：只留一行地址，画在符号下方（上方是主线，画不下两行） */
  function compactLabel(e, cx, cy) {
    var L = labelParts(e);
    var txt = L.addr || L.sym || '';
    if (!txt) {
      return '<text class="lt-addr lt-ph" data-part="addr" data-el="' + esc(e.id) + '" x="' + cx +
        '" y="' + (cy + 20) + '" text-anchor="middle" font-size="8.5" ' +
        'fill="#e0006c" font-style="italic" font-family="Segoe UI, Microsoft YaHei">&lt;??.?&gt;</text>';
    }
    return '<text class="lt-addr" data-part="addr" data-el="' + esc(e.id) + '" x="' + cx +
      '" y="' + (cy + 20) + '" text-anchor="middle" font-size="8.5" font-weight="700" ' +
      'fill="' + SYM.addr + '" font-family="Segoe UI, Microsoft YaHei">' + esc(fit(txt, 10)) + '</text>';
  }

  /* ---------- 线圈 ---------- */
  function drawCoil(e, x, y, w, h, g) {
    var cx = x + w / 2, cy = y + h / 2, r = 12;   // 中线必须与其他元素一致（不能 +6）
    var typ = e.type;
    g += '<line class="lad-wire lad-lead" x1="' + x + '" y1="' + cy +
      '" x2="' + (cx - r) + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':L"/>';
    g += '<line class="lad-wire lad-lead" x1="' + (cx + r) + '" y1="' + cy +
      '" x2="' + (x + w) + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':R"/>';
    g += '<path class="lad-body" d="M ' + (cx - r) + ' ' + (cy - 10) + ' A ' + r + ' 10 0 0 0 ' +
      (cx - r) + ' ' + (cy + 10) + '" fill="none" stroke="' + SYM.body + '" stroke-width="1.7"/>';
    g += '<path class="lad-body" d="M ' + (cx + r) + ' ' + (cy - 10) + ' A ' + r + ' 10 0 0 1 ' +
      (cx + r) + ' ' + (cy + 10) + '" fill="none" stroke="' + SYM.body + '" stroke-width="1.7"/>';

    var mark = { SET: 'S', RESET: 'R', NEG_COIL: '/', POS_COIL: 'P', NEG_EDGE_COIL: 'N' }[typ];
    if (mark) {
      g += '<text class="lad-mark" x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="10" ' +
        'font-weight="700" fill="' + SYM.body + '">' + mark + '</text>';
    }

    g += operandLabels(e, cx, cy, SYM.body);

    g += '<circle class="drag-dot" cx="' + (x + 4) + '" cy="' + (cy - 18) +
      '" r="4" fill="#fff" stroke="#1a6fa8" stroke-width="1.2" data-handle="drag" ' +
      'data-el="' + esc(e.id) + '" style="cursor:move"/>';
    g += '</g>';
    return g;
  }

  /* ---------- 比较指令（触点式，对齐 TIA） ----------
   * 画面照搬博途：
   *      <???>          ← IN1（未赋值时红字）
   *   ┌─────────┐
   *   │   ==    │       ← 比较符
   *   │   Int   │       ← 数据类型（未选显示 ???）
   *   └─────────┘
   *      <???>          ← IN2
   * 没有 EN/ENO：比较结果是 Bool，本身就是串在功率流里的一个触点。
   */
  function drawCompare(e, x, y, w, h, g, meta, ctx) {
    var cx = x + w / 2, cy = y + h / 2;
    var bw = Math.min(60, Math.max(44, w - 18));
    var bh = 46;
    var bx = cx - bw / 2, by = cy - bh / 2;
    var body = SYM.body;

    // 引线
    g += '<line class="lad-wire lad-lead" x1="' + x + '" y1="' + cy +
      '" x2="' + bx + '" y2="' + cy +
      '" stroke="' + body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':L"/>';
    g += '<line class="lad-wire lad-lead" x1="' + (bx + bw) + '" y1="' + cy +
      '" x2="' + (x + w) + '" y2="' + cy +
      '" stroke="' + body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':R"/>';

    // 盒体 + 左右两根粗竖线（TIA 的比较指令就是这个"夹着两个操作数"的样子）
    g += '<rect class="lad-body" x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh +
      '" fill="#fff" stroke="' + body + '" stroke-width="1.2"/>';
    g += '<line class="lad-body" x1="' + (bx + 5) + '" y1="' + by + '" x2="' + (bx + 5) +
      '" y2="' + (by + bh) + '" stroke="' + body + '" stroke-width="2.4"/>';
    g += '<line class="lad-body" x1="' + (bx + bw - 5) + '" y1="' + by + '" x2="' + (bx + bw - 5) +
      '" y2="' + (by + bh) + '" stroke="' + body + '" stroke-width="2.4"/>';

    // 比较符
    g += '<text x="' + cx + '" y="' + (cy - 5) + '" text-anchor="middle" font-size="12.5" ' +
      'font-weight="700" fill="' + body + '" font-family="Consolas">' + esc(meta.cmp || '==') + '</text>';

    // 盒内第二行：选了数据类型就显示类型（Int / Time…）；
    // 没选类型、但下方已经填了数字时，直接显示这个数字 ——
    // 让"填了 5 就生效"这件事在盒子里看得见，而不是永远挂个 ???。
    var ty = (e.params && e.params.TYPE) ? String(e.params.TYPE) : '';
    var boxTxt = ty, boxItalic = !ty, boxBold = !!ty;
    if (!ty) {
      var in2raw = (e.params && e.params.IN2) ? String(e.params.IN2).trim() : '';
      var isNumLit = /^[-+]?\d+(?:[.,]\d+)?$/.test(in2raw);          // 纯数字：原样显示（5 就是 5，不是 5ms）
      var isTimeLit = !isNumLit && !!(root.PLC && root.PLC.isTimeLiteral && root.PLC.isTimeLiteral(in2raw));
      if (in2raw && (isNumLit || isTimeLit)) {
        boxTxt = (isTimeLit && root.PLC && root.PLC.normTime) ? (root.PLC.normTime(in2raw) || in2raw) : in2raw;
        boxItalic = false; boxBold = true;
      }
    }
    g += '<text data-prm="' + esc(e.id) + ':TYPE" x="' + cx + '" y="' + (cy + 14) +
      '" text-anchor="middle" font-size="10.5" ' +
      'fill="#1a3a5c"' + (boxItalic ? ' font-style="italic"' : '') + (boxBold ? ' font-weight="600"' : '') +
      '" font-family="Consolas">' + esc(fit(boxTxt || '???', 8)) + '</text>';

    // 两个操作数：上 = IN1（关联值），下 = IN2（要比较的数字）
    // IN2 填的数如果超出关联值能取到的范围（或格式不对），标红 + 悬停给出原因
    var chk = null;
    try {
      chk = (root.INSTR && root.INSTR.cmpInfo) ? root.INSTR.cmpInfo(e) : null;
    } catch (err) { chk = null; }
    var in2Bad = !!(chk && chk.red);

    function sideVal(nm, py, bad, msg) {
      var v = (e.params && e.params[nm]) ? String(e.params[nm]) : '';
      if (!v) {
        g += '<text data-prm="' + esc(e.id + ':' + nm) + '" x="' + cx + '" y="' + py +
          '" text-anchor="middle" font-size="9.5" font-style="italic" fill="#e0006c" ' +
          'font-family="Segoe UI, Microsoft YaHei">&lt;???&gt;</text>';
      } else {
        g += '<text class="' + (bad ? 'cmp-bad' : '') + '" data-prm="' + esc(e.id + ':' + nm) +
          '" x="' + cx + '" y="' + py + '" text-anchor="middle" font-size="9.5" ' +
          (bad ? 'font-weight="700" fill="#d00010"' : 'fill="' + SYM.addr + '"') +
          ' font-family="Segoe UI, Microsoft YaHei">' + esc(fit(v, 15)) + '</text>';
        if (bad && msg) {
          g += '<title>' + esc(msg) + '</title>';
        }
      }
    }
    sideVal('IN1', by - 7, false, '');
    sideVal('IN2', by + bh + 14, in2Bad, chk && chk.msg);

    // 拖拽手柄
    g += '<circle class="drag-dot" cx="' + (x + 4) + '" cy="' + (by - 20) +
      '" r="4" fill="#fff" stroke="' + body + '" stroke-width="1.2" data-handle="drag" ' +
      'data-el="' + esc(e.id) + '" style="cursor:move"/>';
    g += '</g>';
    return g;
  }

  /* ---------- 盒式指令（通用） ---------- */
  function drawBox(e, x, y, w, h, g, meta, ctx) {
    var I = INSTR();
    ctx = ctx || {};
    // 高度：随参数行数增长
    var ins = [], outs = [];
    (meta.params || []).forEach(function (p) {
      if (p.dir === 'out') outs.push(p); else ins.push(p);
    });
    var maxRows = Math.max(ins.length, outs.length, 1);
    // 定时器/计数器 FB：更高一点（对齐 TIA 比例）
    var tallFB = meta.fb && (meta.group === 'timer' || meta.group === 'counter');
    // 两侧引线：普通盒体各留 12px（盒子不会贴着分出竖线，看起来才是"线接进盒子"）。
    // 定时器/计数器要把 PT / CV 这些值写在框外，框外文字有 30~40px 宽，
    // 以前和普通盒体一样只留 12px，值就会溢出格子、压到左边那条分支竖线上
    // （用户截图里"TON 被分支压住"就是这个）。这里给左右各留出写值的位置。
    var LEAD = Math.min(12, Math.max(4, w * 0.08));
    var BG = boxGeo(meta, x, w, e);
    var leadL = BG.leadL, leadR = BG.leadR, bw = BG.bw, bx = BG.bx;
    var tallFB = BG.tallFB;
    var cy = y + h / 2;
    var hasEN = meta.hasEN !== false;
    var hasENO = meta.hasENO !== false;
    // 标题下方有一个数据类型小框（Time / Int），对齐 TIA 的块头
    var typeH = meta.typeText ? 14 : 0;
    var rowH = tallFB ? 17 : 15;
    var bh = boxHeightOf(meta);   // 与 calcLayout 用同一份算法，行距才对得上
    var by = cy - bh / 2;

    // 实例数据块头部（对齐 TIA）：盒体上方显示 %DBn "name"；未命名显示红色 <???>；
    // 实例名重复时整段标红
    if (meta.fb) {
      var hcx = bx + bw / 2;
      if (e.instance) {
        var dup = ctx.dupInst && ctx.dupInst[String(e.instance).trim()];
        var nstColor = dup ? '#e0342f' : SYM.addr;
        var nameColor = dup ? '#e0342f' : SYM.text;
        g += '<text data-inst="' + esc(e.id) + '" x="' + hcx + '" y="' + (by - 22) +
          '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + nstColor +
          '" font-family="Consolas"' + (dup ? ' text-decoration="underline"' : '') + '>%DB' +
          esc(e.db || '?') + '</text>';
        g += '<text data-inst="' + esc(e.id) + '" x="' + hcx + '" y="' + (by - 10) +
          '" text-anchor="middle" font-size="11" fill="' + nameColor +
          '" font-family="Segoe UI, Microsoft YaHei">"' +
          esc(fit(e.instance, 18)) + '"</text>';
      } else {
        g += '<text data-inst="' + esc(e.id) + '" x="' + hcx + '" y="' + (by - 11) +
          '" text-anchor="middle" font-size="11.5" font-style="italic" fill="#e0006c" ' +
          'font-family="Segoe UI, Microsoft YaHei">&lt;???&gt;</text>';
      }
    }

    // 在线监视：盒体上方那个值框里显示"经过的值"
    //   定时器 → 已过时间 ET（T#3.4s…），计数器 → 当前计数 CV
    // 离线不画，但顶部留白一直留着，切换监视时版式不会跳。
    if (tallFB && ctx.online) {
      var isCounterBox = meta.group === 'counter';
      // 第一拍还没跑到这个元件时（trace 里没有它），先按初始值显示，下一拍就更新
      var vbNum = (typeof ctx.liveDraw === 'number') ? ctx.liveDraw : 0;
      var vbTxt = isCounterBox ? String(vbNum) : fmtTime(vbNum);
      var vbW = Math.max(42, vbTxt.length * 6.2 + 14);
      var vbx = bx + bw / 2 - vbW / 2, vby = by - 46;
      g += '<rect class="lad-vbox" x="' + vbx.toFixed(1) + '" y="' + vby +
        '" width="' + vbW.toFixed(1) + '" height="14" rx="1.5" ' +
        'fill="#fff" stroke="#c9c9c9" stroke-width="0.9"/>';
      g += '<text data-tvbox="' + esc(e.id) + '" data-kind="' + (isCounterBox ? 'CV' : 'ET') +
        '" x="' + (bx + bw / 2) + '" y="' + (vby + 10.5) + '" text-anchor="middle" ' +
        'font-size="9.5" font-weight="700" fill="#bf8f00" font-family="Consolas">' +
        esc(vbTxt) + '</text>';
    }

    // 引线（带 data-lead：点引线等同于点这个元件，和触点/线圈一致）
    g += '<line class="lad-wire lad-lead" x1="' + x + '" y1="' + cy +
      '" x2="' + bx + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':L"/>';
    g += '<line class="lad-wire lad-lead" x1="' + (bx + bw) + '" y1="' + cy +
      '" x2="' + (x + w) + '" y2="' + cy +
      '" stroke="' + SYM.body + '" stroke-width="1.6" data-lead="' + esc(e.id) + ':R"/>';

    // 盒体
    var stroke = meta.sim ? SYM.sim : SYM.body;
    g += '<rect class="lad-body" x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh +
      '" fill="#fff" stroke="' + stroke + '" stroke-width="1.6" rx="1"/>';

    // 标题栏分隔线
    var titleH = tallFB ? 22 : 18;
    g += '<line x1="' + bx + '" y1="' + (by + titleH) + '" x2="' + (bx + bw) + '" y2="' + (by + titleH) +
      '" stroke="' + stroke + '" stroke-width="0.8"/>';

    // EN / ENO 在左侧竖排小字（不占标题行）
    if (hasEN) {
      g += '<text x="' + (bx + 3) + '" y="' + (by + 15) + '" font-size="8.5" fill="' + stroke +
        '" font-family="Consolas">EN</text>';
    }
    if (hasENO) {
      g += '<text x="' + (bx + bw - 3) + '" y="' + (by + 15) + '" text-anchor="end" font-size="8.5" ' +
        'fill="' + stroke + '" font-family="Consolas">ENO</text>';
    }

    // 指令名（标题行居中）—— 对齐 TIA：这里写助记符（TON / CTU / ADD / MOVE），
    // 中文名只出现在指令窗格和属性里
    var title = meta.mnemonic || meta.name || e.type;
    g += '<text x="' + (bx + bw / 2) + '" y="' + (by + 15.5) + '" text-anchor="middle" font-size="11" ' +
      'font-weight="700" fill="' + stroke + '">' + esc(fit(title, Math.max(6, Math.floor((bw - 36) / 8.5)))) + '</text>';

    // 数据类型小框（TIA 块头第二行）：TON/TOF = Time，CTU/CTD/CTUD = Int
    if (meta.typeText) {
      var tw = String(meta.typeText).length * 5.2 + 10;
      var tbx = bx + bw / 2 - tw / 2, tby = by + titleH + 1;
      g += '<rect class="lad-body" x="' + tbx + '" y="' + tby + '" width="' + tw +
        '" height="12" fill="#fff" stroke="' + stroke + '" stroke-width="0.8"/>';
      g += '<text x="' + (bx + bw / 2) + '" y="' + (tby + 9.5) + '" text-anchor="middle" font-size="8.5" ' +
        'fill="' + stroke + '" font-family="Consolas">' + esc(meta.typeText) + '</text>';
    }

    // 参数区
    function valOf(p) {
      if (e.params && e.params[p.n] !== undefined && e.params[p.n] !== '') return e.params[p.n];
      if (p.d !== undefined) return p.d;
      if (p.n === 'IN1') return e.src1 || e.operand || '';
      if (p.n === 'IN2') return e.src2 || e.operand2 || '';
      if (p.n === 'PT') return e.pt || '';
      if (p.n === 'OUT') return e.dest || '';
      return '';
    }
    // 这个参数是不是用户真的填过（没填就用默认值，默认值画成灰字，对齐 TIA 的 false）
    function isSet(pn) {
      return !!(e.params && e.params[pn] !== undefined && String(e.params[pn]).trim() !== '');
    }

    // 时间/数值型参数（对齐 TIA）：值画在框外 —— PT/PV 在左，ET/CV 在右，
    // 其余参数（IN/Q 等布尔量）值仍画在框内
    function outsideVal(pn) {
      return (meta.group === 'timer' && (pn === 'PT' || pn === 'ET')) ||
        (meta.group === 'counter' && (pn === 'PV' || pn === 'CV'));
    }
    var isTimer = meta.group === 'timer';
    var isCounter = meta.group === 'counter';
    // 框体功率流端子（定时器的 IN/Q、计数器的 CU/Q）：值来自接线，不是手填的操作数，
    // 所以线上不画红色 <???> 占位（对齐 TIA）
    var flowPrm = {};
    (meta.flow || []).forEach(function (n) { flowPrm[n] = true; });
    // 引脚支路（R / LD 接了触点支路）：这个引脚的值由导线送进来
    function chainOf(pn) {
      return !!(e.pins && e.pins[pn] && e.pins[pn].length);
    }
    // 统一时间写法：'5s' → 'T#5s'，保证框外显示永远带 T# 前缀
    function timeText(v) {
      v = String(v == null ? '' : v).trim();
      if (!v) return '';
      var N = root.PLC && root.PLC.normTime;
      var n = N ? N(v) : '';
      return n || v;
    }
    // 计数器是整数：绝不能走时间格式化（以前 PV=10 会被显示成 T#10ms）
    function intText(v) {
      v = String(v == null ? '' : v).trim();
      if (!v) return '';
      var n = parseFloat(v);
      return isNaN(n) ? v : String(n);
    }
    // 在线监视时本元件的实时值（定时器 = 已过时间 ET 毫秒；计数器 = 当前计数值）
    var liveNum = (ctx.liveDraw !== undefined && ctx.liveDraw !== null && typeof ctx.liveDraw === 'number')
      ? ctx.liveDraw : null;

    var textW = Math.max(4, Math.floor((bw - 16) / 5.6));
    var cy0 = by + titleH + typeH + 4;

    ins.forEach(function (p, i) {
      var ry = cy0 + i * rowH + 9;
      g += '<text x="' + (bx + 3) + '" y="' + ry + '" font-size="9" fill="' + stroke +
        '" font-family="Consolas" font-weight="600">' + esc(p.n) + '</text>';
      /* 这个引脚接了触点支路：值由导线送进来，不再画 "false" / <???>，
         也不再画那根短引线 —— 支路自己会画到盒子左边（对齐 TIA）。 */
      if (chainOf(p.n)) return;
      var v = String(valOf(p));
      if (outsideVal(p.n)) {
        // 框外左侧：短引线 + 值（双击可改）
        g += '<line x1="' + (bx - 10) + '" y1="' + (ry - 3) + '" x2="' + bx + '" y2="' + (ry - 3) +
          '" stroke="' + stroke + '" stroke-width="1"/>';
        var tv, tc;
        if (isTimer) {
          // PT 是"设定值"，在线时也保持不动（TIA 就是这样：只有 ET 在走）。
          // 以前这里把 PT 画成倒计时，数字每周期都在变，看着像"值在乱跑"。
          if (v) { tv = timeText(v); tc = SYM.addr; }
          else { tv = '<???>'; tc = '#e0006c'; }
        } else {
          // 计数器 PV：整数；没填就是红色占位（对齐 TIA，不再是 T#10ms）
          if (v) { tv = intText(v); tc = SYM.addr; }
          else { tv = '<???>'; tc = '#e0006c'; }
        }
        g += '<text data-prm="' + esc(e.id + ':' + p.n) + '"' +
          (isTimer && v ? ' data-tv="' + esc(e.id + ':PT') + '" data-preset="' + esc(timeText(v)) + '"' : '') +
          ' x="' + (bx - 12) + '" y="' + ry + '" text-anchor="end" font-size="9" fill="' + tc +
          '" font-family="Consolas">' + esc(fit(tv, 11)) + '</text>';
      } else {
        var nx = bx + 3 + p.n.length * 5.4 + 6;
        if (v) {
          // 默认值（例如计数器的 R=false）画灰色；用户填过的才画黑字
          var colIn = (!isSet(p.n) && p.soft) ? SYM.gray : SYM.text;
          g += '<text data-prm="' + esc(e.id + ':' + p.n) + '" x="' + nx + '" y="' + ry +
            '" font-size="9" fill="' + colIn + '" font-family="Consolas">' +
            esc(fit(v, textW)) + '</text>';
        } else if (meta.fb && !flowPrm[p.n]) {
          // FB 未赋值的输入参数：红色 <???> 占位（对齐 TIA，点击即可填写）
          g += '<text data-prm="' + esc(e.id + ':' + p.n) + '" x="' + nx + '" y="' + ry +
            '" font-size="9" font-style="italic" fill="#e0006c" font-family="Consolas">&lt;???&gt;</text>';
        }
      }
    });
    outs.forEach(function (p, i) {
      var ry = cy0 + i * rowH + 9;
      var nameX = bx + bw - 3;
      g += '<text x="' + nameX + '" y="' + ry + '" text-anchor="end" font-size="9" fill="' +
        stroke + '" font-family="Consolas" font-weight="600">' + esc(p.n) + '</text>';
      var v = String(valOf(p));
      if (outsideVal(p.n)) {
        // 框外右侧：短引线 + 值；离线显示初始值，在线显示实时值（橙色）
        g += '<line x1="' + (bx + bw) + '" y1="' + (ry - 3) + '" x2="' + (bx + bw + 10) + '" y2="' + (ry - 3) +
          '" stroke="' + stroke + '" stroke-width="1"/>';
        var tv2, tc2;
        if (isTimer) {
          if (liveNum !== null) { tv2 = fmtTime(liveNum); tc2 = '#bf8f00'; }
          else if (v) { tv2 = timeText(v); tc2 = SYM.text; }
          else { tv2 = 'T#0ms'; tc2 = SYM.gray; }
        } else {
          // 计数器 CV：当前计数值（在线橙色，离线 0）
          if (liveNum !== null) { tv2 = String(liveNum); tc2 = '#bf8f00'; }
          else if (v) { tv2 = intText(v); tc2 = SYM.text; }
          else { tv2 = '0'; tc2 = SYM.gray; }
        }
        g += '<text data-prm="' + esc(e.id + ':' + p.n) + '"' +
          (isTimer && p.n === 'ET' ? ' data-tv="' + esc(e.id + ':ET') + '"' : '') +
          (isCounter && p.n === 'CV' ? ' data-cv="' + esc(e.id + ':CV') + '"' : '') +
          ' x="' + (bx + bw + 12) + '" y="' + ry + '" font-size="9" fill="' + tc2 +
          '" font-family="Consolas">' + esc(fit(tv2, 11)) + '</text>';
      } else {
        var vx = nameX - p.n.length * 5.4 - 6;
        if (v) {
          var colOut = (!isSet(p.n) && p.soft) ? SYM.gray : SYM.text;
          g += '<text data-prm="' + esc(e.id + ':' + p.n) + '" x="' + vx + '" y="' + ry +
            '" text-anchor="end" font-size="9" fill="' + colOut + '" font-family="Consolas">' +
            esc(fit(v, textW)) + '</text>';
        } else if (meta.fb && !flowPrm[p.n]) {
          g += '<text data-prm="' + esc(e.id + ':' + p.n) + '" x="' + vx + '" y="' + ry +
            '" text-anchor="end" font-size="9" font-style="italic" fill="#e0006c" ' +
            'font-family="Consolas">&lt;???&gt;</text>';
        }
      }
    });

    /* 引脚小方块（对齐 TIA）：
       R / LD 这类"可以接一条触点支路"的布尔输入脚，在盒体左边框上画一个接线端子：
         · 没接支路 —— 空心白底小方块，提示"这里可以接线"
         · 接了支路 —— 变成实心小方块（已连接），支路导线正好停在这个方块上
       双击小方块 = 接一条触点支路（和右键菜单里的同一功能）。
       方块整个放在盒体**外面**（右缘贴着盒体左边界）：
       以前骑在边界上会压住盒内的 R / LD 字（用户反馈"这个 r 被遮挡了"）。 */
    var padPins = meta.pinBranches || [];
    if (padPins.length) {
      var padS = 7;
      padPins.forEach(function (pn) {
        var idx = -1;
        ins.forEach(function (p, i) { if (p.n === pn) idx = i; });
        if (idx < 0) return;
        var pry = cy0 + idx * rowH + 9 - 3;      // 该引脚引线的高度（和 pinWireY 一致）
        var conn = chainOf(pn);
        // 拖开口箭头悬停在这个引脚上：绿色高亮 = "松开就接到这里"
        var hot = ctx && ctx.dragTarget === ('pin:' + e.id + ':' + pn);
        if (hot) {
          g += '<rect x="' + (bx - padS - 5) + '" y="' + (pry - padS / 2 - 5) +
            '" width="' + (padS + 10) + '" height="' + (padS + 10) + '" rx="2.5"' +
            ' fill="#00b050" fill-opacity="0.18" stroke="#00b050" stroke-width="1.4"' +
            ' pointer-events="none"/>';
        }
        g += '<rect class="lad-body lad-pinport' + (conn ? ' connected' : '') + (hot ? ' hot' : '') + '"' +
          ' data-pin-port="' + esc(e.id + ':' + pn) + '"' +
          ' data-el="' + esc(e.id) + '"' +
          ' x="' + (bx - padS) + '" y="' + (pry - padS / 2) + '"' +
          ' width="' + padS + '" height="' + padS + '" rx="0.8"' +
          ' fill="' + (hot ? '#00b050' : (conn ? stroke : '#fff')) + '"' +
          ' stroke="' + (hot ? '#00803c' : stroke) + '" stroke-width="' + (hot ? 1.8 : 1.1) + '"' +
          ' style="cursor:pointer">' +
          '<title>' + esc(pn) + ' 端可接一条触点支路（双击这个方块，或拖开口箭头到这里）</title></rect>';
        // 方块只有 7px，拖放/点击不好命中 —— 外面罩一个 18px 的透明命中区
        // （只到 bx+5，不碰盒内 R / LD 的参数编辑区）
        g += '<rect data-pin-port="' + esc(e.id + ':' + pn) + '" data-el="' + esc(e.id) + '"' +
          ' x="' + (bx - padS - 6) + '" y="' + (pry - 9) + '" width="18" height="18"' +
          ' fill="transparent" style="cursor:pointer"/>';
      });
    }

    // 参数值的可点区域：透明命中矩形。
    // SVG 文字只有笔画本身能接收事件，双击落在笔画间隙会穿透到盒体，
    // 被当成"盒体双击"而打开调用选项 —— 用整块透明区域把每个参数值罩住。
    if (meta.fb) {
      ins.forEach(function (p, i) {
        if (flowPrm[p.n]) return;   // 功率流端子（IN）不可就地填操作数
        if (chainOf(p.n)) return;   // 接了触点支路的引脚：值来自导线，没有可填的框
        var ry = cy0 + i * rowH + 9;
        if (outsideVal(p.n)) {
          // 命中区只覆盖"框外那一小块写值的位置"，不要越过格子边界去盖住分支竖线
          g += '<rect data-prm="' + esc(e.id + ':' + p.n) + '" x="' + (bx - 52) + '" y="' + (ry - 11) +
            '" width="48" height="15" fill="transparent"/>';
        } else {
          var nrx = bx + 3 + p.n.length * 5.4 + 6;
          var nrw = Math.max(10, (bx + bw / 2 - 2) - (nrx - 2));
          g += '<rect data-prm="' + esc(e.id + ':' + p.n) + '" x="' + (nrx - 2) + '" y="' + (ry - 11) +
            '" width="' + nrw + '" height="15" fill="transparent"/>';
        }
      });
      outs.forEach(function (p, i) {
        if (flowPrm[p.n]) return;   // 功率流端子（Q）同样不可就地填
        var ry = cy0 + i * rowH + 9;
        var nmx = bx + bw - 3;
        if (outsideVal(p.n)) {
          g += '<rect data-prm="' + esc(e.id + ':' + p.n) + '" x="' + (bx + bw + 2) + '" y="' + (ry - 11) +
            '" width="74" height="15" fill="transparent"/>';
        } else {
          var nvx = nmx - p.n.length * 5.4 - 6;
          var nvw = Math.max(10, (nvx + 4) - (bx + bw / 2 + 2));
          g += '<rect data-prm="' + esc(e.id + ':' + p.n) + '" x="' + (bx + bw / 2 + 2) + '" y="' + (ry - 11) +
            '" width="' + nvw + '" height="15" fill="transparent"/>';
        }
      });
    }

    // 拖拽手柄
    g += '<circle class="drag-dot" cx="' + (x + 4) + '" cy="' + (by - 2) +
      '" r="4" fill="#fff" stroke="' + stroke + '" stroke-width="1.2" data-handle="drag" ' +
      'data-el="' + esc(e.id) + '" style="cursor:move"/>';

    g += '</g>';
    return g;
  }

  /* ---------- 引脚支路（V50，对齐 TIA） ----------
   * 计数器的 R / LD 是布尔输入引脚，除了双击填操作数，还可以**接一条触点支路**：
   *   母线 ──┤ I0.3 ├──┐
   *                    └──→ R（盒体左边）
   * 这条支路不属于任何列/行，所以单独画：从左侧母线起、按引脚高度一路向右，
   * 串过链上的触点，最后停在盒体左边的引脚引线上。
   * 功率流由 plc.js 单独算（母线 → 触点链），结果在 trace.pin 里，监视时同样上色。 */
  function drawPinChains(el, meta, cellX, cellW, cy, ev, NT) {
    var out = '';
    var geo = boxGeo(meta, cellX, cellW, el);
    var CHW = 62, CHH = 40;             // 紧凑触点格子（比正常格子窄一半）
    (meta.pinBranches || []).forEach(function (pn, pidx) {
      var chain = el.pins && el.pins[pn];
      if (!chain || !chain.length) return;
      var py = pinWireY(meta, cy, pn);      // 引脚引线的高度（R 端）
      /* 支路自己占一条"子行"，画在主线下 30px：
         再往上就贴着主线上的触点了（盒子内部的引脚间距只有 17px，放不下一个触点）。
         链尾用一个竖钩拐上去接进引脚 —— 竖钩放在盒体左边留白里（bx-56），
         那里没有 PT/PV 的数字，不会压字。 */
      var cY = cy + 30 + pidx * 34;
      var riseX = geo.bx - 56;
      var spec = 'pin:' + el.id + ':' + pn;
      var live = NT ? liveOf(NT, spec) : null;
      var x = GRID.padL;
      /* 每一段都带 data-live：在线扫描刷新时 updateLadLive 会按 trace.pin 重上色，
         否则导线只在渲染那一刻着色，触点闭合后后面那段还停在断电的蓝色虚线上。 */
      var liveAttr = ' data-live="' + esc(spec) + '"';
      // 母线取电点（小圆点：和主线区分，表示这条支路是从母线分出来的）
      out += '<circle class="lad-pindot" data-live="' + esc(spec) + '" cx="' + x + '" cy="' + cY +
        '" r="2.6" fill="' + (live ? LIVE : SYM.body) + '"/>';
      // 母线到第一个元件之间的短线（第一个元件自己从 x 开始画引线，这里补个接点）
      out += '<line class="lad-wire lad-pinwire"' + liveAttr + ' x1="' + x + '" y1="' + cY + '" x2="' + (x + 2) +
        '" y2="' + cY + '"' + wireAttrs(live) + '/>';
      chain.forEach(function (ce) {
        var w = ce.type === 'OPEN_END' ? 34 : CHW;
        var evc = ev.elem[ce.id] || {};
        var cls = '';
        if (ev.online) {
          cls = (evc.out ? 'el-true' : 'el-false') +
            (evc.in ? ' in-live' : ' in-dead') + (evc.out ? ' out-live' : ' out-dead');
        }
        out += '<g class="' + cls + '">' +
          drawElement(ce, x, cY - CHH / 2, w, CHH, {
            sel: ev.selEl === ce.id,
            noArrow: false,
            compact: true,
            dupInst: null,
            liveDraw: null,
            online: !!ev.online
          }) + '</g>';
        x += w;
      });
      // 链尾 → 竖钩 → 引脚引线：横一段、竖一段、再横一段进盒子
      if (x < riseX) {
        out += '<line class="lad-wire lad-pinwire"' + liveAttr + ' x1="' + x + '" y1="' + cY + '" x2="' + riseX +
          '" y2="' + cY + '"' + wireAttrs(live) + '/>';
      }
      out += '<line class="lad-wire lad-pinwire"' + liveAttr + ' x1="' + riseX + '" y1="' + cY + '" x2="' + riseX +
        '" y2="' + py + '"' + wireAttrs(live) + '/>';
      out += '<line class="lad-wire lad-pinwire"' + liveAttr + ' x1="' + riseX + '" y1="' + py + '" x2="' + (geo.bx - 7) +
        '" y2="' + py + '"' + wireAttrs(live) + '/>';
    });
    return out;
  }

  function line(x1, y1, x2, y2, cls) {
    return '<line class="' + (cls || 'lad-wire') + '" x1="' + x1 + '" y1="' + y1 +
      '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + SYM.body + '" stroke-width="1.6"/>';
  }
  function rect(x1, y1, w1, h1, cls) {
    return '<rect class="' + (cls || 'lad-body') + '" x="' + x1 + '" y="' + y1 + '" width="' + w1 +
      '" height="' + h1 + '" fill="#fff" stroke="' + SYM.body + '" stroke-width="1.6"/>';
  }

  /* ============================================================
   * 网络绘制 + 几何输出
   * ============================================================ */
  /* ============================================================
   * 在线监视：导线通电着色（V32）
   * trace 结构（plc.js execNetwork）：
   *   { cols:[ {in, out, wires:[{in,out}] } ], final }
   * 导线上用 data-live 记下"这根的电位查哪儿"，刷新时按它重上色：
   *   colin:c     → 该列入口电位（分出/落下竖线）
   *   colout:c:b  → 该列第 b 条分支的出口电位（汇合竖线、空分支直通线）
   *   link:c      → 第 c 列整体输出（列间连线）
   *   final       → 网络末端电位（末端封口 / 悬空尾线）
   * ============================================================ */
  var LIVE = '#00b050';       // 通电：绿
  var DEAD = '#1a6fa8';       // 未通电：暗蓝 + 虚线（与元件引线的"没通"一致）

  function liveOf(NT, spec) {
    if (!NT || !spec) return null;
    var p = String(spec).split(':');
    var k = p[0];
    if (k === 'final') return !!NT.final;
    // 引脚支路：pin:<元件id>:<引脚名>（母线 → 触点 → R / LD）
    if (k === 'pin') {
      var pv = NT.pin ? NT.pin[p[1] + ':' + p[2]] : null;
      return (pv === undefined || pv === null) ? null : !!pv;
    }
    var col = NT.cols && NT.cols[+p[1]];
    if (!col) return null;
    if (k === 'colin') return !!col.in;
    if (k === 'link') return !!col.out;
    if (k === 'colout') {
      var w = col.wires && col.wires[+p[2]];
      return !!(w && w.out);
    }
    return null;
  }

  // 渲染时用：直接拼出 stroke 属性（live 为 null = 离线，用默认色）
  function wireAttrs(live) {
    if (live === null || live === undefined) {
      return ' stroke="' + SYM.body + '" stroke-width="1.6"';
    }
    return live
      ? ' stroke="' + LIVE + '" stroke-width="2.6"'
      : ' stroke="' + DEAD + '" stroke-width="1.6" stroke-dasharray="5 3"';
  }

  // 刷新时用：改已有节点
  function paintWire(node, live) {
    if (!node || live === null || live === undefined) return;
    // 引脚支路起点的小圆点是填充的圆：按 fill 上色，不要改 stroke
    if (node.tagName && node.tagName.toLowerCase() === 'circle') {
      node.setAttribute('fill', live ? LIVE : DEAD);
      return;
    }
    if (live) {
      node.setAttribute('stroke', LIVE);
      node.setAttribute('stroke-width', '2.6');
      node.removeAttribute('stroke-dasharray');
    } else {
      node.setAttribute('stroke', DEAD);
      node.setAttribute('stroke-width', '1.6');
      node.setAttribute('stroke-dasharray', '5 3');
    }
  }

  /* ============================================================
   * 在线值气泡（TRUE / FALSE / 数值）
   * 位置：器件符号**下方**、导线之下那条空白带（cy + 11 起，高 12）
   *   · 触点/线圈的符号只到 cy ± 10，行底在 cy + 34 —— 这块是空的
   *   · 之前画在 y + 12（符号上沿往下 12px），正好压在"地址 / 符号名"
   *     两行标签上，监视时 TRUE/FALSE 会和标签叠在一起
   * 由 updateLadLive() 每个扫描周期调用，按 trace 增删改，不重建 DOM
   * ============================================================ */
  function badgeText(draw) {
    if (draw === undefined || draw === null || draw === false) return '';
    var v = typeof draw === 'boolean' ? 'TRUE' : String(draw);
    if (typeof draw === 'number' && Math.abs(draw) > 10000) v = (draw / 1000).toFixed(1) + 's';
    return v;
  }

  function syncBadges(svg, NT) {
    if (!svg) return;
    // 先收掉上一轮的（元件被删/值变 false 时也要消失）
    Array.prototype.slice.call(svg.querySelectorAll('.lad-val')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    if (!NT || !NT.elem) return;

    Array.prototype.slice.call(svg.querySelectorAll('.lad-el')).forEach(function (g) {
      var hit = g.querySelector('.hit');
      if (!hit) return;
      var id = hit.getAttribute('data-el');
      var trace = NT.elem[id];
      if (!trace) return;

      // 定时器 FB 的 ET/PT 已画在框外（data-tv 实时刷新），不再重复画气泡；
      // PT 没填时没有 data-tv，再按 ET / CV 引脚兜一次，避免气泡跑到盒体上方
      if (g.querySelector && (g.querySelector('[data-tv]') || g.querySelector('[data-prm$=":ET"]') ||
        g.querySelector('[data-prm$=":CV"]'))) return;

      var vtxt = badgeText(trace.draw);
      if (!vtxt) return;

      var hx = +hit.getAttribute('x'), hy = +hit.getAttribute('y');
      var hw = +hit.getAttribute('width'), hh = +hit.getAttribute('height');
      if (isNaN(hx) || isNaN(hw) || hw <= 0) return;

      var maxChars = Math.max(3, Math.floor((hw - 12) / 5.6));
      var show = fit(vtxt, maxChars);
      var bw = Math.min(hw - 4, Math.max(20, show.length * 5.6 + 9));
      var cx = hx + hw / 2;
      var top = hy + hh / 2 + 13;          // 导线（cy）下方 13px：线圈半圆到 cy+10，留 3px 空隙

      var NS = 'http://www.w3.org/2000/svg';
      var badge = document.createElementNS(NS, 'g');
      badge.setAttribute('class', 'lad-val');
      badge.setAttribute('data-el', id);          // 便于刷新时对账 / 测试定位
      badge.setAttribute('pointer-events', 'none');

      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', (cx - bw / 2).toFixed(1));
      rect.setAttribute('y', top.toFixed(1));
      rect.setAttribute('width', bw.toFixed(1));
      rect.setAttribute('height', '12');
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', '#f1faf4');
      rect.setAttribute('stroke', '#8fcfa8');
      rect.setAttribute('stroke-width', '0.8');

      var txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', cx.toFixed(1));
      txt.setAttribute('y', (top + 9).toFixed(1));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '8');
      txt.setAttribute('fill', '#0a7d3a');
      txt.setAttribute('font-family', 'Consolas');
      txt.setAttribute('font-weight', '700');
      txt.textContent = show;

      badge.appendChild(rect);
      badge.appendChild(txt);
      svg.appendChild(badge);
    });
  }

  // 在线监视：刷新框外时间值（ET 正数 / PT 设定值），由 app.js 每扫描周期调用
  function syncTimeValues(svg, NT) {
    if (!svg) return;
    Array.prototype.slice.call(svg.querySelectorAll('[data-tv]')).forEach(function (t) {
      var spec = (t.getAttribute('data-tv') || '').split(':');
      if (spec.length < 2) return;
      var tr = NT && NT.elem ? NT.elem[spec[0]] : null;
      var et = tr && typeof tr.draw === 'number' ? tr.draw : 0;
      if (spec[1] === 'ET') { t.textContent = fmtTime(et); return; }
      if (spec[1] === 'PT') {
        // PT 是设定值，不跟着时间跑（免得看起来像"值在乱跑"）
        t.textContent = t.getAttribute('data-preset') || 'T#0ms';
      }
    });
    // 盒体上方的值框：定时器显示经过时间、计数器显示当前计数
    Array.prototype.slice.call(svg.querySelectorAll('[data-tvbox]')).forEach(function (t) {
      var id = t.getAttribute('data-tvbox');
      var kind = t.getAttribute('data-kind');
      var tr = NT && NT.elem ? NT.elem[id] : null;
      var v = tr && typeof tr.draw === 'number' ? tr.draw : 0;
      var txt = kind === 'CV' ? String(v) : fmtTime(v);
      if (t.textContent !== txt) {
        t.textContent = txt;
        var rect = t.previousElementSibling;
        if (rect && rect.classList && rect.classList.contains('lad-vbox')) {
          var w = Math.max(42, txt.length * 6.2 + 14);
          var cx = +t.getAttribute('x') || 0;
          rect.setAttribute('width', w.toFixed(1));
          rect.setAttribute('x', (cx - w / 2).toFixed(1));
        }
      }
    });
  }

  function drawNetwork(net, netIdx, ev) {
    var L = calcLayout(net);
    var svg = [];
    var geo = { wires: [], slots: [], elements: [] };
    // 在线监视：本网络的功率流追踪（没有就是离线）
    var NT = (ev.online && ev.netTrace) ? ev.netTrace : null;
    // 本网络的行距 / 顶部留白（含定时器/计数器时都更大）
    var rowH = L.rowH || GRID.h;
    var padT = L.padT || GRID.padT;

    // 统一几何：所有列共享同一行基线，第 i 条分支的中线 y
    function rowCy(i) { return padT + i * rowH + rowH / 2; }

    // 各列起始 X（列之间留 gap）
    var colXs = [];
    // 第 1 列含定时器/计数器 FB 时整体右移：给框外的 PT/PV 时间值留出位置，
    // 避免文字越过左母线（对齐 TIA 排版）
    var col0Extra = 0;
    (function () {
      var c0 = net.columns[0];
      if (!c0) return;
      for (var i0 = 0; i0 < c0.branches.length && !col0Extra; i0++) {
        for (var j0 = 0; j0 < c0.branches[i0].length; j0++) {
          var e0 = c0.branches[i0][j0];
          var m0 = e0 && e0.type && INSTR() ? INSTR().info(e0.type) : null;
          if (m0 && m0.fb && (m0.group === 'timer' || m0.group === 'counter')) {
            col0Extra = 48;
            break;
          }
        }
      }
    })();
    var cx = GRID.padL + col0Extra;
    for (var ci = 0; ci < net.columns.length; ci++) {
      colXs.push(cx);
      cx += (L.widths[ci] || GRID.cellW) + GRID.gap;
    }
    var lastColRight = colXs.length
      ? colXs[colXs.length - 1] + (L.widths[colXs.length - 1] || GRID.cellW)
      : GRID.padL;

    var totalBranchRows = 1;
    for (var tb = 0; tb < net.columns.length; tb++) {
      totalBranchRows = Math.max(totalBranchRows, net.columns[tb].branches.length);
    }

    // ============ 1. 左母线 ============
    var railTop = padT - 8;
    var railBot = padT + totalBranchRows * rowH - rowH + rowH / 2 + 8;
    /* 引脚支路（R / LD 上的触点链）画在主线下 30px 的子行上，
       这条子行比网络的最后一行还低 —— 母线必须跟着延伸下去，
       否则支路起点的小圆点悬在母线末端外面，看起来就像"触点悬空"。 */
    for (var pcx = 0; pcx < net.columns.length; pcx++) {
      var pcolx = net.columns[pcx];
      for (var pbx = 0; pbx < pcolx.branches.length; pbx++) {
        var pbrx = pcolx.branches[pbx];
        for (var pex = 0; pex < pbrx.length; pex++) {
          var pelx = pbrx[pex];
          if (!pelx || !pelx.pins) continue;
          var pmetax = INSTR() ? INSTR().info(pelx.type) : null;
          var pnames = (pmetax && pmetax.pinBranches) || [];
          var pdepth = 0;
          for (var pni = 0; pni < pnames.length; pni++) {
            var pch = pelx.pins[pnames[pni]];
            if (pch && pch.length) pdepth++;
          }
          if (!pdepth) continue;
          var pbot = rowCy(pbx) + 30 + (pdepth - 1) * 34 + 8;
          if (pbot > railBot) railBot = pbot;
        }
      }
    }
    var railKey = netIdx + ':rail';
    svg.push('<line class="lad-rail' + (ev.selSeg === railKey ? ' sel' : '') + '" x1="' + GRID.padL +
      '" y1="' + railTop + '" x2="' + GRID.padL + '" y2="' + railBot +
      '" stroke="' + (ev.selSeg === railKey ? '#1a6fa8' : SYM.body) +
      '" stroke-width="' + (ev.selSeg === railKey ? 3.2 : 2.6) + '"' +
      (ev.selSeg === railKey ? ' stroke-dasharray="6 3"' : '') +
      ' pointer-events="none"/>');
    // 母线透明命中线
    svg.push('<line class="lad-hit" x1="' + GRID.padL + '" y1="' + railTop +
      '" x2="' + GRID.padL + '" y2="' + railBot +
      '" stroke="transparent" stroke-width="14" data-seg="' + railKey +
      '" style="cursor:pointer"/>');

    // ============ 1.5 竖线（先画，压在元件下面）：分出竖线（左）+ 汇合竖线（右，按行分段）============
    // 左（分出）：分支从主线引出，一根到底；第 1 列与母线重合时由母线充当
    // 右（汇合）：只有"闭合分支"才画它上方那一段；开放分支（末端是 OPEN_END）不画
    // 键格式：左 = net:vseg:col:L ；右 = net:vseg:col:row:R（按行分段，可单独断开）
    for (var vc = 0; vc < net.columns.length; vc++) {
      var vcol = net.columns[vc];
      var vn = vcol.branches.length;
      if (vn <= 1) continue;
      var vLX = colXs[vc];
      var vRX = vLX + (L.widths[vc] || GRID.cellW);
      var vTop = rowCy(0);
      var vBot = rowCy(vn - 1);

      // ---- 左竖线（分出）----
      if (Math.abs(vLX - GRID.padL) >= 0.5) {
        var vKeyL = netIdx + ':vseg:' + vc + ':L';
        var selL = (ev.selSeg === vKeyL);
        var specL = 'colin:' + vc;
        svg.push('<line class="lad-wire lad-join' + (selL ? ' sel' : '') + '" x1="' + vLX +
          '" y1="' + vTop + '" x2="' + vLX + '" y2="' + vBot + '"' +
          (selL ? ' stroke="#1a6fa8" stroke-width="2.6" stroke-dasharray="6 3"'
            : wireAttrs(NT ? liveOf(NT, specL) : null)) +
          ' data-live="' + specL + '" pointer-events="none"/>');
        svg.push('<line class="lad-hit" x1="' + vLX + '" y1="' + vTop + '" x2="' + vLX +
          '" y2="' + vBot + '" stroke="transparent" stroke-width="16" data-seg="' + vKeyL +
          '" style="cursor:pointer"/>');
      }

      // ---- 右竖线（汇合）：逐行画小段 ----
      for (var vb = 1; vb < vn; vb++) {
        if (isTerminalBranch(vcol.branches[vb])) continue;   // 开放分支 / 线圈收尾：不汇合
        // 上面那一行是开放分支时没有"可汇合的目标"，不画悬空竖线
        if (vb > 1 && isTerminalBranch(vcol.branches[vb - 1])) continue;
        var yTop = rowCy(vb - 1), yBot = rowCy(vb);
        var vKeyR = netIdx + ':vseg:' + vc + ':' + vb + ':R';
        var selR = (ev.selSeg === vKeyR);
        var specR = 'colout:' + vc + ':' + vb;
        svg.push('<line class="lad-wire lad-join' + (selR ? ' sel' : '') + '" x1="' + vRX +
          '" y1="' + yTop + '" x2="' + vRX + '" y2="' + yBot + '"' +
          (selR ? ' stroke="#1a6fa8" stroke-width="2.6" stroke-dasharray="6 3"'
            : wireAttrs(NT ? liveOf(NT, specR) : null)) +
          ' data-live="' + specR + '" pointer-events="none"/>');
        svg.push('<line class="lad-hit" x1="' + vRX + '" y1="' + yTop + '" x2="' + vRX +
          '" y2="' + yBot + '" stroke="transparent" stroke-width="16" data-seg="' + vKeyR +
          '" style="cursor:pointer"/>');
      }
      geo.wires.push({ net: netIdx, col: vc, vseg: vc, x: vLX, x2: vRX, y: vTop, y2: vBot });
    }

    // ============ 2. 绘制所有元素（含引线） ============
    for (var c = 0; c < net.columns.length; c++) {
      var col = net.columns[c];
      var colW = L.widths[c] || GRID.cellW;
      var cX = colXs[c];
      var nBr = col.branches.length;

      for (var bi = 0; bi < nBr; bi++) {
        var branch = col.branches[bi];
        var cy = rowCy(bi);
        var y = cy - GRID.h / 2;
        var n = branch.length;

        if (n === 0) {
          // 空分支：整段直通导线
          continue;   // 水平线统一在步骤 3 画
        }

        // 单元格宽度按各元件需要的宽度分配（盒式指令不再被压扁）
        var cells = cellLayout(branch, cX, colW);
        for (var ei = 0; ei < n; ei++) {
          var el = branch[ei];
          var ex = cells[ei].x;
          var segW = cells[ei].w;
          var elEv = ev.elem[el.id] || {};
          var cls = '';
          if (ev.online) {
            // 符号按 out 上色；引线左右两侧分别按 in / out 上色（V32）
            cls = (elEv.out ? 'el-true' : 'el-false') +
              (elEv.in ? ' in-live' : ' in-dead') +
              (elEv.out ? ' out-live' : ' out-dead');
          }

          geo.elements.push({
            net: netIdx, col: c, branch: bi, idx: ei, id: el.id,
            x: ex, y: y, w: segW, h: GRID.h
          });
          geo.slots.push({
            net: netIdx, col: c, branch: bi, pos: ei,
            x: ex, y: y, w: segW, h: GRID.h
          });

          // 开放分支被线圈收尾时，开口箭头不再显示（线圈就是分支的终点）
          var prevEl = ei > 0 ? branch[ei - 1] : null;
          var hideOpenEnd = el.type === 'OPEN_END' && prevEl && isCoilType(prevEl.type);

          if (el.type !== 'EMPTY' && !hideOpenEnd) {
            svg.push('<g class="' + cls + '">' +
              drawElement(el, ex, y, segW, GRID.h, {
                sel: ev.selEl === el.id,
                noArrow: bi === 0,          // 主线上的 OPEN_END 只当导线画
                dupInst: ev.dupInst || null, // FB 实例名重复标红
                liveDraw: (ev.online && elEv) ? elEv.draw : null,  // 在线实时值（定时器 = ET 毫秒）
                online: !!ev.online,
                dragTarget: ev.dragArrow ? (ev.dragArrow.target || null) : null  // 拖开口箭头的落点 key（引脚高亮用）
              }) + '</g>');
          }

          // 引脚支路（R / LD 接了触点）：母线 → 触点 → 盒体左边的引脚
          if (el.pins) {
            var pmeta = INSTR() ? INSTR().info(el.type) : null;
            if (pmeta && pmeta.pinBranches && pmeta.pinBranches.length) {
              svg.push(drawPinChains(el, pmeta, ex, segW, cy, ev, NT));
            }
          }

          // 在线值气泡改由 syncBadges() 统一画（见文件后面）——
          // 以前渲染时在这里画一次、app.js 刷新时又新建一个 .lt-val，
          // 两处都贴在符号上沿，正好压在"地址 / 符号名"两行标签上。
        }
      }
    }

    // ============ 3. 水平连线 ============
    // 每列每条分支：从列左边界画到列右边界（元素自身的引线会覆盖中间部分）
    // 第 1 列因框外时间值右移（col0Extra）时，连线从母线画起，避免断线
    for (var hc = 0; hc < net.columns.length; hc++) {
      var hcol = net.columns[hc];
      var hcX = colXs[hc];
      var hx1 = (hc === 0 && col0Extra) ? GRID.padL : hcX;   // 第 1 列：从母线接过来
      var hcW = L.widths[hc] || GRID.cellW;
      for (var hb = 0; hb < hcol.branches.length; hb++) {
        var hcy = rowCy(hb);
        var hasContent = hcol.branches[hb].length > 0;
        if (!hasContent) {
          // 空分支：直通线，选中后按 Delete 可删除该分支（图1 的底边）
          var ebKey = netIdx + ':ebr:' + hc + ':' + hb;
          var ebSpec = 'colout:' + hc + ':' + hb;
          var ebSel = (ev.selSeg === ebKey);
          svg.push('<line class="lad-wire lad-seg' + (ebSel ? ' sel' : '') + '" x1="' + hx1 + '" y1="' + hcy +
            '" x2="' + (hcX + hcW) + '" y2="' + hcy + '"' +
            (ebSel ? ' stroke="#1a6fa8" stroke-width="2.6" stroke-dasharray="6 3"'
              : wireAttrs(NT ? liveOf(NT, ebSpec) : null)) +
            ' data-live="' + ebSpec + '" data-seg="' + ebKey + '" pointer-events="none"/>');
        } else if (hc === 0 && col0Extra) {
          // 第 1 列右移后，母线到列起点之间补一段连线（内容分支的引线只从列起点画）
          svg.push('<line class="lad-wire" x1="' + GRID.padL + '" y1="' + hcy + '" x2="' + hcX + '" y2="' + hcy +
            '" stroke="' + SYM.body + '" stroke-width="1.6" pointer-events="none"/>');
        }
        // 元件是按"自然宽度"从左往右排的，行尾可能还留一段空档（列宽由最长分支决定）：
        // 这一段必须补上导线，否则短的那一行会在元件后面断线。
        // 末端是开口箭头（OPEN_END）时不补 —— 箭头就是这条支路的终点。
        if (hasContent) {
          var hbr = hcol.branches[hb];
          var hlast = hbr[hbr.length - 1];
          if (hlast && hlast.type !== 'OPEN_END') {
            var hcells = cellLayout(hbr, hcX, hcW);
            var hLastCell = hcells.length ? hcells[hcells.length - 1] : null;
            var hEnd = hLastCell ? (hLastCell.x + hLastCell.w) : hcX;
            var hRight = hcX + hcW;
            if (hRight - hEnd > 0.5) {
              var htSpec = 'colout:' + hc + ':' + hb;
              svg.push('<line class="lad-wire" x1="' + hEnd + '" y1="' + hcy +
                '" x2="' + hRight + '" y2="' + hcy + '"' +
                wireAttrs(NT ? liveOf(NT, htSpec) : null) +
                ' data-live="' + htSpec + '"/>');
            }
          }
        }
        geo.wires.push({ net: netIdx, col: hc, branch: hb, x: hx1, x2: hcX + hcW, y: hcy });
      }
    }

    // 列间连线：主线（第 1 行）画一条；分支行同样要画 —— 否则两支路跨列时，
    // 列与列之间那 30px 的空档没人补，看着就是断线。
    for (var cc = 0; cc < net.columns.length - 1; cc++) {
      var rX = colXs[cc] + (L.widths[cc] || GRID.cellW);
      var lX = colXs[cc + 1];
      // 两列都有这一行才连（分支数不同的地方由阶梯汇合的竖线处理）
      var lRows = Math.min(net.columns[cc].branches.length, net.columns[cc + 1].branches.length);
      for (var lr = 0; lr < lRows; lr++) {
        var lPrevBr = net.columns[cc].branches[lr] || [];
        // 上一列这一行已经用开口箭头收尾了，就不再往右连
        if (lr > 0 && isTerminalBranch(lPrevBr)) continue;
        var lcy0 = rowCy(lr);
        var lKey = netIdx + ':link:' + cc + ':' + lr;
        var lSpec = lr === 0 ? ('link:' + cc) : ('colout:' + cc + ':' + lr);
        var lSel = (ev.selSeg === lKey);
        svg.push('<line class="lad-wire lad-seg' + (lSel ? ' sel' : '') + '" ' +
          'x1="' + rX + '" y1="' + lcy0 + '" x2="' + lX + '" y2="' + lcy0 + '"' +
          (lSel ? ' stroke="#1a6fa8" stroke-width="2.6" stroke-dasharray="6 3"'
            : wireAttrs(NT ? liveOf(NT, lSpec) : null)) +
          ' data-live="' + lSpec + '" data-seg="' + lKey + '" pointer-events="none"/>');
        geo.wires.push({ net: netIdx, col: cc, branch: lr, x: rX, x2: lX, y: lcy0, link: true });
      }
    }

    // ============ 3.5 整段导线命中层（同一列内两个器件之间的线也能点选）============
    // 之前只有"列与列之间"的 link 能选，列内器件之间只有元件引线（点它=选元件）
    // 或干脆没有命中区，看起来就是"这条线选不中"。
    // 这里按元件符号的命中框把每列这一行切成若干小段：符号上归元件，段与段之间归导线。
    // 键：net:span:col:row:k —— 每一小段都独立成键，选中/高亮只作用于"光标那一段"
    //     k = 这段线左边有几个元件（既是"第几个空档"，也是"在这一列哪条边界上"）
    var spanHits = [];
    for (var sc = 0; sc < net.columns.length; sc++) {
      var sCol = net.columns[sc];
      var sW = L.widths[sc] || GRID.cellW;
      for (var sb = 0; sb < sCol.branches.length; sb++) {
        var sBranch = sCol.branches[sb];
        var sKey = netIdx + ':span:' + sc + ':' + sb;
        var scy = rowCy(sb);

        // 只画在"元件之间的空档"上：选中态补虚线高亮 + 一节透明命中线
        // k = 这段线左边有几个元件 —— 后面"在这段线处开分支"就按它切列
        var emitSpan = function (k, a, b) {
          if (b - a < 6) return;
          var oneKey = sKey + ':' + k;
          if (ev.selSeg === oneKey) {
            // 选中态：淡蓝底 + 蓝色虚线（和 TIA 选中导线的观感一致）
            spanHits.push('<line x1="' + a + '" y1="' + scy + '" x2="' + b + '" y2="' + scy +
              '" stroke="rgba(26,111,168,.18)" stroke-width="12" stroke-linecap="round" ' +
              'pointer-events="none"/>');
            spanHits.push('<line class="lad-seg sel" x1="' + a + '" y1="' + scy +
              '" x2="' + b + '" y2="' + scy +
              '" stroke="#1a6fa8" stroke-width="2.6" stroke-dasharray="6 3" pointer-events="none"/>');
          }
          spanHits.push(spanHit(a, b, scy, oneKey));
        };

        if (sBranch.length === 0) {
          emitSpan(0, colXs[sc], colXs[sc] + sW);
          continue;
        }
        var sCells = cellLayout(sBranch, colXs[sc], sW);
        var cursor = colXs[sc];
        var colEnd = colXs[sc] + sW;
        for (var sei = 0; sei < sBranch.length; sei++) {
          var sel0 = sBranch[sei];
          var sex = sCells[sei].x, sew = sCells[sei].w;
          var prev0 = sei > 0 ? sBranch[sei - 1] : null;
          var hide0 = sel0.type === 'OPEN_END' && prev0 && isCoilType(prev0.type);
          var hr = (sel0.type === 'EMPTY' || hide0) ? null : symbolHitRange(sel0, sex, sew);
          if (hr) {
            emitSpan(sei, cursor, hr[0]);
            if (hr[1] > cursor) cursor = hr[1];
          }
        }
        emitSpan(sBranch.length, cursor, colEnd);
      }
    }
    if (spanHits.length) {
      svg.push('<g class="lad-hit-layer lad-span-layer">' + spanHits.join('') + '</g>');
    }


    // 分支数变化处的跨列竖线：只在"分支数增加"的位置补一根
    for (var mc = 0; mc < net.columns.length - 1; mc++) {
      var mPrev = net.columns[mc].branches.length;
      var mNext = net.columns[mc + 1].branches.length;
      if (mNext <= mPrev) continue;          // 只处理"增加"
      // 下一列自己已有竖线（步骤4会画），此处不补，避免双线
    }

    // ============ 5. 末端封口 ============
    // 末列多分支时，右（汇合）竖线就是封口竖杠（步骤 4 已画，不重复画第二根）
    // 末列没有汇合竖线（单分支 / 分支全部开放）时补一小段横线 + 竖杠端点
    var lastIdx = net.columns.length - 1;
    var lastHasJoin = false;
    if (lastIdx >= 0) {
      var lcol = net.columns[lastIdx];
      for (var lb = 1; lb < lcol.branches.length; lb++) {
        if (isTerminalBranch(lcol.branches[lb])) continue;
        if (lb > 1 && isTerminalBranch(lcol.branches[lb - 1])) continue;
        lastHasJoin = true; break;
      }
    }

    // 主线最后一格没接线圈 = 这条支路还悬空：横线一直拖到右边，末端画 » 开口箭头带
    // （对齐 TIA）。少了这一段，末列多分支会和汇合竖线一起收成一个"闭合方框"，
    // 看起来像短路环 —— 也就是"这样是不行的"那张图。
    var mainRow = (lastIdx >= 0 && net.columns[lastIdx].branches[0]) || [];
    var mainTailEl = mainRow.length ? mainRow[mainRow.length - 1] : null;
    // 空横线（新建网络那种）保持原来的短封口，别把一整条空线拉长
    var dangling = !(mainTailEl && isCoilType(mainTailEl.type)) &&
      (mainRow.length > 0 || lastHasJoin);
    var tailX = dangling ? lastColRight + 120 : lastColRight;

    if (lastIdx >= 0 && dangling) {
      var tcy = rowCy(0);
      var tLive = NT ? liveOf(NT, 'final') : null;
      svg.push('<line class="lad-wire" x1="' + lastColRight + '" y1="' + tcy +
        '" x2="' + (tailX - 6) + '" y2="' + tcy + '"' +
        wireAttrs(tLive) + ' data-live="final"/>');
      // » 双箭头 = TIA 的"开口端"标记
      var ax2 = tailX - 4;
      svg.push('<path class="lad-openend lad-dangle" d="M ' + (ax2 - 12) + ' ' + (tcy - 6) +
        ' L ' + (ax2 - 4) + ' ' + tcy + ' L ' + (ax2 - 12) + ' ' + (tcy + 6) +
        ' M ' + (ax2 - 4) + ' ' + (tcy - 6) + ' L ' + (ax2 + 4) + ' ' + tcy +
        ' L ' + (ax2 - 4) + ' ' + (tcy + 6) +
        '" fill="none" stroke="' + (tLive ? LIVE : SYM.body) + '" data-live-arrow="final"' +
        ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>');
    } else if (lastIdx >= 0 && !lastHasJoin) {
      var ecy0 = rowCy(0);
      var eLive = NT ? liveOf(NT, 'final') : null;
      svg.push('<line class="lad-wire" x1="' + lastColRight + '" y1="' + ecy0 +
        '" x2="' + (lastColRight + 12) + '" y2="' + ecy0 + '"' +
        wireAttrs(eLive) + ' data-live="final"/>');
      svg.push('<line class="lad-bus" x1="' + (lastColRight + 12) + '" y1="' + (ecy0 - 7) +
        '" x2="' + (lastColRight + 12) + '" y2="' + (ecy0 + 7) +
        '" stroke="' + SYM.body + '" stroke-width="2.2" stroke-linecap="round"/>');
    }

    // ============ 6. 分支手柄 ============
    var handles = [];
    for (var hbc = 0; hbc < net.columns.length; hbc++) {
      var hbCol = net.columns[hbc];
      if (hbCol.branches.length <= 1) continue;
      for (var hbi = 1; hbi < hbCol.branches.length; hbi++) {
        handles.push('<circle class="br-handle" cx="' + (colXs[hbc] - 6) + '" cy="' + rowCy(hbi) +
          '" r="4" fill="#fff" stroke="#1a6fa8" stroke-width="1.3" ' +
          'data-branch="' + netIdx + ':' + hbc + ':' + hbi + '" style="cursor:crosshair"/>');
      }
    }
    if (handles.length) svg.push('<g class="br-handles">' + handles.join('') + '</g>');

    // ============ 7. 命中层（最上层，最后画）============
    var hitLines = [];

    // 空分支命中线
    // 空分支命中线
    for (var ebc = 0; ebc < net.columns.length; ebc++) {
      var ebCol = net.columns[ebc];
      var ebX = colXs[ebc];
      var ebW = L.widths[ebc] || GRID.cellW;
      for (var ebb = 0; ebb < ebCol.branches.length; ebb++) {
        if (ebCol.branches[ebb].length > 0) continue;
        var eby = rowCy(ebb);
        var ebKey2 = netIdx + ':ebr:' + ebc + ':' + ebb;
        hitLines.push('<line class="lad-hit" x1="' + ebX + '" y1="' + eby +
          '" x2="' + (ebX + ebW) + '" y2="' + eby +
          '" stroke="transparent" stroke-width="16" data-seg="' + ebKey2 +
          '" style="cursor:pointer"/>');
      }
    }

    // 列间命中线（主线一行）
    for (var hic = 0; hic < net.columns.length - 1; hic++) {
      var hiRX = colXs[hic] + (L.widths[hic] || GRID.cellW);
      var hiLX = colXs[hic + 1];
      var hiKey = netIdx + ':link:' + hic + ':0';
      hitLines.push('<line class="lad-hit" x1="' + hiRX + '" y1="' + rowCy(0) +
        '" x2="' + hiLX + '" y2="' + rowCy(0) +
        '" stroke="transparent" stroke-width="16" data-seg="' + hiKey +
        '" style="cursor:pointer"/>');
    }
    if (hitLines.length) svg.push('<g class="lad-hit-layer">' + hitLines.join('') + '</g>');

    // ============ 8. 拖拽落点小方块（只在该网络正在拖/选中开口箭头时出现）============
    // 对齐 TIA：主线（第 1 行）每个器件后一个方块，分支上只在它自己的开口箭头处一个方块
    if (ev.dragArrow && (ev.dragArrow.net == null || ev.dragArrow.net === netIdx)) {
      var tgtKey = ev.dragArrow.target || '';
      var dsrc = ev.dragArrow.src || null;
      var dots = [];
      for (var dc = 0; dc < net.columns.length; dc++) {
        var dcol = net.columns[dc];
        var dcX = colXs[dc];
        var dcW = L.widths[dc] || GRID.cellW;
        for (var db = 0; db < dcol.branches.length; db++) {
          var dbr = dcol.branches[db];
          var ownRow = !!(dsrc && dsrc.net === netIdx && dsrc.col === dc && dsrc.row === db);
          if (db !== 0 && !ownRow) continue;      // 其他分支没有落点
          var dcells = cellLayout(dbr, dcX, dcW);
          var dcy = rowCy(db);
          for (var dk = 0; dk <= dbr.length; dk++) {
            if (ownRow && dk !== dbr.length) continue;   // 自己这行只画箭头那个方块
            var dx;
            if (dk < dbr.length) {
              dx = dcells[dk].x;
            } else {
              dx = dcX + dcW;
              // 列尾的小方块落在开口箭头的尖端上，看着就是"从箭头拖出去"
              var tail = dbr[dbr.length - 1];
              if (tail && tail.type === 'OPEN_END' && dcells.length) {
                var lc = dcells[dcells.length - 1];
                dx = lc.x + Math.max(lc.w, 20) - 13;
              }
            }
            var dkey = netIdx + ':' + dc + ':' + db + ':' + dk;
            var don = (dkey === tgtKey);
            dots.push('<rect class="lad-anchor' + (don ? ' on' : '') + '" x="' + (dx - 4) +
              '" y="' + (dcy - 4) + '" width="8" height="8" rx="1.5" ' +
              'fill="' + (don ? '#00b050' : '#d6ecfb') + '" stroke="' +
              (don ? '#00803c' : '#4a9fd4') + '" stroke-width="1.2" ' +
              'data-anchor="' + dkey + '" pointer-events="none"/>');
          }
        }
      }
      if (dots.length) svg.push('<g class="lad-anchors">' + dots.join('') + '</g>');
    }

    // SVG 尺寸（悬空尾线要算进去）
    var svgW = Math.max(GRID.padL + 40, lastColRight + 40, tailX + 26);
    var svgH = padT + totalBranchRows * rowH + 14;

    return {
      html: '<svg width="' + svgW + '" height="' + svgH +
        '" viewBox="0 0 ' + svgW + ' ' + svgH + '" preserveAspectRatio="xMinYMin meet"' +
        '" xmlns="http://www.w3.org/2000/svg" data-net="' + netIdx + '">' +
        svg.join('') + '</svg>',
      layout: { w: svgW, h: svgH, rows: totalBranchRows, widths: L.widths },
      geo: geo
    };
  }

  /* ============================================================
   * 整块渲染
   * ============================================================ */
  function renderBlock(blk, opts) {
    opts = opts || {};
    var out = [];
    out.push('<div class="lad-wrap">');
    for (var n = 0; n < blk.networks.length; n++) {
      var net = blk.networks[n];
      var ev = {
        online: opts.online && opts.trace && opts.trace.net[n],
        elem: (opts.online && opts.trace && opts.trace.net[n]) ? opts.trace.net[n].elem : {},
        netTrace: (opts.online && opts.trace && opts.trace.net[n]) ? opts.trace.net[n] : null,
        selEl: opts.selEl,
        selSeg: opts.selSeg,
        dupInst: opts.dupInst || null,   // FB 实例名重复集合（name -> true）
        dragArrow: opts.dragArrow || null   // 落点方块只在 src 网络画；引脚高亮按 target key 命中（可能跨网络）
      };
      var r = drawNetwork(net, n, ev);
      out.push('<div class="network' + (opts.selNet === n ? ' sel' : '') + '" data-net="' + n + '">');
      out.push('<div class="network-head">');
      out.push('<span class="idx">网络 ' + (n + 1) + '：</span>');
      out.push('<span class="title"><input data-net-title="' + n + '" value="' + esc(net.title || '') +
        '" placeholder="（网络标题）"/></span>');
      out.push('<span class="net-ops">');
      out.push('<span class="nop" data-net-addbranch="' + n + '" title="为第一列添加并联分支">并联+</span>');
      out.push('<span class="nop" data-net-addcol="' + n + '" title="在末尾追加一列">列+</span>');
      out.push('<span class="nop del" data-net-del="' + n + '" title="删除网络">✕</span>');
      out.push('</span>');
      out.push('</div>');
      out.push('<div class="net-svg" data-net-svg="' + n + '">' + r.html + '</div>');
      out.push('</div>');
    }
    out.push('<div style="padding:12px">');
    out.push('<span class="addnet-btn" data-ins="NEW_NET">＋ 添加网络</span>');
    out.push('</div>');

    // 右下角缩放条（对齐 TIA）
    out.push('<div class="lad-zoombar">');
    out.push('<span class="zb-label">缩放</span>');
    out.push('<input type="range" class="zb-slider" id="ladZoomSlider" min="50" max="150" step="10" value="100">');
    out.push('<select class="zb-select" id="ladZoomSel">');
    [50, 60, 70, 80, 90, 100, 110, 120, 130, 150].forEach(function (v) {
      out.push('<option value="' + v + '"' + (v === 100 ? ' selected' : '') + '>' + v + '%</option>');
    });
    out.push('</select>');
    out.push('</div>');

    out.push('</div>');
    return out.join('');
  }

  root.LAD = {
    renderBlock: renderBlock,
    drawNetwork: drawNetwork,
    calcLayout: calcLayout,
    elWidth: elWidth,
    cellLayout: cellLayout,
    liveOf: liveOf,        // 在线监视：按 data-live 说明查电位
    paintWire: paintWire,  // 在线监视：给导线重新上色
    syncBadges: syncBadges,// 在线监视：画/更新值气泡（符号下方，不压标签）
    syncTimeValues: syncTimeValues, // 在线监视：刷新框外时间值（ET 正数 / PT 倒数）
    GRID: GRID
  };
})(window);



















