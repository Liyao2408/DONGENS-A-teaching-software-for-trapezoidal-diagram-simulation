/* ============================================================
   racks.js — 设备组态「机架视图」渲染器
   对齐 TIA：左侧 CPU 图形占第 1 槽，右侧 2~9 槽为可插模块位置
   提供：图形绘制、坐标几何（供右键/拖拽命中）、选中态
   ============================================================ */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var RACK = {
    slotW: 118,        // 每个槽宽
    slotH: 148,        // 机架高度
    headerH: 22,       // 槽号标题栏高
    slots: 9,          // 1~9 号槽
    cpuW: 96,          // CPU 图形宽
    cpuH: 108
  };

  /* ---------------- CPU 图形（SVG） ---------------- */
  // 参照真实 1215C 前面板：左上 DONGENS 标、型号串、指示灯、下方接线端子
  function cpuFigure(x, y, w, h, opts) {
    opts = opts || {};
    var g = '<g class="rack-cpu' + (opts.selected ? ' sel' : '') + '" data-rack="cpu">';

    // 主体
    g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
      '" fill="#5d7f9c" stroke="#3d5a73" stroke-width="1.2" rx="1"/>';

    // 左侧浅色竖条（实际是电源/接口区）
    g += '<rect x="' + (x + 4) + '" y="' + (y + 4) + '" width="' + (w - 8) + '" height="' +
      (h * 0.52) + '" fill="#7a9ab8" stroke="#4a6b85" stroke-width="0.8"/>';

    // DONGENS 标
    g += '<text x="' + (x + 9) + '" y="' + (y + 15) + '" font-size="6.2" font-weight="700" ' +
      'fill="#e8f2fa" font-family="Arial">DONGENS</text>';

    // 型号串（右侧）
    g += '<text x="' + (x + w - 8) + '" y="' + (y + 14) + '" text-anchor="end" font-size="5" ' +
      'fill="#dbe9f4" font-family="Consolas">DONGENS S7-1200</text>';
    g += '<text x="' + (x + w - 8) + '" y="' + (y + h * 0.5) + '" text-anchor="end" font-size="5" ' +
      'fill="#dbe9f4" font-family="Consolas">CPU ' + esc(opts.model || '1215C') + '</text>';
    g += '<text x="' + (x + w - 8) + '" y="' + (y + h * 0.5 + 7) + '" text-anchor="end" font-size="4.6" ' +
      'fill="#c4d8e8" font-family="Consolas">DC/DC/DC</text>';

    // 指示灯（RUN/STOP/ERROR）
    g += '<rect x="' + (x + 8) + '" y="' + (y + h * 0.56) + '" width="7" height="5" fill="#4fc46a" rx="0.8"/>';
    g += '<rect x="' + (x + 18) + '" y="' + (y + h * 0.56) + '" width="7" height="5" fill="#e8b64c" rx="0.8"/>';
    g += '<rect x="' + (x + 28) + '" y="' + (y + h * 0.56) + '" width="7" height="5" fill="#e0655a" rx="0.8"/>';

    // 下方接线端子区（两排小方块）
    var tx = x + 6, ty = y + h - 30;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 9; c++) {
        g += '<rect x="' + (tx + c * 9.6) + '" y="' + (ty + r * 10) + '" width="7" height="7" ' +
          'fill="#8fb8d8" stroke="#4a6b85" stroke-width="0.5"/>';
      }
    }

    // 网口（右下）
    g += '<rect x="' + (x + w - 22) + '" y="' + (y + h - 20) + '" width="16" height="12" ' +
      'fill="#2e4658" stroke="#1e3242" stroke-width="0.8" rx="1"/>';
    g += '<rect x="' + (x + w - 19) + '" y="' + (y + h - 17) + '" width="10" height="6" ' +
      'fill="#a8cde8"/>';

    // 选中虚线框（TIA 里点中设备时的蓝色虚线）
    if (opts.selected) {
      g += '<rect x="' + (x - 3) + '" y="' + (y - 3) + '" width="' + (w + 6) + '" height="' + (h + 6) +
        '" fill="none" stroke="#1a6fa8" stroke-width="1.6" stroke-dasharray="4 3"/>';
    }

    g += '</g>';
    return g;
  }

  /* ---------------- 空白模块槽 ---------------- */
  function emptySlot(x, y, w, h, slotNo, opts) {
    opts = opts || {};
    var g = '<g class="rack-slot" data-slot="' + slotNo + '">';
    // 底板
    g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
      '" fill="' + (opts.hover ? '#e8f2fa' : '#f4f7fa') + '" stroke="#c9d5df" stroke-width="1"/>';
    // 竖向分隔感
    g += '<line x1="' + (x + w - 1) + '" y1="' + y + '" x2="' + (x + w - 1) + '" y2="' + (y + h) +
      '" stroke="#dde5ec" stroke-width="1"/>';
    if (opts.selected) {
      g += '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + (w - 2) + '" height="' + (h - 2) +
        '" fill="none" stroke="#1a6fa8" stroke-width="1.6" stroke-dasharray="4 3"/>';
    }
    g += '</g>';
    return g;
  }

  /* ---------------- 已插入模块 ---------------- */
  function moduleFigure(x, y, w, h, mod, opts) {
    opts = opts || {};
    var g = '<g class="rack-mod" data-rack="mod" data-slot="' + (mod.slot || '') + '">';
    g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
      '" fill="#7a9ab8" stroke="#3d5a73" stroke-width="1.2" rx="1"/>';
    g += '<text x="' + (x + w / 2) + '" y="' + (y + 18) + '" text-anchor="middle" font-size="7" ' +
      'font-weight="700" fill="#e8f2fa" font-family="Arial">' + esc(mod.short || 'SM') + '</text>';
    g += '<text x="' + (x + w / 2) + '" y="' + (y + h / 2) + '" text-anchor="middle" font-size="6" ' +
      'fill="#dbe9f4" font-family="Consolas">' + esc(mod.name || '') + '</text>';
    // 端子
    var tx = x + 8, ty = y + h - 26;
    for (var c = 0; c < 8; c++) {
      g += '<rect x="' + (tx + c * 10) + '" y="' + ty + '" width="7" height="7" ' +
        'fill="#a8cde8" stroke="#4a6b85" stroke-width="0.5"/>';
    }
    if (opts.selected) {
      g += '<rect x="' + (x - 3) + '" y="' + (y - 3) + '" width="' + (w + 6) + '" height="' + (h + 6) +
        '" fill="none" stroke="#1a6fa8" stroke-width="1.6" stroke-dasharray="4 3"/>';
    }
    g += '</g>';
    return g;
  }

  /* ============================================================
   * 渲染整块机架
   * cfg = {
   *   deviceName,       // "PLC_1"
   *   cpuModel,         // "1215C DC/DC/DC"
   *   modules: [{slot, short, name}],
   *   selected: 'cpu' | slotNo | null,
   *   showLabel         // 是否显示左上角 "PLC_1" 斜标
   * }
   * 返回 { html, geo }
   * ============================================================ */
  function renderRack(cfg) {
    cfg = cfg || {};
    var S = RACK;
    var totalW = S.slots * S.slotW + 4;
    var totalH = S.headerH + S.slotH + 14;

    var svg = [];
    var geo = { slots: [], cpu: null };

    svg.push('<svg class="rack-svg" width="' + totalW + '" height="' + totalH +
      '" xmlns="http://www.w3.org/2000/svg">');

    // 左上角斜标签 PLC_1
    if (cfg.showLabel !== false) {
      var label = cfg.deviceName || 'PLC_1';
      svg.push('<g transform="translate(18,20) rotate(-32)">' +
        '<rect x="-2" y="-9" width="' + (label.length * 6.4 + 10) + '" height="13" rx="1.5" ' +
        'fill="#4a90d9" stroke="#2a6db0" stroke-width="1"/>' +
        '<text x="' + ((label.length * 6.4 + 6) / 2) + '" y="1" text-anchor="middle" ' +
        'font-size="8" font-weight="700" fill="#fff" font-family="Arial">' +
        esc(label) + '</text></g>');
    }

    // 槽号标题栏
    for (var i = 0; i < S.slots; i++) {
      var hx = i * S.slotW;
      var isFirst = (i === 0);
      svg.push('<rect x="' + hx + '" y="0" width="' + (S.slotW - 1) + '" height="' + S.headerH +
        '" fill="' + (isFirst && cfg.selected === 'cpu' ? '#a9cde8' : '#c9d5df') +
        '" stroke="#aeb9c3" stroke-width="1"/>');
      svg.push('<text x="' + (hx + S.slotW / 2 - 1) + '" y="' + (S.headerH - 7) +
        '" text-anchor="middle" font-size="11" font-weight="700" fill="#33475b" ' +
        'font-family="Segoe UI">' + (i + 1) + '</text>');
    }

    // 各槽内容
    for (var s = 0; s < S.slots; s++) {
      var x = s * S.slotW;
      var y = S.headerH;

      if (s === 0) {
        // 第 1 槽：CPU
        var cw = S.cpuW, ch = S.cpuH;
        var cx = x + (S.slotW - 1 - cw) / 2;
        var cy = y + 12;
        // 槽背景
        svg.push('<rect x="' + x + '" y="' + y + '" width="' + (S.slotW - 1) + '" height="' + S.slotH +
          '" fill="#eef1f4" stroke="#c9d5df" stroke-width="1"/>');
        svg.push(cpuFigure(cx, cy, cw, ch, {
          selected: cfg.selected === 'cpu',
          model: (cfg.cpuModel || '').replace(/^CPU\s*/, '').split(' ')[0]
        }));
        geo.cpu = { slot: 1, x: x, y: y, w: S.slotW, h: S.slotH };
        geo.slots.push({ slot: 1, x: x, y: y, w: S.slotW, h: S.slotH, type: 'cpu' });
      } else {
        // 其余槽：已插模块 or 空
        var mod = null;
        (cfg.modules || []).forEach(function (m) {
          if (m.slot === (s + 1)) mod = m;
        });
        if (mod) {
          svg.push('<rect x="' + x + '" y="' + y + '" width="' + (S.slotW - 1) + '" height="' + S.slotH +
            '" fill="#eef1f4" stroke="#c9d5df" stroke-width="1"/>');
          svg.push(moduleFigure(x + 10, y + 12, S.slotW - 21, S.cpuH, mod, {
            selected: cfg.selected === (s + 1)
          }));
        } else {
          svg.push(emptySlot(x, y, S.slotW - 1, S.slotH, s + 1, {
            selected: cfg.selected === (s + 1)
          }));
        }
        geo.slots.push({ slot: s + 1, x: x, y: y, w: S.slotW, h: S.slotH, type: mod ? 'mod' : 'empty' });
      }
    }

    svg.push('</svg>');
    return { html: svg.join(''), geo: geo };
  }

  root.Rack = {
    render: renderRack,
    RACK: RACK
  };
})(window);
