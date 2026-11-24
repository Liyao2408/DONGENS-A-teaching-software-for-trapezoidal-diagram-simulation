/* ============================================================
   portal.js — 启动门户（对齐 DSI Platform 启动界面）
   三个右侧视图：
     open       打开现有项目（最近项目表）
     new        创建新项目（表单）
     firststeps 新手上路（引导流程图）
   交互：
     · 中间动作项点击 → 切换右侧视图
     · 双击项目行 / 单击后点"打开" → 进入工程
     · 创建表单填好后点"创建" → 进度框 → 停在新手上路页
     · 新手上路页各入口 → 进入工程并定位到对应页面
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

  var P = {
    selectedId: null,
    currentView: 'open',
    pendingProject: null,     // 已创建但还没进工程的项目
    onOpen: null,             // function(project)  打开已有项目
    onCreate: null,           // function(spec)      创建新项目，返回 project 或 null
    onEnterProject: null      // function(project, target) 进入工程
  };

  /* ============================================================
   * 视图切换
   * ============================================================ */
  var VIEWS_PROJECT = ['open', 'new', 'firststeps'];
  var VIEWS_DEVICE = ['devices', 'adddevice'];

  function switchView(name) {
    var valid = VIEWS_PROJECT.concat(VIEWS_DEVICE);
    if (valid.indexOf(name) < 0) return;
    P.currentView = name;

    // 显示对应视图
    $$('.pr-view').forEach(function (v) {
      v.style.display = (v.dataset.view === name) ? 'flex' : 'none';
    });

    // 切换动作栏分组（项目组 / 设备组）
    var isDevice = VIEWS_DEVICE.indexOf(name) >= 0;
    $$('.portal-actions .pa-group').forEach(function (g) {
      g.style.display = (g.dataset.group === (isDevice ? 'devices' : 'project')) ? 'flex' : 'none';
    });

    // 同步动作项高亮
    var map = {
      open: 'actOpenProject', new: 'actNewProject', firststeps: 'actFirstSteps',
      devices: 'actShowDevices', adddevice: 'actAddDevice'
    };
    $$('.portal-actions .pa-item').forEach(function (x) { x.classList.remove('active'); });
    var el = document.getElementById(map[name]);
    if (el) el.classList.add('active');

    // 进入具体视图时的初始化
    if (name === 'open') render();
    if (name === 'new') prepareNewForm();
    if (name === 'firststeps') renderFirstSteps();
    if (name === 'devices') renderDevices();
    if (name === 'adddevice') prepareAddDevice();
  }

  /* ============================================================
   * 视图 1：打开现有项目
   * ============================================================ */
  function render() {
    var list = root.ProjectStore.list();
    var tbody = $('#portalTable');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">' +
        '还没有项目。点“创建新项目”开始，或从“浏览…”导入文件。</td></tr>';
      updateButtons();
      return;
    }

    var h = '';
    list.forEach(function (p) {
      var sel = (p.id === P.selectedId) ? ' class="sel"' : '';
      h += '<tr data-id="' + esc(p.id) + '"' + sel + '>' +
        '<td class="c-check"><span class="chk-box"></span></td>' +
        '<td class="c-name">' + esc(p.name) + '<span class="ext">.ap16</span></td>' +
        '<td class="c-path">' + esc(p.path || '') + '</td>' +
        '<td class="c-time">' + esc(p.changedAt || '') + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = h;

    $$('#portalTable tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        P.selectedId = tr.dataset.id;
        $$('#portalTable tr').forEach(function (x) { x.classList.remove('sel'); });
        tr.classList.add('sel');
        updateButtons();
      });
      tr.addEventListener('dblclick', function () {
        P.selectedId = tr.dataset.id;
        doOpen();
      });
      var box = tr.querySelector('.chk-box');
      if (box) box.addEventListener('click', function (e) {
        e.stopPropagation();
        P.selectedId = tr.dataset.id;
        $$('#portalTable tr').forEach(function (x) { x.classList.remove('sel'); });
        tr.classList.add('sel');
        updateButtons();
      });
    });

    updateButtons();
  }

  function updateButtons() {
    var has = !!P.selectedId;
    var btnOpen = $('#btnOpen');
    var btnDel = $('#btnDelete');
    if (btnOpen) btnOpen.disabled = !has;
    if (btnDel) btnDel.disabled = !has;
  }

  function doOpen() {
    if (!P.selectedId) return;
    var proj = root.ProjectStore.load(P.selectedId);
    if (!proj) {
      alert('项目数据读取失败，可能已被删除。');
      render();
      return;
    }
    root.ProjectStore.setLastOpened(P.selectedId);
    P.pendingProject = null;
    refreshOpenedPath(proj);
    if (P.onOpen) P.onOpen(proj);
  }

  function doDelete() {
    if (!P.selectedId) return;
    var list = root.ProjectStore.list();
    var meta = list.filter(function (x) { return x.id === P.selectedId; })[0];
    if (!meta) return;
    if (!confirm('确定删除项目「' + meta.name + '」吗？\n此操作不可撤销。')) return;
    root.ProjectStore.remove(P.selectedId);
    P.selectedId = null;
    render();
  }

  function doBrowse() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.dongens.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      root.ProjectStore.importFile(f, function (err, proj) {
        if (err) { alert('导入失败：' + err); return; }
        delete proj.id;
        var r = root.ProjectStore.save(proj);
        if (!r.ok) { alert('保存失败：' + r.error); return; }
        P.selectedId = r.meta.id;
        render();
      });
    };
    inp.click();
  }

  /* ============================================================
   * 视图 2：创建新项目
   * ============================================================ */
  var DEFAULT_PATH = 'C:\\Users\\Administrator\\Documents\\Automation';

  // 生成一个不与现有项目重名的默认名（项目1、项目2…）
  function nextProjectName() {
    var list = root.ProjectStore.list();
    var names = {};
    list.forEach(function (x) { names[x.name] = true; });
    for (var i = 1; i < 999; i++) {
      var n = '项目' + i;
      if (!names[n]) return n;
    }
    return '项目' + Date.now().toString(36);
  }

  function prepareNewForm() {
    var nameEl = $('#npName');
    if (!nameEl) return;

    nameEl.value = nextProjectName();
    var pathEl = $('#npPath');
    if (pathEl) pathEl.value = DEFAULT_PATH;
    var verEl = $('#npVersion');
    if (verEl) verEl.value = 'V16';
    var auEl = $('#npAuthor');
    if (auEl) auEl.value = 'Administrator';
    var cmEl = $('#npComment');
    if (cmEl) cmEl.value = '';
    setFormError('');

    // 名称自动聚焦并全选（对齐真实 TIA：默认名被选中，可直接覆盖）
    setTimeout(function () {
      nameEl.focus();
      nameEl.select();
    }, 30);
  }

  function setFormError(msg, isInfo) {
    var el = $('#npError');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'pf-note' + (isInfo ? ' info' : '');
  }

  function doCreate() {
    var name = ($('#npName').value || '').trim();
    var path = ($('#npPath').value || '').trim() || DEFAULT_PATH;
    var version = $('#npVersion').value;
    var author = ($('#npAuthor').value || '').trim();
    var comment = ($('#npComment').value || '').trim();

    // 校验
    if (!name) {
      setFormError('请输入项目名称');
      $('#npName').focus();
      return;
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      setFormError('项目名称不能包含 \\ / : * ? " < > |');
      $('#npName').focus();
      return;
    }
    var exist = root.ProjectStore.list().filter(function (x) { return x.name === name; })[0];
    if (exist) {
      if (!confirm('已存在同名项目「' + name + '」，是否覆盖？')) {
        setFormError('已存在同名项目，请换一个名称');
        return;
      }
    }
    setFormError('');

    var fullPath = path.replace(/\\+$/, '') + '\\' + name;

    // 进度框（按需求：运行很快，极短即可）
    showCreateProgress(fullPath, function () {
      // 真正创建
      var proj = null;
      if (P.onCreate) {
        proj = P.onCreate({
          name: name, path: fullPath, version: version,
          author: author, comment: comment, overwrite: !!exist
        });
      }
      if (!proj) {
        setFormError('创建失败');
        return;
      }
      P.pendingProject = proj;
      refreshOpenedPath(proj);
      // 创建完成 → 停在新手上路（对齐 TIA 截图）
      switchView('firststeps');
    });
  }

  /* ---------------- 创建进度对话框 ---------------- */
  var progressTimer = null;
  var progressCancelled = false;

  function showCreateProgress(fullPath, onDone) {
    closeCreateProgress();
    progressCancelled = false;

    var mask = document.createElement('div');
    mask.className = 'create-progress-mask';
    mask.id = 'createProgress';
    mask.innerHTML =
      '<div class="create-progress">' +
      '<div class="cp-title">正在创建项目...</div>' +
      '<div class="cp-body">' +
      '<div class="cp-icon">⏳</div>' +
      '<div class="cp-text"><b>正在创建项目...</b><br>' +
      '正在创建项目 <span class="cp-path">' + esc(fullPath) + '.ap16</span>。请稍候。</div>' +
      '</div>' +
      '<div class="cp-foot"><button class="cp-btn" id="cpCancel">取消</button></div>' +
      '</div>';
    document.body.appendChild(mask);

    var cancelBtn = $('#cpCancel');
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        progressCancelled = true;
        closeCreateProgress();
        setFormError('已取消创建', true);
      };
    }

    // 500ms 后自动完成（够看清，不拖沓）
    progressTimer = setTimeout(function () {
      progressTimer = null;
      if (progressCancelled) return;
      closeCreateProgress();
      onDone();
    }, 500);
  }

  function closeCreateProgress() {
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    var m = $('#createProgress');
    if (m) m.remove();
  }

  /* ============================================================
   * 视图 3：新手上路
   * ============================================================ */
  function renderFirstSteps() {
    var proj = P.pendingProject;
    if (!proj) {
      // 没有 pending 时，尝试用最近打开的项目
      var last = root.ProjectStore.lastOpened();
      if (last) {
        var meta = root.ProjectStore.list().filter(function (x) { return x.id === last; })[0];
        if (meta) {
          $('#fsIntro').textContent = '项目："' + meta.name + '"已成功打开。请选择下一步：';
          return;
        }
      }
      $('#fsIntro').textContent = '项目：还没有打开项目。请先创建或打开一个项目。';
      return;
    }
    $('#fsIntro').textContent = '项目："' + proj.name + '"已成功打开。请选择下一步：';
  }

  function doFirstStep(target) {
    var proj = P.pendingProject;
    if (!proj) {
      // 没有待进入项目：回打开视图提示
      switchView('open');
      alert('还没有打开项目，请先创建或打开一个项目。');
      return;
    }

    // 未实现模块：明确告知，不静默
    if (target === 'motion') {
      alert('运动控制 & 技术\n\n本仿真器尚未实现工艺对象组态（MC_ 指令族）。\n如需继续，请从"项目视图"进入。');
      return;
    }
    if (target === 'drive') {
      alert('驱动 参数设置\n\n本仿真器尚未实现 SINAMICS 驱动组态。\n如需继续，请从"项目视图"进入。');
      return;
    }
    if (target === 'hmi') {
      alert('可视化\n\n本仿真器尚未实现 HMI 画面编辑器。\n如需继续，请从"项目视图"进入。');
      return;
    }

    // 设备与网络：留在门户内，切到"显示所有设备"（对齐真实 TIA）
    if (target === 'devconfig') {
      switchView('devices');
      return;
    }

    if (P.onEnterProject) {
      P.onEnterProject(proj, target);
    }
    hide();
  }

  /* ============================================================
   * 视图 4：显示所有设备
   * ============================================================ */
  function renderDevices() {
    var canvas = $('#devCanvas');
    if (!canvas) return;

    var proj = P.pendingProject;
    var devs = (proj && proj.devices) ? proj.devices : [];
    var empty = $('#devEmpty');
    var cards = $('#devCards');

    if (!devs.length) {
      if (empty) empty.style.display = 'flex';
      if (cards) cards.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    var h = '';
    devs.forEach(function (d, i) {
      h += '<div class="dev-card' + (P.selectedDevice === i ? ' selected' : '') +
        '" data-dev="' + i + '">' +
        '<div class="dev-card-img"><div class="dev-cpu-fig"><div class="dev-cpu-led"></div></div></div>' +
        '<div class="dev-card-body">' +
        '<div class="dev-card-name">' + esc(d.name) + '</div>' +
        '<div class="dev-card-sub">' + esc(d.type) + '</div>' +
        '<div class="dev-card-meta">' + esc(d.orderNo || '') + '</div>' +
        '</div></div>';
    });
    cards.innerHTML = h;

    $$('#devCards .dev-card').forEach(function (c) {
      c.addEventListener('click', function () {
        P.selectedDevice = +c.dataset.dev;
        renderDevices();
      });
      c.addEventListener('dblclick', function () {
        // 双击设备：进入工程并打开设备组态
        if (P.onEnterProject && P.pendingProject) {
          P.onEnterProject(P.pendingProject, 'devconfig');
          hide();
        }
      });
    });
  }

  /* ============================================================
   * 视图 5：添加新设备
   * ============================================================ */
  var AD = {
    category: 'controller',
    expanded: { 0: true, '0-0': true, '0-0-0': true },  // 默认展开控制器→S7-1200→CPU
    selected: null,       // 选中的设备项对象
    nameEdited: false     // 用户是否手改过设备名称
  };

  function prepareAddDevice() {
    var cat = root.DeviceCatalog;
    if (!cat) return;

    AD.category = 'controller';
    AD.expanded = { 0: true, '0-0': true, '0-0-0': true };
    AD.selected = null;
    AD.nameEdited = false;

    // 设备名称默认 PLC_1（若已存在则 PLC_2…）
    var proj = P.pendingProject;
    var n = 1;
    var used = {};
    ((proj && proj.devices) || []).forEach(function (d) { used[d.name] = true; });
    while (used['PLC_' + n]) n++;
    var nameEl = $('#adName');
    if (nameEl) nameEl.value = 'PLC_' + n;

    renderCats();
    renderTree();
    updateDetail();
  }

  function renderCats() {
    var cat = root.DeviceCatalog;
    var host = $('#adCats');
    if (!host) return;

    var icons = { controller: '▭', hmi: '🖥', pc: '💻', drive: '⚙' };
    var h = '';
    cat.CATEGORIES.forEach(function (key) {
      var c = cat.TREE[key];
      h += '<div class="ad-cat' + (AD.category === key ? ' active' : '') +
        '" data-cat="' + key + '">' +
        '<div class="ad-cat-ico">' + (icons[key] || '▭') + '</div>' +
        '<div class="ad-cat-name">' + esc(c.label) + '</div></div>';
    });
    host.innerHTML = h;

    $$('#adCats .ad-cat').forEach(function (el) {
      el.addEventListener('click', function () {
        AD.category = el.dataset.cat;
        AD.expanded = {};
        AD.selected = null;
        renderCats();
        renderTree();
        updateDetail();
      });
    });
  }

  function renderTree() {
    var cat = root.DeviceCatalog;
    var host = $('#adTree');
    if (!host) return;

    var rootNode = cat.TREE[AD.category];
    if (!rootNode) { host.innerHTML = ''; return; }

    var h = '';
    // 根节点（如"控制器"）
    h += treeNodeHtml(rootNode.label, 'cat', 0, true, true, false);
    if (AD.expanded[0]) {
      (rootNode.children || []).forEach(function (child, i) {
        var key = '' + i;
        h += treeNodeHtml(child.label, 'fam', 1, !!(child.children || (child.items && child.items.length)),
          !!AD.expanded[key], false, key);
        if (AD.expanded[key] && child.children) {
          child.children.forEach(function (sub, j) {
            var skey = '0-' + i + '-' + j;
            var hasSub = sub.items && sub.items.length > 0;
            h += treeNodeHtml(sub.label, 'sub', 2, hasSub, !!AD.expanded[skey], false, skey);
            if (AD.expanded[skey] && hasSub) {
              sub.items.forEach(function (item, k) {
                h += itemHtml(item, 3, '0-' + i + '-' + j + '-' + k);
              });
            } else if (AD.expanded[skey] && !hasSub) {
              h += '<div class="ad-tempty" style="padding-left:' + (6 + 3 * 15 + 17) + 'px">' +
                '（本仿真器未收录该类别）</div>';
            }
          });
        } else if (AD.expanded[key] && !(child.children)) {
          h += '<div class="ad-tempty" style="padding-left:' + (6 + 1 * 15 + 17) + 'px">（空）</div>';
        }
      });
    }
    host.innerHTML = h;
    bindTree();
  }

  function treeNodeHtml(label, kind, depth, expandable, expanded, isSel, key) {
    var pad = 6 + depth * 15;
    var arrow = expandable ? (expanded ? '▾' : '▸') : '';
    var icon = kind === 'cat' ? '🗀' : (kind === 'fam' ? '🗀' : '🗀');
    return '<div class="ad-tnode' + (isSel ? ' sel' : '') + '"' +
      ' data-kind="' + kind + '"' + (key !== undefined ? ' data-key="' + key + '"' : '') +
      ' style="padding-left:' + pad + 'px">' +
      '<span class="ad-arrow">' + arrow + '</span>' +
      '<span class="ad-ticon">' + icon + '</span>' +
      '<span class="ad-tlabel">' + esc(label) + '</span></div>';
  }

  function itemHtml(item, depth, key) {
    var pad = 6 + depth * 15;
    var sel = (AD.selected && AD.selected.orderNo === item.orderNo) ? ' sel' : '';
    return '<div class="ad-tnode' + sel + '" data-kind="item" data-key="' + esc(key) + '"' +
      ' style="padding-left:' + pad + 'px">' +
      '<span class="ad-arrow"></span>' +
      '<span class="ad-ticon">▭</span>' +
      '<span class="ad-tlabel">' + esc(item.name) + '</span></div>';
  }

  function bindTree() {
    $$('#adTree .ad-tnode').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var arrowClicked = e.target.classList.contains('ad-arrow');
        var kind = el.dataset.kind;
        var key = el.dataset.key;

        if (kind === 'item') {
          selectItem(key);
          return;
        }
        // 文件夹节点：点箭头或整行都切换展开
        if (key !== undefined) {
          AD.expanded[key] = !AD.expanded[key];
        } else if (kind === 'cat') {
          AD.expanded[0] = !AD.expanded[0];
        }
        renderTree();
      });
    });
  }

  function selectItem(key) {
    // key: "0-0-0-k" → 定位到 items[k]
    var parts = key.split('-').map(Number);
    var cat = root.DeviceCatalog;
    var node = cat.TREE[AD.category];
    try {
      var fam = node.children[parts[1]];
      var sub = fam.children[parts[2]];
      var item = sub.items[parts[3]];
      AD.selected = item;
      AD.expanded[key] = true;
      // 自动填设备名称（未手改过时才覆盖）
      if (!AD.nameEdited && item) {
        var nameEl = $('#adName');
        if (nameEl) {
          var base = item.name.replace(/^CPU\s+/, 'PLC_');
          // 提取型号：CPU 1215C DC/DC/DC → PLC_1 风格保持简单
          nameEl.value = 'PLC_1';
        }
      }
      renderTree();
      updateDetail();
    } catch (err) {
      AD.selected = null;
      updateDetail();
    }
  }

  function updateDetail() {
    var item = AD.selected;
    var nameEl = $('#adDevName');
    var orderEl = $('#adOrderNo');
    var verEl = $('#adVersion');
    var descEl = $('#adDesc');
    var btn = $('#btnAddDevice');
    var note = $('#adFootNote');
    var preview = $('#adPreview');

    if (!item) {
      if (nameEl) nameEl.textContent = '未选择设备';
      if (orderEl) orderEl.value = '';
      if (verEl) verEl.innerHTML = '<option>—</option>';
      if (descEl) descEl.textContent = '请从左侧设备树中选择一个设备型号。';
      if (btn) btn.disabled = true;
      if (note) { note.textContent = '推荐型号：' + root.DeviceCatalog.RECOMMENDED; note.className = 'ad-foot-note'; }
      if (preview) preview.style.opacity = '.5';
      return;
    }

    if (preview) preview.style.opacity = '1';
    if (nameEl) nameEl.textContent = item.name;
    if (orderEl) orderEl.value = item.orderNo;

    // 版本下拉（按型号给几个常见版本）
    if (verEl) {
      var vers = ['V4.0', 'V4.1', 'V4.2', 'V4.3', 'V4.4', 'V4.5'];
      verEl.innerHTML = vers.map(function (v) {
        return '<option' + (v === item.version ? ' selected' : '') + '>' + v + '</option>';
      }).join('');
    }

    if (descEl) descEl.textContent = item.desc || '（无说明）';
    if (btn) btn.disabled = false;
    if (note) {
      note.textContent = item.name === root.DeviceCatalog.RECOMMENDED
        ? '这是班级最常用的型号'
        : '';
      note.className = 'ad-foot-note' + (item.name === root.DeviceCatalog.RECOMMENDED ? ' warn' : '');
    }
  }

  function doAddDevice() {
    if (!AD.selected) return;
    if (!P.pendingProject) {
      alert('请先创建或打开一个项目。');
      return;
    }
    var nameEl = $('#adName');
    var verEl = $('#adVersion');
    var name = (nameEl ? nameEl.value : '').trim() || 'PLC_1';

    // 名称查重
    var proj = P.pendingProject;
    proj.devices = proj.devices || [];
    var dup = proj.devices.filter(function (d) { return d.name === name; })[0];
    if (dup) {
      alert('已存在同名设备「' + name + '」，请换一个名称。');
      if (nameEl) { nameEl.focus(); nameEl.select(); }
      return;
    }

    var item = AD.selected;
    proj.devices.push({
      name: name,
      type: item.name,
      orderNo: item.orderNo,
      version: verEl ? verEl.value : item.version,
      desc: item.desc,
      family: item.family
    });

    // 同步到工程设备配置（第一个设备作为主 CPU）
    if (!proj.device || !proj.device.type || proj.devices.length === 1) {
      proj.device = proj.device || {};
      proj.device.name = name;
      proj.device.type = item.name;
      proj.device.orderNo = item.orderNo;
      proj.device.fw = verEl ? verEl.value : item.version;
    }

    // 存库
    if (root.ProjectStore) root.ProjectStore.save(proj);

    // 回到"显示所有设备"
    switchView('devices');
  }
  function refreshOpenedPath(proj) {
    var el = $('#pfOpened');
    if (!el) return;
    if (!proj) {
      el.textContent = '未打开项目';
      el.className = 'pf-opened';
      return;
    }
    var full = proj.path || proj.name || '';
    el.textContent = '已打开的项目：' + full;
    el.className = 'pf-opened has-project';
    el.title = full;
  }

  /* ============================================================
   * 显示 / 隐藏
   * ============================================================ */
  function show(view) {
    var el = $('#portal');
    if (!el) return;
    el.style.display = 'flex';
    document.body.classList.add('in-portal');

    // 默认视图：有 pending 项目时进新手上路，否则打开现有项目
    var v = view;
    if (!v) v = P.pendingProject ? 'firststeps' : 'open';
    switchView(v);
  }

  function hide() {
    var el = $('#portal');
    if (!el) return;
    el.style.display = 'none';
    document.body.classList.remove('in-portal');
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init(opts) {
    P.onOpen = opts.onOpen;
    P.onCreate = opts.onCreate;
    P.onEnterProject = opts.onEnterProject;

    // 选中上次打开的项目
    var last = root.ProjectStore.lastOpened();
    var list = root.ProjectStore.list();
    if (last && list.some(function (x) { return x.id === last; })) {
      P.selectedId = last;
    } else if (list.length) {
      P.selectedId = list[0].id;
    }

    // ---- 视图 1 按钮 ----
    var bo = $('#btnOpen'); if (bo) bo.onclick = doOpen;
    var bd = $('#btnDelete'); if (bd) bd.onclick = doDelete;
    var bb = $('#btnBrowse'); if (bb) bb.onclick = doBrowse;

    // ---- 中间动作项 ----
    bind('actOpenProject', function () { switchView('open'); });
    bind('actNewProject', function () { switchView('new'); });
    bind('actFirstSteps', function () { switchView('firststeps'); });
    bind('actMigrate', function () {
      alert('移植项目\n\n本仿真器不支持旧版本项目移植（无 V13/V14/V15 格式兼容层）。');
    });
    bind('actClose', function () {
      P.pendingProject = null;
      refreshOpenedPath(null);
      switchView('open');
    });
    bind('navWelcome', function () { switchView('open'); });

    // ---- 设备与网络：动作栏 ----
    bind('actShowDevices', function () { switchView('devices'); });
    bind('actAddDevice', function () { switchView('adddevice'); });
    bind('actConfigureNet', function () {
      alert('组态网络\n\n本仿真器未实现网络拓扑组态（PROFINET / PROFIBUS 连线）。\n设备之间无实际通讯。');
    });
    bind('devHelp', function () {
      alert('设备与网络 · 帮助\n\n· 显示所有设备：查看项目中已添加的设备\n' +
        '· 添加新设备：从硬件目录选择型号加入项目\n' +
        '· 双击设备卡片可进入设备组态\n\n' +
        '注：本仿真器无真实总线通讯能力。');
    });

    // 添加新设备：版本下拉与名称输入
    var btnAdd = $('#btnAddDevice');
    if (btnAdd) btnAdd.onclick = doAddDevice;
    var nameInp = $('#adName');
    if (nameInp) nameInp.addEventListener('input', function () { AD.nameEdited = true; });

    // 显示所有设备：视图切换按钮（只做视觉切换，三种视图内容一致）
    $$('.dev-viewtabs .dvt').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.dev-viewtabs .dvt').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
      });
    });
    bind('navSoftware', function () {
      alert('已安装的软件\n\nDONGENS 仿真教学版（网页版）\n' +
        '· 软 PLC 内核（循环扫描 / I/Q/M/DB）\n' +
        '· LAD / SCL 编辑器\n' +
        '· 83 条指令\n' +
        '· 在线监视与强制表\n' +
        '· 项目持久化到浏览器本地存储\n\n' +
        '不含真实硬件通讯能力');
    });
    bind('navHelp', function () {
      alert('帮助\n\n· 双击项目行可直接打开\n' +
        '· 单击选中后点右下角"打开"也可以\n' +
        '· "创建新项目"在当前页填表，点"创建"\n' +
        '· 创建完成后停在"新手上路"，可点"项目视图"进入\n' +
        '· "浏览…" 可导入 .dongens.json 文件\n' +
        '· 项目自动保存在浏览器本地，刷新不丢');
    });

    // 左侧竖排功能条
    var navMap = {
      navOpenProject: function () { switchView('open'); },
      navDevices: function () {
        // 设备与网络：需要先有项目
        if (!P.pendingProject) {
          alert('请先打开或创建一个项目。');
          switchView('open');
          return;
        }
        switchView('devices');
      },
      navPlc: function () {
        if (P.pendingProject) { doFirstStep('blockov'); }
        else alert('PLC 编程：请先打开一个项目');
      },
      navMotion: function () { doFirstStep('motion'); },
      navDrive: function () { doFirstStep('drive'); },
      navHmi: function () { doFirstStep('hmi'); },
      navOnline: function () {
        if (P.pendingProject) { doFirstStep('projectview'); }
        else alert('在线与诊断：请先打开一个项目');
      },
      navWelcome: function () { switchView('open'); },
      navSoftware: function () {
        var el = document.getElementById('navSoftware');
        if (el) el.click();
      },
      navHelp: function () {
        var el = document.getElementById('navHelp');
        if (el) el.click();
      }
    };
    Object.keys(navMap).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.onclick = navMap[id];
    });

    // ---- 视图 2：创建表单 ----
    var bc = $('#btnCreateProject');
    if (bc) bc.onclick = doCreate;

    // 路径浏览按钮：浏览器环境无法读目录，诚实提示
    var pb = $('#npPathBrowse');
    if (pb) pb.onclick = function () {
      var p = $('#npPath');
      if (p) { p.focus(); p.select(); }
      setFormError('浏览器环境不能浏览本地目录，请直接编辑路径', true);
    };

    // 回车提交
    ['npName', 'npPath', 'npAuthor'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
      });
    });

    // ---- 视图 3：新手上路入口 ----
    $$('.fs-step').forEach(function (step) {
      step.addEventListener('click', function () {
        doFirstStep(step.dataset.target);
      });
    });

    // ---- 底部"项目视图" ----
    var pf = $('#pfProjectView');
    if (pf) pf.onclick = function () {
      if (P.pendingProject) doFirstStep('projectview');
      else switchView('open');
    };

    // ---- 键盘 ----
    document.addEventListener('keydown', function (e) {
      var portal = $('#portal');
      if (!portal || portal.style.display === 'none') return;
      // 表单里不抢键
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

      if (P.currentView === 'open') {
        if (e.key === 'Enter' && P.selectedId) { e.preventDefault(); doOpen(); }
        if (e.key === 'Delete' && P.selectedId) { e.preventDefault(); doDelete(); }
      }
    });

    refreshOpenedPath(null);
    switchView('open');
  }

  function bind(id, fn) {
    var el = document.getElementById(id);
    if (el) el.onclick = fn;
  }

  /* ============================================================ */
  root.Portal = {
    init: init,
    show: show,
    hide: hide,
    render: render,
    switchView: switchView,
    doCreate: doCreate,
    doFirstStep: doFirstStep,
    refreshOpenedPath: refreshOpenedPath,
    setPending: function (p) { P.pendingProject = p; },
    getPending: function () { return P.pendingProject; },
    selected: function () { return P.selectedId; },
    view: function () { return P.currentView; },
    // 设备与网络
    renderDevices: renderDevices,
    addDeviceState: function () { return AD; },
    selectDeviceItem: selectItem
  };
})(window);
