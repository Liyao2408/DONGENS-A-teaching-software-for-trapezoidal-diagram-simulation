/* ============================================================
   app.js — DSI Platform 复刻：外壳、项目树、编辑器调度、在线监视
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 应用状态 ================= */
  var App = {
    project: null,
    plc: new PLC.SoftPLC(),
    openTabs: [],          // {id, kind, ref, title, dirty}
    activeTab: null,
    selectedNode: null,
    online: false,         // 是否已"下载到设备"并在线
    running: false,        // CPU 是否 RUN
    monitor: false,        // 是否开启监视
    selNet: 0,
    selEl: null,
    inspectTab: 'props',
    diags: [],
    scanTimer: null,
    scanInterval: 50,
    editingCell: null,
    modalCb: null
  };

  /* ================= 默认示例工程 ================= */
  function newProject(name) {
    return {
      name: name || 'Project1',
      author: 'Administrator',
      version: 'V16',
      comment: '',
      path: 'C:\\Users\\Administrator\\Documents\\Automation\\' + (name || 'Project1'),
      created: new Date().toISOString().slice(0, 10),
      // 班级最常用：S7-1200 系列的 CPU 1215C DC/DC/DC
      device: {
        name: 'PLC_1', type: 'CPU 1215C DC/DC/DC',
        orderNo: '6ES7 215-1AG40-0XB0', fw: 'V4.4', ip: '192.168.0.1'
      },
      // 已添加的设备列表（设备与网络视图用）
      devices: [{
        name: 'PLC_1', type: 'CPU 1215C DC/DC/DC',
        orderNo: '6ES7 215-1AG40-0XB0', version: 'V4.4',
        family: 'S7-1200',
        desc: '125 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2 和 AQ2；' +
          '板载 6 个高速计数器和 4 路脉冲输出；PROFINET IO 控制器，双端口'
      }],
      tags: [
        { name: 'Start_Button', address: 'I0.0', datatype: 'Bool', comment: '启动按钮' },
        { name: 'Stop_Button', address: 'I0.1', datatype: 'Bool', comment: '停止按钮' },
        { name: 'Sensor_Light', address: 'I0.2', datatype: 'Bool', comment: '光电传感器' },
        { name: 'Motor_Run', address: 'Q0.0', datatype: 'Bool', comment: '电机运行输出' },
        { name: 'Alarm_Lamp', address: 'Q0.1', datatype: 'Bool', comment: '报警指示灯' },
        { name: 'Run_Time_MS', address: 'MW10', datatype: 'Int', comment: '运行计时(ms)' },
        { name: 'Part_Count', address: 'MW12', datatype: 'Int', comment: '工件计数' },
        { name: 'Setpoint_Speed', address: 'MD20', datatype: 'DInt', comment: '设定转速' }
      ],
      blocks: [
        {
          name: 'OB1', lang: 'LAD', obNumber: 1, type: 'OB',
          desc: '主程序（循环执行）',
          title: 'Main Program Sweep (Cycle)',
          comment: '主程序循环执行：每个扫描周期从网络 1 执行到最后一个网络。',
          networks: [
            {
              title: '电机启保停控制',
              columns: [
                { branches: [
                  [{ id: 'n1a', type: 'NO', operand: 'Start_Button', addr: 'I0.0' }],
                  [{ id: 'n1b', type: 'NO', operand: 'Motor_Run', addr: 'Q0.0' }]
                ] },
                { branches: [[{ id: 'n1c', type: 'NC', operand: 'Stop_Button', addr: 'I0.1' }]] },
                { branches: [[{ id: 'n1d', type: 'COIL', operand: 'Motor_Run', addr: 'Q0.0' }]] }
              ]
            },
            {
              title: '工件计数（上升沿）',
              columns: [
                { branches: [[{ id: 'n2a', type: 'P', operand: 'Sensor_Light', addr: 'I0.2' }]] },
                { branches: [[{ id: 'n2b', type: 'ADD', params: { IN1: 'Part_Count', IN2: '1', OUT: 'Part_Count' } }]] },
                { branches: [[{ id: 'n2c', type: 'CMP_GE', params: { IN1: 'Part_Count', IN2: '100' } }]] },
                { branches: [[{ id: 'n2d', type: 'COIL', operand: 'Alarm_Lamp', addr: 'Q0.1' }]] }
              ]
            },
            {
              title: '运行计时（TON 计时到 1s 后累加计数）',
              columns: [
                { branches: [[{ id: 'n3a', type: 'NO', operand: 'Motor_Run', addr: 'Q0.0' }]] },
                { branches: [[{ id: 'n3c', type: 'ADD', params: { IN1: 'Run_Time_MS', IN2: '10', OUT: 'Run_Time_MS' } }]] },
                { branches: [[{ id: 'n3b', type: 'TON', params: { IN: 'Motor_Run', PT: 'T#2s', ET: 'MW14' } }]] },
                { branches: [[{ id: 'n3d', type: 'CTU', params: { CU: 'Q0.0', PV: '5', CV: 'MW16' } }]] }
              ]
            },
            {
              title: '产量达标后自停（限值 + 比较演示）',
              columns: [
                { branches: [[{ id: 'n4a', type: 'CMP_GT', params: { IN1: 'Part_Count', IN2: '5' } }]] },
                { branches: [[{ id: 'n4b', type: 'SET', operand: 'M1.0' }]] }
              ]
            }
          ]
        },
        {
          name: 'FB_Motor', lang: 'SCL', type: 'FB', obNumber: 0,
          desc: '电机控制功能块',
          source:
            'FUNCTION_BLOCK "FB_Motor"\n' +
            'VAR_INPUT\n' +
            '  Start : Bool;\n' +
            '  Stop : Bool;\n' +
            '  Interlock : Bool;\n' +
            'END_VAR\n' +
            'VAR_OUTPUT\n' +
            '  Run : Bool;\n' +
            '  Fault : Bool;\n' +
            'END_VAR\n' +
            'VAR\n' +
            '  RunTime : Int;\n' +
            '  StartCount : Int;\n' +
            'END_VAR\n' +
            'BEGIN\n' +
            '  // 互锁：有故障时禁止启动\n' +
            '  "Fault" := NOT "Interlock";\n' +
            '\n' +
            '  IF "Start" AND NOT "Stop" AND "Interlock" THEN\n' +
            '    "Run" := TRUE;\n' +
            '    "StartCount" := "StartCount" + 1;\n' +
            '  END_IF;\n' +
            '\n' +
            '  IF "Stop" OR NOT "Interlock" THEN\n' +
            '    "Run" := FALSE;\n' +
            '  END_IF;\n' +
            '\n' +
            '  // 累计运行扫描数\n' +
            '  IF "Run" THEN\n' +
            '    "RunTime" := "RunTime" + 1;\n' +
            '  END_IF;\n' +
            'END_FUNCTION_BLOCK\n'
        },
        {
          name: 'FC_Calc', lang: 'SCL', type: 'FC', obNumber: 0,
          desc: '算术处理函数',
          source:
            'FUNCTION "FC_Calc" : Int\n' +
            'VAR_INPUT\n' +
            '  a : Int;\n' +
            '  b : Int;\n' +
            'END_VAR\n' +
            'VAR_TEMP\n' +
            '  i : Int;\n' +
            '  sum : Int;\n' +
            'END_VAR\n' +
            'BEGIN\n' +
            '  sum := 0;\n' +
            '  FOR i := 1 TO "b" DO\n' +
            '    sum := sum + "a";\n' +
            '  END_FOR;\n' +
            '  "FC_Calc" := sum;\n' +
            'END_FUNCTION\n'
        }
      ],
      watchTables: [
        {
          name: '监控表_1',
          rows: [
            { address: 'I0.0', display: 'Start_Button', monitorFormat: 'Bool' },
            { address: 'I0.1', display: 'Stop_Button', monitorFormat: 'Bool' },
            { address: 'Q0.0', display: 'Motor_Run', monitorFormat: 'Bool' },
            { address: 'MW12', display: 'Part_Count', monitorFormat: 'Int' },
            { address: 'MW10', display: 'Run_Time_MS', monitorFormat: 'Int' }
          ]
        }
      ],
      forceTable: { name: '强制表', rows: [] }
    };
  }

  /* 空白新项目（门户"创建新项目"用）：
     只带设备和一个空的 OB1，不含示例程序 / 变量 / 监控表 */
  function blankProject(name) {
    var p = newProject(name);
    p.tags = [];
    p.blocks = [{
      name: 'OB1', lang: 'LAD', obNumber: 1, type: 'OB',
      desc: '主程序（循环执行）',
      title: 'Main Program Sweep (Cycle)',
      comment: '',
      networks: [{ title: '', columns: [{ branches: [[]] }] }]
    }];
    p.watchTables = [];
    p.forceTable = { name: '强制表', rows: [] };
    return p;
  }

  /* ================= 启动 ================= */
  // 兼容旧工程：清理历史遗留的 EMPTY 占位节点
  // 早期版本删除元件后会在结构里留 {type:'EMPTY'}，现在统一改成空分支 []
  function migrateProject(project) {
    if (!project) return project;
    var changed = false;

    (project.blocks || []).forEach(function (b) {
      if (!b.networks) return;
      b.networks.forEach(function (net) {
        if (!net.columns) return;
        net.columns.forEach(function (col) {
          if (!col.branches) return;
          col.branches = col.branches.map(function (br) {
            var filtered = br.filter(function (el) {
              if (el && el.type === 'EMPTY') { changed = true; return false; }
              return true;
            });
            return filtered;
          });
          if (col.branches.length === 0) col.branches = [[]];
          // 定时器/计数器的设定值统一成 T#… 规范写法
          // （旧工程里可能存成 "5s"，既不显示 T#，旧内核还会解析成 5ms）
          col.branches.forEach(function (br) {
            br.forEach(function (el) {
              if (!el || !el.params) return;
              ['PT', 'ET', 'PV', 'CV'].forEach(function (k) {
                var v = el.params[k];
                if (v === undefined || v === '' || typeof v !== 'string') return;
                // PT/ET 一定是时间；PV/CV 只有写成带单位的时间才处理（避免把计数 10 变成 T#10ms）
                if (k !== 'PT' && k !== 'ET' && !/[a-z]/i.test(v)) return;
                if (PLC.isTimeLiteral && PLC.isTimeLiteral(v)) {
                  var nn = PLC.normTime(v);
                  if (nn && nn !== v) { el.params[k] = nn; changed = true; }
                }
              });
            });
          });
        });
      });
    });

    if (changed) {
      // 顺手把项目里 devices 字段补齐（旧工程没有）
      if (!project.devices && project.device) {
        project.devices = [{
          name: project.device.name, type: project.device.type,
          orderNo: project.device.orderNo, version: project.device.fw,
          family: 'S7-1200', modules: []
        }];
      }
    }
    return project;
  }

  function enterProject(project) {
    // 进入前先做一次旧数据迁移
    project = migrateProject(project);
    App.project = project;
    App.online = false;
    App.running = false;
    App.monitor = false;
    if (App.scanTimer) { clearInterval(App.scanTimer); App.scanTimer = null; }
    App.plc = new PLC.SoftPLC();
    syncTagsToPlc();
    App.openTabs = [];
    App.activeTab = null;
    App.selNet = 0;
    App.selEl = null;
    App.diags = [];

    App.treeOpen = null;
    App.treeNodes = null;
    App.selectedNode = null;
    refreshTreeData();
    renderTree();
    renderTabs();
    renderEditor();
    renderStatus();
    updateTitle();

    // 打开第一个块
    if (App.project.blocks && App.project.blocks.length) {
      openTab('block', App.project.blocks[0]);
    }

    startAutoSave();

    // 初次编译填充诊断面板
    setTimeout(function () {
      var diags = PLC.compileProject(App.project);
      App.diags = diags;
      renderDiagPanel();
      APP_renderTreeBadges();
      renderEditor();
    }, 80);
  }

  // 应用外壳只绑定一次
  var shellBound = false;
  function ensureShell() {
    if (shellBound) return;
    shellBound = true;
    bindShell();
    switchInspect('diag');
  }

  function updateTitle() {
    var d = $('#titleDoc');
    if (!d) return;
    var dirty = App.openTabs.some(function (t) { return t.dirty; });
    var base = 'DONGENS';
    if (App.project) {
      base += '  -  ' + (App.project.path || App.project.name || '');
    }
    d.textContent = base + (dirty ? '   ●' : '');
    d.style.color = dirty ? '#ffd69a' : '';
  }

  // 自动保存：有改动时每 4 秒落一次盘（避免忘记保存丢工作）
  function startAutoSave() {
    if (App.autoSaveTimer) return;
    App.autoSaveTimer = setInterval(function () {
      if (!App.project) return;
      var dirty = App.openTabs.some(function (t) { return t.dirty; });
      if (!dirty) return;
      var r = ProjectStore.save(App.project);
      if (r.ok) {
        App.openTabs.forEach(function (t) { t.dirty = false; });
        renderTabs();
        updateTitle();
        var sb = $('#statusbar');
        if (sb) {
          var note = sb.querySelector('.autosave-note');
          if (!note) {
            note = document.createElement('span');
            note.className = 'seg autosave-note';
            note.style.color = '#2a7';
            sb.appendChild(note);
          }
          note.textContent = '✔ 已自动保存 ' + ProjectStore.nowStr().slice(11);
        }
      }
    }, 4000);
  }

  /* ================= 菜单 ================= */
  var MENUS = {
    '项目': [
      ['新建项目...', 'Ctrl+N', 'newProject'],
      ['打开项目...', 'Ctrl+O', 'openProject'],
      ['保存项目', 'Ctrl+S', 'saveProject'],
      ['另存为文件（导出 .dongens.json）', '', 'saveAsFile'],
      ['-'],
      ['导出为 XML（DongensML）', '', 'exportXml'],
      ['-'],
      ['关闭项目并返回启动页', '', 'closeProject'],
      ['退出', '', 'closeProject']
    ],
    '编辑': [
      ['撤销', 'Ctrl+Z', null],
      ['恢复', 'Ctrl+Y', null],
      ['-'],
      ['全选', 'Ctrl+A', null],
      ['查找', 'Ctrl+F', null]
    ],
    '视图': [
      ['门户视图', '', 'viewPortal'],
      ['项目视图', '', 'viewProject'],
      ['-'],
      ['开启/关闭监视', 'Ctrl+M', 'toggleMonitor'],
      ['显示巡视窗口', '', 'toggleInspector'],
      ['-'],
      ['显示 / 隐藏指令面板', '', 'toggleInstrPanel']
    ],
    '插入': [
      ['组织块 OB', '', 'addOB'],
      ['功能块 FB', '', 'addFB'],
      ['函数 FC', '', 'addFC'],
      ['数据块 DB', '', 'addDB'],
      ['-'],
      ['变量表', '', 'addTagTable'],
      ['监控表', '', 'addWatch']
    ],
    '在线': [
      ['下载到设备', 'Ctrl+L', 'download'],
      ['编译 → 软件（全部重建）', '', 'compile'],
      ['-'],
      ['转到在线', '', 'goOnline'],
      ['转到离线', '', 'goOffline'],
      ['-'],
      ['启动 CPU (RUN)', '', 'cpuRun'],
      ['停止 CPU (STOP)', '', 'cpuStop'],
      ['存储器复位', '', 'cpuReset']
    ],
    '选项': [
      ['设置...', '', 'settings'],
      ['-'],
      ['读取信息', '', null]
    ],
    '工具': [
      ['监控表/强制表', '', 'addWatch'],
      ['-'],
      ['导出诊断报告', '', 'exportReport']
    ],
    '帮助': [
      ['关于本仿真器', '', 'about'],
      ['DSI Platform 快捷键', '', 'helpKeys']
    ]
  };

  function buildMenus() {
    var bar = $('#menubar');
    bar.innerHTML = '';
    Object.keys(MENUS).forEach(function (name) {
      var d = document.createElement('div');
      d.className = 'menu';
      d.textContent = name;
      d.dataset.menu = name;
      bar.appendChild(d);
    });
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'spacer' }));

    // 下拉容器
    var dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.id = 'dropdown';
    document.body.appendChild(dd);

    bar.addEventListener('click', function (e) {
      var m = e.target.closest('.menu');
      if (!m) return;
      openMenu(m.dataset.menu, m);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.menu') && !e.target.closest('.dropdown')) closeMenu();
    });
  }

  function openMenu(name, anchor) {
    var dd = $('#dropdown');
    var items = MENUS[name] || [];
    dd.innerHTML = '';
    var rect = anchor.getBoundingClientRect();
    dd.style.left = rect.left + 'px';
    dd.style.top = '56px';
    items.forEach(function (it) {
      if (it[0] === '-') {
        dd.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
        return;
      }
      var row = document.createElement('div');
      row.className = 'item' + (it[2] ? '' : ' disabled');
      row.innerHTML = '<span>' + esc(it[0]) + '</span><span class="key">' + esc(it[1]) + '</span>';
      if (it[2]) {
        row.addEventListener('click', function () {
          closeMenu();
          runAction(it[2]);
        });
      }
      dd.appendChild(row);
    });
    $$('.menu').forEach(function (m) { m.classList.toggle('open', m === anchor); });
    dd.classList.add('show');
  }

  function closeMenu() {
    $('#dropdown').classList.remove('show');
    $$('.menu').forEach(function (m) { m.classList.remove('open'); });
  }

  /* ================= 动作分发 ================= */
  function runAction(a) {
    switch (a) {
      case 'compile': doCompile(); break;
      case 'download': doDownload(); break;
      case 'goOnline': doGoOnline(); break;
      case 'goOffline': doGoOffline(); break;
      case 'cpuRun': doCpuRun(); break;
      case 'cpuStop': doCpuStop(); break;
      case 'cpuReset': doCpuReset(); break;
      case 'toggleMonitor': doToggleMonitor(); break;
      case 'toggleInspector': toggleInspector(); break;
      case 'toggleInstrPanel':
        var pnl = $('#instrPanel');
        if (pnl && pnl.style.display !== 'none') closeInstrPanel();
        else openInstrPanel();
        break;
      case 'addOB': addBlock('OB'); break;
      case 'addFB': addBlock('FB'); break;
      case 'addFC': addBlock('FC'); break;
      case 'addDB': addBlock('DB'); break;
      case 'addWatch': addWatch(); break;
      case 'addTagTable': openTab('tags', null); break;
      case 'saveProject': saveProject(); break;
      case 'openProject': openProjectPortal(); break;
      case 'newProject':
        // 新建走门户表单（与启动页一致）
        Portal.show('new');
        break;
      case 'exportXml': exportXml(); break;
      case 'exportReport': exportReport(); break;
      case 'about': showAbout(); break;
      case 'helpKeys': showHelp(); break;
      case 'settings': showSettings(); break;
      case 'openSimPanel':
        if (!App.online) {
          toast('请先下载到设备，再打开仿真面板', 'err');
          return;
        }
        openTab('sim', null);
        break;
      case 'viewPortal': openProjectPortal(); break;
      case 'viewProject': toast('已在项目视图'); break;
      case 'saveAsFile': exportProjectFile(); break;
      case 'closeProject':
        if (App.project) saveProject(true);
        Portal.show();
        toast('已保存并返回启动页');
        break;
    }
  }

  /* ================= 工具栏 / 外壳 ================= */
  // 标题栏右侧 ─ ☐ ✕：浏览器里只是装饰；Electron 里接管真窗口控制
  // （无边框窗口没有系统标题栏，这三个按钮就是唯一的窗口控制）
  function bindWinBtns() {
    if (window.tiaWin && window.tiaWin.isDesktop) {
      document.body.classList.add('desktop');
    }
    $$('.win-btns div').forEach(function (d) {
      d.addEventListener('click', function () {
        if (window.tiaWin && window.tiaWin.isDesktop) {
          var t = d.getAttribute('title') || '';
          if (t.indexOf('最小化') === 0) window.tiaWin.min();
          else if (t.indexOf('最大化') === 0) window.tiaWin.max();
          else if (t.indexOf('关闭') === 0) window.tiaWin.close();
        }
      });
    });
    // 双击标题栏空白处 = 最大化/还原（对齐系统标题栏行为）
    var bar = $('.titlebar');
    if (bar) {
      bar.addEventListener('dblclick', function (e) {
        if (window.tiaWin && window.tiaWin.isDesktop && e.target === bar) window.tiaWin.max();
      });
    }
  }

  function bindShell() {
    buildMenus();
    bindWinBtns();

    var tb = $('#toolbar');
    tb.innerHTML =
      tbBtn('💾', '保存', 'save') +
      tbSep() +
      tbBtn('🔨', '编译', 'compile') +
      tbBtn('⬇', '下载', 'download') +
      tbSep() +
      tbBtn('▶', 'RUN', 'run') +
      tbBtn('■', 'STOP', 'stop') +
      tbSep() +
      tbBtn('👁', '监视', 'monitor') +
      tbBtn('🌐', '在线', 'online') +
      tbBtn('🔌', '离线', 'offline') +
      tbSep() +
      tbBtn('🎛', '仿真面板', 'simpanel') +
      tbSep() +
      tbBtn('＋OB', '', 'addOB') +
      tbBtn('＋FB', '', 'addFB') +
      tbBtn('＋FC', '', 'addFC');

    tb.addEventListener('click', function (e) {
      var b = e.target.closest('.tb');
      if (!b) return;
      var k = b.dataset.act;
      var map = {
        save: 'saveProject', compile: 'compile', download: 'download',
        run: 'cpuRun', stop: 'cpuStop', monitor: 'toggleMonitor',
        online: 'goOnline', offline: 'goOffline', addOB: 'addOB', addFB: 'addFB', addFC: 'addFC',
        simpanel: 'openSimPanel'
      };
      if (map[k]) runAction(map[k]);
    });
  }

  function tbBtn(ico, label, act) {
    return '<div class="tb" data-act="' + act + '"><span class="ico">' + ico + '</span>' +
      (label ? '<span class="lbl">' + esc(label) + '</span>' : '') + '</div>';
  }
  function tbSep() { return '<div class="vsep"></div>'; }

  /* ================= 项目树 ================= */
  /* ================= 项目树 ================= */
  // 展开状态：按项目 id + 节点 id 记忆，切项目/重渲染都不丢
  function treeOpenKey() { return 'dongens.treeOpen.' + (App.project ? (App.project.id || 'noid') : 'noid'); }

  function loadTreeState() {
    try {
      var raw = localStorage.getItem(treeOpenKey());
      if (raw) return JSON.parse(raw) || {};
    } catch (e) { }
    // 默认展开：项目 → PLC → 程序块/变量
    return { proj: true, plc: true, blocks: true, variables: true, watchforce: true };
  }

  function saveTreeState(st) {
    try { localStorage.setItem(treeOpenKey(), JSON.stringify(st)); } catch (e) { }
  }

  function renderTree() {
    var p = App.project;
    var tree = $('#treeBody');
    if (!tree) return;
    if (!p) {
      tree.innerHTML = '<div style="padding:16px 12px;color:#9aa;font-size:11px;line-height:1.9">' +
        '尚未打开项目。<br><br>请从启动页选择或新建一个项目。</div>';
      return;
    }

    if (!App.treeOpen) App.treeOpen = loadTreeState();
    if (!App.treeNodes) App.treeNodes = Tree.build(p);

    tree.innerHTML = Tree.render(App.treeNodes, App.treeOpen, { selected: App.selectedNode });
    tree.onclick = onTreeClick;
    tree.ondblclick = onTreeDblClick;
  }

  // 重建树数据（块/变量变化后调用）
  function refreshTreeData() {
    if (App.project) {
      App.treeNodes = Tree.build(App.project);
    }
  }

  function onTreeClick(e) {
    var node = e.target.closest('.node');
    if (!node) return;
    var key = node.dataset.node;
    var expandable = node.dataset.expandable === '1';

    // 点小三角 = 只展开/收起，不打开
    if (e.target.classList.contains('arrow') && expandable) {
      App.treeOpen[key] = !App.treeOpen[key];
      saveTreeState(App.treeOpen);
      renderTree();
      return;
    }

    // 选中
    App.selectedNode = key;
    $$('#treeBody .node').forEach(function (n) { n.classList.remove('selected'); });
    node.classList.add('selected');

    // 可展开节点：单击也展开（TIA 里单击叶子是打开，单击容器是选中）
    var hasChildren = expandable;
    var leafKeys = /^(block:|tags:)/.test(key) ||
      ['devconfig', 'diagnostics', 'watchlist', 'forcelist', 'varsAll',
        'addBlock', 'addDevice', 'devnet', 'proginfo'].indexOf(key) >= 0;

    if (hasChildren && !leafKeys) {
      App.treeOpen[key] = !App.treeOpen[key];
      saveTreeState(App.treeOpen);
      renderTree();
      return;
    }

    openNode(key);
  }

  // 双击 = 打开（对容器节点也能打开其总览）
  function onTreeDblClick(e) {
    var node = e.target.closest('.node');
    if (!node) return;
    var key = node.dataset.node;
    if (/^(block:|tags:)/.test(key) || key === 'watchlist' || key === 'forcelist') {
      openNode(key);
    }
  }

  function openNode(key) {
    if (!App.project) return;
    if (key === 'block:' || key.indexOf('block:') === 0) {
      var name = key.slice(6);
      var blk = App.project.blocks.filter(function (b) { return b.name === name; })[0];
      if (blk) openTab('block', blk);
      return;
    }
    if (key.indexOf('tags:') === 0) { openTab('tags', App.project.tags); return; }
    if (key === 'watchlist') {
      if (!App.project.watchTables.length) addWatch(true);
      openTab('watch', App.project.watchTables[0]);
      return;
    }
    if (key === 'forcelist') { openTab('force', App.project.forceTable); return; }
    if (key === 'diagnostics') { openTab('diag', null); return; }
    if (key === 'devconfig') { openTab('devconfig', App.project.device); return; }
    if (key === 'blocks') { openTab('blockov', null); return; }
    if (key === 'variables' || key === 'varsAll') { openTab('tags', App.project.tags); return; }
    if (key === 'addBlock') { addBlock('FB'); return; }
    if (key === 'addDevice') { toast('添加新设备：本仿真器只支持单个 CPU，暂不支持多设备'); return; }
    if (key === 'devnet') { toast('设备和网络视图未实现（本仿真器无总线组态）'); return; }
    if (key === 'proginfo') { openTab('blockov', null); return; }
    if (key === 'sysblocks' || key === 'techobj' || key === 'extsrc' ||
      key === 'datatypes' || key === 'onlinebackup' || key === 'traces' ||
      key === 'opcua' || key === 'alarmtext' || key === 'localmod' ||
      key === 'ungrouped' || key === 'security' || key === 'crossdev' || key === 'common') {
      toast('「' + key + '」在真实 TIA 里有内容，本仿真器暂未实现');
      return;
    }
  }

  /* ================= 标签页 ================= */
  function openTab(kind, ref) {
    var id = kind + ':' + (ref ? (ref.name || ref.id || 'x') : 'new');
    var exist = App.openTabs.filter(function (t) { return t.id === id; })[0];
    if (!exist) {
      var titles = {
        block: ref ? ref.name : '块', tags: 'PLC 变量表', watch: ref ? ref.name : '监控表',
        force: '强制表', diag: '在线和诊断', devconfig: '设备组态', blockov: '程序块',
        sim: '仿真 · 外部接线图'
      };
      exist = { id: id, kind: kind, ref: ref, title: titles[kind] || kind, dirty: false };
      App.openTabs.push(exist);
    }
    App.activeTab = exist;
    renderTabs();
    renderEditor();
  }

  function closeTab(id) {
    App.openTabs = App.openTabs.filter(function (t) { return t.id !== id; });
    if (App.activeTab && App.activeTab.id === id) {
      App.activeTab = App.openTabs[App.openTabs.length - 1] || null;
    }
    renderTabs();
    renderEditor();
  }

  function renderTabs() {
    var bar = $('#tabs');
    bar.innerHTML = '';
    App.openTabs.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'tab' + (App.activeTab === t ? ' active' : '');
      d.innerHTML = '<span>' + esc(t.title) + '</span>' +
        (t.dirty ? '<span class="dirty">●</span>' : '') +
        '<span class="close">✕</span>';
      d.addEventListener('click', function (e) {
        if (e.target.classList.contains('close')) { closeTab(t.id); return; }
        App.activeTab = t;
        renderTabs(); renderEditor();
      });
      bar.appendChild(d);
    });
    updateTitle();
  }

  /* ================= 编辑器调度 ================= */
  function renderEditor() {
    var area = $('#editorArea');
    // 设备组态页需要占满高度（内部有可拖拽面板），其他页面恢复滚动
    area.classList.remove('devcfg-mode');
    area.classList.remove('lad-mode');
    area.classList.remove('sim-mode');
    document.body.classList.remove('devcfg');
    if (!App.activeTab) {
      area.innerHTML = '<div class="empty-state"><div class="big">📂</div>' +
        '<div>在左侧项目树中打开块、变量表或监控表</div>' +
        '<div style="font-size:11px;color:#aaa">提示：双击 OB1 开始编辑梯形图</div></div>';
      return;
    }
    var t = App.activeTab;
    switch (t.kind) {
      case 'block': renderBlockEditor(t); break;
      case 'tags': renderTagTable(); break;
      case 'watch': renderWatchTable(t.ref); break;
      case 'force': renderForceTable(t.ref); break;
      case 'diag': renderDiagnostics(); break;
      case 'devconfig': renderDevConfig(); break;
      case 'blockov': renderBlockOverview(); break;
      case 'sim': renderSimPanel(); break;
    }
    renderStatus();
  }

  /* ================= 块编辑器（LAD / SCL） ================= */
  function renderBlockEditor(tab) {
    var blk = tab.ref;
    var area = $('#editorArea');
    var isLad = blk.lang === 'LAD';
    var head =
      '<div class="blk-head">' +
      '<span class="bh-name">' + esc(blk.name) + '</span>' +
      '<span class="bh-desc">' + esc(blk.desc || '') + '</span>' +
      '<span style="flex:1"></span>' +
      '<span class="bh-meta">语言：' + (isLad ? 'LAD（梯形图）' : 'SCL（结构化控制语言）') + '</span>' +
      '<span class="bh-btn" id="btnCompileBlk">编译此块</span>' +
      '<span class="bh-btn" id="btnToggleLang">切换为 ' + (isLad ? 'SCL' : 'LAD') + '</span>' +
      '</div>';

    if (isLad) {
      area.classList.add('lad-mode');
      // 渲染前先归一化老数据：
      //   · 老的"空并联分支"→ 开放分支（避免画成空闭合环）
      //   · 主线里残留的 OPEN_END → 清掉（避免主干导线中间冒箭头）
      if (typeof LadEdit !== 'undefined' && LadEdit.normalize) {
        if (LadEdit.normalize(blk)) tab.dirty = true;
      }
      area.innerHTML = '<div class="lad-editor-root">' +
        '<div class="lad-head-zone" id="ladHeadZone">' + head +
        '<div class="favbar-host" id="favbarHost"></div>' +
        (typeof BlockHeader !== 'undefined' ? BlockHeader.render(blk, {}) : '') +
        '</div>' +
        '<div class="head-splitter" id="headSplitter"' +
        ' title="按住拖动，调节块头区与梯形图区的高度（双击复位）"></div>' +
        '<div class="lad-scroll">' +
        LAD.renderBlock(blk, {
          online: App.online && App.monitor,
          trace: App.plc.trace,
          selNet: App.selNet,
          selEl: null,
          selSeg: App.selSeg || null,
          // FB 实例名重复集合：重名的 %DB 头部整段标红
          dupInst: (typeof LadEdit !== 'undefined' && LadEdit.dupInstMap) ? LadEdit.dupInstMap() : null,
          // 正在拖开口箭头：把落点信息传给渲染层（画那排小方块 + 绿色高亮）
          dragArrow: (function () {
            var st = (typeof LadEdit !== 'undefined') ? LadEdit.state : null;
            if (!st) return null;
            if (st.dragArrow) return st.dragArrow;
            // 选中了某个开口箭头：也把那排小方块画出来（对齐 TIA，
            // 让人一眼看到可以拖到哪里合并）
            if (st.selId && st.blk && LadEdit.locate && LadEdit.isOpenBranch) {
              var loc = LadEdit.locate(st.blk, st.selId);
              if (loc && loc.branch > 0 && LadEdit.isOpenBranch(loc.arr)) {
                return {
                  net: loc.net, target: null,
                  src: { net: loc.net, col: loc.col, row: loc.branch }
                };
              }
            }
            return null;
          })()
        }) + '</div>';   // /lad-scroll

      // 块标题 / 注释：就地编辑
      if (typeof BlockHeader !== 'undefined') {
        BlockHeader.bind(blk, {
          onDirty: function () { tab.dirty = true; renderTabs(); updateTitle(); },
          onChange: function (field, v) {
            // 标题/注释改了，刷新树与标签页显示
            refreshTreeData();
            renderTree();
            if (field === 'title' && v) {
              tab.title = blk.name;
            }
          },
          onLiveChange: function (field, v) {
            if (field === 'title') {
              var bh = $('.bh-desc');
              if (bh) bh.textContent = blk.desc || '';
            }
          }
        });
      }

      // 收藏夹工具栏（块标题上方，固定）
      if (typeof FavBar !== 'undefined') {
        FavBar.render($('#favbarHost'), {
          onInsert: function (type) {
            LadEdit.appendInstruction(type);
          },
          onBranch: function (kind) {
            // 第一个图标：插入开放分支（右端悬空、末端带开口箭头）
            // 第二个图标：关闭分支 —— 把当前开放分支向上汇合回主线（对齐 TIA「关闭分支」）
            if (kind === 'OPEN_BRANCH_UP') LadEdit.closeBranch();
            else LadEdit.addOpenBranch('down');
          },
          onDropInsert: function (type, pt) {
            var pos = LadEdit.dropPosAt(pt);
            if (pos) LadEdit.insertInstruction(type, pos);
          },
          onChanged: function () {
            // 选中状态变了，让 Delete 键归属正确
          }
        });
      }

      // 交给 LadEdit 接管交互
      LadEdit.setTags(App.project.tags);
      LadEdit.setCurrentNet(App.selNet || 0);
      LadEdit.setCallbacks({
        onRerender: function () { renderBlockEditor(tab); },
        onSelNet: function (n) { App.selNet = n; LadEdit.setCurrentNet(n); },
        onSelect: function (id) { App.selEl = id; renderProps(); },
        onSelSeg: function (seg) {
          // 线段选中状态同步到 App，重绘时才能保持高亮
          App.selSeg = seg;
        },
        onTagsChanged: function () {
          // 内联编辑自动创建了变量：同步到工程、刷新树与变量表
          LadEdit.setTags(App.project.tags);
          saveProject();
          refreshTreeData();
          renderTree();
          if (App.activeTab && App.activeTab.kind === 'tags') renderEditor();
        }
      });
      LadEdit.mount(blk, tab, { selId: App.selEl });
      // 重绘后恢复线段选中态
      LadEdit.state.selSeg = App.selSeg || null;
      if (App.selEl) LadEdit.setSelection(App.selEl);
      // 闭合 lad-editor-root
      var rootEl = area.querySelector('.lad-editor-root');
      if (rootEl) { /* 结构已由上面的字符串拼好，这里只需确认存在 */ }
      applyHeadZone();   // 重绘后恢复块头区高度（拖分界线调过的）
    } else {
      area.innerHTML = head + renderSclEditor(blk);
      bindSclEvents(blk, tab);
    }

    var bc = $('#btnCompileBlk');
    if (bc) bc.onclick = function () { doCompile(); };
    var tl = $('#btnToggleLang');
    if (tl) tl.onclick = function () { toggleBlockLang(blk, tab); };
  }

  function toggleBlockLang(blk, tab) {
    if (blk.lang === 'LAD') {
      // LAD -> SCL：生成等价骨架
      blk.lang = 'SCL';
      blk.source = generateSclFromLad(blk);
      blk.desc = (blk.desc || '') + '（已转换为 SCL）';
    } else {
      blk.lang = 'LAD';
      if (!blk.networks) blk.networks = [{ title: '', columns: [{ branches: [[{ id: uid(), type: 'COIL', operand: 'Q0.0', addr: 'Q0.0' }]] }] }];
    }
    tab.dirty = true;
    LAD && renderEditor();
    toast('已切换为 ' + blk.lang + ' 语言');
  }

  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }

  function generateSclFromLad(blk) {
    var lines = ['// 由 LAD 自动转换的 SCL 骨架', 'VAR', 'END_VAR', 'BEGIN'];
    (blk.networks || []).forEach(function (n, i) {
      lines.push('  // ' + (n.title || ('网络 ' + (i + 1))));
      var col = n.columns;
      // 简单拼接所有触点条件
      var conds = [];
      (col[0] ? col[0].branches : []).forEach(function (br) {
        var parts = br.filter(function (e) { return ['NO', 'NC'].indexOf(e.type) >= 0; })
          .map(function (e) { return (e.type === 'NC' ? 'NOT ' : '') + '"' + e.operand + '"'; });
        if (parts.length) conds.push('(' + parts.join(' AND ') + ')');
      });
      // 找线圈
      var coil = null;
      col.forEach(function (c) {
        c.branches.forEach(function (br) {
          br.forEach(function (e) { if (['COIL', 'SET', 'RESET'].indexOf(e.type) >= 0) coil = e; });
        });
      });
      if (coil) {
        lines.push('  "' + coil.operand + '" := ' + (conds.length ? conds.join(' OR ') : 'TRUE') + ';');
      }
    });
    lines.push('END_FUNCTION_BLOCK');
    return lines.join('\n');
  }

  function renderSclEditor(blk) {
    return '<div class="scl-editor">' +
      '<div class="scl-bar"><span>语法：SCL</span><span style="color:#888">|</span>' +
      '<span id="scl-lines">行数：' + blk.source.split('\n').length + '</span>' +
      '<span style="flex:1"></span>' +
      '<span style="color:#888">Ctrl+Enter 编译</span></div>' +
      '<div class="code-area" id="codeArea">' +
      '<pre id="hl" aria-hidden="true"></pre>' +
      '<textarea id="sclTa" spellcheck="false"></textarea>' +
      '</div></div>';
  }

  function highlightScl(src) {
    // 简单高亮：注释 / 字符串 / 关键字 / 数字 / 地址
    var kwRe = /\b(IF|THEN|ELSIF|ELSE|END_IF|FOR|TO|BY|DO|END_FOR|WHILE|END_WHILE|REPEAT|UNTIL|END_REPEAT|RETURN|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_STAT|END_VAR|BEGIN|END|AND|OR|XOR|NOT|MOD|TRUE|FALSE|FUNCTION_BLOCK|FUNCTION|END_FUNCTION_BLOCK|END_FUNCTION|FUNCTION_BLOCK)\b/;
    var out = '';
    var lines = src.split('\n');
    lines.forEach(function (line, li) {
      var res = '';
      var i = 0;
      while (i < line.length) {
        // 注释
        if (line[i] === '/' && line[i + 1] === '/') {
          res += '<span class="tk-cmt">' + esc(line.slice(i)) + '</span>';
          i = line.length; break;
        }
        if (line[i] === '(' && line[i + 1] === '*') {
          var end = line.indexOf('*)', i + 2);
          if (end < 0) end = line.length;
          res += '<span class="tk-cmt">' + esc(line.slice(i, end + 2)) + '</span>';
          i = end + 2; continue;
        }
        // 字符串
        if (line[i] === "'") {
          var e2 = line.indexOf("'", i + 1);
          if (e2 < 0) e2 = line.length - 1;
          res += '<span class="tk-str">' + esc(line.slice(i, e2 + 1)) + '</span>';
          i = e2 + 1; continue;
        }
        // 引号地址 "xxx"
        if (line[i] === '"') {
          var e3 = line.indexOf('"', i + 1);
          if (e3 < 0) e3 = line.length - 1;
          res += '<span class="tk-addr">' + esc(line.slice(i, e3 + 1)) + '</span>';
          i = e3 + 1; continue;
        }
        // 数字
        if (/[0-9]/.test(line[i])) {
          var j = i;
          while (j < line.length && /[0-9._]/.test(line[j])) j++;
          res += '<span class="tk-num">' + esc(line.slice(i, j)) + '</span>';
          i = j; continue;
        }
        // 标识符
        if (/[A-Za-z_]/.test(line[i])) {
          var k = i;
          while (k < line.length && /[A-Za-z0-9_.]/.test(line[k])) k++;
          var word = line.slice(i, k);
          if (kwRe.test(word)) res += '<span class="tk-kw">' + esc(word) + '</span>';
          else if (/^(TON|TOF|CTU|CTD|ABS|MIN|MAX|SQR)$/i.test(word)) res += '<span class="tk-fb">' + esc(word) + '</span>';
          else res += esc(word);
          i = k; continue;
        }
        res += esc(line[i]);
        i++;
      }
      out += res + '\n';
    });
    return out;
  }

  function bindSclEvents(blk, tab) {
    var ta = $('#sclTa');
    var pre = $('#hl');
    if (!ta) return;
    ta.value = blk.source;
    pre.innerHTML = highlightScl(blk.source);

    function sync() {
      pre.innerHTML = highlightScl(ta.value);
      var ln = ta.value.split('\n').length;
      var el2 = $('#scl-lines');
      if (el2) el2.textContent = '行数：' + ln;
      pre.style.width = ta.scrollWidth + 'px';
    }
    sync();

    ta.addEventListener('input', function () {
      blk.source = ta.value;
      tab.dirty = true;
      sync();
      renderTabs();
    });
    ta.addEventListener('scroll', function () {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      pre.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        blk.source = ta.value; tab.dirty = true; sync();
      }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); doCompile(); }
    });
    pre.style.position = 'absolute';
    sync();
  }

  /* ================= 变量表 ================= */
  var DATATYPES = ['Bool', 'Byte', 'Word', 'DWord', 'Int', 'DInt', 'Real', 'LReal',
    'Time', 'Date', 'Char', 'String'];

  // 地址布局：决定某数据类型占多少位
  function addrStep(datatype) {
    switch (datatype) {
      case 'Bool': return { bits: 1 };
      case 'Byte': case 'Char': return { bits: 8 };
      case 'Word': case 'Int': case 'Date': return { bits: 16 };
      case 'DWord': case 'DInt': case 'Real': case 'Time': return { bits: 32 };
      case 'LReal': return { bits: 64 };
      case 'String': return { bits: 32 };
      default: return { bits: 1 };
    }
  }

  // 把地址拆成 {area, byte, bit}
  function splitAddr(addr) {
    if (!addr) return null;
    var s = String(addr).trim();
    var m = /^(I|Q|M)([BWD]?)(\d+)(?:\.(\d+))?$/i.exec(s);
    if (!m) return null;
    return {
      area: m[1].toUpperCase(),
      size: (m[2] || 'X').toUpperCase(),
      byte: +m[3],
      bit: m[4] === undefined ? 0 : +m[4]
    };
  }

  function joinAddr(a) {
    if (!a) return '';
    if (a.size === 'X') return a.area + a.byte + '.' + (a.bit || 0);
    return a.area + a.size + a.byte;
  }

  // 在给定地址基础上，按数据类型推进一位
  // 规则（对齐 TIA 的直觉行为）：
  //   Bool     : M1.0 -> M1.1 ... M1.7 -> M2.0
  //   Byte/Word/DWord : MB1 -> MB2 / MW2 -> MW4（按字节步进）
  function nextAddress(baseAddr, datatype) {
    var a = splitAddr(baseAddr);
    if (!a) return '';
    var step = addrStep(datatype);

    if (datatype === 'Bool' || a.size === 'X') {
      var bit = (a.bit || 0) + 1;
      var byte = a.byte;
      if (bit > 7) { bit = 0; byte += 1; }
      return a.area + byte + '.' + bit;
    }
    // 字/双字类：按字节推进
    var bytes = step.bits / 8;
    if (bytes < 1) bytes = 1;
    var newByte = a.byte + bytes;
    var sizeChar = { 8: 'B', 16: 'W', 32: 'D' }[step.bits] || 'B';
    return a.area + sizeChar + newByte;
  }

  // 新变量的地址：取「上一个变量」的地址推进一位（这是你要的仿原版行为）
  function suggestAddrFromPrev(tags) {
    if (!tags.length) return 'M0.0';
    var last = tags[tags.length - 1];
    var nx = nextAddress(last.address, last.datatype);
    if (nx) return nx;
    // 上一个地址不合法时，兜底找 M 区最大值
    return fallbackAddr(tags);
  }

  function fallbackAddr(tags) {
    var usedQ = [], usedI = [], usedM = [];
    tags.forEach(function (t) {
      var a = splitAddr(t.address);
      if (!a) return;
      var abs = a.byte * 8 + (a.bit || 0);
      if (a.area === 'I') usedI.push(abs);
      if (a.area === 'Q') usedQ.push(abs);
      if (a.area === 'M') usedM.push(abs);
    });
    var n = usedM.length ? Math.max.apply(null, usedM) + 1 : 0;
    return 'M' + Math.floor(n / 8) + '.' + (n % 8);
  }

  /* ---- 变量表：行选中 / 删除（行号点击、右键菜单、Delete 键共用） ---- */
  function selectTagRow(tr) {
    $$('#editorArea .tag-grid tr').forEach(function (r) { r.classList.remove('sel'); });
    if (tr) tr.classList.add('sel');
  }

  // 遍历所有程序块，把对变量 name 的符号引用清掉
  // 返回被清理的引用数
  function scrubTagRefs(name) {
    if (!name) return 0;
    var n = 0;
    (App.project.blocks || []).forEach(function (blk) {
      (blk.networks || []).forEach(function (net) {
        (net.columns || []).forEach(function (col) {
          (col.branches || []).forEach(function (br) {
            (br || []).forEach(function (el) {
              if (!el) return;
              // 触点/线圈：符号名和地址一起清掉，回到未命名占位 <??.?> 状态
              if (el.operand === name) { el.operand = ''; el.addr = ''; n++; }
              if (el.operand2 === name) { el.operand2 = ''; el.addr2 = ''; n++; }
              // 旧版字段兜底
              if (el.src1 === name) { el.src1 = ''; n++; }
              if (el.src2 === name) { el.src2 = ''; n++; }
              if (el.dest === name) { el.dest = ''; n++; }
              // 盒式指令参数（TON 的 IN、ADD 的 IN1/OUT 等）：清空参数
              if (el.params) {
                Object.keys(el.params).forEach(function (k) {
                  if (String(el.params[k]).trim() === name) { el.params[k] = ''; n++; }
                });
              }
            });
          });
        });
      });
    });
    return n;
  }

  function deleteSelectedTag() {
    var tr = $('#editorArea .tag-grid tr.sel');
    if (!tr || tr.dataset.tag == null) return;
    var i = +tr.dataset.tag;
    // 用户变量排在合并数组最前面，data-tag 下标即 App.project.tags 下标
    var tags = App.project.tags;
    var t = tags[i];
    if (!t) return;
    var name = t.name;
    tags.splice(i, 1);

    // 同步清理程序块里对该变量的引用：触点/线圈/参数全部回到未命名状态，
    // 否则程序块里会残留旧符号名或旧地址
    var nRef = scrubTagRefs(name);

    App.activeTab.dirty = true;
    renderTagTable();
    syncTagsToPlc();
    refreshTreeData();
    renderTree();
    // 块编辑器正打开时立即重绘（切回页签时本来也会重绘）
    if (App.activeTab && App.activeTab.kind === 'block' && window.LadEdit) {
      try { LadEdit.rerender({ keepScroll: true }); } catch (e) { }
    }
    toast('已删除变量 ' + (name || '') + (nRef ? '，并清除程序块中 ' + nRef + ' 处引用' : ''));
  }

  // Delete 键删除选中行（只绑一次；输入框/下拉框聚焦时不触发）
  var tagDelKeyBound = false;
  function bindTagDelKey() {
    if (tagDelKeyBound) return;
    tagDelKeyBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Delete') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable)) return;
      var tr = $('#editorArea .tag-grid tr.sel');
      if (!tr) return;
      e.preventDefault();
      deleteSelectedTag();
    });
  }

  function renderTagTable() {
    var userTags = App.project.tags;
    // 系统时钟存储器启用时，变量表里会自动多出 8 个时钟位（与真机一致）
    var dev = App.project.device || {};
    var cm = dev.clockMemory || { enabled: false, byte: 0 };
    var sm = dev.systemMemory || { enabled: false, byte: 1 };
    var clockTags = cm.enabled ? PLC.SoftPLC.getClockTagList(cm.byte) : [];
    var sysTags = sm.enabled ? PLC.SoftPLC.getSystemTagList(sm.byte) : [];
    var tags = userTags.concat(sysTags).concat(clockTags);

    var h = '<div class="tag-head">' +
      '<span class="th-title">默认变量表</span>' +
      '<span class="th-count">' + tags.length + ' 个变量' +
      (clockTags.length ? '（含 ' + clockTags.length + ' 个系统时钟位）' : '') + '</span>' +
      '<span style="flex:1"></span>' +
      '<span class="lb" id="addTag">＋ 新建变量</span>' +
      '</div>';

    h += '<table class="grid tag-grid"><thead><tr>' +
      '<th style="width:38px"></th><th style="width:180px">名称</th>' +
      '<th style="width:120px">数据类型</th><th style="width:110px">地址</th>' +
      '<th style="width:90px">保持性</th><th>注释</th></tr></thead><tbody>';

    tags.forEach(function (t, i) {
      // 系统存储器位 / 时钟位：只读行，带特殊底色标记
      if (t.isClock || t.isSystem) {
        h += '<tr class="clock-row" data-clock="1">';
        h += '<td class="num">' + (i + 1) + '</td>';
        h += '<td style="color:#0a7a8c;font-weight:600">' + esc(t.name) + '</td>';
        h += '<td>Bool</td>';
        h += '<td style="font-family:Consolas;color:#0a7a8c;font-weight:600">' + esc(t.address) + '</td>';
        h += '<td>非保持</td>';
        h += '<td style="color:#666">' + esc(t.comment || '') + '</td>';
        h += '</tr>';
        return;
      }

      h += '<tr data-tag="' + i + '">';
      h += '<td class="num">' + (i + 1) + '</td>';
      h += '<td class="editable" data-f="name">' + esc(t.name) + '</td>';

      // 数据类型：下拉框
      h += '<td><select class="cell-sel" data-f="datatype" data-idx="' + i + '">';
      DATATYPES.forEach(function (dt) {
        h += '<option value="' + dt + '"' + (dt === t.datatype ? ' selected' : '') + '>' + dt + '</option>';
      });
      h += '</select></td>';

      // 地址：可编辑输入 + 自绘下拉（不用 datalist，选项太多时不可靠）
      h += '<td class="addr-cell">';
      h += '<div class="addr-wrap">';
      h += '<input class="cell addr-input" data-f="address" data-idx="' + i +
        '" value="' + esc(t.address) + '" style="font-family:Consolas">';
      h += '<span class="addr-dd-btn" data-idx="' + i + '" title="选择地址">▾</span>';
      h += '</div>';
      h += '</td>';

      h += '<td><select class="cell-sel" data-f="retain" data-idx="' + i + '">' +
        '<option' + (t.retain ? '' : ' selected') + '>非保持</option>' +
        '<option' + (t.retain ? ' selected' : '') + '>保持</option></select></td>';
      h += '<td class="editable" data-f="comment">' + esc(t.comment || '') + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';

    // 地址候选改用自绘下拉（见 addrDropdown）

    $('#editorArea').innerHTML = h;

    // 新建变量：地址取上一个用户变量推进一位（时钟位不参与）
    $('#addTag').onclick = function () {
      var last = userTags[userTags.length - 1];
      var dt = last ? last.datatype : 'Bool';
      var addr = suggestAddrFromPrev(userTags);
      userTags.push({
        name: 'Tag_' + (userTags.length + 1),
        address: addr,
        datatype: dt,
        comment: '',
        retain: false
      });
      App.activeTab.dirty = true;
      renderTagTable();
      syncTagsToPlc();
      refreshTreeData();
      renderTree();
      toast('已新增变量，地址 ' + addr);
    };

    // 数据类型下拉：切换后若地址与新类型不匹配，自动给出建议地址
    $$('#editorArea .cell-sel[data-f="datatype"]').forEach(function (sel) {
      sel.onchange = function () {
        var i = +sel.dataset.idx;
        userTags[i].datatype = sel.value;
        // 类型变化时重算该行地址（保持区间，按新宽度对齐）
        var a = splitAddr(tags[i].address);
        if (a) {
          var step = addrStep(sel.value);
          var sizeChar = { 1: 'X', 8: 'B', 16: 'W', 32: 'D', 64: 'D' }[step.bits] || 'X';
          tags[i].address = joinAddr({
            area: a.area, size: sizeChar,
            byte: a.byte, bit: sizeChar === 'X' ? (a.bit || 0) : 0
          });
        }
        App.activeTab.dirty = true;
        renderTagTable();
        syncTagsToPlc();
      };
    });

    // 保持性下拉
    $$('#editorArea .cell-sel[data-f="retain"]').forEach(function (sel) {
      sel.onchange = function () {
        userTags[+sel.dataset.idx].retain = (sel.value === '保持');
        App.activeTab.dirty = true;
      };
    });

    // ---- 地址自绘下拉 ----
    $$('#editorArea .addr-dd-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openAddrDropdown(+btn.dataset.idx, btn);
      });
    });

    // 地址输入：回车触发下拉、失焦校验
    $$('#editorArea .addr-input').forEach(function (inp) {
      inp.onchange = function () {
        var i = +inp.dataset.idx;
        var v = inp.value.trim();
        if (v && !PLC.parseAddr(v)) {
          toast('地址格式无效：' + v, 'err');
          inp.value = userTags[i].address;
          return;
        }
        userTags[i].address = v;
        App.activeTab.dirty = true;
        syncTagsToPlc();
      };
      inp.onblur = function () { inp.onchange(); };
    });

    // 名称/注释：单元格内联编辑
    $$('#editorArea td.editable').forEach(function (td) {
      td.addEventListener('click', function () { startCellEdit(td); });
    });

    // 行号点击：选中/取消选中整行（对齐 TIA，系统时钟位行不可选）
    $$('#editorArea .tag-grid td.num').forEach(function (td) {
      td.addEventListener('click', function (e) {
        e.stopPropagation();
        var tr = td.parentNode;
        if (tr.dataset.clock) return;
        if (tr.classList.contains('sel')) selectTagRow(null);
        else selectTagRow(tr);
      });
    });

    // 右键：先选中该行，再弹出菜单删除
    $$('#editorArea .tag-grid tr[data-tag]').forEach(function (tr) {
      tr.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        selectTagRow(tr);
        rMenu(e.clientX, e.clientY, [
          { label: '删除(D)', key: 'Del', cb: deleteSelectedTag }
        ]);
      });
    });

    // Delete 键删除选中行
    bindTagDelKey();
  }

  /* ================= 地址自绘下拉 ================= */
  var addrDdEl = null;

  function closeAddrDropdown() {
    if (addrDdEl && addrDdEl.parentNode) addrDdEl.remove();
    addrDdEl = null;
    document.removeEventListener('click', closeAddrDropdown, true);
  }

  // 生成候选地址：变量表已有的 + I/Q/M 常用位/字地址
  function buildAddrCandidates(filter) {
    var tags = App.project.tags || [];
    var used = {}, tagList = [];
    tags.forEach(function (t) {
      if (t.isClock || t.isSystem) return;
      if (!t.address) return;
      used[t.address] = true;
      tagList.push({ v: t.address, label: t.address, note: t.name, kind: 'tag' });
    });

    var groups = [];
    if (tagList.length) {
      groups.push({ name: '变量表中的地址', items: tagList });
    }

    // 位地址 I/Q/M 0~4 字节
    var bits = [];
    ['I', 'Q', 'M'].forEach(function (area) {
      for (var b = 0; b <= 4; b++) {
        for (var k = 0; k < 8; k++) {
          var a = area + b + '.' + k;
          if (!used[a]) bits.push({ v: a, label: a, kind: 'bit' });
        }
      }
    });
    if (bits.length) groups.push({ name: '位地址', items: bits });

    // 字地址
    var words = [];
    ['I', 'Q', 'M'].forEach(function (area) {
      ['B', 'W', 'D'].forEach(function (sz) {
        [0, 2, 4, 6, 8, 10, 12, 16, 20].forEach(function (b) {
          var a = area + sz + b;
          if (!used[a]) words.push({ v: a, label: a, kind: 'word' });
        });
      });
    });
    if (words.length) groups.push({ name: '字地址', items: words });

    // 过滤
    if (filter) {
      var f = filter.toUpperCase();
      groups = groups.map(function (g) {
        return {
          name: g.name,
          items: g.items.filter(function (it) {
            return it.label.toUpperCase().indexOf(f) >= 0 ||
              (it.note && it.note.toUpperCase().indexOf(f) >= 0);
          })
        };
      }).filter(function (g) { return g.items.length; });
    }
    return groups;
  }

  function openAddrDropdown(idx, anchorEl) {
    closeAddrDropdown();

    var inp = document.querySelector('.addr-input[data-idx="' + idx + '"]');
    if (!inp) return;

    var box = document.createElement('div');
    box.className = 'addr-dd';
    box.id = 'addrDd';

    function renderList(filter) {
      var groups = buildAddrCandidates(filter);
      var h = '';
      if (!groups.length) {
        h = '<div class="add-empty">没有匹配的地址</div>';
      } else {
        groups.forEach(function (g) {
          h += '<div class="add-group">' + esc(g.name) + '</div>';
          g.items.forEach(function (it, i) {
            h += '<div class="add-item" data-val="' + esc(it.v) + '">' +
              '<span class="add-addr">' + esc(it.label) + '</span>' +
              (it.note ? '<span class="add-note">' + esc(it.note) + '</span>' : '') +
              '</div>';
          });
        });
      }
      box.innerHTML =
        '<div class="add-search"><input type="text" id="addSearch" placeholder="输入筛选，如 I0 / MW / 启动"></div>' +
        '<div class="add-list" id="addList">' + h + '</div>';

      var searchEl = box.querySelector('#addSearch');
      if (searchEl) {
        searchEl.value = filter || '';
        searchEl.addEventListener('input', function () {
          renderList(searchEl.value.trim());
          var s2 = box.querySelector('#addSearch');
          if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
        });
        searchEl.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { closeAddrDropdown(); }
          if (e.key === 'Enter') {
            e.preventDefault();
            var first = box.querySelector('.add-item');
            if (first) { pick(first.dataset.val); }
          }
        });
        setTimeout(function () { searchEl.focus(); searchEl.select(); }, 20);
      }

      $$('.add-item', box).forEach(function (item) {
        item.addEventListener('click', function () {
          pick(item.dataset.val);
        });
      });
    }

    function pick(val) {
      inp.value = val;
      var tags = App.project.tags || [];
      // 若该地址在变量表里有对应符号，不需要改符号列（地址与符号各自独立）
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      closeAddrDropdown();
      var tr = inp.closest('tr');
      if (tr) {
        var cells = tr.querySelectorAll('td');
        if (cells[1]) {
          // 视觉反馈：名称列闪一下
          cells[1].style.background = '#e8f4fd';
          setTimeout(function () { cells[1].style.background = ''; }, 400);
        }
      }
      toast('地址已设为 ' + val);
    }

    // 打开时显示全部候选（不拿现有值预筛选，否则只能看到一条）
    renderList('');

    // 定位到输入框下方
    document.body.appendChild(box);
    var r = inp.getBoundingClientRect();
    var bw = box.offsetWidth, bh = box.offsetHeight;
    var left = Math.min(r.left, window.innerWidth - bw - 8);
    var top = r.bottom + 2;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 2);
    box.style.left = Math.max(6, left) + 'px';
    box.style.top = top + 'px';

    addrDdEl = box;
    setTimeout(function () {
      document.addEventListener('click', closeAddrDropdown, true);
    }, 10);
  }
  function startCellEdit(td) {
    if (App.editingCell) return;
    var tr = td.parentElement;
    var idx = +tr.dataset.tag;
    var field = td.dataset.f;
    var old = App.project.tags[idx][field];
    App.editingCell = td;
    var inp = document.createElement('input');
    inp.className = 'cell';
    inp.value = old == null ? '' : old;
    td.textContent = '';
    td.appendChild(inp);
    inp.focus();
    inp.select();

    function commit() {
      if (!App.editingCell) return;
      var v = inp.value.trim();
      App.project.tags[idx][field] = v;
      App.editingCell = null;
      syncTagsToPlc();
      renderTagTable();
      renderTree();
    }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { inp.blur(); }
      if (e.key === 'Escape') { App.editingCell = null; renderTagTable(); }
    });
  }

  function syncTagsToPlc() {
    App.plc.setTags(App.project.tags);
  }
  /* ================= 监控表 ================= */
  function renderWatchTable(wt) {
    if (!wt) return;
    var h = '<div style="padding:6px 10px;background:#fbfbfb;border-bottom:1px solid #e0e0e0;display:flex;align-items:center;gap:10px;font-size:11px">' +
      '<span style="font-weight:700;color:#1a6fa8">' + esc(wt.name) + '</span>' +
      '<span style="color:#666">监视状态：' + (App.monitor && App.online ? '开启' : '关闭') + '</span>' +
      '<span style="flex:1"></span>' +
      '<span class="lb" id="wtAdd" style="padding:3px 10px;border:1px solid #c8c8c8;background:#fafafa;border-radius:2px;cursor:default">＋ 添加行</span>' +
      '<span class="lb" id="wtMon" style="padding:3px 10px;border:1px solid #c8c8c8;background:#fafafa;border-radius:2px;cursor:default">' +
      (App.monitor ? '关闭监视' : '开启监视') + '</span>' +
      '</div>';

    h += '<table class="grid"><thead><tr>' +
      '<th style="width:30px"></th><th style="width:210px">地址</th><th style="width:170px">符号名</th>' +
      '<th style="width:110px">显示格式</th><th style="width:130px">监视值</th><th style="width:110px">修改值</th><th></th></tr></thead><tbody>';

    wt.rows.forEach(function (r, i) {
      var val = App.plc.read(r.address);
      var disp = '—';
      if (val !== undefined) {
        if (r.monitorFormat === 'Bool') disp = val ? 'TRUE' : 'FALSE';
        else disp = String(val);
      }
      var changed = (App.lastValues && App.lastValues[r.address] !== undefined &&
        App.lastValues[r.address] !== val);
      h += '<tr data-wt="' + i + '"><td class="num">' + (i + 1) + '</td>';
      h += '<td class="editable" data-wf="address" style="font-family:Consolas">' + esc(r.address) + '</td>';
      h += '<td class="editable" data-wf="display">' + esc(r.display || '') + '</td>';
      h += '<td class="editable" data-wf="monitorFormat">' + esc(r.monitorFormat || '') + '</td>';
      h += '<td style="font-family:Consolas;font-weight:600;color:' + (changed ? '#c00000' : '#1a6fa8') + '">' + esc(disp) + '</td>';
      h += '<td><input class="cell" data-modify="' + i + '" placeholder="输入后回车" style="font-family:Consolas"></td>';
      h += '<td><span class="lb" data-wdel="' + i + '" style="cursor:default;color:#999">✕</span></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';

    $('#editorArea').innerHTML = h;

    $('#wtAdd').onclick = function () {
      wt.rows.push({ address: 'M0.0', display: '', monitorFormat: 'Bool' });
      renderWatchTable(wt);
    };
    $('#wtMon').onclick = function () { doToggleMonitor(); };

    $$('#editorArea td.editable').forEach(function (td) {
      td.addEventListener('click', function () {
        var tr = td.parentElement;
        var idx = +tr.dataset.wt;
        var field = td.dataset.wf;
        var inp = document.createElement('input');
        inp.className = 'cell';
        inp.value = wt.rows[idx][field] || '';
        td.textContent = '';
        td.appendChild(inp);
        inp.focus(); inp.select();
        inp.addEventListener('blur', function () {
          wt.rows[idx][field] = inp.value.trim();
          renderWatchTable(wt);
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') inp.blur();
          if (e.key === 'Escape') renderWatchTable(wt);
        });
      });
    });

    $$('#editorArea [data-modify]').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var i = +inp.dataset.modify;
        var row = wt.rows[i];
        var v = inp.value.trim();
        if (!v) return;
        var parsed = /^(true|false)$/i.test(v) ? /^true$/i.test(v) : Number(v);
        if (App.plc.write(row.address, parsed)) {
          toast('已写入 ' + row.address + ' = ' + parsed, 'ok');
          inp.value = '';
          refreshLiveValues();
        } else {
          toast('地址无效：' + row.address, 'err');
        }
      });
    });

    $$('#editorArea [data-wdel]').forEach(function (b) {
      b.onclick = function () {
        wt.rows.splice(+b.dataset.wdel, 1);
        renderWatchTable(wt);
      };
    });
  }

  /* ================= 强制表 ================= */
  function renderForceTable(ft) {
    if (!ft) return;
    var h = '<div style="padding:6px 10px;background:#fbfbfb;border-bottom:1px solid #e0e0e0;display:flex;align-items:center;gap:10px;font-size:11px">' +
      '<span style="font-weight:700;color:#1a6fa8">强制表</span>' +
      '<span style="color:#666">警告：强制值将覆盖程序输出</span>' +
      '<span style="flex:1"></span>' +
      '<span class="lb" id="ftAdd" style="padding:3px 10px;border:1px solid #c8c8c8;background:#fafafa;border-radius:2px;cursor:default">＋ 添加</span>' +
      '</div>';
    h += '<table class="grid"><thead><tr><th style="width:30px"></th><th style="width:210px">地址</th>' +
      '<th style="width:130px">强制值</th><th style="width:120px">当前值</th><th></th></tr></thead><tbody>';
    ft.rows.forEach(function (r, i) {
      var v = App.plc.read(r.address);
      h += '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td class="editable" style="font-family:Consolas">' + esc(r.address) + '</td>' +
        '<td style="font-family:Consolas;color:#c00000;font-weight:600">' + esc(String(r.value)) + '</td>' +
        '<td style="font-family:Consolas">' + (v === undefined ? '—' : String(v)) + '</td>' +
        '<td><span class="lb" data-fdel="' + i + '" style="cursor:default;color:#999">✕</span></td></tr>';
    });
    if (!ft.rows.length) {
      h += '<tr><td colspan="5" style="text-align:center;color:#999;padding:14px">暂无强制条目</td></tr>';
    }
    h += '</tbody></table>';
    $('#editorArea').innerHTML = h;

    $('#ftAdd').onclick = function () {
      pickAddressDialog(function (addr) {
        ft.rows.push({ address: addr, value: true });
        App.plc.forced[addr] = true;
        renderForceTable(ft);
        toast('已强制 ' + addr + ' = true');
      });
    };
    $$('#editorArea [data-fdel]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.fdel;
        delete App.plc.forced[ft.rows[i].address];
        ft.rows.splice(i, 1);
        renderForceTable(ft);
      };
    });
  }

  function pickAddressDialog(cb) {
    var opts = App.project.tags.map(function (t) {
      return '<option value="' + esc(t.address) + '">' + esc(t.name) + ' — ' + esc(t.address) + '</option>';
    }).join('');
    modal('选择地址', '<div class="field"><label>PLC 变量</label><select id="pickA">' + opts + '</select></div>' +
      '<div class="field"><label>或绝对地址</label><input type="text" id="pickAbs" placeholder="M0.0"/></div>',
      [
        { label: '确定', primary: true, cb: function () {
            var a = $('#pickAbs').value.trim() || $('#pickA').value;
            if (!a) return false;
            cb(a);
            return true;
          } },
        { label: '取消' }
      ]);
  }

  /* ================= 诊断 ================= */
  function renderDiagnostics() {
    var p = App.project, d = p.device;
    var h = '<div style="padding:6px 10px;background:#fbfbfb;border-bottom:1px solid #e0e0e0;font-size:11px">' +
      '<span style="font-weight:700;color:#1a6fa8">在线和诊断 · ' + esc(d.name) + '</span></div>';
    h += '<div style="padding:12px 16px;font-size:12px;line-height:1.9">';
    h += '<table class="grid" style="width:auto;min-width:520px"><tbody>';
    var rows = [
      ['设备名称', d.name],
      ['设备类型', d.type],
      ['订货号', d.orderNo],
      ['固件版本', d.fw],
      ['IP 地址', d.ip],
      ['机架/插槽', '0 / 1'],
      ['运行状态', App.running ? 'RUN' : (App.online ? 'STOP' : '离线')],
      ['连接状态', App.online ? '已连接' : '未连接'],
      ['扫描周期（当前）', App.plc.lastCycleMs.toFixed(2) + ' ms'],
      ['扫描周期（最大）', App.plc.maxCycleMs.toFixed(2) + ' ms'],
      ['扫描循环次数', App.plc.cycleCount],
      ['诊断缓冲区条目', App.plc.logs.length]
    ];
    rows.forEach(function (r) {
      h += '<tr><td style="width:170px;background:#f7f7f7;font-weight:600">' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td></tr>';
    });
    h += '</tbody></table>';

    h += '<div style="margin-top:16px;font-weight:700;color:#1a6fa8">诊断缓冲区</div>';
    h += '<table class="grid" style="margin-top:6px"><thead><tr><th style="width:90px">时间</th><th style="width:70px">等级</th><th>事件</th></tr></thead><tbody>';
    var logs = App.plc.logs.slice().reverse();
    if (!logs.length) {
      h += '<tr><td colspan="3" style="text-align:center;color:#999;padding:12px">没有诊断条目</td></tr>';
    }
    logs.forEach(function (l) {
      var color = l.level === 'error' ? '#c00000' : (l.level === 'warning' ? '#e36c0a' : '#333');
      h += '<tr><td style="font-family:Consolas">' + (l.t / 1000).toFixed(1) + 's</td>' +
        '<td style="color:' + color + ';font-weight:600">' + esc(l.level) + '</td>' +
        '<td>' + esc(l.text) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    $('#editorArea').innerHTML = h;
  }

  /* ================= 设备组态 ================= */
  /* ================= 设备组态（机架视图 + 右键菜单） ================= */
  // 选中态：'cpu' | 槽号 | null
  function renderDevConfig() {
    var d = App.project.device;
    var devList = (App.project.devices && App.project.devices.length)
      ? App.project.devices
      : [{ name: d.name, type: d.type, orderNo: d.orderNo, version: d.fw }];

    // 当前选中的设备（暂只编辑第一个）
    if (App.rackSelDevice == null) App.rackSelDevice = 0;
    var curDev = devList[App.rackSelDevice] || devList[0];

    var h = '';

    // ---- 顶部工具条：设备下拉 + 视图切换按钮 ----
    h += '<div class="rack-toolbar">';
    h += '<select class="rack-devsel" id="rackDevSel">';
    devList.forEach(function (dv, i) {
      h += '<option value="' + i + '"' + (i === App.rackSelDevice ? ' selected' : '') + '>' +
        esc(dv.name) + ' [' + esc((dv.type || '').replace(/^CPU\s*/, 'CPU ')) + ']</option>';
    });
    h += '</select>';

    h += '<span class="rack-tbtn" title="编译">🔨</span>';
    h += '<span class="rack-tbtn" title="下载到设备">⬇</span>';
    h += '<span class="rack-tbtn" title="转到在线">🔌</span>';
    h += '<span class="rack-tsep"></span>';
    h += '<span class="rack-tbtn" title="拓扑视图">拓扑</span>';
    h += '<span class="rack-tbtn active" title="设备视图">设备视图</span>';
    h += '<span class="rack-tbtn" title="网络视图">网络</span>';
    h += '<span class="pr-spacer" style="flex:1"></span>';
    h += '<span class="rack-tbtn" title="显示/隐藏地址">地址</span>';
    h += '</div>';

    // ---- 主体：机架画布 + 右侧设备概览 ----
    h += '<div class="rack-main">';

    // 左：机架画布
    h += '<div class="rack-canvas" id="rackCanvas">';
    var rack = Rack.render({
      deviceName: curDev.name,
      cpuModel: curDev.type,
      modules: curDev.modules || [],
      selected: App.rackSel || null
    });
    h += rack.html;
    h += '</div>';

    // 右：设备概览（槽位列表）
    h += '<div class="rack-side">';
    h += '<div class="rack-side-head">设备概览</div>';
    h += '<div class="rack-side-tree">';
    h += '<div class="rack-cap">🧩 模块</div>';
    h += '<div class="rack-node rack-node-root">▾ ' + esc(curDev.name) + '</div>';
    h += '<div class="rack-node" data-rack-slot="1">' +
      '&nbsp;&nbsp;▸ ' + esc((curDev.type || 'CPU').replace(/^CPU\s*/, '')) + '</div>';
    // CPU 下的子项（对齐截图：DI 14/DQ、AI 2/AQ、HSC_1..6、Pulse_1..4、OPC UA、PROFINET）
    h += '<div class="rack-sub">DI 14/DQ 10</div>';
    h += '<div class="rack-sub">AI 2/AQ 2</div>';
    for (var hs = 1; hs <= 6; hs++) h += '<div class="rack-sub">HSC_' + hs + '</div>';
    for (var ps = 1; ps <= 4; ps++) h += '<div class="rack-sub">Pulse_' + ps + '</div>';
    h += '<div class="rack-sub">OPC UA</div>';
    h += '<div class="rack-sub">PROFINET</div>';

    // 已插入的模块
    (curDev.modules || []).forEach(function (m) {
      h += '<div class="rack-node" data-rack-slot="' + m.slot + '">' +
        '&nbsp;&nbsp;▸ ' + esc(m.name) + '</div>';
    });
    h += '</div></div>';

    h += '</div>';   // rack-main

    // ---- 底部：可拖拽属性面板（对齐 TIA：收起/展开、上下拉伸） ----
    h += '<div class="props-host" id="propsHost"></div>';

    $('#editorArea').innerHTML = h;
    $('#editorArea').classList.add('devcfg-mode');
    document.body.classList.add('devcfg');
    bindRackEvents(curDev);

    // 渲染可拖拽属性面板
    if (typeof PropsPanel !== 'undefined') {
      PropsPanel.render($('#propsHost'), {
        project: App.project,
        deviceLabel: curDev.name + ' [' + (curDev.type || 'CPU') + ']',
        onChange: function () {
          App.activeTab && (App.activeTab.dirty = true);
        },
        onClockMemoryChange: function (cm) {
          App.plc.setClockMemory(cm.enabled, cm.byte);
          refreshTreeData();
          renderTree();
          toast(cm.enabled ? ('已启用时钟存储器（M' + cm.byte + '.0~.7）') : '已停用时钟存储器');
        },
        onSystemMemoryChange: function (sm) {
          App.plc.setSystemMemory(sm.enabled, sm.byte);
          refreshTreeData();
          renderTree();
          toast(sm.enabled ? ('已启用系统存储器（M' + sm.byte + '.0~.3）') : '已停用系统存储器');
        }
      });
    }
  }

  /* ---------------- 机架视图交互 ---------------- */
  function bindRackEvents(curDev) {
    var d = App.project.device;

    // 设备下拉切换
    var ds = $('#rackDevSel');
    if (ds) ds.onchange = function () {
      App.rackSelDevice = +ds.value;
      App.rackSel = null;
      renderDevConfig();
    };

    // 机架点击：选中 CPU 或某个槽
    var canvas = $('#rackCanvas');
    if (!canvas) return;

    canvas.addEventListener('click', function (e) {
      var g = e.target.closest('[data-rack]');
      var slot = e.target.closest('[data-slot]');
      if (g && g.dataset.rack === 'cpu') {
        App.rackSel = 'cpu';
      } else if (slot) {
        App.rackSel = +slot.dataset.slot;
      } else {
        App.rackSel = null;
      }
      renderDevConfig();
    });

    // 右键菜单：CPU / 模块 / 空槽 / 满整个画布
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var g = e.target.closest('[data-rack]');
      var slot = e.target.closest('[data-slot]');

      if (g && g.dataset.rack === 'cpu') {
        App.rackSel = 'cpu';
        renderDevConfig();
        rackCpuMenu(e.clientX, e.clientY, curDev);
        return;
      }
      if (slot) {
        var sn = +slot.dataset.slot;
        App.rackSel = sn;
        renderDevConfig();
        var hasMod = (curDev.modules || []).some(function (m) { return m.slot === sn; });
        if (hasMod) rackModuleMenu(e.clientX, e.clientY, curDev, sn);
        else rackEmptySlotMenu(e.clientX, e.clientY, curDev, sn);
        return;
      }
      // 空白画布
      rackCanvasMenu(e.clientX, e.clientY, curDev);
    });
  }

  /* ---------------- 右键菜单：本体 CPU ---------------- */
  // 对齐截图里的完整菜单项
  function rackCpuMenu(x, y, curDev) {
    rMenu(x, y, [
      { label: '更改设备', key: '', cb: function () {
          toast('更改设备：请在设备与网络中删除后重新添加');
        } },
      { sep: true },
      { label: '剪切(T)', key: 'Ctrl+X', cb: function () { toast('设备不能剪切（仅单 CPU）'); } },
      { label: '复制(Y)', key: 'Ctrl+C', cb: function () { toast('设备不能复制（仅单 CPU）'); } },
      { label: '粘贴(P)', key: 'Ctrl+V', disabled: true },
      { label: '删除(D)', key: 'Del', disabled: true },
      { sep: true },
      { label: '转到拓扑视图', cb: function () { toast('拓扑视图：本仿真器未实现'); } },
      { label: '转到网络视图', cb: function () { toast('网络视图：本仿真器未实现'); } },
      { sep: true },
      { label: '编译', key: '▸', cb: function () { doCompile(); } },
      { label: '下载到设备(L)', key: '▸', cb: function () { doDownload(); } },
      { label: '转至在线(N)', key: 'Ctrl+K', cb: function () { doGoOnline(); } },
      { label: '转至离线(F)', key: 'Ctrl+M', cb: function () { doGoOffline(); } },
      { label: '在线和诊断(D)', key: 'Ctrl+D', cb: function () { openTab('diag', null); } },
      { sep: true },
      { label: '分配设备名称', cb: function () { toast('分配设备名称：PROFINET 名称 = ' + App.project.device.name); } },
      { label: '接收报警', disabled: true },
      { label: '更新并显示强制的操作数', disabled: true },
      { sep: true },
      { label: '交叉引用', key: 'F11', cb: function () { toast('交叉引用：本仿真器未实现（需完整符号解析）'); } },
      { label: '交叉引用信息', key: 'Shift+F11', disabled: true },
      { label: '调用结构(C)', cb: function () { openTab('blockov', null); } },
      { label: '分配列表(A)', cb: function () { openTab('tags', App.project.tags); } },
      { sep: true },
      { label: '显示目录', key: 'Ctrl+Shift+C', cb: function () {
          $('#instrPanel') && $('#instrPanel').classList.remove('collapsed');
          if (typeof Catalog !== 'undefined') Catalog.render();
          toast('已展开右侧指令目录');
        } },
      { label: '导出模块标签条(L)...', cb: function () { exportXml(); } }
    ]);
  }

  /* ---------------- 右键菜单：已插模块 ---------------- */
  function rackModuleMenu(x, y, curDev, slot) {
    rMenu(x, y, [
      { label: '更改设备', cb: function () { toast('更改设备：请删除后重新插入'); } },
      { sep: true },
      { label: '剪切(T)', key: 'Ctrl+X', disabled: true },
      { label: '复制(Y)', key: 'Ctrl+C', disabled: true },
      { label: '粘贴(P)', key: 'Ctrl+V', disabled: true },
      { label: '删除(D)', key: 'Del', cb: function () { removeModule(curDev, slot); } },
      { sep: true },
      { label: '属性', key: 'Alt+Enter', cb: function () { toast('模块属性：' + moduleLabel(curDev, slot)); } },
      { label: '编译', key: '▸', cb: function () { doCompile(); } },
      { sep: true },
      { label: '转到拓扑视图', cb: function () { toast('拓扑视图：未实现'); } },
      { label: '转到网络视图', cb: function () { toast('网络视图：未实现'); } }
    ]);
  }

  /* ---------------- 右键菜单：空插槽 ---------------- */
  function rackEmptySlotMenu(x, y, curDev, slot) {
    rMenu(x, y, [
      { label: '插入模块...', cb: function () { insertModuleDialog(curDev, slot); } },
      { sep: true },
      { label: '粘贴(P)', key: 'Ctrl+V', disabled: true },
      { sep: true },
      { label: '删除(D)', key: 'Del', disabled: true },
      { label: '属性', key: 'Alt+Enter', cb: function () { toast('空插槽 ' + slot + '：未插入模块'); } },
      { sep: true },
      { label: '转到拓扑视图', cb: function () { toast('拓扑视图：未实现'); } },
      { label: '转到网络视图', cb: function () { toast('网络视图：未实现'); } }
    ]);
  }

  /* ---------------- 右键菜单：画布空白 ---------------- */
  function rackCanvasMenu(x, y, curDev) {
    rMenu(x, y, [
      { label: '添加新设备...', cb: function () { Portal.show('adddevice'); } },
      { sep: true },
      { label: '显示目录', cb: function () {
          if (typeof Catalog !== 'undefined') Catalog.render();
          toast('已展开右侧指令目录');
        } },
      { label: '编译', key: '▸', cb: function () { doCompile(); } },
      { label: '下载到设备(L)', key: '▸', cb: function () { doDownload(); } },
      { sep: true },
      { label: '转到拓扑视图', cb: function () { toast('拓扑视图：未实现'); } },
      { label: '转到网络视图', cb: function () { toast('网络视图：未实现'); } }
    ]);
  }

  /* ---------------- 模块插入 / 删除 ---------------- */
  var MODULE_TYPES = [
    { short: 'DI', name: 'DI 16x24VDC', orderNo: '6ES7 131-6BH01-0BA0' },
    { short: 'DQ', name: 'DQ 16x24VDC/0.5A', orderNo: '6ES7 132-6BH01-0BA0' },
    { short: 'DI/DQ', name: 'DI/DQ 16x24VDC/0.5A', orderNo: '6ES7 323-1BH01-0BA0' },
    { short: 'AI', name: 'AI 8xU/I HS', orderNo: '6ES7 134-6HF00-0BA1' },
    { short: 'AQ', name: 'AQ 4xU/I ST', orderNo: '6ES7 135-6HD00-0BA1' },
    { short: 'AI/AQ', name: 'AI 4/AQ 2xU/I', orderNo: '6ES7 334-6HE00-0BA1' },
    { short: 'CM', name: 'CM 1241 RS422/485', orderNo: '6ES7 241-1CH32-0XB0' }
  ];

  function moduleLabel(curDev, slot) {
    var m = (curDev.modules || []).filter(function (x) { return x.slot === slot; })[0];
    return m ? m.name : '（空）';
  }

  function insertModuleDialog(curDev, slot) {
    var body = '<div class="field"><label>模块类型</label>' +
      '<select id="modType" style="flex:1">';
    MODULE_TYPES.forEach(function (m, i) {
      body += '<option value="' + i + '">' + esc(m.name) + '  —  ' + esc(m.orderNo) + '</option>';
    });
    body += '</select></div>' +
      '<div style="color:#888;font-size:11px;margin-top:6px">' +
      '将插入到第 <b>' + slot + '</b> 号槽。</div>';

    modal('插入模块 · 槽 ' + slot, body, [
      {
        label: '插入', primary: true, cb: function () {
          var idx = +$('#modType').value;
          var t = MODULE_TYPES[idx];
          curDev.modules = curDev.modules || [];
          curDev.modules.push({ slot: slot, short: t.short, name: t.name, orderNo: t.orderNo });
          App.activeTab.dirty = true;
          renderDevConfig();
          toast('已在槽 ' + slot + ' 插入 ' + t.name);
          return true;
        }
      },
      { label: '取消' }
    ]);
  }

  function removeModule(curDev, slot) {
    if (!curDev.modules) return;
    var before = curDev.modules.length;
    curDev.modules = curDev.modules.filter(function (m) { return m.slot !== slot; });
    if (curDev.modules.length !== before) {
      App.activeTab.dirty = true;
      App.rackSel = null;
      renderDevConfig();
      toast('已删除槽 ' + slot + ' 的模块');
    }
  }

  /* ---------------- 通用右键菜单 ---------------- */
  function rMenu(x, y, items) {
    var old = document.getElementById('rackMenu');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'rackMenu';
    d.className = 'lad-menu rack-menu';

    var estH = items.length * 24 + 10;
    d.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    d.style.top = Math.min(y, Math.max(8, window.innerHeight - estH - 10)) + 'px';

    items.forEach(function (it) {
      if (it.sep) {
        d.appendChild(Object.assign(document.createElement('div'), { className: 'lm-sep' }));
        return;
      }
      var row = document.createElement('div');
      row.className = 'lm-item' + (it.disabled ? ' disabled' : '');
      row.innerHTML = '<span>' + esc(it.label) + '</span>' +
        (it.key ? '<span class="lm-key">' + esc(it.key) + '</span>' : '');
      if (!it.disabled && it.cb) {
        row.onclick = function () { d.remove(); it.cb(); };
      }
      d.appendChild(row);
    });

    document.body.appendChild(d);
    setTimeout(function () {
      document.addEventListener('click', function h() {
        var m = document.getElementById('rackMenu');
        if (m) m.remove();
        document.removeEventListener('click', h);
      });
    }, 10);
  }

  /* ================= 仿真面板（外部接线图） ================= */
  function renderSimPanel() {
    var area = $('#editorArea');
    area.classList.add('sim-mode');
    area.innerHTML =
      '<div class="blk-head">' +
      '<span class="bh-name">仿真</span>' +
      '<span class="bh-desc">外部接线图 · 点击接口给输入信号，观察输出</span>' +
      '<span style="flex:1"></span>' +
      '<span class="bh-meta">' + (App.running ? 'CPU 运行中' : 'CPU 未运行') + '</span>' +
      '<span class="bh-btn" id="simBtnRun">' + (App.running ? '停止' : '启动') + '</span>' +
      '<span class="bh-btn" id="simBtnCompile">重新编译下载</span>' +
      '</div>' +
      '<div class="sim-body" id="simBody"></div>';

    if (typeof SimPanel !== 'undefined') {
      SimPanel.render($('#simBody'), {
        plc: App.plc,
        project: App.project,
        onChanged: function () { renderStatus(); }
      });
    }

    var runBtn = $('#simBtnRun');
    if (runBtn) runBtn.onclick = function () {
      if (App.running) doCpuStop(); else doCpuRun();
      renderSimPanel();
    };
    var cb = $('#simBtnCompile');
    if (cb) cb.onclick = function () { doDownload(); };
  }
  function renderBlockOverview() {
    var blks = App.project.blocks;
    var h = '<div style="padding:6px 10px;background:#fbfbfb;border-bottom:1px solid #e0e0e0;font-size:11px">' +
      '<span style="font-weight:700;color:#1a6fa8">程序块</span>' +
      '<span style="color:#666;margin-left:10px">' + blks.length + ' 个块</span></div>';
    h += '<table class="grid"><thead><tr><th style="width:30px"></th><th style="width:150px">名称</th>' +
      '<th style="width:70px">类型</th><th style="width:80px">语言</th><th style="width:90px">编号</th>' +
      '<th>说明</th><th style="width:80px">状态</th></tr></thead><tbody>';
    blks.forEach(function (b, i) {
      var st = b.compiled ? '<span style="color:#00803c">✔ 已编译</span>' : '<span style="color:#999">未编译</span>';
      h += '<tr data-ob="' + b.name + '" style="cursor:default">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td style="font-weight:600">' + esc(b.name) + '</td>' +
        '<td>' + esc(b.type) + '</td>' +
        '<td>' + esc(b.lang) + '</td>' +
        '<td>' + esc(b.obNumber || '—') + '</td>' +
        '<td>' + esc(b.desc || '') + '</td>' +
        '<td>' + st + '</td></tr>';
    });
    h += '</tbody></table>';
    $('#editorArea').innerHTML = h;
    $$('#editorArea tr[data-ob]').forEach(function (tr) {
      tr.addEventListener('dblclick', function () {
        var nm = tr.dataset.ob;
        var blk = App.project.blocks.filter(function (b) { return b.name === nm; })[0];
        if (blk) openTab('block', blk);
      });
    });
  }

  /* ================= 编译 ================= */
  function doCompile() {
    if (!App.project) return;
    var t0 = performance.now();
    var diags = PLC.compileProject(App.project);
    App.diags = diags;
    var ms = (performance.now() - t0).toFixed(0);

    var errs = diags.filter(function (d) { return d.level === 'error'; });
    var warns = diags.filter(function (d) { return d.level === 'warning'; });

    renderDiagPanel();
    switchInspect('diag');

    if (errs.length) {
      addDiagLog('error', '编译完成，发现 ' + errs.length + ' 个错误、' + warns.length + ' 个警告（' + ms + ' ms）');
      toast('编译失败：' + errs.length + ' 个错误', 'err');
    } else {
      addDiagLog('info', '编译完成，0 个错误，' + warns.length + ' 个警告（' + ms + ' ms）');
      toast('编译成功（' + ms + ' ms）', 'ok');
    }
    // 块状态刷新
    APP_renderTreeBadges();
    if (App.activeTab && (App.activeTab.kind === 'blockov' || App.activeTab.kind === 'block')) renderEditor();
    renderStatus();
  }

  var compileLog = [];
  function addDiagLog(level, text) {
    compileLog.unshift({ level: level, text: text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
    if (compileLog.length > 200) compileLog.pop();
  }

  function APP_renderTreeBadges() {
    // 更新树节点上的错误徽标
    var errBlocks = {};
    App.diags.forEach(function (d) {
      if (d.level !== 'error') return;
      var name = String(d.where).split(' / ')[0];
      errBlocks[name] = true;
    });
    $$('#blockList .node').forEach(function (n) {
      var key = n.dataset.node || '';
      var nm = key.replace('block:', '');
      var badge = n.querySelector('.badge');
      if (errBlocks[nm]) {
        n.style.color = '#c00000';
        if (badge) badge.classList.add('badge-err');
      } else {
        n.style.color = '';
        if (badge) badge.classList.remove('badge-err');
      }
    });
  }

  function renderDiagPanel() {
    var body = $('#inspectBody');
    var h = '';
    if (App.diags.length) {
      h += '<div style="padding:3px 8px;background:#f7f7f7;border-bottom:1px solid #e0e0e0;font-size:10px;color:#666">' +
        '编译结果：' + App.diags.length + ' 条</div>';
      App.diags.forEach(function (d) {
        var ico = d.level === 'error' ? '✖' : (d.level === 'warning' ? '⚠' : 'ⓘ');
        h += '<div class="diag-row ' + d.level + '">' +
          '<span class="lvl">' + ico + '</span>' +
          '<span class="where">' + esc(d.where) + '</span>' +
          '<span class="msg">' + esc(d.text) + '</span>' +
          '<span class="time">' + esc(d.time) + '</span></div>';
      });
    } else {
      h += '<div style="padding:14px;color:#888;font-size:11px;text-align:center">尚无编译结果，点击工具栏“编译”开始</div>';
    }
    if (compileLog.length) {
      h += '<div style="padding:3px 8px;background:#f7f7f7;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;font-size:10px;color:#666">操作记录</div>';
      compileLog.forEach(function (l) {
        h += '<div class="diag-row info"><span class="lvl">•</span>' +
          '<span class="where">' + esc(l.time) + '</span>' +
          '<span class="msg">' + esc(l.text) + '</span></div>';
      });
    }
    body.innerHTML = h;
  }

  /* ================= 下载 / 在线 ================= */
  function doDownload() {
    if (!App.project) return;
    doCompile();
    var errs = App.diags.filter(function (d) { return d.level === 'error'; });
    if (errs.length) {
      modal('下载中止', '<div style="color:#c00000;font-weight:600">编译存在 ' + errs.length + ' 个错误，无法下载。</div>' +
        '<div style="margin-top:10px;color:#444">请在下方“编译结果”中修正后重试。</div>',
        [{ label: '确定', primary: true }]);
      return;
    }

    var steps = [
      '正在建立与设备的连接……',
      '正在检查一致性……',
      '正在停止 CPU……',
      '正在装载硬件组态……',
      '正在装载程序块……',
      '正在装载系统数据……',
      '正在启动 CPU……',
      '下载完成，CPU 处于 RUN 模式。'
    ];
    var i = 0;
    var body = '<div id="dlProg" style="font-family:Consolas;font-size:11px;line-height:1.9;min-height:150px"></div>' +
      '<div style="margin-top:10px;height:14px;background:#e8e8e8;border:1px solid #c8c8c8;border-radius:2px;overflow:hidden">' +
      '<div id="dlBar" style="height:100%;width:0%;background:linear-gradient(90deg,#3d8fc4,#1a6fa8);transition:width .18s"></div></div>';
    modal('下载到设备 · ' + App.project.device.name, body, [{ label: '关闭' }], false);

    var timer = setInterval(function () {
      var log = $('#dlProg');
      if (!log) { clearInterval(timer); return; }
      if (i < steps.length) {
        var isErr = i === steps.length - 1 ? false : false;
        var line = document.createElement('div');
        line.textContent = '· ' + steps[i];
        line.style.color = (i === steps.length - 1) ? '#00803c' : '#333';
        if (i === steps.length - 1) line.style.fontWeight = '600';
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
        $('#dlBar').style.width = Math.round((i + 1) / steps.length * 100) + '%';
        i++;
      } else {
        clearInterval(timer);
        afterDownload();
        // 下载完成后自动关闭弹窗（对齐 TIA：无需再点"关闭"），
        // 稍作停留让用户看到最后一行"下载完成，CPU 处于 RUN 模式。"
        setTimeout(closeModal, 900);
      }
    }, 190);
  }

  // 下载完成：建立真实连接 —— 编译产物装入软 PLC，CPU 进入 RUN，并切到仿真面板
  function afterDownload() {
    // 1. 建新的 CPU 实例（模拟真实下载时 CPU 停机→装载→重启）
    App.plc = new PLC.SoftPLC();
    syncTagsToPlc();
    App.plc.cycleTime = App.scanInterval;

    // 2. 把编译产物（已编译的块）真正装入 CPU
    //    compileProject 已把 SCL 块编译成 AST，LAD 块结构就是可执行形式
    var loaded = 0;
    (App.project.blocks || []).forEach(function (b) {
      if (b.compiled) loaded++;
    });
    App.plc.loadedBlocks = loaded;
    App.plc.log('info', '已装载 ' + loaded + ' 个程序块');

    // 3. 同步硬件配置（系统/时钟存储器）
    var dev = App.project.device || {};
    var sm = dev.systemMemory || { enabled: false, byte: 1 };
    var cm = dev.clockMemory || { enabled: false, byte: 0 };
    App.plc.setSystemMemory(sm.enabled, sm.byte);
    App.plc.setClockMemory(cm.enabled, cm.byte);

    // 4. CPU 进入 RUN，开始真实扫描
    App.online = true;
    App.running = true;
    App.plc.runtime = true;
    App.plc.log('info', '下载完成，CPU 启动至 RUN');

    startScan();
    renderStatus();
    refreshLiveValues();

    // 5. 下载完成后直接打开仿真面板（外部接线图）——"切实连接起来"
    openTab('sim', null);
    toast('下载完成：已装载 ' + loaded + ' 个块，CPU 进入 RUN，已打开仿真面板', 'ok');
  }

  /* 关掉所有"仿真 · 外部接线图"标签页（转到离线时用） */
  function closeSimTabs() {
    var had = App.openTabs.some(function (t) { return t.kind === 'sim'; });
    if (!had) return false;
    App.openTabs = App.openTabs.filter(function (t) { return t.kind !== 'sim'; });
    if (App.activeTab && App.activeTab.kind === 'sim') {
      App.activeTab = App.openTabs[App.openTabs.length - 1] || null;
    }
    renderTabs();
    return true;
  }

  function doGoOnline() {
    // 没装载程序时不能上线（和"下载"是两个动作，下载会顺带 RUN）
    if (!App.plc || !App.plc.loadedBlocks) {
      toast('未下载程序，先执行“下载到设备”', 'err');
      return;
    }
    if (App.online && App.running) {
      // 已经在线并在跑：把计数归零，并且照样进入"监视 + 仿真面板"的调试态
      App.plc.cycleCount = 0;
      App.plc.lastCycleMs = 0;
      App.plc.maxCycleMs = 0;
      App.monitor = true;
      openTab('sim', null);
      renderStatus();
      refreshLiveValues();
      toast('已在线：监视已开启、仿真面板已打开，循环计数从 0 重新开始');
      return;
    }

    var needRun = !App.running;
    App.online = true;
    if (needRun) {
      // 首次转到在线 → 自动 RUN（和真机"上电即运行"一致）
      App.running = true;
      App.plc.runtime = true;
      App.plc.log('info', 'CPU 自动切换到 RUN（转到在线）');
      startScan();
    }
    // 每次上线都重新计数：仿真面板右上角"循环 xxx"从 1 开始，
    // 不会出现"刚上线就显示 8576"这种看不懂的数字
    App.plc.cycleCount = 0;
    App.plc.lastCycleMs = 0;
    App.plc.maxCycleMs = 0;

    // 上线 = 进入调试状态：自动开监视 + 打开仿真面板（用户 2026-11-21 要求）
    App.monitor = true;
    openTab('sim', null);

    renderStatus();
    refreshLiveValues();
    toast(needRun ? '已转到在线：CPU 自动进入 RUN、监视已开启、仿真面板已打开'
      : '已转到在线：监视已开启、仿真面板已打开', 'ok');
  }

  function doGoOffline() {
    if (!App.online && !App.running) {
      toast('当前已是离线状态');
      return;
    }
    // 1) STOP：停扫描、停在线监视
    App.running = false;
    App.plc.runtime = false;
    App.plc.log('info', 'CPU 切换到 STOP（转到离线）');
    stopScan();
    App.monitor = false;
    App.lastValues = {};

    // 2) 复位：过程映像 Q / M 清零，循环计数归零（等同 MRES 的效果）
    if (App.plc.mem && App.plc.mem.Q) App.plc.mem.Q.fill(0);
    if (App.plc.mem && App.plc.mem.M) App.plc.mem.M.fill(0);
    App.plc.cycleCount = 0;
    App.plc.lastCycleMs = 0;
    App.plc.maxCycleMs = 0;

    // 3) 断开在线，关掉仿真面板
    App.online = false;
    var closedSim = closeSimTabs();

    renderStatus();
    renderEditor();
    toast('已转到离线：CPU STOP、输出已复位' +
      (closedSim ? '、仿真面板已关闭' : ''), 'ok');
  }

  function doCpuRun() {
    if (!App.online) { toast('请先下载到设备', 'err'); return; }
    App.running = true;
    App.plc.log('info', 'CPU 切换到 RUN');
    startScan();
    renderStatus();
    toast('CPU → RUN', 'ok');
  }

  function doCpuStop() {
    App.running = false;
    App.plc.log('info', 'CPU 切换到 STOP');
    stopScan();
    renderStatus();
    toast('CPU → STOP');
  }

  function doCpuReset() {
    App.plc = new PLC.SoftPLC();
    syncTagsToPlc();
    App.plc.cycleTime = 10;
    App.monitor = false;
    renderStatus();
    toast('存储器已复位（M/Q 区清零）');
    refreshLiveValues();
  }

  function doToggleMonitor() {
    if (!App.online) { toast('请先转到在线', 'err'); return; }
    App.monitor = !App.monitor;
    App.lastValues = {};
    renderStatus();
    if (App.activeTab) renderEditor();
    toast(App.monitor ? '监视已开启' : '监视已关闭');
  }

  /* ================= 扫描循环 ================= */
  function startScan() {
    if (App.scanTimer) return;
    App.scanTimer = setInterval(function () {
      if (!App.running) return;
      try {
        App.plc.cycleTime = App.scanInterval;
        // 同步系统时钟存储器配置
        var cm = (App.project.device && App.project.device.clockMemory) || { enabled: false, byte: 0 };
        App.plc.setClockMemory(cm.enabled, cm.byte);
        App.plc.step(App.project);
      } catch (err) {
        App.plc.log('error', '扫描异常：' + err.message);
        stopScan();
        toast('扫描异常：' + err.message, 'err');
      }
      refreshLiveValues();
    }, App.scanInterval);
  }

  function stopScan() {
    if (App.scanTimer) { clearInterval(App.scanTimer); App.scanTimer = null; }
  }

  function refreshLiveValues() {
    renderStatus();
    // 监控表/强制表即时刷新
    if (App.activeTab) {
      if (App.activeTab.kind === 'watch') {
        updateWatchValues();
        return;
      }
      if (App.activeTab.kind === 'force') return;
      if (App.activeTab.kind === 'diag') { renderDiagnostics(); return; }
      if (App.activeTab.kind === 'block' && App.monitor) {
        // 只更新值气泡与线色，避免整页重绘
        updateLadLive();
        return;
      }
      if (App.activeTab.kind === 'sim') {
        // 仿真面板：每周期刷新接口颜色与统计
        if (typeof SimPanel !== 'undefined') SimPanel.refresh();
        return;
      }
    }
  }

  function updateWatchValues() {
    var wt = App.activeTab.ref;
    if (!wt) return;
    var rows = $$('#editorArea tbody tr');
    wt.rows.forEach(function (r, i) {
      var val = App.plc.read(r.address);
      var cell = rows[i] ? rows[i].children[4] : null;
      if (!cell) return;
      var disp = '—';
      if (val !== undefined) {
        if (r.monitorFormat === 'Bool') disp = val ? 'TRUE' : 'FALSE';
        else disp = String(val);
      }
      if (cell.textContent !== disp) {
        cell.textContent = disp;
        cell.style.color = '#c00000';
        setTimeout(function () { cell.style.color = '#1a6fa8'; }, 180);
      }
    });
  }

  function updateLadLive() {
    // 在线监视刷新：只改已有 SVG 的色值，不重建 DOM，避免打断选中与拖拽
    if (!(App.activeTab && App.activeTab.kind === 'block' && App.activeTab.ref.lang === 'LAD')) return;
    var wrap = $('.lad-wrap');
    if (!wrap) return;
    var trace = App.plc.trace;
    var LADl = window.LAD;

    $$('.network .net-svg > svg', wrap).forEach(function (svg) {
      var n = +svg.getAttribute('data-net');
      var NT = trace.net[n] || null;

      // 1) 元件：符号看 out，左右引线分别看 in / out
      svg.querySelectorAll('.lad-el').forEach(function (g) {
        var hit = g.querySelector('.hit');
        if (!hit) return;
        var ev = NT && NT.elem[hit.dataset.el];
        var inLive = !!(ev && ev.in), outLive = !!(ev && ev.out);
        g.classList.toggle('el-true', outLive);
        g.classList.toggle('el-false', !outLive);
        g.classList.toggle('in-live', inLive);
        g.classList.toggle('in-dead', !inLive);
        g.classList.toggle('out-live', outLive);
        g.classList.toggle('out-dead', !outLive);
        // 置位线圈要按"位值"着色：自锁以后功率流已经断了（前面那个触点松开了），
        // 但这个位还是 1 —— 这时线圈本身得是绿的，才看得出"已经置位并保持"。
        // 其余线圈（普通 / 复位 / 取反…）仍按功率流着色，免得复位线圈因为位是 1 反而变绿。
        var ctype = g.getAttribute('data-type') || '';
        g.classList.toggle('el-bit', ctype === 'SET' && !!(ev && ev.draw === true));
      });

      // 1.5) 值气泡：每个扫描周期按 trace 重建（数量很少，且不碰元件本身）
      if (LADl && LADl.syncBadges) LADl.syncBadges(svg, NT);

      // 1.6) 框外时间值：定时器 ET 正数 / PT 倒数（对齐 TIA 在线视图）
      if (LADl && LADl.syncTimeValues) LADl.syncTimeValues(svg, NT);

      // 2) 导线：分出/汇合竖线、列间连线、末端尾线都按功率流上色（V32）
      if (!NT || !LADl) return;
      svg.querySelectorAll('[data-live]').forEach(function (ln) {
        LADl.paintWire(ln, LADl.liveOf(NT, ln.getAttribute('data-live')));
      });
      svg.querySelectorAll('[data-live-arrow]').forEach(function (p) {
        var live = LADl.liveOf(NT, p.getAttribute('data-live-arrow'));
        p.setAttribute('stroke', live ? '#00b050' : '#1a6fa8');
      });
    });
  }

  /* ================= 状态栏 ================= */
  function renderStatus() {
    var sb = $('#statusbar');
    var cpuCls = !App.online ? '' : (App.running ? 'run' : 'stop');
    var cpuTxt = !App.online ? '离线' : (App.running ? 'RUN' : 'STOP');
    var onlineCls = App.online ? 'online' : '';
    sb.innerHTML =
      '<span class="seg"><span class="led ' + cpuCls + '"></span>CPU：' + cpuTxt + '</span>' +
      '<span class="seg"><span class="led ' + onlineCls + '"></span>' + (App.online ? '在线' : '离线') + '</span>' +
      '<span class="seg">' + (App.monitor ? '👁 监视中' : '监视关闭') + '</span>' +
      '<span class="seg">循环：' + App.plc.cycleCount + '</span>' +
      '<span class="seg">周期：' + App.plc.lastCycleMs.toFixed(2) + ' ms</span>' +
      '<span class="spacer"></span>' +
      '<span class="seg">' + esc(App.project ? App.project.name : '') + '</span>' +
      '<span class="seg">' + esc(App.project ? App.project.device.type : '') + '</span>';

    // 工具栏状态
    var monBtn = $('.tb[data-act="monitor"]');
    if (monBtn) monBtn.classList.toggle('active', App.monitor);
    var onBtn = $('.tb[data-act="online"]');
    if (onBtn) onBtn.classList.toggle('active', App.online);
    var offBtn = $('.tb[data-act="offline"]');
    if (offBtn) offBtn.classList.toggle('active', !App.online);
  }

  /* ================= 巡视窗口 ================= */
  function switchInspect(tab) {
    App.inspectTab = tab;
    $$('#inspectTabs .itab').forEach(function (x) {
      x.classList.toggle('active', x.dataset.it === tab);
    });
    $('#inspectBody').style.display = tab === 'diag' ? 'block' : 'none';
    $('#propBody').style.display = tab === 'props' ? 'block' : 'none';
    if (tab === 'diag') renderDiagPanel();
    else renderProps();
  }

  function renderProps() {
    var h = '';
    if (App.activeTab && App.activeTab.kind === 'block') {
      var b = App.activeTab.ref;
      h += '<table class="grid"><tbody>';
      var rows = [
        ['块名称', b.name], ['块类型', b.type], ['语言', b.lang],
        ['块编号', b.obNumber || '—'], ['说明', b.desc || ''],
        ['编译状态', b.compiled ? '已编译' : '未编译'],
        ['网络数', b.networks ? b.networks.length : '—']
      ];
      rows.forEach(function (r) {
        h += '<tr><td style="width:110px;background:#f7f7f7;font-weight:600">' + r[0] + '</td><td>' + esc(String(r[1])) + '</td></tr>';
      });
      h += '</tbody></table>';
      if (b.interface) {
        h += '<div style="padding:5px 8px;background:#f7f7f7;font-size:11px;font-weight:600;border-top:1px solid #e0e0e0">接口</div>';
        h += '<table class="grid"><thead><tr><th>名称</th><th>类型</th><th>方向</th></tr></thead><tbody>';
        var add = function (arr, dir) {
          arr.forEach(function (x) {
            h += '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.type) + '</td><td>' + dir + '</td></tr>';
          });
        };
        add(b.interface.inputs || [], 'Input');
        add(b.interface.outputs || [], 'Output');
        add(b.interface.inouts || [], 'InOut');
        add(b.interface.statics || [], 'Static');
        add(b.interface.temps || [], 'Temp');
        h += '</tbody></table>';
      }
    } else {
      h += '<div style="padding:14px;color:#888;font-size:11px">选择某个块查看其属性</div>';
    }
    $('#propBody').innerHTML = h;
  }

  /* ================= 右侧指令面板：显示 / 隐藏 ================= */
  var menuReopenInstr = null;

  function closeInstrPanel(silent) {
    var p = $('#instrPanel');
    if (!p) return;
    p.style.display = 'none';
    document.body.classList.add('no-instr');
    try { localStorage.setItem('dongens.instrPanelClosed', '1'); } catch (e) { }
    if (!silent) toast('已关闭指令面板（菜单「视图 → 显示指令面板」可重新打开）');
  }

  function openInstrPanel() {
    var p = $('#instrPanel');
    if (!p) return;
    p.style.display = 'flex';
    p.classList.remove('collapsed');
    document.body.classList.remove('no-instr');
    try { localStorage.setItem('dongens.instrPanelClosed', '0'); } catch (e) { }
    if (typeof Catalog !== 'undefined') Catalog.render();
    toast('已打开指令面板');
  }
  function toggleInspector() {
    $('#inspector').classList.toggle('collapsed');
  }

  /* ================= 编辑区 ↔ 巡视窗口 分界线（V54） =================
     对齐 TIA：鼠标停在"编译结果 / 诊断"上方的分界线上 → 光标变成 ⬍，
     按住左键拖动即可上下调节两块区域的高度：
       · 往下拖 → 分界线下移 → 梯形图区域变大、巡视窗口变矮
       · 往上拖 → 反之
     上下限保护：巡视窗口至少 80px，梯形图区至少 120px；双击复位。 */
  function bindInspSplitter() {
    var sp = document.getElementById('inspSplitter');
    var insp = document.getElementById('inspector');
    if (!sp || !insp) return;
    var drag = null;

    sp.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      insp.classList.remove('collapsed');        // 折叠状态拖一下 = 重新展开
      var edEl = document.getElementById('editorArea');
      var edH = edEl ? edEl.getBoundingClientRect().height : 0;
      drag = {
        y0: e.clientY,
        h0: insp.getBoundingClientRect().height,
        avail: edH + insp.getBoundingClientRect().height   // 两块区域的总可用高度
      };
      sp.classList.add('dragging');
      document.body.classList.add('insp-resizing');
      try { sp.setPointerCapture(e.pointerId); } catch (err) { }
    });

    sp.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var MIN_INSP = 80, MIN_EDITOR = 120;
      // 往下拖（dy > 0）→ 分界线下移 → 梯形图区变大 → 巡视窗口变矮
      var h = drag.h0 - (e.clientY - drag.y0);
      var maxH = Math.max(MIN_INSP, (drag.avail || 0) - MIN_EDITOR);
      if (h < MIN_INSP) h = MIN_INSP;
      if (h > maxH) h = maxH;
      insp.style.height = h + 'px';
    });

    function endDrag(e) {
      if (!drag) return;
      drag = null;
      sp.classList.remove('dragging');
      document.body.classList.remove('insp-resizing');
      try { sp.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    sp.addEventListener('pointerup', endDrag);
    sp.addEventListener('pointercancel', endDrag);

    // 双击分界线 = 复位到默认高度
    sp.addEventListener('dblclick', function () {
      insp.classList.remove('collapsed');
      insp.style.height = '';
    });
  }

  /* ================= 块头区 ↔ 网络区分界线（V55，对齐 TIA） =================
     悬停出现 ⬍ 光标，按住左键上下拖动：往下拖 → 块头区变高（注释编辑区变大），
     往上拖 → 块头区变矮（更多梯形图空间）。双击复位。
     事件用 document 委托绑定 —— 编辑区每次重绘都会重建 DOM，委托才不会失效。
     高度记在 headZoneH 里，重绘后由 applyHeadZone() 恢复。 */
  var headZoneH = 0;   // 0 = 自动（默认内容高度）

  function applyHeadZone() {
    var z = document.getElementById('ladHeadZone');
    if (z) z.style.height = headZoneH > 0 ? headZoneH + 'px' : '';
  }

  function bindHeadSplitter() {
    var drag = null;

    document.addEventListener('pointerdown', function (e) {
      var sp = e.target && e.target.closest ? e.target.closest('#headSplitter') : null;
      if (!sp || e.button !== 0) return;
      e.preventDefault();
      var zone = document.getElementById('ladHeadZone');
      if (!zone) return;
      var scroll = zone.parentElement ? zone.parentElement.querySelector('.lad-scroll') : null;
      var zh = zone.getBoundingClientRect().height;
      var sh = scroll ? scroll.getBoundingClientRect().height : 0;
      drag = {
        y0: e.clientY,
        h0: zh,
        avail: zh + sh   // 块头 + 网络区 总高（分界线自身 6px 不计入可分配空间）
      };
      sp.classList.add('dragging');
      document.body.classList.add('head-resizing');
      try { sp.setPointerCapture(e.pointerId); } catch (err) { }
    });

    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var zone = document.getElementById('ladHeadZone');
      if (!zone) return;
      var MIN_HEAD = 96, MIN_LADDER = 120;   // 96 ≈ 块头行 + 收藏栏始终完整可见
      // 分界线跟随鼠标：往下拖（dy > 0）→ 块头区变高
      var h = drag.h0 + (e.clientY - drag.y0);
      var maxH = Math.max(MIN_HEAD, (drag.avail || 0) - MIN_LADDER);
      if (h < MIN_HEAD) h = MIN_HEAD;
      if (h > maxH) h = maxH;
      headZoneH = h;
      zone.style.height = h + 'px';
    });

    function endDrag(e) {
      if (!drag) return;
      drag = null;
      document.body.classList.remove('head-resizing');
      var sp = document.getElementById('headSplitter');
      if (sp) sp.classList.remove('dragging');
      try { sp && sp.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // 双击分界线 = 复位默认（自动高度）
    document.addEventListener('dblclick', function (e) {
      var sp = e.target && e.target.closest ? e.target.closest('#headSplitter') : null;
      if (!sp) return;
      headZoneH = 0;
      applyHeadZone();
    });
  }

  /* ================= 对话框 / Toast ================= */
  function modal(title, bodyHtml, buttons, closable) {
    var mask = $('#modalMask');
    var html =
      '<div class="modal" style="min-width:' + (bodyHtml.length > 400 ? '560px' : '420px') + '">' +
      '<div class="modal-head">' + esc(title) +
      (closable !== false ? '<span class="modal-x" title="关闭">&times;</span>' : '') +
      '</div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      '<div class="modal-foot">';
    (buttons || []).forEach(function (b, i) {
      html += '<button class="btn' + (b.primary ? ' primary' : '') + '" data-bi="' + i + '">' + esc(b.label) + '</button>';
    });
    html += '</div></div>';
    mask.innerHTML = html;
    mask.classList.add('show');

    // 右上角 ✕：直接关闭（等于取消，不触发任何按钮回调）
    var xbtn = mask.querySelector('.modal-x');
    if (xbtn) {
      xbtn.addEventListener('click', function () {
        mask.classList.remove('show');
      });
    }

    $$('.modal-foot .btn', mask).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var b = buttons[+btn.dataset.bi];
        var keep = false;
        if (b && b.cb) keep = (b.cb() === false);
        if (!keep) mask.classList.remove('show');
      });
    });
    if (closable !== false) {
      mask.addEventListener('click', function (e) {
        if (e.target === mask) mask.classList.remove('show');
      });
    }
  }

  function closeModal() { $('#modalMask').classList.remove('show'); }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2200);
  }

  /* ================= 工程管理 ================= */
  // 保存：写回浏览器本地存储（真正的"保存项目"），并刷新最近项目列表
  function saveProject(silent) {
    if (!App.project) return;
    var r = ProjectStore.save(App.project);
    if (!r.ok) {
      toast('保存失败：' + r.error, 'err');
      return;
    }
    if (App.activeTab) App.activeTab.dirty = false;
    renderTabs();
    updateTitle();
    if (!silent) toast('项目已保存：' + App.project.name, 'ok');
  }

  // 另存为：导出成文件（可拷给别人 / 备份）
  function exportProjectFile() {
    if (!App.project) return;
    var name = ProjectStore.exportFile(App.project);
    toast('已导出文件：' + name, 'ok');
  }

  // 打开：回到门户挑选
  function openProjectPortal() {
    if (App.project) saveProject(true);
    Portal.show();
  }

  // 新建：弹窗填名称，创建后存库并进入
  // 创建项目（由门户表单调用）：只建数据、存库、返回项目对象，不进入工程
  function createProjectFromSpec(spec) {
    // 空白工程：新建项目不能带示例程序（之前复用 newProject 导致"新建=复制示例"）
    var proj = blankProject(spec.name);
    proj.name = spec.name;
    proj.path = spec.path;
    proj.version = spec.version || 'V16';
    proj.author = spec.author || 'Administrator';
    proj.comment = spec.comment || '';

    // 覆盖同名项目：先删旧的
    if (spec.overwrite) {
      var old = ProjectStore.list().filter(function (x) { return x.name === spec.name; })[0];
      if (old) ProjectStore.remove(old.id);
    }

    delete proj.id;   // 让 store 分配新 id
    var r = ProjectStore.save(proj);
    if (!r.ok) {
      toast('创建失败：' + r.error, 'err');
      return null;
    }
    return proj;
  }

  // 从新手上路进入工程（可指定落到哪个页面）
  function enterFromPortal(project, target) {
    ensureShell();

    // 已经是当前项目就只切页面，避免重复重置状态
    if (App.project !== project) {
      enterProject(project);
    }
    Portal.hide();

    if (target === 'projectview' || !target) {
      // 打开主程序 OB1
      var ob1 = (App.project.blocks || []).filter(function (b) {
        return b.obNumber === 1 || b.name === 'OB1' || b.name === 'Main';
      })[0];
      if (ob1) openTab('block', ob1);
      toast('已打开项目：' + App.project.name, 'ok');
      return;
    }
    if (target === 'devconfig') {
      openTab('devconfig', App.project.device);
      toast('已打开设备组态');
      return;
    }
    if (target === 'blockov') {
      openTab('blockov', null);
      toast('已打开程序块总览');
      return;
    }
  }

  function exportXml() {
    var p = App.project;
    var xml = '<?xml version="1.0" encoding="utf-8"?>\n<DongensMLExport format="DONGENS">\n';
    xml += '  <Project name="' + esc(p.name) + '" author="' + esc(p.author || '') + '">\n';
    xml += '    <Device name="' + esc(p.device.name) + '" type="' + esc(p.device.type) + '" ' +
      'orderNumber="' + esc(p.device.orderNo) + '" firmware="' + esc(p.device.fw) + '" ip="' + esc(p.device.ip) + '"/>\n';
    xml += '    <TagTable name="Default tag table">\n';
    p.tags.forEach(function (t) {
      xml += '      <Tag name="' + esc(t.name) + '" dataType="' + esc(t.datatype) +
        '" address="' + esc(t.address) + '" comment="' + esc(t.comment || '') + '"/>\n';
    });
    xml += '    </TagTable>\n';
    xml += '    <Blocks>\n';
    p.blocks.forEach(function (b) {
      xml += '      <Block name="' + esc(b.name) + '" type="' + esc(b.type) + '" language="' + esc(b.lang) + '">\n';
      if (b.lang === 'SCL') {
        xml += '        <Source><![CDATA[\n' + (b.source || '') + '\n]]></Source>\n';
      } else {
        xml += '        <Networks>\n';
        (b.networks || []).forEach(function (n, i) {
          xml += '          <Network number="' + (i + 1) + '" title="' + esc(n.title || '') + '">\n';
          n.columns.forEach(function (c, ci) {
            xml += '            <Column index="' + ci + '">\n';
            c.branches.forEach(function (br, bi) {
              xml += '              <Branch index="' + bi + '">\n';
              br.forEach(function (e) {
                xml += '                <Element type="' + esc(e.type) + '" operand="' + esc(e.operand || '') +
                  '"' + (e.op ? ' op="' + esc(e.op) + '"' : '') +
                  (e.pt ? ' pt="' + esc(e.pt) + '"' : '') +
                  (e.operand2 ? ' operand2="' + esc(e.operand2) + '"' : '') + '/>\n';
              });
              xml += '              </Branch>\n';
            });
            xml += '            </Column>\n';
          });
          xml += '          </Network>\n';
        });
        xml += '        </Networks>\n';
      }
      xml += '      </Block>\n';
    });
    xml += '    </Blocks>\n  </Project>\n</DongensMLExport>';

    var blob = new Blob([xml], { type: 'application/xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.name + '_DongensML.xml';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 DongensML XML', 'ok');
  }

  function exportReport() {
    var p = App.project;
    var lines = [];
    lines.push('DONGENS 诊断报告');
    lines.push('生成时间：' + new Date().toLocaleString('zh-CN'));
    lines.push('='.repeat(50));
    lines.push('项目：' + p.name);
    lines.push('设备：' + p.device.name + ' / ' + p.device.type);
    lines.push('CPU 状态：' + (App.online ? (App.running ? 'RUN' : 'STOP') : '离线'));
    lines.push('循环次数：' + App.plc.cycleCount);
    lines.push('当前周期：' + App.plc.lastCycleMs.toFixed(2) + ' ms');
    lines.push('最大周期：' + App.plc.maxCycleMs.toFixed(2) + ' ms');
    lines.push('');
    lines.push('编译结果（' + App.diags.length + ' 条）：');
    App.diags.forEach(function (d) {
      lines.push('  [' + d.level + '] ' + d.where + ' — ' + d.text);
    });
    lines.push('');
    lines.push('诊断缓冲区：');
    App.plc.logs.forEach(function (l) {
      lines.push('  ' + (l.t / 1000).toFixed(1) + 's [' + l.level + '] ' + l.text);
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.name + '_报告.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出诊断报告', 'ok');
  }

  function showAbout() {
    modal('关于 DONGENS', '<div style="line-height:2">' +
      '<div style="font-size:15px;font-weight:700;color:#1a6fa8;margin-bottom:6px">DONGENS · DSI Platform 仿真教学版</div>' +
      '<div>面向学生的 DSI Platform 行为仿真器，复刻其操作逻辑与界面布局。</div>' +
      '<div style="margin-top:10px"><b>已实现：</b></div>' +
      '<ul style="margin:4px 0 0 20px;line-height:1.9">' +
      '<li>项目树 / 视图切换 / 巡视窗口 / 状态栏</li>' +
      '<li>LAD 梯形图编辑器（触点、线圈、置位复位、边沿、TON、CTU、比较、算术、并联分支）</li>' +
      '<li>SCL 结构化文本编辑器（IF/FOR/WHILE/REPEAT、表达式、运算符优先级）</li>' +
      '<li>软 PLC 循环扫描、符号表解析、I/Q/M/DB 存储区</li>' +
      '<li>编译诊断（语法 / 未定义符号 / 缺失 OB1）</li>' +
      '<li>下载到设备 / RUN / STOP / 存储器复位 / 在线监视 / 强制表</li>' +
      '<li>工程保存为 JSON、导出 DongensML XML、导出诊断报告</li>' +
      '</ul>' +
      '<div style="margin-top:10px;color:#666;font-size:11px">不含真实硬件通讯与烧录能力，符合教学替代定位。</div>' +
      '</div>', [{ label: '确定', primary: true }]);
  }

  function showHelp() {
    var keys = [
      ['Ctrl+S', '导出工程 JSON'],
      ['Ctrl+Enter', '在当前编辑器中编译'],
      ['Ctrl+M', '开启/关闭监视'],
      ['Ctrl+L', '下载到设备'],
      ['Delete', '删除选中 LAD 元件'],
      ['双击元件', '编辑操作数'],
      ['双击空槽位', '选中插入位置']
    ];
    var h = '<table class="grid"><thead><tr><th style="width:130px">快捷键 / 操作</th><th>功能</th></tr></thead><tbody>';
    keys.forEach(function (k) {
      h += '<tr><td style="font-family:Consolas;font-weight:600">' + esc(k[0]) + '</td><td>' + esc(k[1]) + '</td></tr>';
    });
    h += '</tbody></table>';
    modal('快捷键', h, [{ label: '确定', primary: true }]);
  }

  function showSettings() {
    modal('设置', '<div class="field"><label>扫描周期 (ms)</label>' +
      '<input type="text" id="setCycle" value="' + App.scanInterval + '"></div>' +
      '<div style="color:#888;font-size:11px">扫描周期越短，软 PLC 执行越频繁；过低会明显占用 CPU。</div>',
      [
        { label: '确定', primary: true, cb: function () {
            var v = parseInt($('#setCycle').value, 10);
            if (v >= 10 && v <= 1000) {
              App.scanInterval = v;
              if (App.running) { stopScan(); startScan(); }
              toast('扫描周期已设为 ' + v + ' ms', 'ok');
            } else toast('请输入 10–1000 之间的数值', 'err');
            return true;
          } },
        { label: '取消' }
      ]);
  }

  /* ================= 块管理 ================= */
  function addBlock(type) {
    var count = App.project.blocks.filter(function (b) { return b.type === type; }).length + 1;
    var name = type + '_' + count;
    var blk = {
      name: name, lang: 'LAD', type: type, obNumber: type === 'OB' ? (count + 1) : 0,
      desc: '', networks: [{ title: '', columns: [{ branches: [[]] }] }]
    };
    if (type === 'DB') {
      blk.lang = 'DB';
      blk.dbData = [];
      blk.desc = '数据块';
    }
    App.project.blocks.push(blk);
    refreshTreeData();
    renderTree();
    openTab('block', blk);
    toast('已创建 ' + name, 'ok');
  }

  function addWatch(silent) {
    if (!App.project.watchTables) App.project.watchTables = [];
    var n = App.project.watchTables.length + 1;
    var wt = { name: '监控表_' + n, rows: [] };
    App.project.watchTables.push(wt);
    refreshTreeData();
    if (!silent) {
      openTab('watch', wt);
      toast('已创建 ' + wt.name, 'ok');
    }
    return wt;
  }

  /* ================= 键盘快捷键 ================= */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveProject(); }
    if (e.ctrlKey && e.key === 'm') { e.preventDefault(); doToggleMonitor(); }
    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); doDownload(); }
    if (e.ctrlKey && e.key === 'Enter') {
      var ta = document.activeElement;
      if (ta && ta.id === 'sclTa') return; // 由编辑器自行处理
      e.preventDefault(); doCompile();
    }
    if (e.key === 'Escape') closeModal();
  });

  /* ================= 启动 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    // 巡视窗口标签
    $('#inspectTabs').addEventListener('click', function (e) {
      var it = e.target.closest('.itab');
      if (it) switchInspect(it.dataset.it);
    });

    // 把 toast/modal 暴露给 LadEdit（它不能直接访问内部函数）
    window.__toast = toast;
    window.__modal = modal;

    // 初始化右侧指令面板
    Catalog.init({
      onInsert: function (type, pos) {
        if (!App.activeTab || App.activeTab.kind !== 'block' || App.activeTab.ref.lang !== 'LAD') {
          toast('请先打开一个 LAD 块', 'err');
          return;
        }
        LadEdit.appendInstruction(type);
      },
      onDropInsert: function (type, pt) {
        if (!App.activeTab || App.activeTab.kind !== 'block' || App.activeTab.ref.lang !== 'LAD') {
          toast('请先打开一个 LAD 块再拖入指令', 'err');
          return false;
        }
        // 必须真正落在梯形图区域内才插入
        var pos = LadEdit.dropPosAt(pt);
        if (!pos) return false;
        LadEdit.insertInstruction(type, pos);
        return true;
      },
      onFavAdded: function (type, added) {
        if (added === false) {
          toast('「' + type + '」已在收藏夹中');
        } else {
          toast('已加入收藏夹：' + type + '（点收藏项插入，选中后 Delete 移除）');
        }
        // 重绘收藏栏
        if (typeof FavBar !== 'undefined' && document.getElementById('favbarHost')) {
          var tab = App.activeTab;
          if (tab && tab.kind === 'block') renderBlockEditor(tab);
        }
      }
    });

    // 面板拖拽时实时显示落点提示
    DragLayer.setHintHandler(function (e) {
      if (!App.activeTab || App.activeTab.kind !== 'block') return;
      LadEdit.showHintAt({
        clientX: e.clientX, clientY: e.clientY,
        target: document.elementFromPoint(e.clientX, e.clientY)
      });
    });

    // 面板折叠 / 展开 / 关闭
    var ipc = $('#ipCollapse');
    if (ipc) ipc.onclick = function () {
      var p = $('#instrPanel');
      p.classList.toggle('collapsed');
      ipc.textContent = p.classList.contains('collapsed') ? '▯' : '▤';
    };
    var ipx = $('#ipClose');
    if (ipx) ipx.onclick = function () {
      closeInstrPanel();
    };
    // 菜单里也能重新打开
    menuReopenInstr = function () { openInstrPanel(); };
    // 初始化时若之前关闭过则恢复
    try {
      if (localStorage.getItem('dongens.instrPanelClosed') === '1') {
        closeInstrPanel(true);
      }
    } catch (e) { }
    // 竖排 rail 切换（其余功能为占位）
    $$('.instr-rail .rail-item').forEach(function (r) {
      r.onclick = function () {
        $$('.instr-rail .rail-item').forEach(function (x) { x.classList.remove('active'); });
        r.classList.add('active');
        if (r.dataset.rail !== 'cat') {
          $('#instrBody').innerHTML = '<div class="cat-empty" style="padding:16px;line-height:2">' +
            '<b>' + esc(r.textContent) + '</b><br>该面板在本仿真器中未实现。<br><br>' +
            '已实现：<b>指令</b>面板（基本指令 + 扩展指令 + 收藏夹）。</div>';
        } else {
          Catalog.render();
        }
      };
    });

    bindInspSplitter();
    bindHeadSplitter();
    switchInspect('diag');
    ensureShell();

    // 首次使用：种一个示例项目，免得门户空白
    ProjectStore.seedIfEmpty(function () {
      var p = newProject('示例项目_电机启保停');
      p.path = 'C:\\Users\\Administrator\\Documents\\Automation\\示例项目_电机启保停';
      return p;
    });

    // 初始化门户
    Portal.init({
      // 打开已有项目：直接进工程（保持原有行为）
      onOpen: function (project) {
        ensureShell();
        enterProject(project);
        Portal.hide();
        toast('已打开项目：' + project.name, 'ok');
      },
      // 创建新项目：只建数据 + 存库，由门户停在新手上路页
      onCreate: function (spec) {
        return createProjectFromSpec(spec);
      },
      // 从新手上路进工程
      onEnterProject: function (project, target) {
        enterFromPortal(project, target);
      }
    });

    // 启动时先进门户（用户要求的"开始时展示之前的项目"）
    Portal.show();

    // 门户背景里也把外壳先建好，避免进入后闪烁
    renderTree();
    renderStatus();
  });

  // 暴露给门户/测试使用
  window.TIA_ENTER = function (project) { ensureShell(); enterProject(project); Portal.hide(); };
  window.TIA_PORTAL = function () { Portal.show(); };

  // 监视模式下"按住触点改值"用：改完立刻刷一次显示，不用等下一个扫描周期
  App.refreshLive = function () { try { refreshLiveValues(); } catch (e) { } };

  window.TIA = App;
  // 同一对象的短别名：LadEdit 内部用 window.App 同步"选中状态"
  // （之前只挂了 TIA，导致 ladedit.js 里 `if (window.App) …` 全是死代码，
  //   重绘时会把已经清掉的 selSeg / selEl 又恢复回来）
  window.App = App;

})();































