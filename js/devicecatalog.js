/* ============================================================
   devicecatalog.js — 硬件目录（对齐 TIA「添加新设备」的设备树）
   只收录本仿真器用得上的部分：控制器 / HMI / PC 系统 / 驱动
   S7-1200 系列按真实型号与订货号填写，班级最常用 1215C DC/DC/DC
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- S7-1200 CPU 型号 ---------------- */
  // [显示名, 订货号, 默认版本, 说明]
  var S71200 = [
    ['CPU 1211C AC/DC/Rly', '6ES7 211-1BE40-0XB0', 'V4.4',
      '100 KB 工作存储器；120/240VAC 电源，板载 DI6 x 120/240VAC、DQ4 x 继电器、AI2；板载 4 个高速计数器；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1211C DC/DC/DC', '6ES7 211-1AE40-0XB0', 'V4.4',
      '100 KB 工作存储器；24VDC 电源，板载 DI6 x 24VDC、DQ4 x 24VDC、AI2；板载 4 个高速计数器；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1211C DC/DC/Rly', '6ES7 211-1HE40-0XB0', 'V4.4',
      '100 KB 工作存储器；24VDC 电源，板载 DI6 x 24VDC、DQ4 x 继电器、AI2；板载 4 个高速计数器；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1212C AC/DC/Rly', '6ES7 212-1BE40-0XB0', 'V4.4',
      '125 KB 工作存储器；120/240VAC 电源，板载 DI8 x 120/240VAC、DQ6 x 继电器、AI2；板载 4 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1212C DC/DC/DC', '6ES7 212-1AE40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI8 x 24VDC、DQ6 x 24VDC、AI2；板载 4 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1212C DC/DC/Rly', '6ES7 212-1HE40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI8 x 24VDC、DQ6 x 继电器、AI2；板载 4 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，单端口'],
    ['CPU 1214C AC/DC/Rly', '6ES7 214-1BG40-0XB0', 'V4.4',
      '125 KB 工作存储器；120/240VAC 电源，板载 DI14 x 120/240VAC、DQ10 x 继电器、AI2；板载 6 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，双端口'],
    ['CPU 1214C DC/DC/DC', '6ES7 214-1AG40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2；板载 6 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，双端口'],
    ['CPU 1214C DC/DC/Rly', '6ES7 214-1HG40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 继电器、AI2；板载 6 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，双端口'],
    ['CPU 1215C AC/DC/Rly', '6ES7 215-1BG40-0XB0', 'V4.4',
      '125 KB 工作存储器；120/240VAC 电源，板载 DI14 x 120/240VAC、DQ10 x 继电器、AI2 和 AQ2；板载 6 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，双端口'],
    ['CPU 1215C DC/DC/DC', '6ES7 215-1AG40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2 和 AQ2；' +
      '板载 6 个高速计数器和 4 路脉冲输出；信号板扩展板载式 IO；' +
      '多达 3 个可进行串行通信的通信模块；多达 8 个可用于 I/O 扩展的信号模块；' +
      'PROFINET IO 控制器，双端口，智能设备，TCP/IP 传输协议，开放式用户安全通信，' +
      'S7 通信，Web 服务器，OPC UA；服务器 DA'],
    ['CPU 1215C DC/DC/Rly', '6ES7 215-1HG40-0XB0', 'V4.4',
      '125 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 继电器、AI2 和 AQ2；' +
      '板载 6 个高速计数器和 4 路脉冲输出；信号板扩展板载式 IO；' +
      '多达 3 个可进行串行通信的通信模块；多达 8 个可用于 I/O 扩展的信号模块；' +
      'PROFINET IO 控制器，双端口，智能设备，TCP/IP 传输协议，开放式用户安全通信，S7 通信'],
    ['CPU 1217C DC/DC/DC', '6ES7 217-1AG40-0XB0', 'V4.4',
      '150 KB 工作存储器；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2 和 AQ2；' +
      '板载 6 个高速计数器和 4 路脉冲输出；信号板扩展；PROFINET IO 控制器，双端口'],
    ['CPU 1212FC DC/DC/DC', '6ES7 212-1AF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI8 x 24VDC、DQ6 x 24VDC、AI2；故障安全型；PROFINET IO 控制器，单端口'],
    ['CPU 1212FC DC/DC/Rly', '6ES7 212-1HF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI8 x 24VDC、DQ6 x 继电器、AI2；故障安全型；PROFINET IO 控制器，单端口'],
    ['CPU 1214FC DC/DC/DC', '6ES7 214-1AF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2；故障安全型；PROFINET IO 控制器，双端口'],
    ['CPU 1214FC DC/DC/Rly', '6ES7 214-1HF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 继电器、AI2；故障安全型；PROFINET IO 控制器，双端口'],
    ['CPU 1215FC DC/DC/DC', '6ES7 215-1AF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 24VDC、AI2 和 AQ2；故障安全型；PROFINET IO 控制器，双端口'],
    ['CPU 1215FC DC/DC/Rly', '6ES7 215-1HF40-0XB0', 'V4.4',
      '125 KB 工作存储器（其中 100 KB 用于 F 程序）；24VDC 电源，板载 DI14 x 24VDC、DQ10 x 继电器、AI2 和 AQ2；故障安全型；PROFINET IO 控制器，双端口'],
    ['CPU SIPLUS', '6AG1 215-1AG40-2XB0', 'V4.4',
      'SIPLUS 极端条件型 CPU 1215C DC/DC/DC；-40…+70°C；带防腐涂层；功能与 6ES7 215-1AG40-0XB0 相同'],
    ['非特定的 CPU 1200', '6ES7 2xx-1xx40-0XB0', 'V4.4',
      '通用 S7-1200 CPU 占位型号，用于后续再确定具体订货号'],
    ['未指定的 CPU 1200 SIPLUS', '6AG1 2xx-1xx40-2XB0', 'V4.4',
      '通用 SIPLUS S7-1200 CPU 占位型号']
  ];

  function cpuItem(row) {
    return {
      name: row[0], orderNo: row[1], version: row[2], desc: row[3],
      family: 'S7-1200', kind: 'cpu'
    };
  }

  /* ---------------- 设备树 ---------------- */
  // 每个节点：{name, expanded?, children?, items?}
  var TREE = {
    controller: {
      label: '控制器',
      icon: 'cpu',
      children: [
        {
          label: 'DONGENS S7-1200',
          children: [
            { label: 'CPU', items: S71200.map(cpuItem) },
            { label: 'CPU 故障安全型', items: [] },
            { label: '信号模块', items: [] },
            { label: '信号板', items: [] },
            { label: '通信模块', items: [] }
          ]
        },
        {
          label: 'DONGENS S7-1500',
          children: [
            { label: 'CPU', items: [] },
            { label: '信号模块', items: [] }
          ]
        },
        { label: 'DONGENS Drive Controller', children: [{ label: 'CPU', items: [] }] },
        {
          label: 'DONGENS S7-300',
          children: [{ label: 'CPU', items: [] }, { label: '信号模块', items: [] }]
        },
        {
          label: 'DONGENS S7-400',
          children: [{ label: 'CPU', items: [] }, { label: '信号模块', items: [] }]
        },
        { label: 'DONGENS ET200 CPU', children: [{ label: '接口模块', items: [] }] },
        { label: 'Device proxy', children: [] }
      ]
    },
    hmi: {
      label: 'HMI',
      icon: 'hmi',
      children: [
        { label: 'DONGENS 精简面板', items: [] },
        { label: 'DONGENS 精智面板', items: [] },
        { label: 'DONGENS WinCC', items: [] }
      ]
    },
    pc: {
      label: 'PC 系统',
      icon: 'pc',
      children: [
        { label: 'DONGENS PC', items: [] },
        { label: 'DONGENS Field PG', items: [] }
      ]
    },
    drive: {
      label: '驱动',
      icon: 'drive',
      children: [
        { label: 'SINAMICS G 系列', items: [] },
        { label: 'SINAMICS S 系列', items: [] },
        { label: 'SINAMICS V 系列', items: [] }
      ]
    }
  };

  // 类别顺序（对应左侧四个方块）
  var CATEGORIES = ['controller', 'hmi', 'pc', 'drive'];

  /* ---------------- 常用机型（班级最常用） ---------------- */
  var RECOMMENDED = 'CPU 1215C DC/DC/DC';

  function findItem(name) {
    var found = null;
    S71200.forEach(function (row) {
      if (row[0] === name) found = cpuItem(row);
    });
    return found;
  }

  root.DeviceCatalog = {
    TREE: TREE,
    CATEGORIES: CATEGORIES,
    S71200: S71200,
    RECOMMENDED: RECOMMENDED,
    find: findItem,
    cpuList: function () { return S71200.map(cpuItem); }
  };
})(window);
