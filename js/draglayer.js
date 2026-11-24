/* ============================================================
   draglayer.js — 基于 Pointer Events 的拖拽层
   为什么不用 HTML5 drag&drop：
     SVG 子元素默认不可拖，draggable 属性对 SVG 无效，
     真人无法触发 dragstart（自动化测试直接派发事件，会假通过）
   本实现同时服务两条链路：
     1. 梯形图内元件换位（pointer 拖拽 + 落点判定）
     2. 指令面板 -> 梯形图（pointer 拖拽 + 幽灵元素）
   ============================================================ */
(function (root) {
  'use strict';

  var DL = {
    active: null,        // 当前拖拽会话
    ghost: null,         // 跟随鼠标的幽灵元素
    hint: null,          // 落点提示框（SVG rect）
    callbacks: {},
    threshold: 4         // 位移超过 4px 才认为开始拖拽
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------------- 启动拖拽 ---------------- */
  // opts = {
  //   kind: 'move' | 'insert',
  //   payload: 元件id 或 指令type,
  //   label: 幽灵上显示的文字,
  //   startEvent: pointerdown 事件,
  //   onDrop: function(point) -> bool  (point: {clientX, clientY, target})
  //   onCancel: function()
  // }
  function start(opts) {
    if (DL.active) cancel();

    var sx = opts.startEvent.clientX;
    var sy = opts.startEvent.clientY;

    DL.active = {
      kind: opts.kind,
      payload: opts.payload,
      label: opts.label || '',
      onDrop: opts.onDrop,
      onCancel: opts.onCancel,
      sx: sx, sy: sy,
      moved: false,
      sourceEl: opts.sourceEl || null
    };

    // 关键：阻止浏览器原生拖拽与文本选择，否则 pointerup 会被吞掉
    try {
      if (opts.startEvent.preventDefault) opts.startEvent.preventDefault();
    } catch (e) { }
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    // 用 pointer capture 保证后续事件都回到源元素
    var capEl = opts.sourceEl;
    var capId = opts.startEvent.pointerId;
    if (capEl && capEl.setPointerCapture && capId !== undefined) {
      try { capEl.setPointerCapture(capId); } catch (e) { }
    }

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancelEvt, true);
    document.addEventListener('dragstart', blockNativeDrag, true);
    document.addEventListener('keydown', onKey, true);
  }

  // 拖拽期间彻底阻止原生 HTML5 drag
  function blockNativeDrag(e) {
    if (DL.active) { e.preventDefault(); e.stopPropagation(); }
  }

  function onCancelEvt(e) {
    cancel();
  }

  function cleanup() {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancelEvt, true);
    document.removeEventListener('dragstart', blockNativeDrag, true);
    document.removeEventListener('keydown', onKey, true);
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
  }

  function onMove(e) {
    var a = DL.active;
    if (!a) return;

    var dx = e.clientX - a.sx;
    var dy = e.clientY - a.sy;

    if (!a.moved) {
      if (Math.abs(dx) < DL.threshold && Math.abs(dy) < DL.threshold) return;
      a.moved = true;
      // 开始拖拽：造幽灵 + 源元素半透明
      makeGhost(a);
      if (a.sourceEl) a.sourceEl.classList.add('dragging');
      document.body.classList.add('dragging-active');
    }

    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    updateHint(e);
  }

  function onUp(e) {
    var a = DL.active;
    cleanup();
    if (!a) return;
    DL.active = null;

    clearGhost();
    clearHint();
    if (a.sourceEl) a.sourceEl.classList.remove('dragging');
    document.body.classList.remove('dragging-active');

    // 位移太小 = 视为点击，不触发落点
    if (!a.moved) {
      if (a.onCancel) a.onCancel(true);
      return;
    }
    // 找落点：先隐藏幽灵，否则 elementFromPoint 取到的是幽灵
    var point = {
      clientX: e.clientX,
      clientY: e.clientY,
      target: document.elementFromPoint(e.clientX, e.clientY)
    };
    if (a.onDrop) a.onDrop(point);
  }

  function onKey(e) {
    if (e.key === 'Escape') cancel();
  }

  function cancel() {
    var a = DL.active;
    cleanup();
    DL.active = null;
    clearGhost();
    clearHint();
    if (a && a.sourceEl) a.sourceEl.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    if (a && a.onCancel) a.onCancel();
  }

  /* ---------------- 幽灵元素 ---------------- */
  function makeGhost(a) {
    var g = document.createElement('div');
    g.className = 'drag-ghost';
    g.textContent = a.label || (a.kind === 'move' ? '移动' : '插入');
    document.body.appendChild(g);
    DL.ghost = g;
  }
  function moveGhost(x, y) {
    if (!DL.ghost) return;
    DL.ghost.style.left = x + 'px';
    DL.ghost.style.top = y + 'px';
  }
  function clearGhost() {
    if (DL.ghost && DL.ghost.parentNode) DL.ghost.remove();
    DL.ghost = null;
  }

  /* ---------------- 落点提示 ---------------- */
  function setHint(svgEl, rect) {
    clearHint();
    if (!svgEl) return;
    var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', 'drop-hint');
    r.setAttribute('x', rect.x);
    r.setAttribute('y', rect.y);
    r.setAttribute('width', Math.max(8, rect.w));
    r.setAttribute('height', Math.max(8, rect.h));
    r.setAttribute('fill', 'rgba(0,176,80,.16)');
    r.setAttribute('stroke', '#00b050');
    r.setAttribute('stroke-width', '1.6');
    r.setAttribute('stroke-dasharray', '5 3');
    r.setAttribute('pointer-events', 'none');
    svgEl.appendChild(r);
    DL.hint = r;
  }
  function clearHint() {
    if (DL.hint && DL.hint.parentNode) DL.hint.remove();
    DL.hint = null;
  }

  // 由使用方接管 hint 计算；支持多个处理器（面板拖拽与元件拖拽各注册一个）
  function updateHint(e) {
    var list = DL.callbacks.hintList || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](e); } catch (err) { }
    }
  }

  /* ---------------- 落点提示 ---------------- */
  function setHint(svgEl, rect) {
    clearHint();
    if (!svgEl) return;
    var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', 'drop-hint');
    r.setAttribute('x', rect.x);
    r.setAttribute('y', rect.y);
    r.setAttribute('width', Math.max(8, rect.w));
    r.setAttribute('height', Math.max(8, rect.h));
    r.setAttribute('fill', 'rgba(0,176,80,.16)');
    r.setAttribute('stroke', '#00b050');
    r.setAttribute('stroke-width', '1.6');
    r.setAttribute('stroke-dasharray', '5 3');
    r.setAttribute('pointer-events', 'none');
    svgEl.appendChild(r);
    DL.hint = r;
  }
  function clearHint() {
    if (DL.hint && DL.hint.parentNode) DL.hint.remove();
    DL.hint = null;
  }
  root.DragLayer = {
    start: start,
    cancel: cancel,
    setHint: setHint,
    clearHint: clearHint,
    // 支持注册多个 hint 处理器
    setHintHandler: function (fn) {
      DL.callbacks.hintList = DL.callbacks.hintList || [];
      if (DL.callbacks.hintList.indexOf(fn) < 0) DL.callbacks.hintList.push(fn);
    },
    isActive: function () { return !!DL.active; },
    state: DL
  };
})(window);

