/* ============================================================
   ladedit.js — LAD 交互层（V2）
   修复：Delete 失效（改为文档级键盘监听 + 选中态不重建 DOM）
   新增：元件拖拽换位（跨网络/换列/换位）、导线端点拖拽加分支、
        右键菜单（删除/复制/加分支/插入指令）
   ============================================================ */
(function (root) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }

  var ED = {
    blk: null, tab: null,
    selId: null,
    selSeg: null,        // 选中的线段（用于插入分支）
    drag: null,          // 正在拖拽的元件
    wireDrag: null,      // 正在拖拽的导线端点
    insertPos: null,     // {net, col, branch, pos}
    insTarget: null,     // 下一次插入指令的落点（开放分支的开口处）
    dragArrow: null,     // 正在拖开口箭头：{net, target, src}
    adrag: null,         // 拖拽过程的临时状态（未激活前也算）
    force: null,         // 监视模式下正按住的触点：{plc, el, before}
    ghost: null,
    keyBound: false
  };

  /* 现在是不是"在线 + 监视"状态（只有这时按住触点才改值） */
  function isMonitor() {
    var A = window.App;
    return !!(A && A.online && A.monitor);
  }

  /* ============================================================
   * 在线 = 只读（对齐 TIA：在线视图里不能改程序）
   *  · 在线时梯形图不给选中、不给拖、不给插、不给删、不给双击改操作数
   *  · 唯一允许的动作是监视模式下按住 NO / NC 触点改状态（V32）
   *  · 想编辑就点工具栏「离线」——离线会 STOP、复位并关掉仿真面板
   * ============================================================ */
  function isOnline() {
    var A = window.App;
    return !!(A && A.online);
  }

  var _roWarnAt = 0;
  function warnReadOnly() {
    var now = Date.now();
    if (now - _roWarnAt < 1500) return;    // 连点别刷屏
    _roWarnAt = now;
    if (typeof toast === 'function') {
      toast('在线模式下梯形图是只读的（只能点触点改状态）—— 要编辑请先点「离线」', 'err');
    }
  }

  // true = 允许编辑；false = 已拦下
  function guardEdit() {
    if (!isOnline()) return true;
    warnReadOnly();
    return false;
  }

  /* ============================================================
   * 开放分支（Open Branch）—— 对齐 TIA 语义
   *  · 分支最后一个节点是 OPEN_END 时，该分支为"开放分支"：
   *    右端不汇合回主线，末端画开口箭头
   *  · 插入指令落在箭头之前，箭头始终保持在末尾
   *  · 选中汇合竖线按 Delete → 只断开该竖线（分支内容保留，变成开放分支）
   * ============================================================ */
  var COIL_TYPES = ['COIL', 'SET', 'RESET', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL'];
  function isCoilType(t) { return COIL_TYPES.indexOf(t) >= 0; }
  function isOpenEndEl(el) { return !!el && el.type === 'OPEN_END'; }
  function isOpenBranch(br) { return !!(br && br.length && isOpenEndEl(br[br.length - 1])); }
  function mkOpenEnd() { return { id: uid(), type: 'OPEN_END' }; }

  /* 解析线段键：net:vseg:col:L / net:vseg:col:row:R / net:ebr:col:row / net:link:col:0 */
  function parseSeg(key) {
    if (!key) return null;
    var p = String(key).split(':');
    var net = +p[0];
    if (isNaN(net)) return null;
    if (p[1] === 'rail') return { net: net, kind: 'rail' };
    if (p[1] === 'link') return { net: net, kind: 'link', col: +p[2] + 1, branch: 0, row: 0 };
    if (p[1] === 'ebr') return { net: net, kind: 'ebr', col: +p[2], branch: +p[3], row: +p[3] };
    // 整段导线里的一小段（同一列内两个器件之间）：net:span:col:row:k
    // k = 这段线左边有几个元件 —— 既是"这一列这一行的第几个空档"（只高亮这一段），
    // 也是"这个位置在该列的哪条元件边界上"：插入指令按列行走，
    // 点「分支」则先按 k 把这一列切开，分支才会落在你点的那一段下面
    if (p[1] === 'span') {
      return {
        net: net, kind: 'col', col: +p[2], branch: +p[3], row: +p[3],
        seg: p[4] == null ? null : +p[4]
      };
    }
    if (p[1] === 'vseg') {
      var isR = p[p.length - 1] === 'R';
      return {
        net: net, kind: isR ? 'vsegR' : 'vsegL', col: +p[2],
        row: isR ? +p[3] : null, branch: isR ? +p[3] : null
      };
    }
    return { net: net, kind: 'col', col: +p[1], branch: +p[2], row: +p[2] };
  }

  /* ============================================================
   * 初始化：全局只绑定一次键盘
   * ============================================================ */
  function initGlobalKeys() {
    if (ED.keyBound) return;
    ED.keyBound = true;

    document.addEventListener('keydown', function (e) {
      // 只在 LAD 编辑器可见且焦点不在输入控件时响应
      if (!ED.blk) return;
      // 在线 = 只读：Delete / 快捷键一律不响应
      if (isOnline()) { if (e.key === 'Delete' || e.key === 'Backspace') warnReadOnly(); return; }
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      if (ae && ae.isContentEditable) return;
      // 如果当前打开的标签不是这个块，忽略
      if (!document.body.contains(ED.blk ? document.querySelector('.lad-wrap') : null)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 收藏夹里的功能块【不再】用 Delete 删除（太容易误触），
        // 删除改到收藏项的右键菜单里。这里只处理画布上的元件 / 线段。
        // 其次：选中的是线段 → 按线段类型分别处理
        if (ED.selSeg) {
          var sk = String(ED.selSeg);
          var sp = parseSeg(sk);
          // 左母线：不可删
          if (sp && sp.kind === 'rail') {
            e.preventDefault();
            toast('左母线不可删除', 'err');
            return;
          }
          // 右侧汇合竖线：只断开这根线（分支变成开放分支），不删除分支
          if (sp && sp.kind === 'vsegR') {
            e.preventDefault();
            breakBranchAt(sp);
            return;
          }
          // 左侧分出竖线：不能单独删
          if (sp && sp.kind === 'vsegL') {
            e.preventDefault();
            toast('请选中右侧的汇合竖线再按 Delete（可把分支断开）', 'err');
            return;
          }
          // 空分支的直通线：删除这一行分支
          if (sp && sp.kind === 'ebr') {
            e.preventDefault();
            deleteBranchRow(sp);
            return;
          }
          // 列间连接线等：不允许单独删除
          e.preventDefault();
          toast('该导线段不可单独删除', 'err');
          return;
        }
        if (!ED.selId) return;
        e.preventDefault();
        deleteElement(ED.selId);
        return;
      }
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if (e.key === 'F2') {
        if (ED.selId) { e.preventDefault(); openEdit(ED.selId); }
        return;
      }
      // Ctrl+D 复制
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        if (ED.selId) { e.preventDefault(); duplicate(ED.selId); }
      }
    }, true);
  }

  /* ============================================================
   * 挂载一个块
   * ============================================================ */
  function mount(blk, tab, opts) {
    if (ED.blk !== blk) ED.insTarget = null;   // 换块后重置插入落点
    normalizeBranches(blk);                    // 老的空并联分支 → 开放分支
    ED.blk = blk;
    ED.tab = tab;
    ED.selId = (opts && opts.selId) || null;
    initGlobalKeys();
    bindSurface(opts || {});
  }

  /* ---------------- 选中态：只改 class，不重建 DOM ---------------- */
  function setSelection(id) {
    ED.selId = id;
    var wrap = $('.lad-wrap');
    if (!wrap) return;
    $$('.lad-el', wrap).forEach(function (g) {
      var hit = g.querySelector('.hit');
      var isSel = hit && hit.dataset.el === id;
      var box = g.querySelector('.selbox');
      if (isSel && !box) {
        var r = g.querySelector('.hit');
        if (r) {
          var ns = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          ns.setAttribute('class', 'selbox');
          ns.setAttribute('x', +r.getAttribute('x') + 2);
          ns.setAttribute('y', +r.getAttribute('y') + 3);
          ns.setAttribute('width', +r.getAttribute('width') - 4);
          ns.setAttribute('height', +r.getAttribute('height') - 6);
          ns.setAttribute('fill', 'rgba(26,111,168,.10)');
          ns.setAttribute('stroke', '#1a6fa8');
          ns.setAttribute('stroke-width', '1.4');
          ns.setAttribute('stroke-dasharray', '4 2');
          ns.setAttribute('pointer-events', 'none');
          g.insertBefore(ns, g.firstChild);
        }
      } else if (!isSel && box) {
        box.remove();
      }
    });
    // 通知外部更新巡视窗口
    if (ED.onSelect) ED.onSelect(id);

    // 选中/取消选中"开口箭头"时，重绘一次 —— 让那排落点小方块跟着出现/消失
    // （对齐 TIA：一选中分支就看得见可以往哪儿拖）
    var hint = false;
    if (id && ED.blk) {
      var hl = locate(ED.blk, id);
      hint = !!(hl && hl.branch > 0 && isOpenBranch(hl.arr));
    }
    if (hint !== !!ED.hintOn) {
      ED.hintOn = hint;
      setTimeout(function () {
        if (ED.blk && ED.tab) rerender({ keepScroll: true });
      }, 0);
    }
  }

  function clearSelection() {
    setSelection(null);
  }

  /* ============================================================
   * 元素定位与结构操作
   * ============================================================ */
  function locate(blk, id) {
    for (var n = 0; n < blk.networks.length; n++) {
      var cols = blk.networks[n].columns;
      for (var c = 0; c < cols.length; c++) {
        for (var b = 0; b < cols[c].branches.length; b++) {
          var br = cols[c].branches[b];
          for (var e = 0; e < br.length; e++) {
            if (br[e].id === id) {
              return { el: br[e], net: n, col: c, branch: b, idx: e, arr: br };
            }
          }
        }
      }
    }
    /* 引脚支路里的元件（计数器 R / LD 端接的那串触点）：
       它们挂在盒体上（el.pins = { R: [...] }），不属于任何列/行，
       所以单独找一遍 —— 找到后带 pin / host 两个标记，调用方据此走另一条编辑路径。 */
    for (var n2 = 0; n2 < blk.networks.length; n2++) {
      var cols2 = blk.networks[n2].columns;
      for (var c2 = 0; c2 < cols2.length; c2++) {
        for (var b2 = 0; b2 < cols2[c2].branches.length; b2++) {
          var br2 = cols2[c2].branches[b2];
          for (var e2 = 0; e2 < br2.length; e2++) {
            var host = br2[e2];
            if (!host || !host.pins) continue;
            for (var pn in host.pins) {
              if (!Object.prototype.hasOwnProperty.call(host.pins, pn)) continue;
              var ch = host.pins[pn] || [];
              for (var k2 = 0; k2 < ch.length; k2++) {
                if (ch[k2] && ch[k2].id === id) {
                  return {
                    el: ch[k2], net: n2, col: c2, branch: b2, idx: k2, arr: ch,
                    pin: pn, host: host, hostIdx: e2
                  };
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  function deleteElement(id) {
    if (!guardEdit()) return;            // 在线只读
    var loc = locate(ED.blk, id);
    if (!loc) return;

    // 引脚支路（R / LD 端的触点）：只从链上摘掉，链空了就把引脚接的这条支路整个删掉。
    // 不能走下面的"列/行清理"——那会把计数器所在的整行/整列也一起判空。
    if (loc.pin) {
      loc.arr.splice(loc.idx, 1);
      if (!loc.arr.length && loc.host.pins) {
        delete loc.host.pins[loc.pin];
        if (!Object.keys(loc.host.pins).length) delete loc.host.pins;
      }
      ED.tab.dirty = true;
      rerender({ keepScroll: true });
      return;
    }

    var wasOpenEnd = isOpenEndEl(loc.el);

    // 1. 从分支里移除
    loc.arr.splice(loc.idx, 1);

    // 2. 清理结构：
    //    · 主行空了 -> 保留为空数组（空网络是合法的）
    //    · 并联行空了 -> 整行删掉（不要留下"空闭合环"这种怪东西）
    //    · 整列都空了且不止一列 -> 删除该列
    var net = ED.blk.networks[loc.net];
    var col = net.columns[loc.col];
    if (!col) return;

    var branchRemoved = false;
    if (loc.arr.length === 0 && loc.branch > 0 && col.branches.length > 1) {
      col.branches.splice(loc.branch, 1);
      branchRemoved = true;
    }

    var colIsEmpty = col.branches.every(function (br) {
      return br.length === 0 || br.every(function (x) { return x.type === 'EMPTY'; });
    });

    if (colIsEmpty && net.columns.length > 1) {
      // 该列没内容了，整列删掉
      net.columns.splice(loc.col, 1);
    } else if (colIsEmpty) {
      // 只剩这一列：清成空分支，不再塞 EMPTY 占位
      col.branches = [[]];
    } else {
      // 该列还有别的分支有内容：把空分支清成空数组
      col.branches = col.branches.map(function (br) {
        return br.filter(function (x) { return x.type !== 'EMPTY'; });
      });
      if (col.branches.length === 0) col.branches = [[]];
    }

    ED.selId = null;
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    if (branchRemoved) toast('已删除这条分支');
    else if (wasOpenEnd) toast('已闭合该分支（汇合竖线已恢复）');
    else toast('已删除元件');
  }

  function duplicate(id) {
    var loc = locate(ED.blk, id);
    if (!loc) return;
    var copy = JSON.parse(JSON.stringify(loc.el));
    copy.id = uid();
    // 引脚支路（R / LD 端的触点链）也要换 id：不换的话两个盒体会抢同一个 data-el，
    // 点一个另一个跟着变
    if (copy.pins) {
      Object.keys(copy.pins).forEach(function (pn) {
        copy.pins[pn] = (copy.pins[pn] || []).map(function (c) {
          var cc = JSON.parse(JSON.stringify(c));
          cc.id = uid();
          return cc;
        });
      });
    }
    loc.arr.splice(loc.idx + 1, 0, copy);
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    setSelection(copy.id);
    toast('已复制元件');
  }

  /* ============================================================
   * 重绘（保留滚动位置与选中态）
   * ============================================================ */
  function rerender(opts) {
    opts = opts || {};
    // 重绘前先收掉内联编辑框：否则它的锚点已经被新 DOM 替换，
    // 悬浮框会停在半空（看起来像"值跑到盒体上方"还赖着不走）
    closeInlineEdit();
    var area = $('#editorArea');
    // 真正的滚动容器是内部的 .lad-scroll（editorArea 本身 overflow:hidden），
    // 之前保存的是 editorArea 的滚动值（恒为 0），重绘后视图总是跳回顶部
    var sc = area.querySelector('.lad-scroll');
    var sl = sc ? sc.scrollLeft : 0, st = sc ? sc.scrollTop : 0;
    if (ED.onRerender) ED.onRerender(opts);
    sc = area.querySelector('.lad-scroll');
    if (sc) { sc.scrollLeft = sl; sc.scrollTop = st; }
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bindSurface(opts) {
    var wrap = $('.lad-wrap');
    if (!wrap) return;
    // 在线只读：视觉上也给点提示（隐藏拖拽圆点、光标改成普通箭头）
    wrap.classList.toggle('lad-readonly', isOnline());

    // 分支手柄圆点：单击直接新增并联分支（图五交互）
    wrap.addEventListener('click', function (e) {
      var bh = e.target.closest('[data-branch]');
      if (bh) {
        e.stopPropagation();
        if (!guardEdit()) return;
        var p = bh.dataset.branch.split(':').map(Number);
        var net = ED.blk.networks[p[0]];
        if (!net || !net.columns[p[1]]) return;
        // 与 TIA 一致：新增的是"开放分支"（末端带开口箭头）
        var ocol = net.columns[p[1]];
        var orow = ocol.branches.length;
        ocol.branches.splice(orow, 0, [mkOpenEnd()]);
        ED.insTarget = { net: p[0], col: p[1], branch: orow, pos: 0 };
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        toast('已在第 ' + (p[1] + 1) + ' 列新增开放分支（共 ' +
          ocol.branches.length + ' 条）');
      }
    }, true);   // 捕获阶段，先于 wrap.onclick

    // 选中一个元件（点符号 / 点引线 / 点整段导线但落在元件符号上 → 都走这里）
    function pickElement(id, netIdx) {
      ED.selSeg = null;      // 选元件时清掉线段选中
      // 同步清掉外部记录，避免重绘后旧线段高亮又回来
      if (ED.onSelSeg) ED.onSelSeg(null);
      else if (opts.onSelSeg) opts.onSelSeg(null);
      if (window.App) window.App.selSeg = null;
      setSelection(id);
      if (netIdx != null && opts.onSelNet) opts.onSelNet(netIdx);

      var loc = locate(ED.blk, id);
      if (!loc) return;
      var I = window.INSTR;
      var m = I ? I.info(loc.el.type) : null;
      if (m && (m.kind === 'contact' || m.kind === 'coil')) {
        var svgGroup = document.querySelector('.lad-el[data-el="' + id + '"]');
        if (svgGroup) {
          showTypeDropdown(svgGroup, loc.el, function () {
            ED.tab.dirty = true;
            rerender({ keepScroll: true });
          });
        }
      }
    }

    /* ---------------- 拖动开口箭头 → 合并到横线上（V31，对齐 TIA） ----------------
       按住分支末端的开口箭头拖动：网络里会出现一排小方块（每个器件之后 + 列首列尾），
       鼠标最近的方块变绿 = 落点；松开就在该处把这条分支合并回主线。 */
    if (!ED.arrowDragBound) {
      ED.arrowDragBound = true;

      document.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || isOnline()) return;    // 在线只读：不进入拖箭头
        var hit0 = e.target.closest('[data-el]');
        if (!hit0) return;
        var loc0 = locate(ED.blk, hit0.dataset.el);
        if (!loc0 || !isOpenEndEl(loc0.el) || loc0.branch <= 0) return;
        ED.adrag = {
          on: true, active: false, sx: e.clientX, sy: e.clientY,
          src: { net: loc0.net, col: loc0.col, row: loc0.branch },
          target: null
        };
      }, true);

      document.addEventListener('pointermove', function (e) {
        var a = ED.adrag;
        if (!a || !a.on) return;
        if (!a.active) {
          if (Math.abs(e.clientX - a.sx) < 5 && Math.abs(e.clientY - a.sy) < 5) return;
          a.active = true;
          ED.dragArrow = { net: a.src.net, target: null, src: a.src };
          rerender({ keepScroll: true });
        }
        var t = arrowTargetAt(e.clientX, e.clientY);
        var key = arrowTargetKey(t);
        if (ED.dragArrow && ED.dragArrow.target !== key) {
          ED.dragArrow.target = key;
          a.target = t;
          rerender({ keepScroll: true });
        }
      }, true);

      document.addEventListener('pointerup', function (e) {
        var a = ED.adrag;
        if (!a || !a.on) return;
        ED.adrag = null;
        if (!a.active) { ED.dragArrow = null; return; }      // 没拖动 = 当成普通点击
        var tgt = a.target;
        ED.dragArrow = null;
        ED.suppressClick = true;                             // 别让随后的 click 再选一次
        setTimeout(function () { ED.suppressClick = false; }, 0);
        if (tgt && tgt.kind === 'pin') mergeOpenArrowToPin(a.src, tgt);   // 拖到 R / LD 引脚端子
        else if (tgt) mergeOpenArrow(a.src, tgt);
        else { rerender({ keepScroll: true }); toast('已取消拖动'); }
      }, true);
    }

    /* ---------------- 监视模式下"按住触点改状态"（V32） ----------------
       对齐 TIA 的"修改值"：监视中按住常开/常闭触点，相当于把这个位取反
       （用手按住按钮），松开就恢复原值。只对 NO / NC 生效。 */
    if (!ED.forceBound) {
      ED.forceBound = true;

      document.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || !isMonitor()) return;
        var hit = e.target && e.target.closest ? e.target.closest('[data-el]') : null;
        if (!hit) return;
        var loc = locate(ED.blk, hit.dataset.el);
        if (!loc) return;
        if (loc.el.type !== 'NO' && loc.el.type !== 'NC') return;
        var A = window.App, I = window.INSTR;
        if (!A || !A.plc || !I || !I.readB || !I.writeP) return;
        var before = !!I.readB(A.plc, loc.el, 'OPERAND');
        ED.force = { plc: A.plc, el: loc.el, before: before };
        I.writeP(A.plc, loc.el, 'OPERAND', !before);
        ED.suppressClick = true;            // 别让随后的 click 弹出触点类型下拉
        e.preventDefault();
        e.stopPropagation();                // 也别启动"挪动器件"
        // 立刻按新值算一遍，省得等下一个扫描周期
        try { A.plc.step(A.project); if (A.refreshLive) A.refreshLive(); } catch (err) { }
      }, true);

      var releaseForce = function () {
        var f = ED.force;
        if (!f) return;
        ED.force = null;
        var I = window.INSTR;
        if (I && I.writeP) I.writeP(f.plc, f.el, 'OPERAND', f.before);
        var A = window.App;
        try { if (A && A.plc && A.project) { A.plc.step(A.project); if (A.refreshLive) A.refreshLive(); } } catch (err) { }
        setTimeout(function () { ED.suppressClick = false; }, 0);
      };
      document.addEventListener('pointerup', releaseForce, true);
      document.addEventListener('pointercancel', releaseForce, true);
    }

    // 单击：选中元件 / 选中线段 / 取消
    wrap.onclick = function (e) {
      if (ED.suppressClick) return;
      if (isOnline()) { warnReadOnly(); return; }   // 在线只读：不选中、不弹类型下拉
      var elHit = e.target.closest('[data-el]');
      if (elHit) {
        var netEl0 = e.target.closest('.network');
        pickElement(elHit.dataset.el, netEl0 ? +netEl0.dataset.net : null);
        return;
      }

      // 点元件引线：等同于选中该元件（便于随后插入分支 / 插入指令）
      var leadEl = e.target.closest('[data-lead]');
      if (leadEl) {
        var leadId = String(leadEl.getAttribute('data-lead') || '').split(':')[0];
        if (leadId) {
          ED.selSeg = null;
          setSelection(leadId);
          var lNet = leadEl.closest('.network');
          if (lNet && opts.onSelNet) opts.onSelNet(+lNet.dataset.net);
          if (ED.onSelSeg) ED.onSelSeg(null);
          else if (opts.onSelSeg) opts.onSelSeg(null);
          if (window.App) window.App.selSeg = null;
          rerender({ keepScroll: true });
          toast('已选中该元件 —— 点「分支」可在它所在的列分出开放分支');
        }
        return;
      }

      // 点线段/竖线/母线：选中它（用于插入分支/删除分支）
      var segEl = e.target.closest('[data-seg]');
      if (segEl) {
        var segKey0 = segEl.dataset.seg;
        clearSelection();
        ED.selSeg = segKey0;
        if (ED.onSelSeg) ED.onSelSeg(ED.selSeg);
        else if (opts.onSelSeg) opts.onSelSeg(ED.selSeg);
        var nEl = segEl.closest('.network');
        if (nEl && opts.onSelNet) opts.onSelNet(+nEl.dataset.net);
        rerender({ keepScroll: true });
        var key = ED.selSeg || '';
        var skp = parseSeg(key);
        if (skp && skp.kind === 'vsegR') {
          toast('已选中汇合竖线 —— 按 Delete 只断开这根线（分支变成开放分支，元件保留）');
        } else if (skp && skp.kind === 'vsegL') {
          toast('已选中分出竖线（不可单独删除）');
        } else if (skp && skp.kind === 'rail') {
          toast('已选中左母线');
        } else if (skp && skp.kind === 'ebr') {
          toast('已选中空分支直线 —— 按 Delete 删除这一行分支');
        } else if (skp && skp.kind === 'col') {
          toast('已选中这段导线 —— 点工具栏「分支」可在这里分出开放分支');
        } else {
          toast('已选中线段 —— 点工具栏「分支」插入开放分支');
        }
        return;
      }

      // 点 SVG 空白处 / 母线 / 非线段导线：清除所有选中
      if (e.target.closest('svg') || e.target.closest('.lad-wrap') ||
          e.target.closest('.network') || e.target === wrap) {
        clearSelection();
        ED.selSeg = null;
        // 必须同时清外部 App.selSeg，否则重绘后又会被恢复
        if (ED.onSelSeg) ED.onSelSeg(null);
        else if (opts.onSelSeg) opts.onSelSeg(null);
        if (window.App) window.App.selSeg = null;
        // 直接移除 DOM 上的高亮，避免整页重绘
        var sels = document.querySelectorAll('.lad-seg.sel');
        for (var si = 0; si < sels.length; si++) sels[si].classList.remove('sel');
        return;
      }
      var netEl2 = e.target.closest('.network');
      if (netEl2 && opts.onSelNet) opts.onSelNet(+netEl2.dataset.net);
    };

    // 双击：分两种 —— 双击地址行只改地址，双击符号行只改符号名，双击元件本体改符号
    wrap.ondblclick = function (e) {
      if (!guardEdit()) { e.preventDefault(); return; }   // 在线只读：不给改操作数
      var hit = e.target.closest('[data-el]');
      if (!hit) return;
      e.preventDefault();
      closeTypeDropdown();

      var elId = hit.dataset.el;
      // 拖拽层的指针捕获会把 click/dblclick 重定向到 .lad-el 容器本身，
      // 此时 e.target 不是真正被点的子元素 —— 用坐标命中测试找回它
      // （否则双击参数值会被当成"盒体双击"而打开调用选项）
      var t = e.target;
      if (t === hit || (t.classList && t.classList.contains('lad-el'))) {
        var realEl = document.elementFromPoint(e.clientX, e.clientY);
        if (realEl && hit.contains(realEl)) t = realEl;
      }
      var part = (t.dataset && t.dataset.part) || hit.dataset.part || '';   // 'addr' | 'sym' | ''
      setSelection(elId);

      var loc = locate(ED.blk, elId);
      if (!loc) return;

      // 对齐 TIA：
      //  · 双击地址行 → 改地址（内联，不弹窗）
      //  · 双击符号行 → 改符号名（内联）
      //  · 双击元件本体 → 也进地址编辑（触点/线圈只有一个操作数）
      //  · FB：双击 <???> 实例名 / 参数占位符 就地编辑对应项；双击盒体 = 调用选项
      var meta = window.INSTR ? window.INSTR.info(loc.el.type) : null;
      var isSingle = meta && (meta.kind === 'contact' || meta.kind === 'coil');

      var instHit = t.closest ? t.closest('[data-inst]') : null;
      if (instHit && instHit.dataset.inst === elId) {
        editInstanceName(loc.el);
        return;
      }
      var prmHit = t.closest ? t.closest('[data-prm]') : null;
      if (prmHit && prmHit.dataset.prm.indexOf(elId + ':') === 0) {
        editParamInline(loc.el, prmHit.dataset.prm.slice(elId.length + 1), prmHit);
        return;
      }

      // 双击引脚小方块（R / LD 的接线端子）：接一条触点支路（和右键菜单同一功能）
      var portHit = t.closest ? t.closest('[data-pin-port]') : null;
      if (portHit) {
        var portSpec = String(portHit.getAttribute('data-pin-port') || '');
        if (portSpec.indexOf(elId + ':') === 0) {
          addPinContact(loc.el, portSpec.slice(elId.length + 1));
          return;
        }
      }

      if (part === 'addr') {
        editAddressOnly(loc.el);
      } else if (part === 'sym') {
        editSymbolOnly(loc.el);
      } else if (isSingle) {
        // 触点/线圈：双击本体 = 编辑地址
        editAddressOnly(loc.el);
      } else if (meta && meta.fb) {
        openCallDialog(loc.el);   // FB 盒体：双击 = 调用选项（命名数据块）
      } else {
        openEdit(elId);   // 盒式指令（多参数）：完整编辑表单
      }
    };

    // 右键菜单
    wrap.oncontextmenu = function (e) {
      if (isOnline()) { e.preventDefault(); warnReadOnly(); return; }   // 在线只读
      var elHit = e.target.closest('[data-el]');
      var brHandle = e.target.closest('[data-branch]');
      var netEl = e.target.closest('.network');
      if (elHit) {
        e.preventDefault();
        var id = elHit.dataset.el;
        setSelection(id);
        elementMenu(e.clientX, e.clientY, id);
        return;
      }
      if (brHandle) {
        e.preventDefault();
        wireMenu(e.clientX, e.clientY, +netEl.dataset.net, brHandle.dataset.branch);
        return;
      }
      // 线段右键：汇合竖线 → 断开该分支
      var segHit = e.target.closest('[data-seg]');
      if (segHit) {
        var sp0 = parseSeg(segHit.dataset.seg);
        if (sp0 && sp0.kind === 'vsegR') {
          e.preventDefault();
          clearSelection();
          ED.selSeg = segHit.dataset.seg;
          if (ED.onSelSeg) ED.onSelSeg(ED.selSeg);
          else if (opts.onSelSeg) opts.onSelSeg(ED.selSeg);
          menu(e.clientX, e.clientY, [
            {
              label: '断开此分支（保留元件）', cb: function () {
                breakBranchAt(sp0);
              }
            }
          ]);
          rerender({ keepScroll: true });
          return;
        }
        if (sp0 && sp0.kind === 'ebr') {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            { label: '删除这一行分支', cb: function () { deleteBranchRow(sp0); } }
          ]);
          return;
        }
        if (sp0 && sp0.kind === 'col') {
          e.preventDefault();
          clearSelection();
          ED.selSeg = segHit.dataset.seg;
          if (ED.onSelSeg) ED.onSelSeg(ED.selSeg);
          else if (opts.onSelSeg) opts.onSelSeg(ED.selSeg);
          rerender({ keepScroll: true });
          menu(e.clientX, e.clientY, [
            {
              // 和工具栏「分支」走同一条路径：按这一段线的 k 先把列切开再挂分支
              label: '在此线段处分出开放分支', cb: function () {
                addOpenBranch('down');
              }
            }
          ]);
          return;
        }
      }
      if (netEl) {
        e.preventDefault();
        netMenu(e.clientX, e.clientY, +netEl.dataset.net);
      }
    };

    // 网络标题输入
    wrap.addEventListener('input', function (e) {
      var t = e.target.closest('[data-net-title]');
      if (t) {
        ED.blk.networks[+t.dataset.netTitle].title = t.value;
        ED.tab.dirty = true;
      }
    });

    // ---------- 缩放 ----------
    var zoomSel = document.getElementById('ladZoomSel');
    var zoomSlider = document.getElementById('ladZoomSlider');

    function applyZoom(pct) {
      pct = Math.max(50, Math.min(150, pct || 100));
      ED.zoom = pct;
      // 缩放作用在所有网络 svg 上（按比例调整显示尺寸）
      var svgs = document.querySelectorAll('.lad-wrap svg');
      for (var i = 0; i < svgs.length; i++) {
        var s = svgs[i];
        if (!s.dataset.origW) {
          s.dataset.origW = s.getAttribute('width');
          s.dataset.origH = s.getAttribute('height');
        }
        var ow = +s.dataset.origW, oh = +s.dataset.origH;
        if (pct === 100) {
          s.style.width = '';
          s.style.height = '';
        } else {
          s.style.width = (ow * pct / 100) + 'px';
          s.style.height = (oh * pct / 100) + 'px';
        }
      }
      if (zoomSel) zoomSel.value = String(pct);
      if (zoomSlider) zoomSlider.value = String(pct);
    }
    ED.applyZoom = applyZoom;

    // 恢复上次缩放（同一会话内切标签页不丢）
    applyZoom(ED.zoom || 100);

    if (zoomSel) {
      zoomSel.addEventListener('change', function () { applyZoom(+zoomSel.value); });
    }
    if (zoomSlider) {
      zoomSlider.addEventListener('input', function () { applyZoom(+zoomSlider.value); });
    }

    // 网络操作按钮
    wrap.addEventListener('click', function (e) {
      var ab = e.target.closest('[data-net-addbranch]');
      if (ab) { if (guardEdit()) addBranch(+ab.dataset.netAddbranch); return; }
      var ac = e.target.closest('[data-net-addcol]');
      if (ac) { if (guardEdit()) addColumn(+ac.dataset.netAddcol); return; }
      var dl = e.target.closest('[data-net-del]');
      if (dl) { if (guardEdit()) delNetwork(+dl.dataset.netDel); return; }
      var nn = e.target.closest('[data-ins="NEW_NET"]');
      if (nn) { if (guardEdit()) newNetwork(); return; }
    });

    // ---------- 拖拽：元件（Pointer Events，SVG 不支持 HTML5 drag） ----------
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      // 在线只读：不拖元件（监视时点触点改状态由上面的 force 逻辑处理，不走这里）
      if (isOnline()) return;
      // 分支手柄优先（由下面的 mousedown 处理）
      if (e.target.closest('[data-branch]')) return;

      var g = e.target.closest('.lad-el');
      if (!g) return;
      var hit = g.querySelector('.hit');
      if (!hit) return;
      var id = hit.dataset.el;
      var loc = locate(ED.blk, id);
      if (!loc) return;
      // 开口箭头不是"可挪动的器件"：按住它是"拖到横线上合并"（下面的 arrow drag 接管）
      if (loc.branch > 0 && isOpenEndEl(loc.el)) { e.preventDefault(); return; }

      var I = window.INSTR;
      var m = I.info(loc.el.type);
      var label = (m ? m.name : loc.el.type);

      e.preventDefault();
      setSelection(id);

      window.DragLayer.start({
        kind: 'move',
        payload: id,
        label: '↔ ' + label,
        sourceEl: g,
        startEvent: e,
        onDrop: function (pt) {
          var pos = computeDropPosFromPoint(pt);
          if (pos) moveElement(id, pos);
        }
      });
    });

    // 落点提示（由 DragLayer 在移动过程中调用）
    window.DragLayer.setHintHandler(function (e) {
      var pos = computeDropPosFromPoint({
        clientX: e.clientX, clientY: e.clientY,
        target: document.elementFromPoint(e.clientX, e.clientY)
      });
      if (!pos) { window.DragLayer.clearHint(); return; }
      var rect = hintRect(pos);
      if (!rect) { window.DragLayer.clearHint(); return; }
      window.DragLayer.setHint(rect.svg, rect);
    });

    wrap.addEventListener('click', function (e) {
      if (isOnline()) return;    // 在线只读：不选中
      var elHit = e.target.closest('[data-el]');
      if (elHit) {
        setSelection(elHit.dataset.el);
        var netEl = e.target.closest('.network');
        if (netEl && opts.onSelNet) opts.onSelNet(+netEl.dataset.net);
      }
    });

    // ---------- 导线端点拖拽（加并联分支） ----------
    wrap.addEventListener('mousedown', function (e) {
      var h = e.target.closest('[data-branch]');
      if (!h) return;
      if (!guardEdit()) { e.preventDefault(); return; }
      e.preventDefault();
      e.stopPropagation();
      var parts = h.dataset.branch.split(':').map(Number);
      ED.wireDrag = { net: parts[0], col: parts[1], branch: parts[2], x0: e.clientX, y0: e.clientY };
      startWireGhost(e.clientX, e.clientY);
      document.addEventListener('mousemove', onWireMove);
      document.addEventListener('mouseup', onWireUp, { once: true });
    });
  }

  /* ============================================================
   * 拖拽落点计算（基于屏幕坐标，供 DragLayer 调用）
   * ============================================================ */
  function computeDropPosFromPoint(pt) {
    var t = pt.target;
    // 落在引脚小方块上（R / LD 的接线端子）：目标是"接到这个引脚"
    var portEl = t && t.closest ? t.closest('[data-pin-port]') : null;
    if (portEl) {
      var spec = String(portEl.getAttribute('data-pin-port') || '').split(':');
      if (spec.length >= 2) {
        return { kind: 'pin', elId: spec[0], pin: spec[1] };
      }
    }
    var svgWrap = t && t.closest ? t.closest('.net-svg') : null;
    var netEl = t && t.closest ? t.closest('.network') : null;

    // 落在网络内但不在 svg 上（比如标题栏）：投到最后
    if (!svgWrap && netEl) {
      return { net: +netEl.dataset.net, col: 999, branch: 0, pos: 'after' };
    }
    if (!svgWrap) return null;

    var netIdx = +svgWrap.dataset.netSvg;
    var svg = svgWrap.querySelector('svg');
    if (!svg) return null;
    var rect = svg.getBoundingClientRect();
    // 缩放后显示尺寸 ≠ 内部坐标系：把屏幕像素换算回 svg 原始单位，
    // 否则非 100% 缩放时拖指令落点全错位
    var kx = rect.width ? svg.width.baseVal.value / rect.width : 1;
    var ky = rect.height ? svg.height.baseVal.value / rect.height : 1;
    var px = (pt.clientX - rect.left) * kx;
    var py = (pt.clientY - rect.top) * ky;

    var net = ED.blk.networks[netIdx];
    if (!net) return null;
    var L = LAD.calcLayout(net);

    var colX = LAD.GRID.padL;
    for (var c = 0; c < net.columns.length; c++) {
      var cw = L.widths[c] || LAD.GRID.cellW;
      if (px >= colX - 10 && px <= colX + cw + 10) {
        var branchCount = net.columns[c].branches.length;
        // 行基线必须与渲染一致：rowCy(i) = padT + i*rowH + rowH/2
        // padT / rowH 都要用 calcLayout 的实际值（含高盒体的网络行距更大、顶部留白更多），
        // 以前写死 GRID.h / GRID.padT，绿框就整体错位了（用户反馈"绿框定位不大准"）
        var relY = py - L.padT;
        var hitBranch = Math.max(0, Math.min(branchCount - 1, Math.floor(relY / L.rowH)));
        var br = net.columns[c].branches[hitBranch];
        var hitPos = 0;
        if (br && br.length) {
          // 与渲染一致：单元格按元件需要的宽度分配（不是平均分）
          var cells = LAD.cellLayout(br, colX, cw);
          hitPos = 0;
          var best = 1e9;
          for (var kk = 0; kk <= br.length; kk++) {
            var bxv = kk < br.length ? cells[kk].x : colX + cw;
            var dd = Math.abs(px - bxv);
            if (dd < best) { best = dd; hitPos = kk; }
          }
        }
        return { net: netIdx, col: c, branch: hitBranch, pos: hitPos };
      }
      colX += cw + LAD.GRID.gap;
    }
    // 超出右边界：追加新列
    return { net: netIdx, col: net.columns.length, branch: 0, pos: 'after' };
  }

  // 计算落点提示框的几何（返回 svg 元素与该 rect）
  function hintRect(pos) {
    if (!pos) return null;
    // 拖到引脚小方块上：提示框罩住那个小方块（表示"接到这个引脚"）
    if (pos.kind === 'pin') {
      var psvgWrap = null, pport = null;
      $$('.network').forEach(function (ne) {
        var pp = ne.querySelector('[data-pin-port="' + pos.elId + ':' + pos.pin + '"]');
        if (pp && !pport) { pport = pp; psvgWrap = ne.querySelector('.net-svg'); }
      });
      if (!pport || !psvgWrap) return null;
      var psvg = psvgWrap.querySelector('svg');
      if (!psvg) return null;
      var pr = pport.getBoundingClientRect();
      var sr = psvg.getBoundingClientRect();
      // 提示框画在 svg 内部（原始单位）：屏幕像素要按缩放比换算回去
      var kk = sr.width ? psvg.width.baseVal.value / sr.width : 1;
      return {
        svg: psvg,
        x: (pr.left - sr.left) * kk - 8, y: (pr.top - sr.top) * kk - 8,
        w: pr.width * kk + 16, h: pr.height * kk + 16
      };
    }
    var netEl = $('.network[data-net="' + pos.net + '"]');
    if (!netEl) return null;
    var svgWrap = netEl.querySelector('.net-svg');
    if (!svgWrap) return null;
    var svg = svgWrap.querySelector('svg');
    if (!svg) return null;

    var net = ED.blk.networks[pos.net];
    if (!net) return null;
    var L = LAD.calcLayout(net);

    var x, y, w, h;
    if (pos.pos === 'after' || pos.col >= net.columns.length) {
      var totalW = 0;
      for (var i = 0; i < L.widths.length; i++) totalW += L.widths[i];
      x = LAD.GRID.padL + totalW + 2;
      y = L.padT + 4;
      w = 14;
      h = L.rows * L.rowH - 8;
    } else {
      var colX = LAD.GRID.padL;
      for (var c = 0; c < pos.col; c++) colX += (L.widths[c] || LAD.GRID.cellW) + LAD.GRID.gap;
      var cw = L.widths[pos.col] || LAD.GRID.cellW;
      var br = net.columns[pos.col].branches[pos.branch] || [];
      var cells2 = br.length ? LAD.cellLayout(br, colX, cw) : null;
      var segW = 90;
      if (cells2 && typeof pos.pos === 'number' && pos.pos < cells2.length) {
        x = cells2[pos.pos].x;
        segW = cells2[pos.pos].w;
      } else if (cells2 && cells2.length) {
        // 落在最后一个元件之后：提示框贴着它右边，最多到列尾
        // （元件是按自然宽度从左排的，不能用"平均分"去估位置）
        var lastCell = cells2[cells2.length - 1];
        x = Math.min(lastCell.x + lastCell.w, colX + cw - 4);
        segW = 60;
      } else {
        x = colX;
      }
      // 行基线：所有列共用 rowCy(i) = padT + i*rowH + rowH/2
      // 同样要用 calcLayout 的 padT / rowH，绿框才会压在真实那一行上
      y = L.padT + pos.branch * L.rowH + 4;
      w = Math.min(segW, 90);
      h = L.rowH - 8;
    }
    return { svg: svg, x: x, y: y, w: w, h: h };
  }

  /* ============================================================
   * 移动元件
   * ============================================================ */
  function moveElement(id, pos) {
    var loc = locate(ED.blk, id);
    if (!loc) return;
    // 落点是引脚小方块（R / LD 的接线端子）：把这个触点挪过去接成支路
    if (pos && pos.kind === 'pin') {
      var pmv = window.INSTR ? window.INSTR.info(loc.el.type) : null;
      if (!pmv || pmv.kind !== 'contact') {
        toast(pos.pin + ' 端只能接触点（常开 / 常闭）', 'err');
        return;
      }
      // 从原位置摘下来（列/行里的普通触点，或另一条引脚支路上的触点）
      loc.arr.splice(loc.idx, 1);
      if (!loc.pin) {
        var sNet = ED.blk.networks[loc.net];
        var sCol = sNet.columns[loc.col];
        var colEmpty = sCol.branches.every(function (br) {
          return br.every(function (x) { return x.type === 'EMPTY'; });
        });
        if (colEmpty && sNet.columns.length > 1) sNet.columns.splice(loc.col, 1);
      } else if (!loc.arr.length) {
        delete loc.host.pins[loc.pin];
        if (!Object.keys(loc.host.pins).length) delete loc.host.pins;
      }
      if (!dropContactOnPin(loc.el, pos)) {
        // 接失败（比如目标端已满 3 个）：塞回原位，别把元件弄丢
        if (loc.pin) {
          if (!loc.host.pins) loc.host.pins = {};
          if (!loc.host.pins[loc.pin]) loc.host.pins[loc.pin] = [];
          loc.host.pins[loc.pin].splice(loc.idx, 0, loc.el);
        } else {
          insertInto(ED.blk.networks[loc.net], {
            net: loc.net, col: loc.col, branch: loc.branch, pos: loc.idx
          }, loc.el);
        }
      }
      return;
    }
    // 引脚支路上的触点不能拖到列/行里（它只属于那个引脚）
    if (loc.pin) { toast('引脚支路上的触点不能拖动位置', 'err'); return; }
    var el = loc.el;
    // 拖回原位则不做任何事
    if (pos.net === loc.net && pos.col === loc.col && pos.branch === loc.branch &&
      (pos.pos === loc.idx || pos.pos === loc.idx + 1 || pos.pos === 'after' && loc.col === ED.blk.networks[loc.net].columns.length - 1)) {
      if (pos.pos !== 'after') return;
    }
    var net = ED.blk.networks[pos.net];
    if (!net) return;

    var srcNet = ED.blk.networks[loc.net];
    var srcCol = srcNet.columns[loc.col];

    // 先从原位置移除
    loc.arr.splice(loc.idx, 1);

    // 若原分支空了，补一个空槽（避免分支消失）
    if (loc.arr.length === 0) {
      loc.arr.length = 0;   // 空分支用空数组表示
    }
    // 若整列除了空槽没有别的元件，且该列不是唯一列，删除该列
    var colEmpty = srcCol.branches.every(function (br) {
      return br.every(function (x) { return x.type === 'EMPTY'; });
    });
    if (colEmpty && srcNet.columns.length > 1) {
      srcNet.columns.splice(loc.col, 1);
      // 目标列索引需要相应修正
      if (pos.net === loc.net && pos.col > loc.col) pos.col -= 1;
    }

    // 插入目标
    insertInto(ED.blk.networks[pos.net], pos, el);

    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    setSelection(el.id);
    var where = pos.net !== loc.net ? ('网络' + (pos.net + 1)) : ('网络' + (pos.net + 1) + ' 第' + (pos.col + 1) + '列');
    toast('已移动元件到 ' + where);
  }

  /* 插入元件到指定落点
   * 规则（对齐 TIA）：
   *  · 开放分支：永远插在开口箭头之前
   *  · 线圈是分支的终点：不允许插到线圈后面（自动挪到线圈之前）
   *  · 线圈落到开放分支末尾时，开口箭头失效（分支由线圈收尾）
   * 返回实际插入位置 {col, branch, idx} */
  function insertInto(net, pos, el) {
    // 在指定列之前插入一整列
    if (pos.newCol && pos.col != null && pos.col <= net.columns.length) {
      net.columns.splice(pos.col, 0, { branches: [[el]] });
      return { col: pos.col, branch: 0, idx: 0 };
    }
    // 追加新列
    if (pos.col == null || pos.col >= net.columns.length || pos.pos === 'after') {
      net.columns.push({ branches: [[el]] });
      return { col: net.columns.length - 1, branch: 0, idx: 0 };
    }
    var col = net.columns[pos.col];
    if (!col) {
      net.columns.push({ branches: [[el]] });
      return { col: net.columns.length - 1, branch: 0, idx: 0 };
    }
    // 确保分支存在（缺的分支一律建成开放分支，绝不生成空闭合环）
    while (col.branches.length <= pos.branch) {
      col.branches.push(pos.branch === 0 ? [] : [mkOpenEnd()]);
    }
    var br = col.branches[pos.branch];
    var idx = br.length ? Math.min(typeof pos.pos === 'number' ? pos.pos : br.length, br.length) : 0;

    // 开放分支：插到开口箭头之前
    if (isOpenBranch(br) && idx >= br.length) idx = br.length - 1;
    // 线圈是末端元件：不允许插到线圈后面
    for (var k = 0; k < idx && k < br.length; k++) {
      if (isCoilType(br[k].type)) { idx = k; break; }
    }

    // 若目标位置是历史遗留的空槽位则替换
    if (br[idx] && br[idx].type === 'EMPTY') {
      br[idx] = el;
    } else {
      br.splice(idx, 0, el);
    }

    // 线圈收尾：去掉末尾的开口箭头（分支由线圈结束）
    if (isOpenBranch(br) && br.length >= 2 && isCoilType(br[br.length - 2].type)) {
      br.pop();
    }
    return { col: pos.col, branch: pos.branch, idx: idx };
  }

  /* ============================================================
   * 插入指令
   * ============================================================ */
  function insertInstruction(type, pos) {
    if (!guardEdit()) return false;      // 在线只读
    var el = mkEl(type);
    if (!el) { toast('未知指令：' + type, 'err'); return; }
    // 落点是引脚小方块（R / LD 的接线端子）：直接接成这条引脚的触点支路
    if (pos && pos.kind === 'pin') {
      var pmeta = window.INSTR ? window.INSTR.info(type) : null;
      if (!pmeta || pmeta.kind !== 'contact') {
        toast(pos.pin + ' 端只能接触点（常开 / 常闭）', 'err');
        return false;
      }
      return dropContactOnPin(el, pos);
    }
    if (!pos) pos = { net: ED.curNet || 0, col: 999, branch: 0, pos: 'after' };
    if (pos.net == null || !ED.blk.networks[pos.net]) pos.net = ED.curNet || 0;
    var net = ED.blk.networks[pos.net] || ED.blk.networks[0];
    if (!net) return;

    var actual = insertInto(net, pos, el);
    // 记住落点：连续点指令时按顺序往后排（TIA 的插入光标行为）
    ED.insTarget = { net: pos.net, col: actual.col, branch: actual.branch, pos: actual.idx + 1 };

    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    setSelection(el.id);
    // 对齐 TIA：插入后不弹窗，直接显示红色 <?..?> 占位符
    // 用户双击元件即可就地输入
    if (needsOperand(el)) {
      toast('已插入 ' + (window.INSTR.info(type) || {}).name + '，双击元件输入地址');
    } else {
      toast('已插入 ' + (window.INSTR.info(type) || {}).name);
    }
    // 对齐 TIA：添加 TON/TOF/TP/TONR/计数器等需要实例 DB 的指令时，
    // 自动弹出"调用选项"命名数据块（点右上角 ✕ 可跳过，元件保持 <???>）
    var metaIns = window.INSTR.info(type);
    if (metaIns && metaIns.fb) {
      openCallDialog(el);
    }
  }

  /* 指令面板单击 / 收藏夹双击：插到"当前插入点"
   * 优先级：选中的元件 → 选中的线段 → 刚创建的开放分支 → 网络末尾新列 */
  function resolveInsertPos() {
    if (!ED.blk) return null;

    // 1) 选中的元件：插到它后面（线圈/开口箭头这类末端元件则插到它前面）
    //    引脚支路上的触点（loc.pin）不在列/行里，插到它"后面"没有意义 → 走后面的兜底
    if (ED.selId) {
      var loc = locate(ED.blk, ED.selId);
      if (loc && !loc.pin) {
        var meta = window.INSTR ? window.INSTR.info(loc.el.type) : null;
        var terminal = isOpenEndEl(loc.el) || (meta && meta.kind === 'coil');
        return {
          net: loc.net, col: loc.col, branch: loc.branch,
          pos: terminal ? loc.idx : loc.idx + 1
        };
      }
    }

    // 2) 选中的线段
    if (ED.selSeg) {
      var sp = parseSeg(ED.selSeg);
      if (sp) {
        if (sp.kind === 'link') return { net: sp.net, col: sp.col, branch: 0, pos: 0, newCol: true };
        // 整段导线：插到该列这一行的末尾
        if (sp.kind === 'col') {
          var cnet = ED.blk.networks[sp.net];
          var ccol = cnet && cnet.columns[sp.col];
          var crow = sp.row == null ? 0 : sp.row;
          if (ccol && ccol.branches[crow]) {
            return { net: sp.net, col: sp.col, branch: crow, pos: ccol.branches[crow].length };
          }
        }
        if (sp.kind === 'vsegR' || sp.kind === 'vsegL' || sp.kind === 'ebr') {
          var net = ED.blk.networks[sp.net];
          var col = net && net.columns[sp.col];
          var row = sp.row == null ? 0 : sp.row;
          if (col && col.branches[row]) {
            return { net: sp.net, col: sp.col, branch: row, pos: col.branches[row].length };
          }
        }
      }
    }

    // 3) 上一次的插入点（刚创建的开放分支）
    if (ED.insTarget) return ED.insTarget;
    return null;
  }

  // 插入到当前插入点（单击指令面板时的默认行为）
  function appendInstruction(type) {
    if (!guardEdit()) return false;      // 在线只读
    var pos = resolveInsertPos();
    if (!pos) {
      var netIdx = ED.curNet || 0;
      var net = ED.blk.networks[netIdx] || ED.blk.networks[0];
      if (!net) return;
      pos = { net: netIdx, col: net.columns.length, branch: 0, pos: 'after' };
    }
    insertInstruction(type, pos);
  }

  function needsOperand(el) {
    var m = window.INSTR.info(el.type);
    if (!m) return false;
    if (m.kind === 'contact' || m.kind === 'coil') return !el.operand;
    var hasAny = false;
    (m.params || []).forEach(function (p) {
      if (p.dir === 'in' && el.params && el.params[p.n]) hasAny = true;
    });
    return !hasAny;
  }

  function mkEl(type) {
    var I = window.INSTR;
    var meta = I.info(type);
    if (!meta) return null;
    var el = { id: uid(), type: type };
    if (meta.kind === 'contact' || meta.kind === 'coil') {
      el.operand = '';
    } else {
      el.params = {};
      (meta.params || []).forEach(function (p) {
        // soft 默认值（如计数器 R=false）不写进参数，只在画面上显示灰字，
        // 这样"未接线"和"手工填了 false"在数据上仍然是可区分的
        if (p.d !== undefined && !p.soft) el.params[p.n] = p.d;
      });
    }
    return el;
  }

  /* ============================================================
   * 结构编辑
   * ============================================================ */

  // 断开某条分支的汇合竖线：分支内容保留，右端变成开口（对齐 TIA 图 7 → 图 8）
  function breakBranchAt(sp) {
    if (!sp || sp.col == null || sp.row == null) return;
    var net = ED.blk.networks[sp.net];
    var col = net && net.columns[sp.col];
    if (!col) return;
    var row = sp.row;
    if (row <= 0) { toast('主行没有汇合竖线', 'err'); return; }
    var br = col.branches[row];
    if (!br) return;
    if (isOpenBranch(br)) { toast('该分支已经是开放分支', 'err'); return; }

    br.push(mkOpenEnd());
    ED.selSeg = null;
    if (window.App) window.App.selSeg = null;
    ED.insTarget = { net: sp.net, col: sp.col, branch: row, pos: Math.max(0, br.length - 1) };
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已删除该汇合竖线 —— 分支变为开放分支（元件保留）');
  }

  // 删除整行并联分支（空分支直通线按 Delete 时用）
  function deleteBranchRow(sp) {
    if (!sp || sp.col == null) return;
    var net = ED.blk.networks[sp.net];
    var col = net && net.columns[sp.col];
    if (!col) return;
    if (col.branches.length <= 1) { toast('至少保留一条分支', 'err'); return; }
    var row = sp.row == null ? 0 : sp.row;
    if (row <= 0) { toast('主行不可删除', 'err'); return; }
    col.branches.splice(row, 1);
    ED.selSeg = null;
    if (window.App) window.App.selSeg = null;
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已删除一条并联分支（剩 ' + col.branches.length + ' 条）');
  }

  /* 老数据归一化：
     1) 老的并联空分支（branches[i] = []，i>0）转成"开放分支"，
        否则会被画成"空闭合环"（一根横线 + 汇合竖线）；
     2) 主线（第 1 行）里残留的 OPEN_END 直接清掉 —— 主线永远是连到线圈的，
        不可能"在这里结束"，留着就会在主干导线中间画出一个箭头（历史遗留）。 */
  function normalizeBranches(blk) {
    if (!blk || !blk.networks) return false;
    var changed = false;
    blk.networks.forEach(function (net) {
      (net.columns || []).forEach(function (col) {
        if (!col.branches) return;
        for (var i = 1; i < col.branches.length; i++) {
          if (col.branches[i] && col.branches[i].length === 0) {
            col.branches[i] = [mkOpenEnd()];
            changed = true;
          }
        }
        // 主线不允许有开口箭头
        var main = col.branches[0];
        if (main && main.length) {
          for (var m = main.length - 1; m >= 0; m--) {
            if (isOpenEndEl(main[m])) { main.splice(m, 1); changed = true; }
          }
        }
      });
    });
    return changed;
  }

  /* 取"要操作的分支"：选中元件 > 选中线段 > 上次插入点 */
  function targetBranch() {
    if (!ED.blk) return null;
    if (ED.selId) {
      var loc = locate(ED.blk, ED.selId);
      // 选中引脚支路上的触点时，它不属于任何分支 → 交给后面的兜底
      if (loc && !loc.pin) return { net: loc.net, col: loc.col, branch: loc.branch };
    }
    if (ED.selSeg) {
      var sp = parseSeg(ED.selSeg);
      if (sp && sp.col != null) {
        return { net: sp.net, col: sp.col, branch: (sp.row == null ? 0 : sp.row) };
      }
    }
    if (ED.insTarget) {
      return { net: ED.insTarget.net, col: ED.insTarget.col, branch: ED.insTarget.branch };
    }
    return null;
  }

  /* 关闭分支（对齐 TIA 的「关闭分支」图标）：
     把当前开放分支的末端向上汇合回主线 —— 去掉开口箭头，画上汇合竖线 */
  function closeBranch() {
    if (!guardEdit()) return;            // 在线只读
    if (!ED.blk) return;
    var t = targetBranch();
    var net = t ? ED.blk.networks[t.net] : null;
    if (!net) net = ED.blk.networks[ED.curNet || 0];
    if (!net) { toast('请先选择一个网络', 'err'); return; }

    var col = net.columns[t ? t.col : 0];
    if (t && (!col || !col.branches[t.branch])) { col = net.columns[0]; t = null; }
    if (!col) return;

    var row = t ? t.branch : null;

    // 没指定就拿该网络里最后一个开放分支
    if (row == null) {
      for (var c = net.columns.length - 1; c >= 0 && row == null; c--) {
        var cc = net.columns[c];
        for (var b = cc.branches.length - 1; b >= 1; b--) {
          if (isOpenBranch(cc.branches[b])) { row = b; col = cc; t = { net: t ? t.net : (ED.curNet || 0), col: c, branch: b }; break; }
        }
      }
    }
    if (row == null) { toast('当前没有可关闭的开放分支', 'err'); return; }
    if (row <= 0) { toast('主线没有可关闭的分支', 'err'); return; }

    var br = col.branches[row];
    if (!br) return;
    if (!isOpenBranch(br)) {
      toast('该分支已经是闭合状态（若要去掉它，选中汇合竖线按 Delete）', 'err');
      return;
    }
    // 去掉末尾的开口箭头 → 分支闭合、向上汇合
    while (br.length && isOpenEndEl(br[br.length - 1])) br.pop();

    // 空分支没有"东西"可汇合，直接整行删掉（否则会退化成空闭合环）
    if (br.length === 0) {
      col.branches.splice(row, 1);
      ED.insTarget = null;
      ED.tab.dirty = true;
      rerender({ keepScroll: true });
      toast('已关闭并删除这条空分支');
      return;
    }

    ED.insTarget = null;
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已关闭该分支 —— 分支向上汇合到主线');
  }

  /* 在"某个元件边界"处把列切开（对齐 TIA：分支从你点的那一点分出去，
     而不是从整列的左边界分出去）。
     k = 边界左边保留几个元件：
       k = 0        → 不动（就在列左边界）
       0 < k < 长度 → 切成左右两列，返回右列索引
       k = 最大长度 → 右边没东西了，插一列空列，返回新列索引
     切分保留行结构：每条分支各自按 k 切；右半边空的记为 []（直通）

     开口箭头（OPEN_END）的处理很关键 —— 它只是个"分支到此为止"的标记，
     不是元件。切开之后：
       · 左半边末尾的箭头要摘掉（这条支路在切口处接上了，不再"到此为止"）
       · 右半边开头的箭头要摘掉（箭头前面没东西了毫无意义）
       · 右半边因此变空的并联行整行不要（留下 [] 会在渲染时被归一化成新的
         OPEN_END，切一次裂成两个箭头，也就是"线段中间冒出箭头"那种怪图形） */
  function forkColumnAt(net, colIdx, k) {
    var col = net && net.columns[colIdx];
    if (!col || !(k > 0)) return colIdx;

    var maxLen = 0;
    col.branches.forEach(function (br) { maxLen = Math.max(maxLen, br.length); });

    var trimTail = function (arr) {
      while (arr.length && isOpenEndEl(arr[arr.length - 1])) arr.pop();
      return arr;
    };

    if (k >= maxLen) {
      // 所有分支都在 k 之前结束：右边新建一列放分支
      col.branches.forEach(function (br) { trimTail(br); });
      net.columns.splice(colIdx + 1, 0, { branches: [[]] });
      return colIdx + 1;
    }

    var leftRows = [], rightRows = [];
    col.branches.forEach(function (br) {
      var L = trimTail(br.slice(0, k));
      var R = br.slice(k);
      while (R.length && isOpenEndEl(R[0])) R.shift();
      leftRows.push(L);
      rightRows.push(R);
    });

    // 左右两侧：并联行空了就整行去掉（留着会被归一化成新的开口箭头）
    var keepL = leftRows.filter(function (L, i) { return i === 0 || L.length > 0; });
    var keepR = rightRows.filter(function (R, i) { return i === 0 || R.length > 0; });

    // 右边什么都不剩（切点正好在本列最后）：不新建空列，
    // 否则会多出一列空白，看起来像导线被拉开一段（V31 修复）
    var rightEmpty = keepR.every(function (R) { return R.length === 0; });
    if (rightEmpty) {
      col.branches = keepL;
      return colIdx;
    }

    net.columns.splice(colIdx, 1, { branches: keepL },
      { branches: keepR.length ? keepR : [[]] });
    return colIdx + 1;
  }

  /* 把屏幕坐标换算成"落点"：{net, col, row, k}
     k = 这一行里第几个元件之后（0 = 列首，br.length = 列尾） */
  function anchorAtPoint(clientX, clientY) {
    if (!ED.blk) return null;
    var nets = document.querySelectorAll('.network');
    for (var i = 0; i < nets.length; i++) {
      var svg = nets[i].querySelector('.net-svg svg');
      if (!svg) continue;
      var r = svg.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      var netIdx = +nets[i].dataset.net;
      var net = ED.blk.networks[netIdx];
      if (!net || !net.columns.length) return null;
      var L = LAD.calcLayout(net);
      var G = LAD.GRID;
      // 缩放后显示尺寸 ≠ 内部坐标系：换算回 svg 原始单位再和布局坐标比较
      var kx = r.width ? svg.width.baseVal.value / r.width : 1;
      var px = (clientX - r.left) * kx;

      // 落点只认主线（并联分支在梯形图里只能汇合回主线）
      var row = 0;

      var x = G.padL, ci = -1, cw = 0;
      for (var c = 0; c < net.columns.length; c++) {
        cw = L.widths[c] || G.cellW;
        if (px <= x + cw + G.gap / 2) { ci = c; break; }
        x += cw + G.gap;
      }
      if (ci < 0) {
        ci = net.columns.length - 1;
        x = G.padL;
        for (var c1 = 0; c1 < ci; c1++) x += (L.widths[c1] || G.cellW) + G.gap;
        cw = L.widths[ci] || G.cellW;
      }
      var col = net.columns[ci];
      if (!col) return null;
      if (row > col.branches.length - 1) row = col.branches.length - 1;
      var br = col.branches[row] || [];
      var cells = LAD.cellLayout(br, x, cw);
      var k = 0, best = 1e9;
      for (var kk = 0; kk <= br.length; kk++) {
        var bxv = kk < br.length ? cells[kk].x : x + cw;
        var d = Math.abs(px - bxv);
        if (d < best) { best = d; k = kk; }
      }
      return { net: netIdx, col: ci, row: row, k: k };
    }
    return null;
  }

  /* 拖开口箭头时的"落点"识别（比 anchorAtPoint 多认一种目标）：
     · 先看指针下是不是引脚小方块（R / LD 接线端子）→ { kind:'pin', elId, pin }
       （用户现场："希望通过拖拽来将触点和 r 端连接起来" —— 拖箭头到 R 脚）
     · 否则退回 anchorAtPoint 的横线落点 { net, col, row, k } */
  function arrowTargetAt(clientX, clientY) {
    var els = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    for (var i = 0; i < els.length; i++) {
      var t = els[i];
      var portEl = t && t.closest ? t.closest('[data-pin-port]') : null;
      if (portEl) {
        var spec = String(portEl.getAttribute('data-pin-port') || '').split(':');
        if (spec.length >= 2) return { kind: 'pin', elId: spec[0], pin: spec[1] };
      }
    }
    return anchorAtPoint(clientX, clientY);
  }

  /* 拖拽目标的唯一 key（重绘时用来画"落点变绿"）：
     横线落点 = net:col:row:k；引脚落点 = pin:elId:pin */
  function arrowTargetKey(t) {
    if (!t) return null;
    if (t.kind === 'pin') return 'pin:' + t.elId + ':' + t.pin;
    return t.net + ':' + t.col + ':' + t.row + ':' + t.k;
  }

  /* 把开放分支的开口箭头"合并"到某条横线上（对齐 TIA：拖动开口箭头到导线上）
     · 同一列：在落点处把列切开，左半列这条分支的箭头被收掉 → 分支在该处汇合
     · 不在同一列：只能合到本列末端（等价于"关闭分支"） */
  function mergeOpenArrow(src, dst) {
    if (!guardEdit()) return false;      // 在线只读
    if (!src || !dst || !ED.blk) return false;
    var net = ED.blk.networks[src.net];
    if (!net) return false;
    var col = net.columns[src.col];
    if (!col) return false;
    var br = col.branches[src.row];
    if (!br || !isOpenBranch(br)) {
      toast('这条分支不是开放分支，不能合并', 'err');
      return false;
    }

    if (dst.net !== src.net || dst.col !== src.col) {
      // 跨列：合到本列末端
      while (br.length && isOpenEndEl(br[br.length - 1])) br.pop();
      if (br.length === 0 && col.branches.length > 1) col.branches.splice(src.row, 1);
      toast('已关闭该分支 —— 在本列末端汇合回主线');
    } else {
      var maxLen = 0;
      col.branches.forEach(function (b) { maxLen = Math.max(maxLen, b.length); });
      var k = Math.max(1, Math.min(dst.k, maxLen));
      if (k < br.length - 1) k = br.length - 1;    // 不能把分支自己的元件切断
      forkColumnAt(net, src.col, k);               // 切口会把左半列末尾的箭头收掉
      // 左列这行空了就整行去掉（否则会被归一化成新的开口箭头）
      var left = net.columns[src.col];
      if (left && left.branches[src.row] && left.branches[src.row].length === 0) {
        left.branches.splice(src.row, 1);
        if (!left.branches.length) left.branches.push([]);
      }
      toast('已把开口分支合并到这条横线上');
    }

    ED.insTarget = null;
    ED.selId = null;
    ED.selSeg = null;
    if (window.App) { window.App.selSeg = null; window.App.selEl = null; }
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    return true;
  }

  /* 把开放分支的开口箭头拖到引脚小方块（R / LD 端子）上
     → 整条开放分支变成这个引脚的触点支路（母线 → 触点链 → 引脚）。
     · 分支里除开口箭头外必须全是触点（常开/常闭/上升沿/下降沿）——引脚链只吃触点；
     · 触点数上限 3（和 dropContactOnPin 一致）；
     · 挪完后清掉空分支 / 空列（和 deleteElement 的结构清理一致）。 */
  function mergeOpenArrowToPin(src, pos) {
    if (!guardEdit()) return false;      // 在线只读
    if (!src || !pos || pos.kind !== 'pin' || !ED.blk) return false;
    var net = ED.blk.networks[src.net];
    if (!net) return false;
    var col = net.columns[src.col];
    if (!col) return false;
    var br = col.branches[src.row];
    if (!br || !isOpenBranch(br)) {
      toast('这条分支不是开放分支，不能接入引脚', 'err');
      return false;
    }

    // 找到引脚所属的盒体（计数器等）
    var hostLoc = locate(ED.blk, pos.elId);
    if (!hostLoc) { toast('找不到这个引脚所属的元件', 'err'); return false; }
    var host = hostLoc.el;
    var meta = window.INSTR ? window.INSTR.info(host.type) : null;
    if (!meta || !meta.pinBranches || meta.pinBranches.indexOf(pos.pin) < 0) {
      toast('这个元件没有 ' + pos.pin + ' 端', 'err');
      return false;
    }

    // 分支里除开口箭头外只能是触点
    var contacts = [], bad = null;
    for (var i = 0; i < br.length; i++) {
      var e = br[i];
      if (isOpenEndEl(e)) continue;
      var m = window.INSTR ? window.INSTR.info(e.type) : null;
      if (m && m.kind === 'contact') contacts.push(e);
      else { bad = e; break; }
    }
    if (bad) {
      toast(pos.pin + ' 端只能接触点（请先把 ' + (bad.type || '元件') + ' 移出这条分支）', 'err');
      return false;
    }
    if (!contacts.length) {
      toast('这条分支里没有触点可接', 'err');
      return false;
    }

    if (!host.pins) host.pins = {};
    if (!host.pins[pos.pin]) host.pins[pos.pin] = [];
    var chain = host.pins[pos.pin];
    if (chain.length + contacts.length > 3) {
      toast(pos.pin + ' 端最多串 3 个触点', 'err');
      return false;
    }

    // 收掉开口箭头，把触点按顺序挪进引脚链（br 里剩下的就全是触点）
    while (br.length && isOpenEndEl(br[br.length - 1])) br.pop();
    while (br.length) chain.push(br.shift());

    // 结构清理：空分支整行删掉、空列该删就删（同 deleteElement）
    if (src.row > 0 && col.branches.length > 1 && col.branches[src.row] && col.branches[src.row].length === 0) {
      col.branches.splice(src.row, 1);
    }
    var colIsEmpty = col.branches.every(function (b) {
      return b.length === 0 || b.every(function (x) { return x.type === 'EMPTY'; });
    });
    if (colIsEmpty && net.columns.length > 1) {
      net.columns.splice(src.col, 1);
    } else if (colIsEmpty) {
      col.branches = [[]];
    } else {
      col.branches = col.branches.map(function (b) {
        return b.filter(function (x) { return x.type !== 'EMPTY'; });
      });
      if (col.branches.length === 0) col.branches = [[]];
    }

    ED.insTarget = null;
    ED.selId = null;
    ED.selSeg = null;
    if (window.App) { window.App.selSeg = null; window.App.selEl = null; }
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已把这条分支接到 ' + pos.pin + ' 端');
    // 单个触点还没地址 → 弹地址框（和拖触点接引脚的手感一致）
    if (chain.length === 1 && !chain[0].operand && !chain[0].addr) {
      try { editAddressOnly(chain[0]); } catch (err) { }
    }
    return true;
  }

  /* 插入一条开放分支（OPEN_BRANCH / 并联+）
   * forceNet: 指定网络（不跟随选中状态时用） */
  function addOpenBranch(dir, forceNet) {
    if (!guardEdit()) return;            // 在线只读
    if (!ED.blk) return;
    var netIdx = (forceNet == null) ? (ED.curNet || 0) : forceNet;
    var colIdx = null, baseRow = null, splitAt = 0;

    if (forceNet == null) {
      // 优先跟随选中状态：元件 → 该列该行；线段 → 该列该行
      if (ED.selId) {
        var loc = locate(ED.blk, ED.selId);
        // 引脚支路上的触点不在列/行里：不在它旁边分叉，落到最后一列
        if (loc && !loc.pin) { netIdx = loc.net; colIdx = loc.col; baseRow = loc.branch; splitAt = loc.idx; }
      } else if (ED.selSeg) {
        var sp = parseSeg(ED.selSeg);
        if (sp && sp.col != null) {
          netIdx = sp.net; colIdx = sp.col; baseRow = sp.row;
          // 导线段：sp.seg = 这段线左边有几个元件，正好是切点
          if (sp.kind === 'col' && sp.seg != null) splitAt = sp.seg;
        }
      }
    }

    var net = ED.blk.networks[netIdx];
    if (!net || !net.columns.length) { toast('请先选择一个网络', 'err'); return; }
    /* 没选中任何元件 / 线段时的兜底落点。
       旧代码默认 colIdx = 0，而第 1 列的"分出竖线"和左侧母线是重合的
       （lad.js 里 vLX 与 GRID.padL 重合就不画左竖线，由母线顶替）——
       于是新分支的引线直接从母线上长出来，看着像"主线和分支意外连在一起"。
       改成落在最后一列，和"没选中时追加指令"的落点一致，竖线画在列边界上，不再贴母线。 */
    if (colIdx == null) colIdx = net.columns.length - 1;
    if (colIdx >= net.columns.length) colIdx = net.columns.length - 1;
    if (colIdx < 0) colIdx = 0;

    // 在选中点把列切开 —— 分支才会落在"你点的那一段"下面
    if (splitAt > 0 && dir !== 'up') {
      colIdx = forkColumnAt(net, colIdx, splitAt);
    }

    var col = net.columns[colIdx];
    if (!col) return;

    var idx;
    if (dir === 'up') {
      idx = (baseRow == null) ? 1 : baseRow;          // 插到当前行上方
    } else {
      idx = (baseRow == null) ? col.branches.length : baseRow + 1;
    }
    idx = Math.max(1, Math.min(idx, col.branches.length));   // 第 0 行永远是主线

    col.branches.splice(idx, 0, [mkOpenEnd()]);

    ED.insTarget = { net: netIdx, col: colIdx, branch: idx, pos: 0 };
    ED.selId = null;
    ED.selSeg = null;
    if (window.App) window.App.selSeg = null;
    if (window.App) window.App.selEl = null;
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已插入开放分支（网络 ' + (netIdx + 1) + ' 第 ' + (colIdx + 1) + ' 列，第 ' +
      (idx + 1) + ' 行）—— 直接点指令即可放进这条分支');
  }

  // 兼容旧调用：给指定网络加并联分支（现在是"开放分支"）
  function addBranch(netIdx) {
    if (ED.selId || ED.selSeg) {
      ED.curNet = netIdx;
      addOpenBranch('down');
      return;
    }
    addOpenBranch('down', netIdx);
  }

  function addColumn(netIdx) {
    var net = ED.blk.networks[netIdx];
    if (!net) return;
    net.columns.push({ branches: [[]] });
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已在网络 ' + (netIdx + 1) + ' 追加一列');
  }

  function delNetwork(netIdx) {
    var nets = ED.blk.networks;
    if (nets.length <= 1) { toast('至少保留一个网络', 'err'); return; }
    nets.splice(netIdx, 1);
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已删除网络 ' + (netIdx + 1));
  }

  function newNetwork() {
    ED.blk.networks.push({
      title: '',
      columns: [{ branches: [[]] }]
    });
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
  }

  /* ============================================================
   * 导线拖拽：拖出并联分支
   * ============================================================ */
  function startWireGhost(x, y) {
    var g = document.createElement('div');
    g.id = 'wireGhost';
    g.className = 'wire-ghost';
    g.style.left = x + 'px';
    g.style.top = y + 'px';
    g.textContent = '＋并联';
    document.body.appendChild(g);
  }
  function onWireMove(e) {
    var g = $('#wireGhost');
    if (g) { g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; }
    // 高亮候选分支
    $$('.network').forEach(function (n) { n.classList.remove('wire-target'); });
    var netEl = document.elementFromPoint(e.clientX, e.clientY);
    var nw = netEl && netEl.closest ? netEl.closest('.network') : null;
    if (nw) nw.classList.add('wire-target');
  }
  function onWireUp(e) {
    document.removeEventListener('mousemove', onWireMove);
    var g = $('#wireGhost');
    if (g) g.remove();
    $$('.network').forEach(function (n) { n.classList.remove('wire-target'); });

    var wd = ED.wireDrag;
    ED.wireDrag = null;
    if (!wd) return;

    var target = document.elementFromPoint(e.clientX, e.clientY);
    var netEl = target && target.closest ? target.closest('.network') : null;

    // 拖到另一网络 => 把该分支内容迁过去（形成新的并联分支在那边的第 1 列）
    var srcNet = ED.blk.networks[wd.net];
    if (!srcNet) return;
    var srcCol = srcNet.columns[wd.col];
    if (!srcCol || !srcCol.branches[wd.branch]) return;

    if (netEl && +netEl.dataset.net !== wd.net) {
      var dstNet = ED.blk.networks[+netEl.dataset.net];
      if (dstNet && dstNet.columns.length) {
        var moved = srcCol.branches[wd.branch];
        dstNet.columns[0].branches.push(moved);
        srcCol.branches.splice(wd.branch, 1);
        if (srcCol.branches.length === 0) srcCol.branches.push([]);
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        toast('已把分支移动到 网络' + (+netEl.dataset.net + 1));
        return;
      }
    }

    // 拖到本网络空白处 => 新增一条并联分支
    if (netEl && +netEl.dataset.net === wd.net) {
      var dist = Math.abs(e.clientY - wd.y0);
      if (dist > 20) {
        srcCol.branches.push([]);
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        toast('已添加并联分支');
        return;
      }
    }
    // 否则取消
  }

  /* ============================================================
   * 就地编辑：双击地址行 / 符号行
   * 对齐 TIA：双击后该处变成蓝底输入框，回车确认，Esc 取消
   * ============================================================ */
  function inlineEdit(anchorEl, opts) {
    closeInlineEdit();

    var rect = anchorEl.getBoundingClientRect();
    var box = document.createElement('div');
    box.className = 'inline-edit';
    box.id = 'inlineEdit';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = opts.value || '';
    inp.placeholder = opts.placeholder || '';
    inp.spellcheck = false;
    box.appendChild(inp);

    // 下拉候选（地址输入时给常用地址；符号输入时给变量表里的符号）
    if (opts.suggest && opts.suggest.length) {
      var sel = document.createElement('select');
      sel.className = 'ie-sel';
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '选择…';
      sel.appendChild(o0);
      opts.suggest.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.value;
        o.textContent = s.label;
        sel.appendChild(o);
      });
      sel.onchange = function () {
        // FB 实例候选：交给 onPick 做二级选择（如选 IN/Q 成员），不走普通提交
        var idx = sel.selectedIndex - 1;
        var picked = (idx >= 0 && opts.suggest) ? opts.suggest[idx] : null;
        if (picked && picked.fb && opts.onPick) {
          opts.onPick(picked);
          return;
        }
        if (sel.value) {
          // 选中候选后立即提交：更新器件命名并关闭弹窗
          inp.value = sel.value;
          commit(true);
        }
      };
      box.appendChild(sel);
    }

    document.body.appendChild(box);

    var bw = Math.max(box.offsetWidth, 150);
    var left = Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 8);
    box.style.left = Math.max(6, left) + 'px';
    box.style.top = Math.max(6, rect.top - 3) + 'px';

    inp.focus();
    inp.select();

    var done = false;
    function commit(ok) {
      if (done) return;
      done = true;
      var v = inp.value.trim();
      // 地址类输入：自动转大写（对齐 TIA）；FB 实例引用 "name".X 除外
      if (ok && opts.uppercase && !/^"/.test(v)) v = v.toUpperCase();
      closeInlineEdit();
      if (ok) opts.onCommit(v);
    }

    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      // 输入时实时转大写（视觉上立即生效，光标不跳）
      if (opts.uppercase && ev.key.length === 1 && /[a-z]/i.test(ev.key)) {
        // 交给 input 事件处理
      }
    });

    // 实时把输入框里的字母转成大写（保持光标位置）；FB 实例引用 "name".X 不转
    if (opts.uppercase) {
      inp.addEventListener('input', function () {
        if (/^"/.test(inp.value)) return;
        var pos = inp.selectionStart;
        var upper = inp.value.toUpperCase();
        if (upper !== inp.value) {
          inp.value = upper;
          try { inp.setSelectionRange(pos, pos); } catch (e) { }
        }
      });
    }
    inp.addEventListener('blur', function (ev) {
      // 失焦也提交（与 TIA 一致：点别处即生效）
      // 但如果焦点只是移到本弹窗内的候选下拉（select），则不提交，
      // 否则一点开下拉弹窗就会"一闪而过"地自动关闭
      var rt = ev.relatedTarget;
      if (rt && rt.closest && rt.closest('#inlineEdit')) return;
      setTimeout(function () {
        // 延迟后再确认一次：焦点若已回到弹窗内（如下拉选择中），不提交
        var b = document.getElementById('inlineEdit');
        if (b && b.contains(document.activeElement)) return;
        commit(true);
      }, 120);
    });

    // 焦点在下拉上时点外部：同样按失焦提交处理（否则弹窗会残留）
    var selEl = box.querySelector('select');
    if (selEl) {
      selEl.addEventListener('blur', function () {
        setTimeout(function () {
          var b = document.getElementById('inlineEdit');
          if (b && b.contains(document.activeElement)) return;
          commit(true);
        }, 120);
      });
    }
  }

  function closeInlineEdit() {
    var b = document.getElementById('inlineEdit');
    if (b) b.remove();
  }

  // ============================================================
  // 地址内联编辑（对齐 TIA）
  //  · 双击元件 → 就地输入 I/Q/M 地址
  //  · 输入自动转大写（回车时）
  //  · 下拉候选显示变量表里的内容
  //  · 变量表里没有该地址时自动创建一条（名字 Tag_1 / Tag_2 ...）
  // ============================================================
  function editAddressOnly(el) {
    var anchor = findAnchorFor(el.id);
    if (!anchor) return;

    var tags = ED.tags || [];

    // 候选：只显示变量表里已有的地址
    var sugg = [];
    tags.forEach(function (t) {
      if (!t.address) return;
      if (t.isClock || t.isSystem) return;
      sugg.push({
        value: t.address,
        label: t.address + '  "' + t.name + '"'
      });
    });

    // FB 实例候选（对齐 TIA："time" DB3 这种），选中后二级菜单挑成员
    fbInstances().forEach(function (fb) {
      sugg.push({
        value: '\u0001fb:' + fb.instance,
        label: '"' + fb.instance + '"  ' + fb.type + (fb.db ? ' DB' + fb.db : ''),
        fb: fb
      });
    });

    inlineEdit(anchor, {
      value: el.addr || (el.operand && /^".*\./.test(el.operand) ? el.operand : ''),
      placeholder: 'I0.0 / Q0.0 / M10.0',
      suggest: sugg.slice(0, 200),
      uppercase: true,            // 回车自动转大写
      onPick: function (s) {
        // 选中 FB 实例：弹出成员选择菜单（IN / Q / ET …）
        closeInlineEdit();
        pickFbMember(el, s.fb);
      },
      onCommit: function (v) {
        if (!v) {
          el.addr = '';
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
          return;
        }
        // FB 实例成员引用（"time".Q）：不做大写校验，直接采纳
        var fbRef = /^"?[^".\s]+"?\.[A-Za-z_]\w*$/.test(v) && !PLC.parseAddr(v);
        if (fbRef) {
          el.operand = v;
          el.addr = '';
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
          toast('操作数已设为 ' + v);
          return;
        }
        // 自动转大写（I/Q/M）
        var addr = String(v).toUpperCase().replace(/\s+/g, '');

        if (!PLC.parseAddr(addr)) {
          toast('地址格式无效：' + v + '（应为 I0.0 / Q0.0 / MW10 形式）', 'err');
          return;
        }

        el.addr = addr;

        // 查找变量表里是否已有该地址
        var found = tags.filter(function (t) { return t.address === addr; })[0];
        if (found) {
          // 已有：把符号名带出来
          el.operand = found.name;
        } else {
          // 没有：自动创建一条变量（名字 Tag_N）
          var newTag = createAutoTag(addr);
          el.operand = newTag.name;
        }

        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        if (ED.onTagsChanged) ED.onTagsChanged();
        toast('地址已设为 ' + addr);
      }
    });
  }

  // 自动创建一个变量：Tag_1 / Tag_2 …（只增不改）
  function createAutoTag(addr) {
    var tags = ED.tags || [];
    // 先看是否已有同地址（防御）
    var exist = tags.filter(function (t) { return t.address === addr; })[0];
    if (exist) return exist;

    // 找下一个可用编号
    var maxN = 0;
    tags.forEach(function (t) {
      var m = /^Tag_(\d+)$/.exec(t.name || '');
      if (m) maxN = Math.max(maxN, +m[1]);
    });
    var name = 'Tag_' + (maxN + 1);

    // 数据类型按地址推断
    var dt = 'Bool';
    var m2 = /^[IQM](\d+)\.(\d+)$/i.exec(addr);
    if (!m2) {
      if (/^[IQM]D/i.test(addr)) dt = 'DInt';
      else if (/^[IQM]W/i.test(addr)) dt = 'Int';
      else if (/^[IQM]B/i.test(addr)) dt = 'Byte';
    }

    var tag = {
      name: name,
      datatype: dt,
      address: addr,
      retain: false,
      comment: ''
    };
    tags.push(tag);
    return tag;
  }

  // 只改符号名
  function editSymbolOnly(el) {
    // FB 实例成员引用（"time".Q）：双击符号行也走地址/实例选择，不改符号
    if (/^".*\./.test(el.operand || '')) { editAddressOnly(el); return; }
    var anchor = findAnchorFor(el.id);
    if (!anchor) return;
    var tags = ED.tags || [];
    var sugg = tags.map(function (t) {
      return { value: t.name, label: t.name + ' — ' + t.address };
    });

    inlineEdit(anchor, {
      value: el.operand || '',
      placeholder: '如 Motor_Run',
      suggest: sugg,
      onCommit: function (v) {
        if (!v) { el.operand = ''; ED.tab.dirty = true; rerender({ keepScroll: true }); return; }
        el.operand = v;
        // 若该符号在变量表里，自动带出地址
        var t = tags.filter(function (x) { return x.name === v; })[0];
        if (t) el.addr = t.address;
        else if (PLC.parseAddr(v)) { el.addr = v; el.operand = ''; }
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        toast('符号名已改为 ' + v);
      }
    });
  }

  // 找到某个元件在页面上的 SVG 锚点（用于定位输入框）
  function findAnchorFor(id) {
    var wrap = document.querySelector('.lad-wrap');
    if (!wrap) return null;
    var els = wrap.querySelectorAll('[data-el="' + id + '"]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].tagName === 'text') return els[i];
    }
    return els.length ? els[0] : null;
  }

  /* ============================================================
   * 元器件类型切换下拉（对齐 TIA：单击元件 → 出现类型下拉）
   * 触点可换：常开 / 常闭 / 上升沿 / 下降沿
   * 线圈可换：线圈 / 置位 / 复位 / 取反 / 正跳变 / 负跳变
   * ============================================================ */
  var CONTACT_TYPES = ['NO', 'NC', 'P', 'N'];
  var COIL_TYPES = ['COIL', 'SET', 'RESET', 'NEG_COIL', 'POS_COIL', 'NEG_EDGE_COIL'];

  function showTypeDropdown(anchorEl, el, onChanged) {
    closeTypeDropdown();

    var I = window.INSTR;
    var meta = I.info(el.type);
    var isContact = meta && meta.kind === 'contact';
    var isCoil = meta && meta.kind === 'coil';
    if (!isContact && !isCoil) return;

    var list = isContact ? CONTACT_TYPES : COIL_TYPES;
    var rect = anchorEl.getBoundingClientRect();

    var box = document.createElement('div');
    box.className = 'type-dd';
    box.id = 'typeDd';

    list.forEach(function (t) {
      var m = I.info(t);
      var row = document.createElement('div');
      row.className = 'td-row' + (t === el.type ? ' cur' : '');
      row.innerHTML = '<span class="td-sym">' + esc(m ? m.sym : t) + '</span>' +
        '<span class="td-name">' + esc(m ? m.name : t) + '</span>';
      row.onclick = function (ev) {
        ev.stopPropagation();
        // 保持原操作数与地址不变，只换类型
        el.type = t;
        closeTypeDropdown();
        if (onChanged) onChanged();
        toast('已切换为「' + (m ? m.name : t) + '」');
      };
      box.appendChild(row);
    });

    document.body.appendChild(box);
    // 定位到元件下方，超出边界则上翻
    var bw = box.offsetWidth, bh = box.offsetHeight;
    var left = Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 8);
    var top = rect.bottom + 4;
    if (top + bh > window.innerHeight - 8) top = rect.top - bh - 4;
    box.style.left = Math.max(6, left) + 'px';
    box.style.top = Math.max(6, top) + 'px';

    setTimeout(function () {
      document.addEventListener('click', closeTypeDropdown, { once: true });
    }, 10);
  }

  function closeTypeDropdown() {
    var d = document.getElementById('typeDd');
    if (d) d.remove();
  }
  function menu(x, y, items) {
    var old = $('#ladMenu');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'ladMenu';
    d.className = 'lad-menu';
    d.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    d.style.top = Math.min(y, window.innerHeight - items.length * 26 - 10) + 'px';
    items.forEach(function (it) {
      if (it.sep) {
        d.appendChild(Object.assign(document.createElement('div'), { className: 'lm-sep' }));
        return;
      }
      var row = document.createElement('div');
      row.className = 'lm-item' + (it.disabled ? ' disabled' : '');
      row.innerHTML = '<span>' + esc(it.label) + '</span>' +
        (it.key ? '<span class="lm-key">' + esc(it.key) + '</span>' : '');
      if (!it.disabled) {
        row.onclick = function () { d.remove(); it.cb(); };
      }
      d.appendChild(row);
    });
    document.body.appendChild(d);
    setTimeout(function () {
      document.addEventListener('click', function h() {
        var m = $('#ladMenu');
        if (m) m.remove();
        document.removeEventListener('click', h);
      });
    }, 10);
  }

  /* ============================================================
   * 引脚支路（V50）：计数器的 R / LD 接一条"母线 → 触点 → 引脚"的支路
   * 数据挂在盒体上：el.pins = { R: [{id, type:'NO'|'NC', operand}] }
   * 引擎按"从母线进来"单独算这条链的功率流（plc._pinFlow），
   * 画面从左侧母线画到盒体左边的引脚引线上（对齐 TIA）。
   * ============================================================ */
  function addPinContact(el, pin) {
    if (!guardEdit()) return;
    if (!el) return;
    if (!el.pins) el.pins = {};
    if (!el.pins[pin]) el.pins[pin] = [];
    var chain = el.pins[pin];
    if (chain.length >= 3) { toast(pin + ' 端最多串 3 个触点', 'err'); return; }
    var c = { id: uid(), type: 'NO', operand: '' };
    chain.push(c);
    ED.selId = c.id;
    if (window.App) { window.App.selEl = c.id; window.App.selSeg = null; }
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    // 接着就把地址输入框弹出来（和"插入触点立刻命名"的手感一致）
    editAddressOnly(c);
  }

  /* 拖到引脚小方块上 → 这个触点接成该引脚的支路
   * el：触点对象（新建的或拖过来的），pos = { elId, pin } */
  function dropContactOnPin(el, pos) {
    if (!guardEdit()) return false;
    if (!el || !pos) return false;
    var host = null;
    for (var n = 0; n < ED.blk.networks.length && !host; n++) {
      var cols = ED.blk.networks[n].columns;
      for (var c = 0; c < cols.length && !host; c++) {
        for (var b = 0; b < cols[c].branches.length && !host; b++) {
          var br = cols[c].branches[b];
          for (var e = 0; e < br.length; e++) {
            if (br[e] && br[e].id === pos.elId) { host = br[e]; break; }
          }
        }
      }
    }
    if (!host) { toast('找不到这个引脚所属的元件', 'err'); return false; }
    if (!host.pins) host.pins = {};
    if (!host.pins[pos.pin]) host.pins[pos.pin] = [];
    var chain = host.pins[pos.pin];
    if (chain.length >= 3) { toast(pos.pin + ' 端最多串 3 个触点', 'err'); return false; }
    chain.push(el);
    ED.selId = el.id;
    if (window.App) { window.App.selEl = el.id; window.App.selSeg = null; }
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已接到 ' + pos.pin + ' 端');
    // 新建的触点还没有地址 → 立刻弹地址框（和双击小方块的手感一致）；
    // 拖过来的已有触点带着地址，不打扰
    if (!el.operand && !el.addr) {
      try { editAddressOnly(el); } catch (e) { }
    }
    return true;
  }

  function removePinChain(el, pin) {
    if (!guardEdit() || !el || !el.pins) return;
    delete el.pins[pin];
    if (!Object.keys(el.pins).length) delete el.pins;
    ED.tab.dirty = true;
    rerender({ keepScroll: true });
    toast('已删除 ' + pin + ' 端的触点支路');
  }

  function elementMenu(x, y, id) {    var loc = locate(ED.blk, id);
    if (!loc) return;
    // 开口箭头：右键只有"闭合分支"
    if (isOpenEndEl(loc.el)) {
      menu(x, y, [
        {
          label: '闭合分支（恢复汇合竖线）', cb: function () { deleteElement(id); }
        }
      ]);
      return;
    }
    var m = window.INSTR.info(loc.el.type);
    var isBox = m && m.kind === 'box';
    var items = [];
    // 盒式指令：原双击弹出的"编辑指令参数"移到右键"属性"
    if (isBox) {
      items.push({ label: '属性…', cb: function () { openEdit(id); } });
      if (m.fb) {
        items.push({ label: '调用选项…', cb: function () { openCallDialog(loc.el); } });
      }
      // 计数器的 R / LD：接一条触点支路（对齐 TIA：从母线拉过来串触点）
      if (m.pinBranches && m.pinBranches.length && !loc.pin) {
        m.pinBranches.forEach(function (pn) {
          var ch = (loc.el.pins && loc.el.pins[pn]) || [];
          items.push({
            label: ch.length
              ? ('在 ' + pn + ' 端再加一个触点（串联）')
              : (pn + ' 端接一条触点支路…'),
            cb: function () { addPinContact(loc.el, pn); }
          });
          if (ch.length) {
            items.push({
              label: '删除 ' + pn + ' 端的触点支路',
              cb: function () { removePinChain(loc.el, pn); }
            });
          }
        });
      }
    } else {
      items.push({ label: '编辑操作数…', key: '双击', cb: function () { openEdit(id); } });
    }
    // 引脚支路上的触点：只能在这条支路里改
    if (loc.pin) {
      items.push(
        { sep: true },
        { label: '改为' + (loc.el.type === 'NC' ? '常开' : '常闭') + '触点', cb: function () {
          loc.el.type = loc.el.type === 'NC' ? 'NO' : 'NC';
          ED.tab.dirty = true; rerender({ keepScroll: true });
        } },
        { label: '再加一个触点（串联）', cb: function () { addPinContact(loc.host, loc.pin); } },
        { label: '删除整条 ' + loc.pin + ' 端支路', cb: function () { removePinChain(loc.host, loc.pin); } },
        { sep: true },
        { label: '删除这个触点', key: 'Delete', cb: function () { deleteElement(id); } }
      );
      menu(x, y, items);
      return;
    }
    items.push(
      { label: '复制元件', key: 'Ctrl+D', cb: function () { duplicate(id); } },
      { sep: true },
      {
        label: '在左侧插入一列', cb: function () {
          var net = ED.blk.networks[loc.net];
          net.columns.splice(loc.col, 0, { branches: [[]] });
          ED.tab.dirty = true; rerender({ keepScroll: true });
        }
      },
      {
        label: '在右侧插入一列', cb: function () {
          var net = ED.blk.networks[loc.net];
          net.columns.splice(loc.col + 1, 0, { branches: [[]] });
          ED.tab.dirty = true; rerender({ keepScroll: true });
        }
      },
      {
        label: '为此列添加开放分支', cb: function () {
          var net = ED.blk.networks[loc.net];
          var col = net.columns[loc.col];
          if (!col) return;
          var idx = col.branches.length;
          col.branches.splice(idx, 0, [mkOpenEnd()]);
          ED.insTarget = { net: loc.net, col: loc.col, branch: idx, pos: 0 };
          ED.tab.dirty = true; rerender({ keepScroll: true });
          toast('已插入开放分支（第 ' + (idx + 1) + ' 行）');
        }
      },
      { sep: true },
      {
        label: '加入指令收藏夹', cb: function () {
          if (window.Catalog) window.Catalog.addFavorite(loc.el.type);
          toast('已加入收藏夹');
        }
      },
      { sep: true },
      { label: '删除元件', key: 'Delete', cb: function () { deleteElement(id); } }
    );
    menu(x, y, items);
  }

  function netMenu(x, y, netIdx) {
    menu(x, y, [
      {
        label: '在末尾列添加并联分支', cb: function () { addBranch(netIdx); }
      },
      {
        label: '追加一列', cb: function () { addColumn(netIdx); }
      },
      { sep: true },
      {
        label: '在下方插入新网络', cb: function () {
          ED.blk.networks.splice(netIdx + 1, 0, {
            title: '', columns: [{ branches: [[]] }]
          });
          ED.tab.dirty = true; rerender({ keepScroll: true });
        }
      },
      { sep: true },
      { label: '删除此网络', cb: function () { delNetwork(netIdx); } }
    ]);
  }

  function wireMenu(x, y, netIdx, branchKey) {
    var p = branchKey.split(':').map(Number);
    menu(x, y, [
      {
        label: '在此列新增开放分支', cb: function () {
          var net = ED.blk.networks[p[0]];
          var col = net && net.columns[p[1]];
          if (!col) return;
          var idx = col.branches.length;
          col.branches.splice(idx, 0, [mkOpenEnd()]);
          ED.insTarget = { net: p[0], col: p[1], branch: idx, pos: 0 };
          ED.tab.dirty = true; rerender({ keepScroll: true });
          toast('已插入开放分支（第 ' + (idx + 1) + ' 行）');
        }
      },
      {
        label: '删除此分支', cb: function () {
          var net = ED.blk.networks[p[0]];
          var col = net.columns[p[1]];
          if (col.branches.length <= 1) { toast('至少保留一个分支', 'err'); return; }
          col.branches.splice(p[2], 1);
          ED.tab.dirty = true; rerender({ keepScroll: true });
        }
      }
    ]);
  }

  /* ============================================================
   * 操作数编辑对话框
   * ============================================================ */
  function openEdit(id) {
    if (!guardEdit()) return;            // 在线只读
    var loc = locate(ED.blk, id);
    if (!loc) return;
    var el = loc.el;
    var I = window.INSTR;
    var meta = I.info(el.type);
    if (!meta) return;

    // 触点/线圈：单操作数
    if (meta.kind === 'contact' || meta.kind === 'coil') {
      singleOperandDialog(meta, el, function (val) {
        el.operand = val;
        var tg = (ED.tags || []).filter(function (x) { return x.name === val; })[0];
        el.addr = tg ? tg.address : (PLC.parseAddr(val) ? val : '');
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
      });
      return;
    }

    // 盒式指令：多参数表单
    boxParamsDialog(meta, el, function (vals) {
      el.params = el.params || {};
      for (var k in vals) el.params[k] = vals[k];
      ED.tab.dirty = true;
      rerender({ keepScroll: true });
    });
  }

  function tagOptions(selected) {
    var tags = ED.tags || [];
    var o = '<option value="">（未指定）</option>';
    tags.forEach(function (t) {
      o += '<option value="' + esc(t.name) + '"' + (t.name === selected ? ' selected' : '') + '>' +
        esc(t.name) + ' — ' + esc(t.address) + (t.comment ? '（' + esc(t.comment) + '）' : '') + '</option>';
    });
    return o;
  }

  function singleOperandDialog(meta, el, cb) {
    var cur = el.operand || '';
    var curAddr = el.addr || '';

    // 生成地址候选（I / Q / M 区的位址与字地址）
    var addrList = [];
    ['I', 'Q', 'M'].forEach(function (area) {
      for (var b = 0; b <= 4; b++) {
        for (var bit = 0; bit < 8; bit++) {
          addrList.push(area + b + '.' + bit);
        }
      }
    });
    // 变量表里已有的地址置顶（更常用）
    var tagAddrs = {};
    (ED.tags || []).forEach(function (t) { tagAddrs[t.address] = t.name; });
    var usedAddrs = Object.keys(tagAddrs);

    function addrOptions(selected) {
      var o = '<option value="">（选择地址）</option>';
      // 先用变量表里已有的
      if (usedAddrs.length) {
        o += '<optgroup label="变量表中的地址">';
        usedAddrs.forEach(function (a) {
          o += '<option value="' + esc(a) + '"' + (a === selected ? ' selected' : '') + '>' +
            esc(a) + ' — ' + esc(tagAddrs[a]) + '</option>';
        });
        o += '</optgroup>';
      }
      o += '<optgroup label="常用地址">';
      addrList.forEach(function (a) {
        if (tagAddrs[a]) return;   // 已在上面
        o += '<option value="' + esc(a) + '"' + (a === selected ? ' selected' : '') + '>' +
          esc(a) + '</option>';
      });
      o += '</optgroup>';
      return o;
    }

    var body =
      '<div class="field"><label>指令</label><span style="font-weight:600">' + esc(meta.name) + '</span></div>' +

      '<div class="field"><label>符号</label>' +
      '<select id="opTag">' + tagOptions(cur) + '</select></div>' +

      // 地址行：输入框 + 下拉候选（点箭头可直接从变量表选）
      '<div class="field"><label>或绝对地址</label>' +
      '<div class="op-addr-wrap">' +
      '<input type="text" id="opAbs" value="' + esc(curAddr || cur) + '" placeholder="I0.0 / Q0.0 / MW10">' +
      '<select id="opAddrSel" class="op-addr-sel" title="从变量表选择地址">' +
      addrOptions(curAddr) + '</select>' +
      '</div></div>' +

      '<div style="color:#888;font-size:11px;margin-top:6px">' +
      '选择符号会自动带出地址；也可直接填地址，或点右侧下拉从变量表挑选。<br>' +
      '按 <b>Enter</b> 确认，<b>Esc</b> 取消。</div>';

    modal('编辑操作数 · ' + meta.name, body, [
      {
        label: '确定', primary: true, cb: function () {
          var abs = ($('#opAbs').value || '').trim();
          var tag = $('#opTag').value;
          var v = abs || tag;
          if (!v) { toast('请输入操作数', 'err'); return false; }
          cb(v);
          return true;
        }
      },
      { label: '取消' }
    ]);

    // ---- 交互联动 ----
    setTimeout(function () {
      var absEl = document.getElementById('opAbs');
      var tagEl = document.getElementById('opTag');
      var selEl = document.getElementById('opAddrSel');

      // 下拉选地址 → 填输入框
      if (selEl) {
        selEl.onchange = function () {
          if (!selEl.value) return;
          if (absEl) absEl.value = selEl.value;
          // 若该地址在变量表有符号，自动选中
          if (tagEl && tagAddrs[selEl.value]) {
            tagEl.value = tagAddrs[selEl.value];
          }
        };
      }

      // 符号变化 → 带出地址
      if (tagEl) {
        tagEl.onchange = function () {
          var t = (ED.tags || []).filter(function (x) { return x.name === tagEl.value; })[0];
          if (t && absEl) {
            absEl.value = t.address;
            if (selEl) selEl.value = t.address;
          }
        };
      }

      // 地址输入 → 若匹配变量表则带回符号
      if (absEl) {
        absEl.oninput = function () {
          var v = absEl.value.trim();
          var t = (ED.tags || []).filter(function (x) { return x.address === v; })[0];
          if (t && tagEl) tagEl.value = t.name;
        };
        absEl.focus();
        absEl.select();
      }

      // Enter 确认 / Esc 取消
      function onKey(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var btn = document.querySelector('.modal-foot .btn.primary');
          if (btn) btn.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          var cancel = document.querySelector('.modal-foot .btn:not(.primary)');
          if (cancel) cancel.click();
        }
      }
      if (absEl) absEl.addEventListener('keydown', onKey);
      if (tagEl) tagEl.addEventListener('keydown', onKey);
    }, 30);
  }

  function boxParamsDialog(meta, el, cb) {
    var pm = el.params || {};
    var body = '<div class="field"><label>指令</label><span style="font-weight:600">' +
      esc(meta.name) + ' <span style="color:#888;font-weight:400">(' + esc(el.type) + ')</span></span></div>';
    body += '<table class="grid" style="margin:8px 0"><thead><tr>' +
      '<th style="width:90px">参数</th><th style="width:60px">方向</th><th>值（符号 / 地址 / 字面量）</th>' +
      '</tr></thead><tbody>';
    (meta.params || []).forEach(function (p, i) {
      var cur = pm[p.n] !== undefined ? pm[p.n] : (p.d || '');
      var dirTxt = p.dir === 'out' ? '输出' : (p.dir === 'inout' ? '输入输出' : '输入');
      body += '<tr><td style="font-family:Consolas;font-weight:600">' + esc(p.n) + '</td>' +
        '<td style="color:#666">' + dirTxt + '</td><td>';
      // 比较指令的数据类型：下拉选，不能乱填
      if (p.ui === 'type') {
        var types = (window.INSTR && window.INSTR.CMP_TYPES) || ['Int', 'DInt', 'Real', 'Time'];
        body += '<select class="cell prm" data-p="' + esc(p.n) +
          '" style="width:100%;border:1px solid #ddd;padding:2px 4px">';
        body += '<option value=""' + (cur ? '' : ' selected') + '>（未选择 → 显示 ???）</option>';
        types.forEach(function (t) {
          body += '<option value="' + esc(t) + '"' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>';
        });
        body += '</select>';
      } else {
        body += '<input class="cell prm" data-p="' + esc(p.n) + '" value="' + esc(cur) +
          '" placeholder="' + esc(p.d || '') + '" style="width:100%;border:1px solid #ddd;padding:2px 4px">' +
          '<select class="prm-sel" data-p="' + esc(p.n) + '" style="width:100%;margin-top:2px;font-size:11px">' +
          tagOptions(cur) + '</select>';
      }
      body += '</td></tr>';
    });
    body += '</tbody></table>';
    body += '<div style="color:#888;font-size:11px">输入参数可填地址、符号或字面量；输出参数需填可写地址或符号。</div>';

    modal('编辑指令参数 · ' + meta.name, body, [
      {
        label: '确定', primary: true, cb: function () {
          var vals = {};
          $$('#modalMask .prm').forEach(function (inp) {
            vals[inp.dataset.p] = inp.value.trim();
          });
          cb(vals);
          return true;
        }
      },
      { label: '取消' }
    ]);

    // 下拉联动输入框
    setTimeout(function () {
      $$('#modalMask .prm-sel').forEach(function (sel) {
        sel.onchange = function () {
          if (!sel.value) return;
          var inp = $('#modalMask .prm[data-p="' + sel.dataset.p + '"]');
          if (inp) inp.value = sel.value;
        };
      });
    }, 20);
  }

  /* ============================================================
   * FB 实例数据块（对齐 TIA）
   *  · 遍历当前块内元件
   *  · 实例名枚举 / 重名检测（重名标红）
   *  · 调用选项对话框（名称 / 编号，自动编号）
   *  · 点 <???> 实例名就地改名；点 <???> 参数就地填值
   *  · 触点候选里可引用 "实例".成员
   * ============================================================ */
  function walkEls(cb) {
    if (!ED.blk || !ED.blk.networks) return;
    ED.blk.networks.forEach(function (net) {
      (net.columns || []).forEach(function (col) {
        (col.branches || []).forEach(function (br) {
          br.forEach(function (el) {
            if (el && el.type && el.type !== 'EMPTY' && el.type !== 'OPEN_END') cb(el);
          });
        });
      });
    });
  }

  // 当前块内所有已命名的 FB 实例
  function fbInstances() {
    var out = [];
    walkEls(function (el) {
      var m = window.INSTR ? window.INSTR.info(el.type) : null;
      if (m && m.fb && el.instance) out.push(el);
    });
    return out;
  }

  // 重名集合：{ 实例名: true }（出现 ≥2 次的名字）
  function dupInstMap() {
    var cnt = {};
    fbInstances().forEach(function (el) {
      var k = String(el.instance).trim();
      cnt[k] = (cnt[k] || 0) + 1;
    });
    var dup = {};
    for (var k in cnt) if (cnt[k] > 1) dup[k] = true;
    return dup;
  }

  // 下一个可用 DB 编号（当前块内最大编号 + 1）
  function nextDbNumber() {
    var max = 0;
    walkEls(function (el) { if (el.db && +el.db > max) max = +el.db; });
    return max + 1;
  }

  // 双击盒体上方的 <???> / %DBn "name"：就地改名（TIA 交互）
  function editInstanceName(el) {
    var anchor = document.querySelector('[data-inst="' + el.id + '"]');
    if (!anchor) return;
    inlineEdit(anchor, {
      value: el.instance || '',
      placeholder: '实例名（如 time）',
      suggest: [],
      onCommit: function (v) {
        v = (v || '').trim();
        if (!v) return;   // 空名 = 取消，保持 <???>
        el.instance = v;
        if (!el.db) el.db = nextDbNumber();   // 首次命名时自动编号
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
        var dup = dupInstMap()[v];
        toast(dup ? '注意：实例名 "' + v + '" 重复，已标红' :
          '已命名 ' + (el.db ? '%DB' + el.db + ' ' : '') + '"' + v + '"',
          dup ? 'err' : undefined);
      }
    });
  }

  // 双击 FB 的某个 <???> 参数占位符：就地填该参数（TIA 交互）
  // 比较指令的数据类型（Int / DInt / Real / Time / Bool）—— 点盒内的类型选
  function pickCmpType(el) {
    var anchor = document.querySelector('[data-prm="' + el.id + ':TYPE"]');
    var types = (window.INSTR && window.INSTR.CMP_TYPES) || ['Int', 'DInt', 'Real', 'Time'];
    var cur = String((el.params && el.params.TYPE) || '');
    var r = anchor ? anchor.getBoundingClientRect()
      : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    menu(r.left - 30, r.bottom + 2, types.map(function (t) {
      return {
        label: (t === cur ? '✓ ' : '   ') + t,
        cb: function () {
          el.params = el.params || {};
          el.params.TYPE = t;
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
        }
      };
    }));
  }

  // 盒式参数引用 FB 实例成员（"time".ET 这种）：比较定时器/计数器的当前值就靠它
  function pickMemberForParam(el, pname, fb) {
    var meta = window.INSTR.info(fb.type);
    var tgtMeta = window.INSTR.info(el.type);
    // 比较指令：成员取的是"运行值"（定时器→经过值，计数器→当前计数），菜单里说清楚
    var isCmp = !!(tgtMeta && tgtMeta.kind === 'compare');
    var grp = (meta && meta.group) || '';
    var anchor = document.querySelector('[data-prm="' + el.id + ':' + pname + '"]');
    var items = ((meta && meta.params) || []).map(function (p) {
      var ty = (window.PLC && window.PLC.instanceMemberType)
        ? window.PLC.instanceMemberType(fb.type, p.n) : 'Bool';
      var live = isCmp && (
        (grp === 'timer' && (p.n === 'PT' || p.n === 'ET')) ||
        (grp === 'counter' && (p.n === 'CV' || p.n === 'PV')));
      var label = p.n + '（' + (p.dir === 'out' ? '输出' : '输入') + ' · ' + ty + '）';
      if (live) label = p.n + '（运行值 · ' + ty + '）';
      return {
        label: label,
        cb: function () {
          el.params = el.params || {};
          el.params[pname] = '"' + fb.instance + '".' + p.n;
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
          toast(pname + ' 已设为 "' + fb.instance + '".' + p.n +
            (live ? '（比较时取它正在跑的值）' : ''));
        }
      };
    });
    var r = anchor ? anchor.getBoundingClientRect()
      : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    menu(r.left, r.bottom + 4, items);
  }

  function editParamInline(el, pname, anchorEl) {
    // 锚点优先用"用户真正双击的那个文字"：以前全文档 querySelector 找，
    // 一旦页面上有同名副本（重渲染前的残留、缩略视图等），编辑框就会弹到别处
    // —— 表现就是"值框跑到盒体上方"。
    var anchor = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl
      : document.querySelector('[data-prm="' + el.id + ':' + pname + '"]');
    if (!anchor) return;
    // 比较指令的"数据类型"：选 Int / DInt / Real / Time / Bool，不是填地址
    if (pname === 'TYPE') { pickCmpType(el); return; }
    var isTime = pname === 'PT' || pname === 'ET';
    /* 只填数字的参数：比较指令下方的 IN2、计数器的 PV。
       这类框里不该出现 "I0.0 / Q0.0 / M10.0" 这种地址提示（那是给触点/线圈用的），
       也不该弹地址候选 —— 用户口径："输入框里保持空白"。 */
    var pMeta = window.INSTR && window.INSTR.info ? window.INSTR.info(el.type) : null;
    var numOnly = !!(pMeta && (
      (pMeta.kind === 'compare' && pname === 'IN2') ||
      (pMeta.group === 'counter' && pname === 'PV')));
    // 候选：变量表地址（时间参数、纯数字参数不需要）
    var sugg = [];
    if (!isTime && !numOnly) {
      (ED.tags || []).forEach(function (t) {
        if (!t.address || t.isClock || t.isSystem) return;
        sugg.push({ value: t.address, label: t.address + '  "' + t.name + '"' });
      });
      // FB 实例（定时器 / 计数器）—— 选中后二级菜单挑成员，如 "time".ET、CTU_DB.CV
      fbInstances().forEach(function (fb) {
        sugg.push({
          value: '\u0001fb:' + fb.instance,
          label: '"' + fb.instance + '"  ' + fb.type + (fb.db ? ' DB' + fb.db : ''),
          fb: fb
        });
      });
    }
    var cur = (el.params && el.params[pname]) || '';
    // 时间是 "5s" 这类简写时，编辑框里先补成规范写法 T#5s，避免看起来像丢了 T#
    if (isTime && cur && PLC.normTime) cur = PLC.normTime(cur) || cur;
    inlineEdit(anchor, {
      value: cur,
      placeholder: numOnly ? '' : (isTime ? 'T#5s' : 'I0.0 / Q0.0 / M10.0'),
      suggest: sugg,
      onPick: function (s) {
        // 选了 FB 实例 → 弹出成员菜单（ET / Q / CV …），写进这个参数
        closeInlineEdit();
        pickMemberForParam(el, pname, s.fb);
      },
      onCommit: function (v) {
        v = (v || '').trim();
        if (!v) {
          delete el.params[pname];   // 清空 = 未指定
        } else {
          if (!isTime && /^[iqm]/i.test(v)) v = v.toUpperCase();
          if (isTime) {
            // 时间：T#… 字面量（也接受 5s / 500ms / 1,5s 这类简写）或地址（MW10 等）
            if (PLC.isTimeLiteral && PLC.isTimeLiteral(v)) {
              v = PLC.normTime(v) || v;   // 统一存成 T#… 规范写法
            } else if (!PLC.parseAddr(v)) {
              toast('时间格式无效：' + v + '（应为 T#5s 形式）', 'err');
              return;
            }
          } else {
            // 参数值允许：绝对地址 / 符号、"实例".成员、常量（数字，可带两位小数）、true/false
            var isNum = /^[-+]?\d+(?:[.,]\d+)?$/.test(v);
            var isBool = /^(true|false)$/i.test(v);
            var isFbRef = /^"[^".\s]+"?\.[A-Za-z_]\w*$/.test(v);
            if (isNum) {
              if (/[.,]\d{3,}$/.test(v)) { toast('数字最多两位小数：' + v, 'err'); return; }
              v = v.replace(',', '.');        // 5,25 当 5.25
            } else if (!isBool && !isFbRef && !PLC.parseAddr(v)) {
              toast('地址格式无效：' + v + '（地址 / 常量 / "实例".成员）', 'err');
              return;
            }
            if (/^[iqm]/i.test(v) && !isBool) v = v.toUpperCase();
          }
          el.params[pname] = v;
        }
        ED.tab.dirty = true;
        rerender({ keepScroll: true });
      }
    });
  }

  // 调用选项对话框（对齐 TIA：添加 TON 等 FB 时自动弹出；右上角 ✕ = 取消）
  function openCallDialog(el) {
    if (!guardEdit()) return;
    var sugDb = el.db || nextDbNumber();
    var sugName = el.instance || (el.type + '_DB');
    var body =
      '<div style="display:flex;gap:16px">' +
      '<div style="width:110px;min-height:110px;border:1px solid #b7b7b7;background:#f4f4f4;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">' +
      '<svg width="44" height="44" viewBox="0 0 44 44"><ellipse cx="22" cy="9" rx="14" ry="5" fill="#4472c4"/>' +
      '<path d="M8 9 L8 33 A14 5 0 0 0 36 33 L36 9" fill="#6a92d8" stroke="#4472c4"/>' +
      '<ellipse cx="22" cy="9" rx="14" ry="5" fill="#7ba3e0" stroke="#2f5597"/></svg>' +
      '<div style="font-size:11px;color:#555;text-align:center">单个<br>实例</div></div>' +
      '<div style="flex:1">' +
      '<div style="font-weight:600;margin-bottom:8px">数据块</div>' +
      '<div class="field"><label>名称：</label>' +
      '<input type="text" id="callDbName" value="' + esc(sugName) + '" style="width:220px"></div>' +
      '<div class="field"><label>编号：</label>' +
      '<input type="text" id="callDbNo" value="' + sugDb + '" style="width:56px">' +
      '<span style="color:#888;font-size:11px;margin-left:8px">（自动）</span></div>' +
      '<div style="color:#555;font-size:12px;margin:8px 0 2px">' +
      '<label style="display:block"><input type="radio" name="callMode"> 手动</label>' +
      '<label style="display:block"><input type="radio" name="callMode" checked> 自动</label></div>' +
      '<div style="color:#888;font-size:11px;margin-top:8px">该指令的数据保存在自己的背景数据块中。' +
      '名称在本块内不可重复，重复的名称会标红。</div>' +
      '</div></div>';
    modal('调用选项', body, [
      {
        label: '确定', primary: true, cb: function () {
          var name = ($('#callDbName').value || '').trim();
          var no = parseInt($('#callDbNo').value, 10);
          if (!name) { toast('请输入数据块名称', 'err'); return false; }
          el.instance = name;
          el.db = (isNaN(no) || no < 1) ? nextDbNumber() : no;
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
          var dup = dupInstMap()[name];
          toast(dup ? '注意：实例名 "' + name + '" 重复，已标红' :
            '已创建实例 ' + (el.db ? '%DB' + el.db + ' ' : '') + '"' + name + '"',
            dup ? 'err' : undefined);
          return true;
        }
      },
      { label: '取消' }
    ]);
    setTimeout(function () {
      var n = document.getElementById('callDbName');
      if (n) { n.focus(); n.select(); }
    }, 30);
  }

  // 触点候选选中 FB 实例后：二级菜单选成员（IN / Q / ET …）
  function pickFbMember(el, fb) {
    var meta = window.INSTR.info(fb.type);
    if (!meta) return;
    var anchor = findAnchorFor(el.id);
    // 触点/线圈只能接 Bool 成员：TIME（PT/ET）之类的直接置灰并说明原因
    var tgtMeta = window.INSTR.info(el.type);
    var needBool = !!(tgtMeta && (tgtMeta.kind === 'contact' || tgtMeta.kind === 'coil'));
    var items = [];
    (meta.params || []).forEach(function (p) {
      var ty = (window.PLC && window.PLC.instanceMemberType)
        ? window.PLC.instanceMemberType(fb.type, p.n) : 'Bool';
      var bad = needBool && ty !== 'Bool';
      items.push({
        label: p.n + '（' + (p.dir === 'out' ? '输出' : '输入') + ' · ' + ty +
          (bad ? '，不能作触点' : '') + '）',
        disabled: bad,
        cb: function () {
          el.operand = '"' + fb.instance + '".' + p.n;
          el.addr = '';
          ED.tab.dirty = true;
          rerender({ keepScroll: true });
          toast('操作数已设为 "' + fb.instance + '".' + p.n);
        }
      });
    });
    var r = anchor ? anchor.getBoundingClientRect()
      : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    menu(r.left, r.bottom + 4, items);
  }

  /* ---------------- toast/modal 由外部注入 ---------------- */
  var toast = function (m) { if (root.__toast) root.__toast(m); };
  var modal = function (t, b, btns) { if (root.__modal) root.__modal(t, b, btns); };

  /* ============================================================ */
  root.LadEdit = {
    mount: mount,
    state: ED,
    rerender: rerender,
    deleteElement: deleteElement,
    openEdit: openEdit,
    appendInstruction: appendInstruction,
    insertInstruction: insertInstruction,
    addOpenBranch: addOpenBranch,
    addPinContact: addPinContact,     // 引脚支路（计数器 R / LD 接一条触点支路）
    removePinChain: removePinChain,
    mergeOpenArrow: mergeOpenArrow,
    mergeOpenArrowToPin: mergeOpenArrowToPin,   // 拖开口箭头接到 R / LD 引脚端子
    anchorAtPoint: anchorAtPoint,
    arrowTargetAt: arrowTargetAt,
    arrowTargetKey: arrowTargetKey,
    closeBranch: closeBranch,
    normalize: normalizeBranches,
    isOpenBranch: isOpenBranch,
    setSelection: setSelection,
    clearSelection: clearSelection,
    mkEl: mkEl,
    locate: locate,
    menu: menu,          // 右键菜单（收藏夹等模块复用同一套样式）
    dupInstMap: dupInstMap,   // FB 实例名重复集合（app.js 渲染时传入 lad.js 标红）
    fbInstances: fbInstances, // 已命名 FB 实例列表
    setTags: function (t) { ED.tags = t; },
    setCurrentNet: function (n) { ED.curNet = n; },
    setCallbacks: function (o) {
      ED.onRerender = o.onRerender || ED.onRerender;
      ED.onSelNet = o.onSelNet || ED.onSelNet;
      ED.onSelect = o.onSelect || ED.onSelect;
      ED.onSelSeg = o.onSelSeg || ED.onSelSeg;
    },

    // 供指令面板拖放使用：在屏幕坐标处插入指令
    insertAtPoint: function (type, pt) {
      if (!ED.blk) return false;
      var pos = computeDropPosFromPoint(pt);
      if (!pos) {
        appendInstruction(type);
        return true;
      }
      insertInstruction(type, pos);
      return true;
    },

    // 供外部预览落点
    dropPosAt: function (pt) { return computeDropPosFromPoint(pt); },
    hintRectAt: function (pos) { return hintRect(pos); },

    // 拖拽过程中的落点提示（面板拖拽时由 app 调用）
    showHintAt: function (pt) {
      var pos = computeDropPosFromPoint(pt);
      if (!pos) { window.DragLayer.clearHint(); return; }
      var r = hintRect(pos);
      if (!r) { window.DragLayer.clearHint(); return; }
      window.DragLayer.setHint(r.svg, r);
    }
  };
})(window);
















