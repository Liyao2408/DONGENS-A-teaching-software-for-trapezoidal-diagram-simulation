/* ============================================================
   simpanel.js — 仿真面板（外部接线图）
   对齐用户需求：
     · 开关与灯的数量/地址**按变量表里 Bool 类型的地址自动生成**（2026-11-21）
         ｜ 输入（I）＝ 可点的开关，写 plc.mem.I
         ｜ 输入（M）＝ 可点的开关，手动给中间位注入信号，写 plc.mem.M
         ｜ 输出（Q）＝ 只读的灯，跟随 plc.mem.Q
         ｜ 输出（M）＝ 只读的灯，观察程序写进 M 的值
       Int / DInt / MW / MD 之类的非 Bool 变量不会变成开关
     · 圆形，无信号灰色，有信号绿色
     · 默认点动：按下有信号，松开失去（像真实机台的点动按钮）
     · 可切换为自锁：点一下锁住，再点取消（调机时想常亮某个输入用）
     · 按住 Shift 可连续点亮多个，松开 Shift 全部停止
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

  var SP = {
    mode: 'momentary',   // 'momentary' 点动（默认）| 'latch' 自锁
    holding: false,      // 是否处于 Shift 连按状态
    shiftPressed: false,
    iStates: {},         // 地址 -> 手动锁定的值（I 和 M 输入共用）
    project: null,       // 当前项目（读变量表用）
    sig: '',             // 变量表地址指纹
    inI: [],             // 输入（I）：变量表里 Bool 的 I 地址
    inM: [],             // 输入（M）：变量表里 Bool 的 M 地址（手动注入中间位）
    outQ: [],            // 输出（Q）：变量表里 Bool 的 Q 地址
    outM: [],            // 输出（M）：变量表里 Bool 的 M 地址（观察程序写入）
    inCard: false,       // 面板是否已渲染
    onStateChange: null
  };

  /* ============================================================
   * 渲染面板
   * host: 容器
   * cfg: { plc, project, onChanged }
   * ============================================================ */
  function render(host, cfg) {
    if (!host) return;
    cfg = cfg || {};
    SP.plc = cfg.plc;
    SP.onStateChange = cfg.onChanged;
    SP.project = cfg.project || null;

    // 从变量表推出 I / Q / M 地址清单
    // 规则（2026-11-21）：只看 Bool 类型；地址是什么就显示什么，不再补齐到
    // 1215C 的 14DI / 10DQ —— 变量表里只有一个 I0.0 就只显示一个开关
    var tags = (cfg.project && cfg.project.tags) || [];
    var groups = { I: [], Q: [], M: [] };
    var seen = { I: {}, Q: {}, M: {} };

    function isBoolTag(t) {
      var d = String(t.datatype || t.dataType || t.type || 'Bool').trim().toLowerCase();
      return d === 'bool';
    }

    tags.forEach(function (t) {
      if (!t.address) return;
      if (!isBoolTag(t)) return;                       // Int / DInt / Word… 不做成开关
      var m = /^([IQM])\s*(\d+)\.(\d+)$/i.exec(String(t.address).trim());
      if (!m) return;                                  // MW10 / MD20 这类整字地址跳过
      var area = m[1].toUpperCase();
      var address = area + (+m[2]) + '.' + (+m[3]);     // 统一成 I0.0 / M100.0
      if (seen[area][address]) return;                 // 同一地址只留一个
      seen[area][address] = 1;
      groups[area].push({
        area: area, address: address,
        name: t.name || '', comment: t.comment || ''
      });
    });

    function addrKey(a) {
      var m = /^([IQM])(\d+)\.(\d+)$/.exec(a.address);
      return m ? (+m[2] * 256 + +m[3]) : 0;
    }
    ['I', 'Q', 'M'].forEach(function (a) {
      groups[a].sort(function (x, y) { return addrKey(x) - addrKey(y); });
    });

    // 输入侧 = I（物理输入）+ M（手动注入）；输出侧 = Q（物理输出）+ M（观察）
    SP.inI = groups.I;
    SP.inM = groups.M;
    SP.outQ = groups.Q;
    SP.outM = groups.M;
    SP.sig = signature(cfg.project);   // 变量表一变（加了 I0.3）就自动重建面板

    var h = '';
    h += '<div class="sim-wrap">';

    // ---- 顶栏 ----
    h += '<div class="sim-head">';
    h += '<span class="sim-title">仿真 · 外部接线图</span>';
    h += '<span class="sim-cpu" id="simCpuState">CPU：—</span>';
    h += '<span class="sim-spacer"></span>';

    // 按钮模式切换
    h += '<span class="sim-mode">';
    h += '<span class="sm-lbl">按钮方式：</span>';
    h += '<span class="sm-opt' + (SP.mode === 'latch' ? ' active' : '') +
      '" data-mode="latch">自锁</span>';
    h += '<span class="sm-opt' + (SP.mode === 'momentary' ? ' active' : '') +
      '" data-mode="momentary">点动</span>';
    h += '</span>';

    h += '<span class="sim-sep"></span>';
    h += '<span class="sim-btn" id="simAllOff">全部复位</span>';
    h += '</div>';

    // ---- 提示条 ----
    h += '<div class="sim-hint" id="simHint">' +
      (SP.mode === 'latch'
        ? '点击圆形接口切换输入 / 观察输出 · 按住 <b>Shift</b> 可连续点亮多个，松开全部停止'
        : '按住圆形接口给输入信号，松开即为 0 · 按住 <b>Shift</b> 可同时按住多个') +
      ' · 开关与灯按变量表里 <b>Bool</b> 类型的 I / Q / M 地址自动生成' +
      '</div>';

    // ---- 软 PLC 状态条（细条，放在接口上方，四组接口才能同屏看全）----
    h += '<div class="sim-stats-bar" id="simStats"></div>';

    // ---- 输入（I）----
    h += '<div class="sim-row sim-row-in">';
    h += '<div class="sim-row-label">输入（I）</div>';
    h += '<div class="sim-nodes" id="simINodes">';
    h += groupHtml(SP.inI, 'in', '变量表里没有 Bool 类型的 I 地址（例如 I0.0）');
    h += '</div></div>';

    // ---- 输入（M）：手动注入的中间位 ----
    h += '<div class="sim-row sim-row-in sim-row-min">';
    h += '<div class="sim-row-label">输入（M）</div>';
    h += '<div class="sim-nodes" id="simMNodes">';
    h += groupHtml(SP.inM, 'in', '变量表里没有 Bool 类型的 M 地址（例如 M0.0）');
    h += '</div></div>';

    // ---- 输出（Q）----
    h += '<div class="sim-row sim-row-out">';
    h += '<div class="sim-row-label">输出（Q）</div>';
    h += '<div class="sim-nodes" id="simQNodes">';
    h += groupHtml(SP.outQ, 'out', '变量表里没有 Bool 类型的 Q 地址（例如 Q0.0）');
    h += '</div></div>';

    // ---- 输出（M）：观察程序写进 M 的值 ----
    h += '<div class="sim-row sim-row-out sim-row-mout">';
    h += '<div class="sim-row-label">输出（M）</div>';
    h += '<div class="sim-nodes" id="simMNodesOut">';
    h += groupHtml(SP.outM, 'out', '变量表里没有 Bool 类型的 M 地址（例如 M0.0）');
    h += '</div></div>';

    h += '</div>';   // sim-wrap

    host.innerHTML = h;
    SP.inCard = true;
    bind(host);
    refresh(host);
  }

  /* 一组接口；空了给一句提示，别留一个空白框让人以为坏了 */
  function groupHtml(list, role, emptyText) {
    if (!list || !list.length) {
      return '<div class="sim-empty">' + esc(emptyText) + '</div>';
    }
    var h = '';
    list.forEach(function (it) { h += nodeHtml(it, role); });
    return h;
  }

  /* 同一个 M 地址在"输入"和"输出"各出现一次，DOM id 必须带角色后缀 */
  function uidOf(it, role) {
    return it.area + '_' + String(it.address).replace('.', '_') + '_' + role;
  }

  /* 变量表里 Bool 的 I/Q/M 地址指纹：用来判断"变量表改过了，面板要重建" */
  function signature(project) {
    var tags = (project && project.tags) || [];
    var out = [];
    tags.forEach(function (t) {
      if (!t.address) return;
      var d = String(t.datatype || t.dataType || t.type || 'Bool').trim().toLowerCase();
      if (d !== 'bool') return;
      var m = /^([IQM])\s*(\d+)\.(\d+)$/i.exec(String(t.address).trim());
      if (!m) return;
      out.push(m[1].toUpperCase() + (+m[2]) + '.' + (+m[3]));
    });
    return out.sort().join(',');
  }

  /* role: 'in'（开关，可点）/ 'out'（灯，只读）
     data-kind 保持 I / Q / MI / MQ 四类：老测试和样式仍按 I、Q 找得到 */
  function nodeHtml(it, role) {
    var kind = role === 'in'
      ? (it.area === 'I' ? 'I' : 'MI')
      : (it.area === 'Q' ? 'Q' : 'MQ');
    var uid = uidOf(it, role);
    var h = '';
    h += '<div class="sim-node" data-node="' + esc(uid) + '" data-addr="' + esc(it.address) +
      '" data-area="' + esc(it.area) + '" data-kind="' + kind + '"' +
      (role === 'out' ? ' data-readonly="1"' : '') + '>';
    h += '<div class="sn-circle" id="sn_' + esc(uid) + '"></div>';
    h += '<div class="sn-addr">' + esc(it.address) + '</div>';
    if (it.name) {
      h += '<div class="sn-name">"' + esc(it.name) + '"</div>';
    }
    h += '</div>';
    return h;
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind(host) {
    // 模式切换
    $$('.sm-opt', host).forEach(function (el) {
      el.onclick = function () {
        SP.mode = el.dataset.mode;
        $$('.sm-opt', host).forEach(function (x) {
          x.classList.toggle('active', x.dataset.mode === SP.mode);
        });
        // 切模式时清空所有锁定
        SP.iStates = {};
        pushAllInputs();
        refresh(host);
        toast(SP.mode === 'latch' ? '已切换为自锁按钮' : '已切换为点动按钮');
      };
    });

    // 全部复位
    var allOff = $('#simAllOff', host);
    if (allOff) allOff.onclick = function () {
      SP.iStates = {};
      pushAllInputs();
      refresh(host);
      toast('已复位所有输入');
    };

    // 输入侧接口：I（物理输入）与 M（手动注入的中间位）都能点/按住
    $$('.sim-node[data-kind="I"], .sim-node[data-kind="MI"]', host).forEach(function (el) {
      var addr = el.dataset.addr;

      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var cur = !!SP.iStates[addr];
        SP.shiftPressed = e.shiftKey;

        if (SP.mode === 'latch') {
          // 自锁：切换（Shift 时只置位不取消，便于批量点亮）
          SP.iStates[addr] = e.shiftKey ? true : !cur;
          pushInput(addr);
          refresh(host);
          return;
        }

        // 点动：按住有效
        SP.iStates[addr] = true;
        SP.holding = true;
        pushInput(addr);
        refresh(host);
      });

      el.addEventListener('mouseup', function (e) {
        if (SP.mode !== 'momentary') return;
        // 有 Shift 时保持，等松开 Shift 再清（对齐需求：Shift 连按多个 I）
        if (SP.shiftPressed || e.shiftKey) return;
        SP.iStates[addr] = false;
        pushInput(addr);
        refresh(host);
      });

      el.addEventListener('mouseleave', function () {
        if (SP.mode !== 'momentary') return;
        if (SP.shiftPressed) return;
        SP.iStates[addr] = false;
        pushInput(addr);
        refresh(host);
      });
    });

    // 全局键盘：Shift 松开时清空所有点动输入
    if (!SP.keyBound) {
      SP.keyBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Shift' && !SP.shiftPressed) {
          SP.shiftPressed = true;
          var hint = document.getElementById('simHint');
          if (hint) hint.classList.add('shift-on');
        }
      });
      document.addEventListener('keyup', function (e) {
        if (e.key === 'Shift') {
          SP.shiftPressed = false;
          SP.holding = false;
          var hint = document.getElementById('simHint');
          if (hint) hint.classList.remove('shift-on');
          // 点动模式下松开 Shift：全部输入断开
          if (SP.mode === 'momentary') {
            Object.keys(SP.iStates).forEach(function (a) { SP.iStates[a] = false; });
            pushAllInputs();
            refreshFromAnywhere();
          }
        }
      });
    }
  }

  function refreshFromAnywhere() {
    var host = document.getElementById('simBody');
    if (host && SP.inCard) refresh(host);
  }

  /* ============================================================
   * 与软 PLC 同步
   * ============================================================ */
  function pushInput(addr) {
    if (!SP.plc) return;
    SP.plc.write(addr, !!SP.iStates[addr]);
    if (SP.onStateChange) SP.onStateChange();
  }

  function pushAllInputs() {
    if (!SP.plc) return;
    Object.keys(SP.iStates).forEach(function (a) {
      SP.plc.write(a, !!SP.iStates[a]);
    });
    if (SP.onStateChange) SP.onStateChange();
  }

  /**
   * 刷新面板显示（每次扫描周期调用）
   * host: 面板容器（不传则自动查找 #simBody）
   */
  function refresh(host) {
    host = host || document.getElementById('simBody');
    if (!host || !SP.plc) return;

    // 变量表变了（比如刚加了个 I0.3）→ 按新地址重建面板，不用人手动关开
    if (SP.project && SP.sig !== signature(SP.project)) {
      render(host, { plc: SP.plc, project: SP.project, onChanged: SP.onStateChange });
      return;
    }

    // ---- 输入侧（I + M）：点动看真实值，自锁看锁定值 ----
    function paintIn(list) {
      (list || []).forEach(function (it) {
        var el = document.getElementById('sn_' + uidOf(it, 'in'));
        if (!el) return;
        var on = SP.mode === 'latch'
          ? !!SP.iStates[it.address]
          : !!SP.plc.read(it.address);
        el.classList.toggle('on', on);
        el.classList.toggle('off', !on);
      });
    }
    paintIn(SP.inI);
    paintIn(SP.inM);

    // ---- 输出侧（Q + M）：只读跟随 PLC ----
    function paintOut(list) {
      (list || []).forEach(function (it) {
        var el = document.getElementById('sn_' + uidOf(it, 'out'));
        if (!el) return;
        var on = !!SP.plc.read(it.address);
        el.classList.toggle('on', on);
        el.classList.toggle('off', !on);
      });
    }
    paintOut(SP.outQ);
    paintOut(SP.outM);

    // ---- CPU 状态 ----
    var cpuEl = document.getElementById('simCpuState');
    if (cpuEl) {
      var running = SP.plc.runtime;
      cpuEl.textContent = 'CPU：' + (running ? 'RUN' : 'STOP') +
        '  循环 ' + SP.plc.cycleCount;
      cpuEl.className = 'sim-cpu' + (running ? ' run' : '');
    }

    // ---- 状态摘要 ----
    var statsEl = document.getElementById('simStats');
    if (statsEl) {
      var inAll = (SP.inI || []).concat(SP.inM || []);
      var onI = inAll.filter(function (it) {
        return SP.mode === 'latch' ? !!SP.iStates[it.address] : !!SP.plc.read(it.address);
      }).length;
      var outAll = (SP.outQ || []).concat(SP.outM || []);
      var onQ = outAll.filter(function (it) {
        return !!SP.plc.read(it.address);
      }).length;
      statsEl.innerHTML =
        '<span class="st st-lbl">软 PLC 状态</span>' +
        '<span class="st">输入导通：<b>' + onI + '</b> / ' + inAll.length + '</span>' +
        '<span class="st">输出导通：<b>' + onQ + '</b> / ' + outAll.length + '</span>' +
        '<span class="st">扫描周期：<b>' + SP.plc.lastCycleMs.toFixed(2) + ' ms</b></span>' +
        '<span class="st">最大周期：<b>' + SP.plc.maxCycleMs.toFixed(2) + ' ms</b></span>';
    }
  }

  function toast(msg) {
    if (root.__toast) root.__toast(msg);
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */
  root.SimPanel = {
    render: render,
    refresh: refresh,
    state: SP,
    setPlc: function (plc) { SP.plc = plc; },
    clearInputs: function () {
      SP.iStates = {};
      pushAllInputs();
      refreshFromAnywhere();
    },
    setMode: function (m) {
      SP.mode = (m === 'momentary') ? 'momentary' : 'latch';
      SP.iStates = {};
      pushAllInputs();
      refreshFromAnywhere();
    }
  };
})(window);



