const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { enterViaPortal } = require('./test-helper.js');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9500+Math.floor(Math.random()*300);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,'--user-data-dir='+path.join(process.env.TEMP,'v2'+Date.now()),'--window-size=1600,1000','http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 if(!t||!t.length){console.log('NO TARGET');killTree(p);process.exit(1);}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();const logs=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,400));
   if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push('ERR: '+m.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,300));
 });
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
   if(r.result?.exceptionDetails)return 'THROW: '+(r.result.exceptionDetails.exception?.description||'').slice(0,300);
   return r.result?.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
  const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x?'  ['+x+']':''));};

  // __PORTAL_ENTRY__
  {
    let ok = false;
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      const r = await ev("(function(){var p=document.getElementById('portal');return !!(p && getComputedStyle(p).display!=='none' && document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
      if (r === true) { ok = true; break; }
    }
    if (ok) {
      await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
    }
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await ev('document.querySelectorAll(".network").length') > 0) break;
    }
  }
;

 ck('INSTR 目录已加载', await ev('typeof INSTR==="object" && INSTR.CATALOG.length===2'));
 ck('指令总数', (await ev('Object.keys(INSTR.DEFS).length'))>55, 'defs='+await ev('Object.keys(INSTR.DEFS).length'));
 ck('LAD 网络渲染', true, 'nets='+await ev('document.querySelectorAll(".network").length'));
 ck('盒式指令已绘制', (await ev('document.querySelectorAll(".lad-body").length'))>5);
 ck('指令面板已渲染', (await ev('document.querySelectorAll(".cat-item").length'))>50, 'items='+await ev('document.querySelectorAll(".cat-item").length'));
 ck('收藏夹有图标', (await ev('document.querySelectorAll(".cat-tile").length'))>3, 'tiles='+await ev('document.querySelectorAll(".cat-tile").length'));
 ck('LadEdit 就绪', await ev('typeof LadEdit==="object"'));

 // 编译
 await ev('document.querySelector(".tb[data-act=compile]").click()');
 const errN = await ev('TIA.diags.filter(d=>d.level==="error").length');
 ck('工程编译无错误', errN===0, 'errors='+errN);
 if(errN>0){console.log('  诊断：'+await ev('JSON.stringify(TIA.diags.filter(d=>d.level==="error").slice(0,4))'));}

 // Delete 测试
 const beforeN = await ev('TIA.project.blocks[0].networks[0].columns[2].branches[0][0].id');
 await ev(`(function(){var g=document.querySelector('[data-el="'+${JSON.stringify(beforeN)}+'"]'); g.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
 await sleep(200);
 ck('点击后进入选中态', await ev('LadEdit.state.selId!==null'), 'sel='+await ev('LadEdit.state.selId'));
 await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
 await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
 await sleep(300);
 const stillThere = await ev(`!!LadEdit.locate(TIA.project.blocks[0], ${JSON.stringify(beforeN)})`);
 ck('Delete 能删除元件', stillThere===false, 'exists='+stillThere);

 // 插入指令（通过面板）
 await ev(`(function(){var el=document.querySelector('.cat-item[data-ins="TOF"]'); el.click(); el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
 await sleep(400);
 const hasTof = await ev(`JSON.stringify(TIA.project.blocks[0]).indexOf('"TOF"')>=0`);
 ck('从面板插入 TOF 指令', hasTof);

 ws.close();killTree(p);
 if(logs.length){console.log('--- 浏览器异常 ---');logs.slice(0,6).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 process.exit(pass===R.length?0:1);
})();


