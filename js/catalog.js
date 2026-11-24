/* ============================================================
   catalog.js — 右侧指令面板（对齐 DSI Platform 指令窗格）
   结构：选项 / 收藏夹 / 基本指令 / 扩展指令
   支持：树展开、搜索、点击插入、拖到梯形图、收藏夹增删
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

  var Cat = {
    state: {
      openSections: { options: false, fav: true, basic: true, extended: true },
      openGroups: { conventional: true },
      favorites: null,
      search: '',
      activeGroup: null
    },
    onInsert: null,     // 回调：点击/双击指令 -> 插入到当前网络末尾
    onDropInsert: null  // 回调：拖放指令 -> 在落点插入
  };

  function store() {
    try {
      var raw = localStorage.getItem('dongens.favorites');
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return null;
  }
  function saveFav() {
    try { localStorage.setItem('dongens.favorites', JSON.stringify(Cat.state.favorites)); } catch (e) { }
  }

  function init(opts) {
    Cat.onInsert = opts.onInsert;
    Cat.onDropInsert = opts.onDropInsert;
    var I = window.INSTR;
    Cat.state.favorites = store() || I.DEFAULT_FAVORITES.slice();
    render();
  }

  function labelOf(id) {
    var I = window.INSTR;
    var m = I.info(id);
    return m ? m.name : id;
  }
  function iconOf(id) {
    var I = window.INSTR;
    var m = I.info(id);
    if (!m) return '▪';
    if (m.kind === 'contact') return '┤├';
    if (m.kind === 'coil') return '()';
    if (m.kind === 'compare') return m.cmp || '==';   // 比较指令：直接显示比较符
    return '▣';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var host = $('#instrBody');
    if (!host) return;
    var I = window.INSTR;
    var s = Cat.state;
    var h = '';

    // 搜索框
    h += '<div class="cat-search"><input type="text" id="catSearch" placeholder="搜索指令…" value="' +
      esc(s.search) + '"><span class="cat-clear" id="catClear">✕</span></div>';

    var searching = s.search.trim() !== '';

    // 选项
    h += section('options', '选项', searching ? false : s.openSections.options, function () {
      var o = '';
      o += '<div class="cat-row"><span>显示所有指令</span><span class="cat-chk">☑</span></div>';
      o += '<div class="cat-row"><span>绝对操作数</span><span class="cat-chk">☐</span></div>';
      o += '<div class="cat-row"><span>拖放插入</span><span class="cat-chk">☑</span></div>';
      return o;
    });

    // 收藏夹
    if (!searching) {
      h += section('fav', '收藏夹', s.openSections.fav, function () {
        if (!s.favorites.length) {
          return '<div class="cat-empty">把常用指令拖到此处，或右键指令选择“加入收藏夹”</div>';
        }
        var o = '<div class="cat-grid">';
        s.favorites.forEach(function (id) {
          o += tile(id, true);
        });
        o += '</div><div class="cat-hint">右键指令可移出收藏夹</div>';
        return o;
      });
    }

    // 基本 / 扩展指令
    I.CATALOG.forEach(function (sec) {
      var groupsHtml = '';
      var anyHit = false;
      sec.groups.forEach(function (g) {
        var items = g.items.filter(function (id) {
          if (!searching) return true;
          var nm = labelOf(id) + ' ' + id;
          return nm.toLowerCase().indexOf(s.search.toLowerCase()) >= 0;
        });
        if (!items.length) return;
        anyHit = true;
        var open = searching ? true : !!s.openGroups[g.id];
        groupsHtml += '<div class="cat-group">';
        groupsHtml += '<div class="cat-ghead" data-group="' + g.id + '">' +
          '<span class="arrow">' + (open ? '▾' : '▸') + '</span>' +
          '<span class="folder">📁</span><span class="gname">' + esc(g.name) + '</span>' +
          '<span class="gcount">' + items.length + '</span></div>';
        groupsHtml += '<div class="cat-gitems' + (open ? ' open' : '') + '">';
        items.forEach(function (id) {
          var m = I.info(id);
          var supported = m && (!m.sim);
          var simTag = (m && m.sim) ? '<span class="simtag" title="示意实现（仿真器不模拟真实 I/O 通讯）">仿真</span>' : '';
          groupsHtml += '<div class="cat-item" data-ins="' + esc(id) + '" draggable="true" ' +
            'title="' + esc(m ? m.name : id) + '  (' + esc(id) + ')">' +
            '<span class="ci-ico">' + iconOf(id) + '</span>' +
            '<span class="ci-name">' + esc(m ? m.name : id) + '</span>' +
            '<span class="ci-code">' + esc(id) + '</span>' + simTag + '</div>';
        });
        groupsHtml += '</div></div>';
      });
      if (searching && !anyHit && sec.id !== 'basic') return;
      h += sectionBlock(sec.id, sec.name, searching ? true : s.openSections[sec.id], groupsHtml);
    });

    if (searching) {
      var total = $$('.cat-item').length;
      h = '<div class="cat-search-wrap">' + h.split('</div>')[0] + '</div>' + 
        '<div class="cat-result">找到 ' + total + ' 条匹配</div>' +
        h.split('</div>').slice(1).join('</div>');
    }

    host.innerHTML = h;
    bind();
  }

  function section(id, title, open, contentFn) {
    var body = open ? contentFn() : '';
    return '<div class="cat-section">' +
      '<div class="cat-shead" data-sec="' + id + '">' +
      '<span class="arrow">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="stitle">' + esc(title) + '</span></div>' +
      (open ? '<div class="cat-sbody">' + body + '</div>' : '') + '</div>';
  }
  function sectionBlock(id, title, open, bodyHtml) {
    return '<div class="cat-section">' +
      '<div class="cat-shead" data-sec="' + id + '">' +
      '<span class="arrow">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="stitle">' + esc(title) + '</span></div>' +
      (open ? '<div class="cat-sbody">' + bodyHtml + '</div>' : '') + '</div>';
  }

  function tile(id, inFav) {
    var I = window.INSTR;
    var m = I.info(id);
    return '<div class="cat-tile" data-ins="' + esc(id) + '" draggable="true" ' +
      'title="' + esc(m ? m.name : id) + '">' +
      '<span class="ct-sym">' + esc(m && m.sym ? m.sym : iconOf(id)) + '</span></div>';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    var host = $('#instrBody');
    if (!host) return;

    // 折叠
    $$('.cat-shead', host).forEach(function (el) {
      el.onclick = function () {
        var id = el.dataset.sec;
        Cat.state.openSections[id] = !Cat.state.openSections[id];
        render();
      };
    });
    $$('.cat-ghead', host).forEach(function (el) {
      el.onclick = function () {
        var id = el.dataset.group;
        Cat.state.openGroups[id] = !Cat.state.openGroups[id];
        render();
      };
    });

    // 搜索
    var si = $('#catSearch');
    if (si) {
      si.oninput = function () {
        Cat.state.search = si.value;
        render();
        var ni = $('#catSearch');
        if (ni) { ni.focus(); ni.selectionStart = ni.selectionEnd = ni.value.length; }
      };
    }
    var cl = $('#catClear');
    if (cl) cl.onclick = function () { Cat.state.search = ''; render(); };

    // 指令项：单击选中，双击插入，按下后拖拽插入到梯形图
    $$('.cat-item, .cat-tile', host).forEach(function (el) {
      var id = el.dataset.ins;
      el.addEventListener('click', function (e) {
        $$('.cat-item.active, .cat-tile.active', host).forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
      });
      // 单击收藏夹图标 = 直接插入
      el.addEventListener('click', function () {
        if (el.classList.contains('cat-tile') && Cat.onInsert) Cat.onInsert(id, null);
      });
      el.addEventListener('dblclick', function () {
        // 双击指令：插入到当前网络（保持原有习惯）
        // 加入收藏夹请用「拖拽到收藏栏」，避免改变双击的既有语义
        if (Cat.onInsert) Cat.onInsert(id, null);
      });

      // 指针拖拽：把指令拖进梯形图
      el.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        var meta = window.INSTR.info(id);
        window.DragLayer.start({
          kind: 'insert',
          payload: id,
          label: '＋ ' + (meta ? meta.name : id),
          sourceEl: el,
          startEvent: ev,
          onDrop: function (pt) {
            // 1. 拖到 LAD 收藏夹区域 → 加入收藏
            //    注意：收藏栏外层是 #favbarHost，内层是 #favbar，
            //    拖拽时可能命中任意一层或它们的空白处，都要接受
            var t = pt.target;
            var inFavbar = false;
            if (t && t.closest) {
              inFavbar = !!(t.closest('#favbarHost') || t.closest('#favbar') ||
                t.closest('.favbar-host') || t.closest('.fb-wrap'));
            }
            // 坐标兜底：直接判断是否落在收藏栏矩形内
            if (!inFavbar) {
              var fb = document.getElementById('favbarHost');
              if (fb) {
                var r = fb.getBoundingClientRect();
                if (pt.clientX >= r.left && pt.clientX <= r.right &&
                  pt.clientY >= r.top && pt.clientY <= r.bottom) {
                  inFavbar = true;
                }
              }
            }
            if (inFavbar) {
              if (window.FavBar) {
                var added = window.FavBar.add(id);
                if (Cat.onFavAdded) Cat.onFavAdded(id, added);
              }
              return;
            }
            // 2. 拖到梯形图 → 插入
            var ok = false;
            if (Cat.onDropInsert) ok = Cat.onDropInsert(id, pt);
            // 没落在梯形图上（拖回面板等）：不插入
            if (!ok) { /* 静默取消 */ }
          }
        });
      });

      el.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        var inFav = Cat.state.favorites.indexOf(id) >= 0;
        var inBar = window.FavBar && window.FavBar.items().indexOf(id) >= 0;
        showMenu(ev.clientX, ev.clientY, [
          {
            label: inBar ? '从 LAD 收藏栏移除' : '加入 LAD 收藏栏',
            cb: function () {
              if (!window.FavBar) return;
              if (inBar) {
                var items = window.FavBar.items();
                var idx = items.indexOf(id);
                if (idx >= 0) {
                  window.FavBar.state.selected = idx;
                  window.FavBar.deleteSelected();
                }
              } else {
                window.FavBar.add(id);
              }
              if (Cat.onFavAdded) Cat.onFavAdded(id, !inBar);
            }
          },
          {
            label: inFav ? '从面板收藏夹移除' : '加入面板收藏夹', cb: function () {
              if (inFav) Cat.state.favorites = Cat.state.favorites.filter(function (x) { return x !== id; });
              else Cat.state.favorites.push(id);
              saveFav(); render();
            }
          },
          { label: '插入到当前网络', cb: function () { if (Cat.onInsert) Cat.onInsert(id, null); } }
        ]);
      });
    });

    // 收藏夹拖放接收
    var favSec = $$('.cat-shead[data-sec="fav"]', host)[0];
    if (favSec) {
      favSec.addEventListener('dragover', function (e) { e.preventDefault(); });
      favSec.addEventListener('drop', function (e) {
        var d = e.dataTransfer.getData('text/plain') || '';
        if (d.indexOf('INSTR:') === 0) {
          var id = d.slice(6);
          if (Cat.state.favorites.indexOf(id) < 0) {
            Cat.state.favorites.push(id);
            saveFav(); render();
          }
        }
      });
    }
  }

  /* 简易右键菜单 */
  function showMenu(x, y, items) {
    var old = $('#catMenu');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'catMenu';
    d.className = 'cat-menu';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'cat-menu-item';
      row.textContent = it.label;
      row.onclick = function () { d.remove(); it.cb(); };
      d.appendChild(row);
    });
    document.body.appendChild(d);
    setTimeout(function () {
      document.addEventListener('click', function h() {
        var m = $('#catMenu');
        if (m) m.remove();
        document.removeEventListener('click', h);
      });
    }, 10);
  }

  root.Catalog = {
    init: init, render: render, state: Cat.state,
    addFavorite: function (id) {
      if (Cat.state.favorites.indexOf(id) < 0) {
        Cat.state.favorites.push(id); saveFav(); render();
      }
    }
  };
})(window);

