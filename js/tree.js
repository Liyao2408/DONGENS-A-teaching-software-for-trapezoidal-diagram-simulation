/* ============================================================
   tree.js — 项目树（对齐 DSI Platform 项目树结构）
   特点：
     · 数据驱动：buildTree(project) 生成完整层级
     · 任意层级展开/折叠，展开状态保存在内存（切项目/重渲染不丢）
     · 图标用内联 SVG（贴近 TIA 的工业软件观感，不依赖系统 emoji）
   ============================================================ */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 图标（内联 SVG，14×14） ---------------- */
  var S = 'width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle"';
  var ICON = {
    // 文件夹（黄）
    folder: '<svg ' + S + '><path d="M1.5 3.5h4.2l1.3 1.6h7.5v8.4h-13z" fill="#f2c94c" stroke="#b8912a" stroke-width="1"/></svg>',
    folderOpen: '<svg ' + S + '><path d="M1.5 3.5h4.2l1.3 1.6h7.5v2H1.5z" fill="#d9ae30" stroke="#b8912a" stroke-width="1"/><path d="M3 7.1h12l-1.8 6.4H1.2z" fill="#f2c94c" stroke="#b8912a" stroke-width="1"/></svg>',
    // 项目（蓝文件夹）
    project: '<svg ' + S + '><path d="M1.5 3.5h4.2l1.3 1.6h7.5v8.4h-13z" fill="#7ba7c9" stroke="#4a7ba0" stroke-width="1"/></svg>',
    // PLC / CPU（深蓝设备）
    plc: '<svg ' + S + '><rect x="2.5" y="4" width="11" height="8.5" rx="0.6" fill="#5d7f9c" stroke="#3d5f7c" stroke-width="1"/><rect x="4" y="5.5" width="6.5" height="1.8" fill="#a8cde8"/><rect x="4" y="8.2" width="4" height="1.6" fill="#a8cde8"/><circle cx="11.5" cy="6.3" r="0.9" fill="#8ee0a0"/></svg>',
    // 添加（星）
    add: '<svg ' + S + '><path d="M8 1.4l1.55 4.3 4.35 1.5-4.35 1.55L8 13.1 6.45 8.75 2.1 7.2l4.35-1.5z" fill="#f2c94c" stroke="#c09a20" stroke-width=".8"/></svg>',
    // 网络（地球）
    net: '<svg ' + S + '><circle cx="8" cy="8" r="6.2" fill="#8fc7e8" stroke="#4a7ba0" stroke-width="1"/><ellipse cx="8" cy="8" rx="6.2" ry="2.6" fill="none" stroke="#4a7ba0" stroke-width=".9"/><ellipse cx="8" cy="8" rx="2.6" ry="6.2" fill="none" stroke="#4a7ba0" stroke-width=".9"/></svg>',
    // 设备组态（齿轮=圆+辐条）
    gear: '<svg ' + S + '><circle cx="8" cy="8" r="2.6" fill="none" stroke="#5d7f9c" stroke-width="1.5"/><g stroke="#5d7f9c" stroke-width="1.7"><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4"/></g></svg>',
    // 在线和诊断（扳手+螺丝刀）
    tool: '<svg ' + S + '><path d="M9.8 2.2a3.4 3.4 0 00-3 5.2L2.2 12l1.9 1.9 4.6-4.6a3.4 3.4 0 004.7-4.4l-2 2-1.6-1.6 2-2a3.4 3.4 0 00-2-1.1z" fill="#e0655a" stroke="#a84038" stroke-width=".8"/></svg>',
    // 程序块（书/方块）
    blocks: '<svg ' + S + '><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1" fill="#8fb8d8" stroke="#4a7ba0" stroke-width="1"/><path d="M2.2 5.6h11.6" stroke="#4a7ba0" stroke-width="1"/><path d="M5 8h6M5 10.2h4" stroke="#eef6fc" stroke-width="1.2"/></svg>',
    // 块对象（OB/FB/FC/DB 各色）
    ob: '<svg ' + S + '><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="#4a90d9" stroke="#2a6db0" stroke-width="1"/><path d="M5 6h6M5 8.4h6M5 10.8h4" stroke="#fff" stroke-width="1.3"/></svg>',
    fb: '<svg ' + S + '><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="#e8b64c" stroke="#b8862a" stroke-width="1"/><path d="M5 6h6M5 8.4h6M5 10.8h4" stroke="#fff" stroke-width="1.3"/></svg>',
    fc: '<svg ' + S + '><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="#5cb85c" stroke="#3a8a3a" stroke-width="1"/><path d="M5 6h6M5 8.4h6M5 10.8h4" stroke="#fff" stroke-width="1.3"/></svg>',
    db: '<svg ' + S + '><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="#9b6fc0" stroke="#6a4390" stroke-width="1"/><path d="M5 6h6M5 8.4h6M5 10.8h4" stroke="#fff" stroke-width="1.3"/></svg>',
    // 变量表（表格）
    table: '<svg ' + S + '><rect x="1.8" y="3" width="12.4" height="10" fill="#fff" stroke="#4a7ba0" stroke-width="1"/><path d="M1.8 6h12.4M1.8 9.2h12.4M6 6v7M10.5 6v7" stroke="#7aa8c8" stroke-width=".9"/><rect x="1.8" y="3" width="12.4" height="3" fill="#bfd9ec"/></svg>',
    // 眼睛（显示所有变量）
    eye: '<svg ' + S + '><path d="M1 8s2.6-4 7-4 7 4 7 4-2.6 4-7 4-7-4-7-4z" fill="none" stroke="#4a7ba0" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" fill="#4a7ba0"/></svg>',
    // 文档
    doc: '<svg ' + S + '><path d="M3.2 1.6h6.4l3.2 3.2v9.6H3.2z" fill="#fff" stroke="#7a8a99" stroke-width="1"/><path d="M9.6 1.6v3.2h3.2" fill="none" stroke="#7a8a99" stroke-width="1"/><path d="M5.2 7.2h5.6M5.2 9.4h5.6M5.2 11.6h3.6" stroke="#9aa9b8" stroke-width="1"/></svg>',
    // 列表/报警
    list: '<svg ' + S + '><rect x="2" y="3" width="12" height="10" rx=".8" fill="#fff" stroke="#c08a3a" stroke-width="1"/><path d="M4.4 5.8h7.2M4.4 8h7.2M4.4 10.2h5" stroke="#c08a3a" stroke-width="1.1"/></svg>',
    // 锁（安全设置）
    lock: '<svg ' + S + '><rect x="3.4" y="7" width="9.2" height="7" rx="1" fill="#e8b64c" stroke="#b8862a" stroke-width="1"/><path d="M5.4 7V5.2a2.6 2.6 0 015.2 0V7" fill="none" stroke="#8a6a20" stroke-width="1.3"/></svg>',
    // 人（公共数据）
    people: '<svg ' + S + '><circle cx="6" cy="5.2" r="2.3" fill="#7ba7c9" stroke="#4a7ba0" stroke-width=".9"/><path d="M1.8 13.4c0-2.4 1.9-4 4.2-4s4.2 1.6 4.2 4z" fill="#7ba7c9" stroke="#4a7ba0" stroke-width=".9"/><circle cx="11.4" cy="5.8" r="1.8" fill="#a8cde8" stroke="#4a7ba0" stroke-width=".8"/><path d="M9.6 13.4c0-1.9 1.2-3.2 2.6-3.2s2.4 1.1 2.4 3.2z" fill="#a8cde8" stroke="#4a7ba0" stroke-width=".8"/></svg>',
    // 交叉（跨设备）
    cross: '<svg ' + S + '><rect x="2" y="2" width="5.4" height="5.4" fill="#8fc7e8" stroke="#4a7ba0" stroke-width="1"/><rect x="8.6" y="8.6" width="5.4" height="5.4" fill="#f2c94c" stroke="#b8912a" stroke-width="1"/><path d="M4.7 8.6v2.6h3.9" fill="none" stroke="#4a7ba0" stroke-width="1.2"/></svg>',
    // 备份（磁盘）
    disk: '<svg ' + S + '><rect x="2" y="2.6" width="12" height="10.8" rx="1" fill="#7ba7c9" stroke="#4a7ba0" stroke-width="1"/><rect x="4.4" y="3.6" width="7.2" height="3.4" fill="#eef6fc"/><rect x="4.4" y="9" width="7.2" height="3.4" fill="#eef6fc"/></svg>',
    // 曲线（Traces）
    chart: '<svg ' + S + '><rect x="2" y="2.6" width="12" height="10.8" fill="#fff" stroke="#4a7ba0" stroke-width="1"/><path d="M3.4 11l2.6-3.4 2.2 1.8 2.4-4 2.4 2.2" fill="none" stroke="#e0655a" stroke-width="1.4"/></svg>',
    // 链接（OPC UA）
    link: '<svg ' + S + '><path d="M6.6 9.4a2.4 2.4 0 010-3.4l2-2a2.4 2.4 0 013.4 3.4l-1 1" fill="none" stroke="#4a7ba0" stroke-width="1.4"/><path d="M9.4 6.6a2.4 2.4 0 010 3.4l-2 2a2.4 2.4 0 01-3.4-3.4l1-1" fill="none" stroke="#4a7ba0" stroke-width="1.4"/></svg>',
    // 芯片（本地模块）
    chip: '<svg ' + S + '><rect x="4" y="4" width="8" height="8" rx=".8" fill="#8fb8d8" stroke="#4a7ba0" stroke-width="1"/><g stroke="#4a7ba0" stroke-width="1.1"><path d="M6 2.2v1.8M8 2.2v1.8M10 2.2v1.8M6 12v1.8M8 12v1.8M10 12v1.8M2.2 6h1.8M2.2 8h1.8M2.2 10h1.8M12 6h1.8M12 8h1.8M12 10h1.8"/></g></svg>',
    // 信息
    info: '<svg ' + S + '><circle cx="8" cy="8" r="6.2" fill="#8fc7e8" stroke="#4a7ba0" stroke-width="1"/><path d="M8 6.8v4.4" stroke="#1e3a52" stroke-width="1.6"/><circle cx="8" cy="5" r=".9" fill="#1e3a52"/></svg>',
    // 包（未分组设备）
    box: '<svg ' + S + '><path d="M8 1.6l6 3v7l-6 3-6-3v-7z" fill="#c9b48a" stroke="#8a7448" stroke-width="1"/><path d="M2 4.6l6 3 6-3M8 7.6v7" fill="none" stroke="#8a7448" stroke-width="1"/></svg>',
    // 齿轮组（工艺对象）
    motion: '<svg ' + S + '><circle cx="6" cy="6" r="2" fill="none" stroke="#5d7f9c" stroke-width="1.4"/><circle cx="11" cy="10.6" r="1.6" fill="none" stroke="#5d7f9c" stroke-width="1.3"/><path d="M6 2.2v1M6 8.8v1M2.2 6h1M8.8 6h1" stroke="#5d7f9c" stroke-width="1.4"/></svg>',
    // 数据块类型
    datatype: '<svg ' + S + '><rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="#6c8ebf" stroke="#4a6a9a" stroke-width="1"/><text x="8" y="11" text-anchor="middle" font-size="7" fill="#fff" font-family="Consolas">T</text></svg>'
  };

  function ic(name) {
    return '<span class="ticon">' + (ICON[name] || ICON.doc) + '</span>';
  }

  /* ---------------- 构建树数据 ---------------- */
  function buildTree(p) {
    var dev = p.device || {};
    var cpuLabel = dev.name + ' [' + (dev.type || 'CPU') + ']';

    var blockNodes = (p.blocks || []).map(function (b) {
      var iconName = b.type === 'OB' ? 'ob' : (b.type === 'FB' ? 'fb' : (b.type === 'FC' ? 'fc' : 'db'));
      return {
        id: 'block:' + b.name,
        label: b.name + (b.obNumber ? ' [' + (b.type === 'OB' ? 'OB' + b.obNumber : b.type) + ']' : ''),
        icon: iconName,
        badge: b.type
      };
    });

    var tagCount = (p.tags || []).length;
    var watchCount = (p.watchTables || []).length;

    return [{
      id: 'proj', label: p.name, icon: 'project', children: [
        { id: 'addDevice', label: '添加新设备', icon: 'add' },
        { id: 'devnet', label: '设备和网络', icon: 'net' },
        {
          id: 'plc', label: cpuLabel, icon: 'plc', children: [
            { id: 'devconfig', label: '设备组态', icon: 'gear' },
            { id: 'diagnostics', label: '在线和诊断', icon: 'tool' },
            {
              id: 'blocks', label: '程序块', icon: 'blocks', children: [
                { id: 'addBlock', label: '添加新块', icon: 'add' }
              ].concat(blockNodes).concat([
                { id: 'sysblocks', label: '系统块', icon: 'folder', children: [] }
              ])
            },
            { id: 'techobj', label: '工艺对象', icon: 'motion', children: [] },
            { id: 'extsrc', label: '外部源文件', icon: 'folder', children: [] },
            {
              id: 'variables', label: 'PLC 变量', icon: 'table', children: [
                { id: 'varsAll', label: '显示所有变量', icon: 'eye' },
                { id: 'varsAdd', label: '添加新变量表', icon: 'add' },
                { id: 'tags:0', label: '默认变量表 [' + tagCount + ']', icon: 'table' }
              ]
            },
            { id: 'datatypes', label: 'PLC 数据类型', icon: 'datatype', children: [] },
            {
              id: 'watchforce', label: '监控与强制表', icon: 'table', children: [
                { id: 'watchlist', label: '监控表 [' + watchCount + ']', icon: 'table' },
                { id: 'forcelist', label: '强制表', icon: 'table' }
              ]
            },
            { id: 'onlinebackup', label: '在线备份', icon: 'disk', children: [] },
            { id: 'traces', label: 'Traces', icon: 'chart', children: [] },
            { id: 'opcua', label: 'OPC UA 通信', icon: 'link', children: [] },
            { id: 'devproxy', label: '设备代理数据', icon: 'doc' },
            { id: 'proginfo', label: '程序信息', icon: 'info' },
            { id: 'alarmtext', label: 'PLC 报警文本列表', icon: 'list', children: [] },
            { id: 'localmod', label: '本地模块', icon: 'chip', children: [] }
          ]
        },
        { id: 'ungrouped', label: '未分组的设备', icon: 'box', children: [] },
        { id: 'security', label: '安全设置', icon: 'lock', children: [] },
        { id: 'crossdev', label: '跨设备功能', icon: 'cross', children: [] },
        { id: 'common', label: '公共数据', icon: 'people', children: [] }
      ]
    }];
  }

  /* ---------------- 渲染 ---------------- */
  // openState: { id: true/false }
  function render(nodes, openState, opts) {
    opts = opts || {};
    var out = [];

    function walk(list, depth) {
      list.forEach(function (n) {
        var hasKids = n.children && n.children.length > 0;
        // 有 children 定义但为空数组，也当成可展开（展开后显示"空"）
        var expandable = n.children !== undefined;
        var isOpen = expandable && !!openState[n.id];
        var pad = 4 + depth * 15;

        out.push(
          '<div class="node' + (opts.selected === n.id ? ' selected' : '') +
          '" data-node="' + esc(n.id) + '" data-expandable="' + (expandable ? '1' : '0') +
          '" style="padding-left:' + pad + 'px">' +
          '<span class="arrow' + (expandable ? '' : ' none') + '">' +
          (expandable ? (isOpen ? '▾' : '▸') : '') + '</span>' +
          ic(n.icon) +
          '<span class="label">' + esc(n.label) + '</span>' +
          (n.badge ? '<span class="badge">' + esc(n.badge) + '</span>' : '') +
          '</div>'
        );

        if (expandable && isOpen) {
          if (!n.children.length) {
            out.push('<div class="tree-empty" style="padding-left:' + (pad + 30) + 'px">（空）</div>');
          } else {
            walk(n.children, depth + 1);
          }
        }
      });
    }

    walk(nodes, 0);
    return out.join('');
  }

  root.Tree = {
    build: buildTree,
    render: render,
    ICON: ICON
  };
})(window);
