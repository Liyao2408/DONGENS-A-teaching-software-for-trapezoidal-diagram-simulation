/* ============================================================
   favbar.js — LAD 编辑器的收藏夹工具栏
   位置：块标题（块标题行）上方，固定在编辑器顶部
   功能：
     · 从右侧指令面板拖入（或双击指令）→ 加入收藏夹
     · 点收藏项 → 插入到当前网络
     · 右键收藏项 → 删除该收藏 / 排序 / 恢复默认 / 清空
     · 排序模式：拖动图标调整顺序，Esc 或「退出排序」按钮退出
   注意：Delete 键【不再】删除收藏项（太容易误触）
   持久化：localStorage（按用户全局共享，不分项目）
   ============================================================ */
(function (root) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    });
  }

  var KEY = 'dongens.ladFavbar';

  // 默认收藏（对齐截图：常开/常闭/上升/下降/线圈 + TON + R + S）
  var DEFAULTS = ['NO', 'NC', 'OPEN_BRANCH', 'OPEN_BRANCH_UP', 'COIL', 'TON', 'RESET', 'SET'];

  var FB = {
    items: null,
    selected: null,     // 当前选中的收藏项 index
    dragOver: false,
    sorting: false,     // 排序模式（拖动排序，Esc 退出）
    host: null,         // 最近一次渲染的容器（排序模式重绘用）
    cfg: null
  };

  var FAV_VERSION = 3;   // 加分支图标时升版

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var ver = +(localStorage.getItem(KEY + '.ver') || 1);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // 旧版本：把新增的默认项（分支图标）补进去
          if (ver < FAV_VERSION) {
            DEFAULTS.forEach(function (d) {
              if (arr.indexOf(d) < 0) arr.push(d);
            });
            // 分支图标放到第 3、4 位（对齐 TIA 收藏夹顺序）
            arr = arr.filter(function (x) { return x !== 'OPEN_BRANCH' && x !== 'OPEN_BRANCH_UP'; });
            arr.splice(2, 0, 'OPEN_BRANCH', 'OPEN_BRANCH_UP');
            try {
              localStorage.setItem(KEY, JSON.stringify(arr));
              localStorage.setItem(KEY + '.ver', String(FAV_VERSION));
            } catch (e) { }
          }
          return arr;
        }
      }
    } catch (e) { }
    return DEFAULTS.slice();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(FB.items));
      localStorage.setItem(KEY + '.ver', String(FAV_VERSION));
    } catch (e) { }
  }

  function init() {
    if (!FB.items) FB.items = load();
    // 强制保证分支图标一定存在（防止旧缓存缺项导致无法创建分支）
    var must = ['OPEN_BRANCH', 'OPEN_BRANCH_UP'];
    var missing = must.filter(function (m) { return FB.items.indexOf(m) < 0; });
    if (missing.length) {
      // 插到第 3 位（对齐 TIA 收藏夹顺序）
      var head = FB.items.slice(0, 2);
      var tail = FB.items.slice(2);
      FB.items = head.concat(missing).concat(tail);
      save();
    }
  }

  // 指令符号（用 SVG 画，贴近 TIA 收藏夹里的图标观感）
  function symSvg(type, size) {
    var s = size || 30;
    var w = s, h = s;
    var I = root.INSTR;
    var meta = I ? I.info(type) : null;
    var color = '#1a6fa8';
    var body = '';

    function ln(x1, y1, x2, y2, sw) {
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
        '" stroke="' + color + '" stroke-width="' + (sw || 1.7) + '" stroke-linecap="round"/>';
    }

    var cy = h / 2;

    if (type === 'NO' || type === 'NC' || type === 'P' || type === 'N') {
      var half = 4.5;
      body += ln(2, cy, w / 2 - half, cy);
      body += ln(w / 2 + half, cy, w - 2, cy);
      body += ln(w / 2 - half, cy - 6, w / 2 - half, cy + 6);
      body += ln(w / 2 + half, cy - 6, w / 2 + half, cy + 6);
      if (type === 'NC') {
        body += ln(w / 2 - half - 1, cy + 6, w / 2 + half + 1, cy - 6, 1.5);
      }
      if (type === 'P') {
        body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
          'font-size="7" font-weight="700" fill="' + color + '">P</text>';
      }
      if (type === 'N') {
        body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
          'font-size="7" font-weight="700" fill="' + color + '">N</text>';
      }
    } else if (type === 'COIL' || type === 'SET' || type === 'RESET' ||
      type === 'NEG_COIL' || type === 'POS_COIL' || type === 'NEG_EDGE_COIL') {
      var r = 6;
      body += ln(2, cy, w / 2 - r, cy);
      body += ln(w / 2 + r, cy, w - 2, cy);
      body += '<path d="M ' + (w / 2 - r) + ' ' + (cy - 6) + ' A ' + r + ' 6 0 0 0 ' +
        (w / 2 - r) + ' ' + (cy + 6) + '" fill="none" stroke="' + color + '" stroke-width="1.7"/>';
      body += '<path d="M ' + (w / 2 + r) + ' ' + (cy - 6) + ' A ' + r + ' 6 0 0 1 ' +
        (w / 2 + r) + ' ' + (cy + 6) + '" fill="none" stroke="' + color + '" stroke-width="1.7"/>';
      var mark = { SET: 'S', RESET: 'R', NEG_COIL: '/', POS_COIL: 'P', NEG_EDGE_COIL: 'N' }[type];
      if (mark) {
        body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
          'font-size="6.5" font-weight="700" fill="' + color + '">' + mark + '</text>';
      }
    } else if (type === 'OPEN_BRANCH') {
      // → 插入并联分支（向下分出）
      body += ln(3, cy, w - 3, cy);
      body += '<path d="M ' + (w - 11) + ' ' + (cy - 5) + ' L ' + (w - 3) + ' ' + cy +
        ' L ' + (w - 11) + ' ' + (cy + 5) + '" fill="none" stroke="' + color +
        '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    } else if (type === 'OPEN_BRANCH_UP') {
      // ↱ 插入并联分支（向上分出）
      body += ln(3, cy, w - 3, cy);
      body += '<path d="M ' + (w - 11) + ' ' + (cy + 5) + ' L ' + (w - 3) + ' ' + cy +
        ' L ' + (w - 11) + ' ' + (cy - 5) + '" fill="none" stroke="' + color +
        '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      body += '<path d="M ' + (w - 3) + ' ' + cy + ' L ' + (w - 3) + ' ' + (cy - 7) +
        '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round"/>';
    } else if (type === 'TON' || type === 'TOF' || type === 'TP' || type === 'TONR') {
      body += '<rect x="3" y="4" width="' + (w - 6) + '" height="' + (h - 8) +
        '" fill="#fff" stroke="' + color + '" stroke-width="1.5"/>';
      body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
        'font-size="6.5" font-weight="700" fill="' + color + '">' + type + '</text>';
    } else if (type === 'CTU' || type === 'CTD' || type === 'CTUD') {
      body += '<rect x="3" y="4" width="' + (w - 6) + '" height="' + (h - 8) +
        '" fill="#fff" stroke="' + color + '" stroke-width="1.5"/>';
      body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
        'font-size="6" font-weight="700" fill="' + color + '">' + type + '</text>';
    } else {
      // 其它盒式指令：方框 + 类型缩写
      body += '<rect x="2" y="4" width="' + (w - 4) + '" height="' + (h - 8) +
        '" fill="#fff" stroke="' + color + '" stroke-width="1.5" rx="1"/>';
      var label = (meta && meta.name) ? meta.name.slice(0, 4) : type.slice(0, 4);
      body += '<text x="' + (w / 2) + '" y="' + (cy + 3) + '" text-anchor="middle" ' +
        'font-size="5.5" fill="' + color + '">' + esc(label) + '</text>';
    }

    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      body + '</svg>';
  }

  /* ============================================================
   * 渲染工具栏
   * host: 容器元素
   * cfg: { onInsert(type), onChanged() }
   * ============================================================ */
  function render(host, cfg) {
    init();
    if (!host) return;
    cfg = cfg || {};

    var h = '';
    h += '<div class="fb-wrap' + (FB.sorting ? ' sorting' : '') + '" id="favbar">';
    h += '<div class="fb-cells" id="fbCells">';

    if (!FB.items.length) {
      h += '<div class="fb-empty">收藏夹为空 —— 从右侧指令面板拖入，或双击指令添加</div>';
    } else {
      FB.items.forEach(function (type, i) {
        var I = root.INSTR;
        var meta = I ? I.info(type) : null;
        var name = meta ? meta.name : ({ OPEN_BRANCH: '插入开放分支（向下）', OPEN_BRANCH_UP: '关闭分支（向上汇合）' }[type] || type);
        var cls = 'fb-cell' + (FB.selected === i ? ' sel' : '') + (FB.sorting ? ' sortable' : '');
        h += '<div class="' + cls + '" draggable="false" data-fbi="' + i + '" ' +
          'data-fbtype="' + esc(type) + '" title="' + esc(name) + '  (' + esc(type) + ')">' +
          symSvg(type, 30) +
          '<span class="fb-code">' + esc(type) + '</span>' +
          '</div>';
      });
    }
    h += '</div>';
    h += '<div class="fb-actions">';
    h += '<span class="fb-btn" id="fbReset" title="恢复默认收藏">↺</span>';
    h += '</div>';
    h += '</div>';

    host.innerHTML = h;
    bind(host, cfg);
    // 排序模式：把外层的变暗遮罩重新对齐（重绘后位置可能变了）
    if (FB.sorting) refreshSortMask();
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function bind(host, cfg) {
    FB.host = host;
    FB.cfg = cfg;
    // 点收藏项：插入到当前网络
    $$('#fbCells .fb-cell', host).forEach(function (el) {
      // 排序模式：只能拖动排序
      if (FB.sorting) {
        el.addEventListener('pointerdown', function (ev) { startReorder(ev, el, host, cfg); });
        el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
        return;
      }

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        // 选中
        var i = +el.dataset.fbi;
        FB.selected = (FB.selected === i) ? null : i;
        refreshSelection(host);
        if (cfg.onChanged) cfg.onChanged();
      });
      el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        var type = el.dataset.fbtype;
        // 分支图标：直接执行插入分支，不当作指令插入
        if (type === 'OPEN_BRANCH' || type === 'OPEN_BRANCH_UP') {
          if (cfg.onBranch) cfg.onBranch(type);
          return;
        }
        if (cfg.onInsert) cfg.onInsert(type);
      });

      // 分支图标单击立即执行：不选中收藏项
      if (el.dataset.fbtype === 'OPEN_BRANCH' || el.dataset.fbtype === 'OPEN_BRANCH_UP') {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          FB.selected = null;
          refreshSelection(host);
          if (cfg.onBranch) cfg.onBranch(el.dataset.fbtype);
        });
      }
      // 直接从这里拖到梯形图上也可以
      el.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        var type = el.dataset.fbtype;
        if (typeof root.DragLayer === 'undefined') return;
        root.DragLayer.start({
          kind: 'insert',
          payload: type,
          label: '＋ ' + type,
          sourceEl: el,
          startEvent: ev,
          onDrop: function (pt) {
            if (cfg.onDropInsert) cfg.onDropInsert(type, pt);
          }
        });
      });

      // 右键菜单：删除收藏 / 排序 / 恢复默认 / 清空（Delete 键已不再删除收藏）
      el.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        FB.selected = +el.dataset.fbi;
        refreshSelection(host);
        favMenu(ev.clientX, ev.clientY, +el.dataset.fbi, host, cfg);
      });
    });

    // 恢复默认
    var rs = $('#fbReset', host);
    if (rs) rs.onclick = function (e) {
      e.stopPropagation();
      FB.items = DEFAULTS.slice();
      FB.selected = null;
      save();
      render(host, cfg);
      if (cfg.onChanged) cfg.onChanged();
    };

    // 拖拽悬停反馈：让用户知道这里是"可放入收藏"的区域
    var wrapEl = $('#favbar', host);
    if (wrapEl) {
      var hostEl = document.getElementById('favbarHost') || host;
      hostEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        hostEl.classList.add('drop-hover');
      });
      hostEl.addEventListener('dragleave', function (e) {
        if (!hostEl.contains(e.relatedTarget)) hostEl.classList.remove('drop-hover');
      });
      hostEl.addEventListener('drop', function () {
        hostEl.classList.remove('drop-hover');
      });
    }

    // 点击空白处取消选中
    var wrap = $('#favbar', host);
    if (wrap) {
      wrap.addEventListener('click', function (e) {
        if (!e.target.closest('.fb-cell')) {
          FB.selected = null;
          refreshSelection(host);
          if (cfg.onChanged) cfg.onChanged();
        }
      });
    }
  }

  function refreshSelection(host) {
    $$('#fbCells .fb-cell', host || document).forEach(function (el) {
      el.classList.toggle('sel', +el.dataset.fbi === FB.selected);
    });
  }

  /* ============================================================
   * 右键菜单（复用 LadEdit 的菜单样式）
   * ============================================================ */
  function favMenu(x, y, idx, host, cfg) {
    var items = [
      {
        label: '插入到当前网络', cb: function () {
          var type = FB.items[idx];
          if (!type) return;
          if (type === 'OPEN_BRANCH' || type === 'OPEN_BRANCH_UP') {
            if (cfg.onBranch) cfg.onBranch(type);
          } else if (cfg.onInsert) cfg.onInsert(type);
        }
      },
      { sep: true },
      {
        label: '删除该收藏项', cb: function () {
          removeAt(idx, host, cfg);
        }
      },
      {
        label: '排序…（拖动调整顺序）', cb: function () {
          enterSort(host, cfg);
        }
      },
      { sep: true },
      {
        label: '恢复默认收藏', cb: function () {
          FB.items = DEFAULTS.slice();
          FB.selected = null;
          save();
          render(host, cfg);
          if (cfg.onChanged) cfg.onChanged();
          toast('已恢复默认收藏');
        }
      },
      {
        label: '清空收藏夹', cb: function () {
          if (!FB.items.length) { toast('收藏夹已经是空的'); return; }
          FB.items = [];
          FB.selected = null;
          save();
          render(host, cfg);
          if (cfg.onChanged) cfg.onChanged();
          toast('已清空收藏夹');
        }
      }
    ];
    if (root.LadEdit && root.LadEdit.menu) root.LadEdit.menu(x, y, items);
  }

  function removeAt(idx, host, cfg) {
    if (idx == null || idx < 0 || idx >= FB.items.length) return;
    var type = FB.items[idx];
    FB.items.splice(idx, 1);
    FB.selected = null;
    save();
    render(host || FB.host, cfg || FB.cfg);
    if (cfg && cfg.onChanged) cfg.onChanged();
    toast('已从收藏夹移除 ' + type);
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2200);
  }

  /* ============================================================
   * 排序模式
   *  · 只有收藏夹所在的那一条保持正常颜色，其余区域用超大 box-shadow 抹成灰黑
   *  · 拖动图标调整顺序；Esc 或「退出排序」按钮退出
   * ============================================================ */
  function ensureSortUi() {
    var m = document.getElementById('fbSortMask');
    if (!m) {
      m = document.createElement('div');
      m.id = 'fbSortMask';
      m.className = 'fb-sort-mask';
      document.body.appendChild(m);
    }
    var box = document.getElementById('fbSortExitBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fbSortExitBox';
      box.className = 'fb-sort-exit-box';
      box.innerHTML =
        '<div class="fse-tip">拖动图标调整顺序</div>' +
        '<div class="fse-btn" id="fbSortExit">退出排序（Esc）</div>';
      document.body.appendChild(box);
      var btn = box.querySelector('#fbSortExit');
      if (btn) btn.onclick = function (e) { e.stopPropagation(); exitSort(); };
    }
    refreshSortMask();
  }

  function refreshSortMask() {
    var bar = document.getElementById('favbar');
    var m = document.getElementById('fbSortMask');
    if (!bar || !m) return;
    var r = bar.getBoundingClientRect();
    m.style.left = Math.round(r.left) + 'px';
    m.style.top = Math.round(r.top) + 'px';
    m.style.width = Math.round(r.width) + 'px';
    m.style.height = Math.round(r.height) + 'px';
  }

  function enterSort(host, cfg) {
    if (FB.sorting) return;
    FB.sorting = true;
    FB.selected = null;
    ensureSortUi();
    render(host || FB.host, cfg || FB.cfg);
    window.addEventListener('resize', refreshSortMask);
    toast('已进入排序模式：拖动图标调整顺序，按 Esc 退出');
  }

  function exitSort() {
    if (!FB.sorting) return;
    FB.sorting = false;
    var m = document.getElementById('fbSortMask');
    if (m) m.remove();
    var b = document.getElementById('fbSortExitBox');
    if (b) b.remove();
    window.removeEventListener('resize', refreshSortMask);
    render(FB.host, FB.cfg);
    toast('已退出排序模式');
  }

  // 拖动排序：指针按住某个图标左右拖动，实时与相邻图标换位
  function startReorder(ev, el, host, cfg) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    var startX = ev.clientX;
    var moved = false;
    var pid = ev.pointerId;

    try { el.setPointerCapture(pid); } catch (e) { }
    el.classList.add('dragging');

    function onMove(e2) {
      if (!moved && Math.abs(e2.clientX - startX) < 4) return;
      moved = true;
      var cells = $$('#fbCells .fb-cell');
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (c === el) continue;
        var b = c.getBoundingClientRect();
        if (e2.clientX < b.left || e2.clientX > b.right) continue;
        if (e2.clientY < b.top || e2.clientY > b.bottom) continue;
        var mid = b.left + b.width / 2;
        if (e2.clientX < mid) {
          if (el.nextSibling !== c) c.parentNode.insertBefore(el, c);
        } else {
          if (c.nextSibling !== el) c.parentNode.insertBefore(el, c.nextSibling);
        }
        break;
      }
    }

    function onUp() {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(pid); } catch (e) { }
      el.classList.remove('dragging');

      if (moved) {
        var order = $$('#fbCells .fb-cell').map(function (c) { return c.dataset.fbtype; });
        // 以 DOM 顺序为准重建（去重，避免异常情况下重复项）
        var seen = {};
        FB.items = order.filter(function (t) {
          if (!t || seen[t]) return false;
          seen[t] = 1; return true;
        });
        save();
        render(host, cfg);
      }
    }

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */
  // Esc 退出排序模式（捕获阶段先吃掉，避免同时清掉 LAD 选中）
  document.addEventListener('keydown', function (e) {
    if (FB.sorting && (e.key === 'Escape' || e.key === 'Esc')) {
      e.preventDefault();
      e.stopPropagation();
      exitSort();
    }
  }, true);

  // 添加一条收藏（去重）
  function add(type) {
    init();
    if (!type) return false;
    if (FB.items.indexOf(type) >= 0) return false;
    FB.items.push(type);
    save();
    return true;
  }

  // Delete 键：删除当前选中的收藏项。返回 true 表示已处理（应阻止后续删除元件逻辑）
  function deleteSelected() {
    init();
    if (FB.selected == null) return false;
    if (FB.selected < 0 || FB.selected >= FB.items.length) return false;
    var removed = FB.items[FB.selected];
    FB.items.splice(FB.selected, 1);
    FB.selected = null;
    save();
    return removed;
  }

  function hasSelection() {
    return FB.selected != null;
  }

  function clearSelection() {
    FB.selected = null;
  }

  function items() { return FB.items ? FB.items.slice() : []; }

  root.FavBar = {
    render: render,
    add: add,
    removeAt: removeAt,
    deleteSelected: deleteSelected,
    hasSelection: hasSelection,
    clearSelection: clearSelection,
    enterSort: enterSort,
    exitSort: exitSort,
    isSorting: function () { return !!FB.sorting; },
    save: save,
    items: items,
    symSvg: symSvg,
    DEFAULTS: DEFAULTS,
    state: FB
  };
})(window);







