/* ============================================================
   blockheader.js — LAD 块的「块标题 / 注释」区
   对齐 TIA：块名下方有「块标题：」一行和「注释」多行区，均可直接编辑
   位置：在收藏夹工具栏下方、第一个网络上方
   ============================================================ */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    });
  }

  /* ============================================================
   * 渲染
   * blk: 块对象（含 title / comment）
   * cfg: { onChange() }
   * ============================================================ */
  function render(blk, cfg) {
    cfg = cfg || {};
    var h = '';
    h += '<div class="blk-title-block" id="blkTitleBlock">';

    // 块标题行
    h += '<div class="btb-row">';
    h += '<span class="btb-label">块标题：</span>';
    h += '<span class="btb-title" id="btbTitle" contenteditable="true" spellcheck="false" ' +
      'data-ph="（未填写块标题）">' + esc(blk.title || '') + '</span>';
    h += '</div>';

    // 注释行
    h += '<div class="btb-row btb-row-top">';
    h += '<span class="btb-label">注释</span>';
    h += '<span class="btb-comment" id="btbComment" contenteditable="true" spellcheck="false" ' +
      'data-ph="（未填写注释）">' + esc(blk.comment || '') + '</span>';
    h += '</div>';

    h += '</div>';
    return h;
  }

  /* ============================================================
   * 绑定编辑事件
   * cfg: { onChange(), block, onDirty() }
   * ============================================================ */
  function bind(blk, cfg) {
    cfg = cfg || {};
    var titleEl = document.getElementById('btbTitle');
    var commentEl = document.getElementById('btbComment');

    function commit(el, field) {
      if (!el) return;
      // 用 textContent，避免粘贴带入 HTML
      var v = el.textContent.replace(/\u00a0/g, ' ').trim();
      if (blk[field] === v) return;
      blk[field] = v;
      if (cfg.onDirty) cfg.onDirty();
      if (cfg.onChange) cfg.onChange(field, v);
    }

    function hookInput(el, field) {
      if (!el) return;

      // 只保留纯文本粘贴
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text') || '';
        // 单行字段去掉换行
        if (field === 'title') text = text.replace(/[\r\n]+/g, ' ');
        document.execCommand('insertText', false, text);
      });

      // 块标题：回车结束编辑，不换行
      if (field === 'title') {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
          }
          if (e.key === 'Escape') {
            el.textContent = blk.title || '';
            el.blur();
          }
        });
      } else {
        // 注释：允许换行；Ctrl+Enter 结束
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            el.blur();
          }
          if (e.key === 'Escape') {
            e.textContent = blk.comment || '';
            el.blur();
          }
        });
      }

      el.addEventListener('blur', function () { commit(el, field); });
      // 输入时同步（用于实时更新树/标签页标题），同时把值写回模型
      // 这样即使 blur 未触发（如某些自动化环境），数据也不会丢
      el.addEventListener('input', function () {
        var v = el.textContent.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
        if (field === 'title') v = v.replace(/[\r\n]+/g, ' ');
        if (blk[field] !== v) {
          blk[field] = v;
          if (cfg.onDirty) cfg.onDirty();
        }
        if (cfg.onLiveChange) cfg.onLiveChange(field, v);
      });
    }

    hookInput(titleEl, 'title');
    hookInput(commentEl, 'comment');
  }

  root.BlockHeader = {
    render: render,
    bind: bind
  };
})(window);
