// 测试辅助：通过启动门户进入工程
// 用法：const { enterViaPortal } = require('./_test-helper.js');
async function enterViaPortal(evalJs, sleep) {
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const r = await evalJs(`(function(){
      var p=document.getElementById('portal');
      return !!(p && getComputedStyle(p).display !== 'none' &&
        document.querySelectorAll('#portalTable tr[data-id]').length > 0);
    })()`);
    if (r.v === true) break;
  }
  const opened = await evalJs(`(function(){
    var tr=document.querySelector('#portalTable tr[data-id]');
    if(!tr) return false;
    tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return true;
  })()`);
  if (opened.v !== true) return false;

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const r = await evalJs(`document.querySelectorAll('.network').length > 0`);
    if (r.v === true) return true;
  }
  return false;
}

module.exports = { enterViaPortal };
