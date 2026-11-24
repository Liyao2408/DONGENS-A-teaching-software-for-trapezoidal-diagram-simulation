/* ============================================================
   propspanel.js — 设备组态下方的可拖拽属性面板
   对齐 TIA：
     · 收起时只有一行（设备名 + 属性/信息/诊断 三个页签）
     · 双击分隔条（或点右侧箭头）展开
     · 展开后：上部四个标签（常规/IO变量/系统常数/文本）
                左侧属性树 + 右侧配置内容
     · 拖动分隔条可上下调整高度
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

  var PP = {
    open: false,
    height: 320,          // 展开高度
    minH: 180,
    maxH: 620,
    activeTab: 'general', // general | io | sysconst | text
    activeProp: 'sysclock', // 属性树当前项
    drag: null
  };

  var DEFAULT_TREE = [
    { id: 'sysclock', label: '系统和时钟存储器', level: 0, active: true },
    { id: 'web', label: 'Web 服务器', level: 0, hasChildren: true },
    { id: 'lang', label: '支持多语言', level: 0 },
    { id: 'time', label: '时间', level: 0 },
    { id: 'security', label: '防护与安全', level: 0, hasChildren: true, open: true },
    { id: 'access', label: '访问级别', level: 1 },
    { id: 'conn', label: '连接机制', level: 1 },
    { id: 'cert', label: '证书管理器', level: 1 },
    { id: 'secevent', label: '安全事件', level: 1 },
    { id: 'extload', label: '外部装载存储器', level: 1 },
    { id: 'opcua', label: 'OPC UA', level: 0, hasChildren: true }
  ];
  var TREE = DEFAULT_TREE.map(function (x) { return Object.assign({}, x); });

  /* ============================================================
   * 渲染外壳
   * ============================================================ */
  function render(host, cfg) {
    cfg = cfg || {};
    if (!host) return;

    var h = '';
    h += '<div class="pp-splitter" id="ppSplitter"><span></span></div>';

    // 标题行（收起时也显示）
    h += '<div class="pp-bar">';
    h += '<span class="pp-title">' + esc(cfg.deviceLabel || 'PLC_1') + '</span>';
    h += '<span class="pp-spacer"></span>';
    h += '<span class="pp-tabs">';
    h += '<span class="pp-tab active" data-pp="props">🔍 属性</span>';
    h += '<span class="pp-tab" data-pp="info">ℹ 信息</span>';
    h += '<span class="pp-tab" data-pp="diag">⚠ 诊断</span>';
    h += '</span>';
    h += '<span class="pp-toggle" id="ppToggle" title="展开/收起属性面板">'
      + (PP.open ? '▾' : '▴') + '</span>';
    h += '</div>';

    // 展开区
    h += '<div class="pp-body" id="ppBody" style="height:' + (PP.open ? PP.height : 0) + 'px;' +
      (PP.open ? '' : 'display:none') + '">';

    // 上部：四个标签
    h += '<div class="pp-tabbar">';
    [['general', '常规'], ['io', 'IO 变量'], ['sysconst', '系统常数'], ['text', '文本']]
      .forEach(function (t) {
        h += '<span class="pp-t2' + (PP.activeTab === t[0] ? ' active' : '') +
          '" data-ppt="' + t[0] + '">' + t[1] + '</span>';
      });
    h += '</div>';

    // 下部：左树 + 右内容
    h += '<div class="pp-main">';
    h += '<div class="pp-tree" id="ppTree">' + treeHtml() + '</div>';
    h += '<div class="pp-content" id="ppContent">' + contentHtml(cfg) + '</div>';
    h += '</div>';

    h += '</div>';

    host.innerHTML = h;
    bind(host, cfg);
  }

  function treeHtml() {
    var h = '';
    TREE.forEach(function (n) {
      var pad = 8 + n.level * 14;
      var arrow = n.hasChildren ? (n.open ? '▾' : '▸') : '';
      var cls = 'pp-node' + (PP.activeProp === n.id ? ' active' : '');
      h += '<div class="' + cls + '" data-ppid="' + n.id + '" style="padding-left:' + pad + 'px">' +
        '<span class="pp-arrow">' + arrow + '</span>' +
        '<span class="pp-label">' + esc(n.label) + '</span></div>';
    });
    return h;
  }

  /* ============================================================
   * 右侧内容
   * ============================================================ */
  function contentHtml(cfg) {
    if (PP.activeTab !== 'general') {
      return otherTabHtml();
    }
    if (PP.activeProp === 'sysclock') return sysClockHtml(cfg);
    return '<div class="pp-empty">「' + esc(propLabel(PP.activeProp)) +
      '」的配置项未收录。<br><br>本仿真器已实现：<b>系统和时钟存储器</b>。</div>';
  }

  function propLabel(id) {
    var it = TREE.filter(function (x) { return x.id === id; })[0];
    return it ? it.label : id;
  }

  function otherTabHtml() {
    var map = {
      io: ['IO 变量', '本仿真器未实现 IO 变量表。真实 TIA 在此列出所有模块的 I/O 地址分配' +
        '（如 %I0.0 ~ %I1.7、%Q0.0 ~ %Q1.1）。'],
      sysconst: ['系统常数', '本仿真器未实现系统常数表。真实 TIA 在此列出 OB 编号、' +
        '事件号、本地数据等内部常数。'],
      text: ['文本', '本仿真器未实现多语言文本表。']
    };
    var m = map[PP.activeTab] || ['', ''];
    return '<div class="pp-empty"><b>' + esc(m[0]) + '</b><br><br>' + esc(m[1]) + '</div>';
  }

  // 系统和时钟存储器（核心配置页）
  function sysClockHtml(cfg) {
    var d = (cfg.project && cfg.project.device) || {};
    var sm = d.systemMemory || { enabled: false, byte: 1 };
    var cm = d.clockMemory || { enabled: false, byte: 0 };

    var h = '';
    h += '<div class="pp-group">';
    h += '<div class="pp-group-title">系统和时钟存储器</div>';

    // ---- 系统存储器位 ----
    h += '<div class="pp-sub">系统存储器位</div>';
    h += '<div class="pp-check"><label><input type="checkbox" id="ppSysEnable"' +
      (sm.enabled ? ' checked' : '') + '> 启用系统存储器字节</label></div>';

    var disabledAttr = sm.enabled ? '' : ' disabled';

    h += '<div class="pp-field"><label>系统存储器字节的地址（MBx）：</label>' +
      '<input class="pp-inp" type="text" id="ppSysByte" value="' +
      esc(String(sm.byte == null ? 1 : sm.byte)) + '"' + disabledAttr + '></div>';

    var SYS = root.PLC && root.PLC.SoftPLC ? root.PLC.SoftPLC.SYS_TABLE : [];
    SYS.forEach(function (b) {
      var addr = sm.enabled ? ('%M' + (sm.byte == null ? 1 : sm.byte) + '.' + b.bit) : '';
      h += '<div class="pp-field"><label>' + esc(b.name) + '：</label>' +
        '<input class="pp-inp" type="text" value="' + esc(addr) + '" readonly></div>';
    });

    // ---- 时钟存储器位 ----
    h += '<div class="pp-sub" style="margin-top:16px">时钟存储器位</div>';
    h += '<div class="pp-check"><label><input type="checkbox" id="ppClkEnable"' +
      (cm.enabled ? ' checked' : '') + '> 启用时钟存储器字节</label></div>';

    var clkDisabled = cm.enabled ? '' : ' disabled';
    h += '<div class="pp-field"><label>时钟存储器字节的地址（MBx）：</label>' +
      '<input class="pp-inp" type="text" id="ppClkByte" value="' +
      esc(String(cm.byte == null ? 0 : cm.byte)) + '"' + clkDisabled + '></div>';

    var CLK = root.PLC && root.PLC.SoftPLC ? root.PLC.SoftPLC.CLOCK_TABLE : [];
    CLK.forEach(function (b) {
      var addr = cm.enabled ? ('%M' + (cm.byte == null ? 0 : cm.byte) + '.' + b.bit) : '';
      h += '<div class="pp-field"><label>' + esc(b.freq) + ' 时钟：</label>' +
        '<input class="pp-inp" type="text" value="' + esc(addr) + '" readonly></div>';
    });

    h += '</div>';
    return h;
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind(host, cfg) {
    // 展开/收起
    var tg = $('#ppToggle');
    if (tg) tg.onclick = function () { toggle(); if (cfg.onChange) cfg.onChange(); };

    // 双击分隔条也可展开/收起（对齐截图说明）
    var sp = $('#ppSplitter');
    if (sp) {
      sp.addEventListener('dblclick', function () {
        toggle();
        if (cfg.onChange) cfg.onChange();
      });
      // 拖动调整高度
      sp.addEventListener('mousedown', function (e) {
        if (!PP.open) return;
        e.preventDefault();
        PP.drag = { y0: e.clientY, h0: PP.height };
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd, { once: true });
      });
    }

    // 上部四个标签
    $$('[data-ppt]', host).forEach(function (el) {
      el.onclick = function () {
        PP.activeTab = el.dataset.ppt;
        rerender(cfg);
      };
    });

    // 属性树
    $$('#ppTree .pp-node', host).forEach(function (el) {
      el.onclick = function () {
        var id = el.dataset.ppid;
        var it = TREE.filter(function (x) { return x.id === id; })[0];
        if (it && it.hasChildren) {
          it.open = !it.open;
          // 展开/收起子项（简单实现：重新渲染）
          PP.activeProp = id;
        } else {
          PP.activeProp = id;
        }
        rerender(cfg);
      };
    });

    // 系统存储器开关
    var se = $('#ppSysEnable');
    if (se) se.onchange = function () {
      var d = cfg.project.device;
      d.systemMemory = d.systemMemory || { enabled: false, byte: 1 };
      d.systemMemory.enabled = se.checked;
      if (cfg.onSystemMemoryChange) cfg.onSystemMemoryChange(d.systemMemory);
      rerender(cfg);
      if (cfg.onChange) cfg.onChange();
    };
    var sb = $('#ppSysByte');
    if (sb) sb.onchange = function () {
      var v = parseInt(sb.value, 10);
      if (isNaN(v) || v < 0 || v > 1023) { sb.value = '1'; return; }
      var d = cfg.project.device;
      d.systemMemory = d.systemMemory || { enabled: false, byte: 1 };
      d.systemMemory.byte = v;
      if (cfg.onSystemMemoryChange) cfg.onSystemMemoryChange(d.systemMemory);
      rerender(cfg);
      if (cfg.onChange) cfg.onChange();
    };

    // 时钟存储器开关
    var ce = $('#ppClkEnable');
    if (ce) ce.onchange = function () {
      var d = cfg.project.device;
      d.clockMemory = d.clockMemory || { enabled: false, byte: 0 };
      d.clockMemory.enabled = ce.checked;
      if (cfg.onClockMemoryChange) cfg.onClockMemoryChange(d.clockMemory);
      rerender(cfg);
      if (cfg.onChange) cfg.onChange();
    };
    var cb = $('#ppClkByte');
    if (cb) cb.onchange = function () {
      var v = parseInt(cb.value, 10);
      if (isNaN(v) || v < 0 || v > 1023) { cb.value = '0'; return; }
      var d = cfg.project.device;
      d.clockMemory = d.clockMemory || { enabled: false, byte: 0 };
      d.clockMemory.byte = v;
      if (cfg.onClockMemoryChange) cfg.onClockMemoryChange(d.clockMemory);
      rerender(cfg);
      if (cfg.onChange) cfg.onChange();
    };
  }

  function onDrag(e) {
    if (!PP.drag) return;
    var dy = PP.drag.y0 - e.clientY;   // 向上拖 = 变高
    var nh = Math.max(PP.minH, Math.min(PP.maxH, PP.drag.h0 + dy));
    PP.height = nh;
    var body = $('#ppBody');
    if (body) body.style.height = nh + 'px';
  }

  function onDragEnd() {
    PP.drag = null;
    document.removeEventListener('mousemove', onDrag);
  }

  function toggle() {
    PP.open = !PP.open;
    var body = $('#ppBody');
    var tg = $('#ppToggle');
    if (body) {
      if (PP.open) {
        body.style.display = 'block';
        body.style.height = PP.height + 'px';
      } else {
        body.style.display = 'none';
      }
    }
    if (tg) tg.textContent = PP.open ? '▾' : '▴';
  }

  // 局部重渲染（只重画树和内容，保留展开高度）
  var lastCfg = null;
  function rerender(cfg) {
    lastCfg = cfg || lastCfg;
    var tree = $('#ppTree');
    var content = $('#ppContent');
    var tabbar = $('.pp-tabbar');
    if (tree) tree.innerHTML = treeHtml();
    if (content) content.innerHTML = contentHtml(lastCfg || {});
    if (tabbar) {
      $$('.pp-t2', tabbar).forEach(function (el) {
        el.classList.toggle('active', el.dataset.ppt === PP.activeTab);
      });
    }
    // 重新绑定内部事件
    var host = $('#ppBody');
    if (host) bind(host, lastCfg || {});
  }

  root.PropsPanel = {
    render: render,
    rerender: rerender,
    toggle: toggle,
    state: PP,
    open: function () { if (!PP.open) toggle(); },
    close: function () { if (PP.open) toggle(); }
  };
})(window);
