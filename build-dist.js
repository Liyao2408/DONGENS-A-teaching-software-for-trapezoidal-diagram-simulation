/* build-dist.js — 生成可发布的 dist 目录
   只复制运行必需文件（不含测试、不含 node_modules），
   并生成一个单文件版 index-standalone.html（JS/CSS 全部内联，双击即用）
   用法：node build-dist.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// 运行必需的文件
const FILES = [
  'index.html',
  'README.md',
  'PUBLISH.md',
  'LICENSE',
  'start.bat',
  'css/tia.css',
  'js/plc.js',
  'js/instructions.js',
  'js/store.js',
  'js/tree.js',
  'js/draglayer.js',
  'js/lad.js',
  'js/ladedit.js',
  'js/catalog.js',
  'js/devicecatalog.js',
  'js/racks.js',
  'js/propspanel.js',
  'js/favbar.js',
  'js/blockheader.js',
  'js/simpanel.js',
  'js/portal.js',
  'js/app.js'
];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFile(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  if (!fs.existsSync(src)) { console.log('  MISSING: ' + rel); return false; }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  const kb = (fs.statSync(dst).size / 1024).toFixed(1);
  console.log('  ' + rel + '  ' + kb + ' KB');
  return true;
}

/* ---------- 1. 清空并复制 ---------- */
console.log('== 清理 dist ==');
if (fs.existsSync(DIST)) {
  try {
    fs.rmSync(DIST, { recursive: true, force: true });
  } catch (e) {
    // 有些环境把 fs.rmSync 换成了"移到回收站"的安全删除，删目录时会抛
    // "Error during a trash operation"（内容其实已经删掉了，只剩空目录）。
    // 这里逐项删内容，删不掉的空目录留着也不影响构建。
    try {
      fs.readdirSync(DIST).forEach(function (n) {
        try { fs.rmSync(path.join(DIST, n), { recursive: true, force: true }); } catch (e2) { }
      });
    } catch (e3) { }
    console.log('  （回收站删除失败，已改为逐项清理，可忽略）');
  }
}
ensureDir(DIST);

console.log('\n== 复制运行文件 ==');
let ok = 0;
FILES.forEach(function (f) { if (copyFile(f)) ok++; });

/* ---------- 1.5 复制 README 里引用的截图 ---------- */
/* dist 里的 README 也要能正常显示图片，所以只挑被引用到的本地图片复制，
   不把整个 docs/（几十张历史截图）搬进去。 */
console.log('\n== 复制 README 截图 ==');
try {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const imgs = [];
  md.replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, function (m, u) {
    if (/^(https?:)?\/\//.test(u)) return m;
    if (imgs.indexOf(u) < 0) imgs.push(u);
    return m;
  });
  if (!imgs.length) console.log('  （README 里没有本地截图）');
  imgs.forEach(function (u) { if (copyFile(u)) ok++; });
} catch (e) {
  console.log('  跳过：' + e.message);
}

/* ---------- 2. 生成单文件版 ---------- */
console.log('\n== 生成单文件版 index-standalone.html ==');
// 去掉资源路径上的 ?v=xxx 缓存串，才能在内联时找到真实文件
function realPath(u) {
  return path.join(ROOT, String(u).split('?')[0].split('#')[0]);
}
try {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 内联 CSS
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (m, href) {
    const p = realPath(href);
    if (!fs.existsSync(p)) return m;
    const css = fs.readFileSync(p, 'utf8');
    return '<style>\n' + css + '\n</style>';
  });

  // 内联 JS（保持原顺序）
  html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
    const p = realPath(src);
    if (!fs.existsSync(p)) return m;
    let js = fs.readFileSync(p, 'utf8');
    // 防止 </script> 提前闭合
    js = js.replace(/<\/script>/gi, '<\\/script>');
    return '<script>\n/* ---- ' + src + ' ---- */\n' + js + '\n</script>';
  });

  const outPath = path.join(DIST, 'index-standalone.html');
  fs.writeFileSync(outPath, html, 'utf8');
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log('  index-standalone.html  ' + kb + ' KB  （单文件，双击即用）');
} catch (e) {
  console.log('  单文件生成失败：' + e.message);
}

/* ---------- 3. 统计 ---------- */
console.log('\n== 完成 ==');
let total = 0, count = 0;
function walk(dir) {
  fs.readdirSync(dir).forEach(function (n) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else { total += st.size; count++; }
  });
}
walk(DIST);
console.log('  复制文件：' + ok + ' 个');
console.log('  dist 总计：' + count + ' 个文件，' + (total / 1024).toFixed(0) + ' KB');
console.log('\n发布方式：');
console.log('  · 网页版：把 index.html + css/ + js/ 一起传上去');
console.log('  · 单文件：只传 index-standalone.html');






