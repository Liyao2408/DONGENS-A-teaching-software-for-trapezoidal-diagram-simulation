/* ============================================================
   store.js — 项目存储层
   职责：
     1. 项目在 localStorage 持久化（按 id 存），刷新/关页面不丢
     2. 维护"最近使用的项目"列表（对齐 TIA 门户的最近项目表）
     3. 导入/导出 .dongens.json 文件
   ============================================================ */
(function (root) {
  'use strict';

  var KEY_PROJ = 'tiasim.project.';   // + id
  var KEY_LIST = 'tiasim.projects';   // 项目索引数组
  var KEY_LAST = 'tiasim.lastOpened'; // 上次打开的项目 id

  function safeParse(s, dflt) {
    try { return JSON.parse(s); } catch (e) { return dflt; }
  }

  function nowStr() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 索引（最近项目列表） ---------------- */
  function listProjects() {
    var arr = safeParse(localStorage.getItem(KEY_LIST), []);
    if (!Array.isArray(arr)) arr = [];
    return arr;
  }

  function saveList(arr) {
    try { localStorage.setItem(KEY_LIST, JSON.stringify(arr)); } catch (e) { }
  }

  /* ---------------- 项目读写 ---------------- */
  // 保存项目（新建或更新）
  function save(project) {
    if (!project) return null;
    if (!project.id) project.id = uid();

    var payload = {
      format: 'DSI/2.0',
      savedAt: nowStr(),
      project: project
    };

    var ok = true;
    try {
      localStorage.setItem(KEY_PROJ + project.id, JSON.stringify(payload));
    } catch (e) {
      ok = false;
      // 通常是超出配额
      return { ok: false, error: '存储空间不足（' + (e.name || 'Error') + '），请先删除部分项目' };
    }

    // 更新索引
    var list = listProjects();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === project.id) { idx = i; break; }
    var meta = {
      id: project.id,
      name: project.name || '未命名项目',
      path: project.path || ('C:\\Users\\Administrator\\Documents\\Automation\\' + (project.name || '未命名')),
      version: project.version || 'V16',
      device: project.device ? project.device.type : '',
      comment: project.comment || '',
      changedAt: nowStr(),
      size: JSON.stringify(payload).length
    };
    if (idx >= 0) list[idx] = meta;
    else list.unshift(meta);
    // 按修改时间倒序（新在前）
    list.sort(function (a, b) { return a.changedAt < b.changedAt ? 1 : -1; });
    saveList(list);
    localStorage.setItem(KEY_LAST, project.id);

    return { ok: true, meta: meta };
  }

  function load(id) {
    var raw = localStorage.getItem(KEY_PROJ + id);
    if (!raw) return null;
    var payload = safeParse(raw, null);
    if (!payload || !payload.project) return null;
    return payload.project;
  }

  function remove(id) {
    localStorage.removeItem(KEY_PROJ + id);
    var list = listProjects().filter(function (x) { return x.id !== id; });
    saveList(list);
    if (localStorage.getItem(KEY_LAST) === id) localStorage.removeItem(KEY_LAST);
  }

  function exists(id) {
    return !!localStorage.getItem(KEY_PROJ + id);
  }

  function lastOpened() {
    return localStorage.getItem(KEY_LAST);
  }

  function setLastOpened(id) {
    if (id) localStorage.setItem(KEY_LAST, id);
  }

  /* ---------------- 文件导入导出 ---------------- */
  function exportFile(project) {
    var payload = {
      format: 'DSI/2.0',
      savedAt: nowStr(),
      project: project
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (project.name || 'Project1') + '.dongens.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    return a.download;
  }

  function importFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var data = safeParse(fr.result, null);
      if (!data) { cb('文件不是有效的 JSON'); return; }
      var proj = data.project || data;
      if (!proj || !proj.blocks) { cb('文件里没有可识别的项目数据'); return; }
      cb(null, proj);
    };
    fr.onerror = function () { cb('读取文件失败'); };
    fr.readAsText(file);
  }

  /* ---------------- 示例项目（首次使用时的种子） ---------------- */
  function seedIfEmpty(factory) {
    var list = listProjects();
    if (list.length > 0) return list;
    // 首次使用：造一个示例项目存起来
    var demo = factory();
    demo.name = '示例项目_电机启保停';
    demo.path = 'C:\\Users\\Administrator\\Documents\\Automation\\示例项目_电机启保停';
    var r = save(demo);
    return listProjects();
  }

  root.ProjectStore = {
    list: listProjects,
    save: save,
    load: load,
    remove: remove,
    exists: exists,
    lastOpened: lastOpened,
    setLastOpened: setLastOpened,
    exportFile: exportFile,
    importFile: importFile,
    seedIfEmpty: seedIfEmpty,
    nowStr: nowStr,
    uid: uid
  };
})(window);
