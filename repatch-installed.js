/* repatch-installed.js — 用当前源码重新打包安装目录的 app.asar
   - 以现有 app.asar 为基础（保留包内精简 package.json）
   - 覆盖 js/ 和 css/ 为 1dongens 源码版本（含变量删除修复）
   - 备份到非同步目录，原子替换
   用法：node repatch-installed.js
*/
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const SRC = 'D:\\个人\\桌面\\1dongens';
const INSTALLED = 'D:\\个人\\桌面\\dongens';
const ASAR = path.join(INSTALLED, 'resources', 'app.asar');
const SAFE_BAK = 'C:\\Users\\yulih\\WorkBuddy\\2026-11-23-09-53-49\\app.asar.bak-before-delete-fix';
const WORK = path.join(process.env.TEMP, 'repack-' + Date.now());

(async () => {
  // 0. 安全备份（放到非桌面同步目录，防止再被云同步冲掉）
  if (!fs.existsSync(SAFE_BAK)) fs.copyFileSync(ASAR, SAFE_BAK);
  console.log('备份(安全目录): ' + SAFE_BAK);

  // 1. 以现有包为基础解包
  asar.extractAll(ASAR, WORK);

  // 2. 用源码覆盖 js/ 与 css/（保留包内精简 package.json 与其余文件）
  ['js', 'css'].forEach(dir => {
    fs.readdirSync(path.join(SRC, dir)).forEach(f => {
      fs.copyFileSync(path.join(SRC, dir, f), path.join(WORK, dir, f));
      console.log('  覆盖: ' + dir + '/' + f);
    });
  });

  // 3. 校验：包内 app.js 必须包含删除功能
  const appJs = fs.readFileSync(path.join(WORK, 'js', 'app.js'), 'utf8');
  if (!appJs.includes('deleteSelectedTag')) throw new Error('包内 app.js 缺少删除功能，中止');
  if (!fs.readFileSync(path.join(WORK, 'css', 'tia.css'), 'utf8').includes('行号列')) throw new Error('包内 css 缺少行号样式，中止');
  console.log('内容校验通过');

  // 4. 重打包并原子替换
  const TMP = ASAR + '.new';
  if (fs.existsSync(TMP)) fs.rmSync(TMP);
  await asar.createPackage(WORK, TMP);
  fs.renameSync(TMP, ASAR);
  console.log('完成: ' + ASAR + ' (' + (fs.statSync(ASAR).size / 1024).toFixed(0) + ' KB)');

  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('OK');
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
