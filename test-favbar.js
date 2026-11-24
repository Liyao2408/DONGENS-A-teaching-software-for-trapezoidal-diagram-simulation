const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9600+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'fb'+Date.now()),'--window-size=1680,1000',
   'http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();const logs=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||'').slice(0,400));
 });
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
   if(r.result?.exceptionDetails)return 'THROW: '+(r.result.exceptionDetails.exception?.description||'').slice(0,400);
   return r.result?.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(let k=0;k<40;k++){await sleep(250);
   const r=await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
   if(r===true)break;}
 await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
 await sleep(1700);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 ck('FavBar 已加载', await ev(`typeof FavBar==='object'`));
 ck('收藏栏已渲染', await ev(`!!document.getElementById('favbar')`));
 const cells = await ev(`document.querySelectorAll('#fbCells .fb-cell').length`);
 ck('默认 8 个收藏项', cells===8, 'cells='+cells);
 ck('有 SVG 图标', (await ev(`document.querySelectorAll('#fbCells .fb-cell svg').length`))===8);
 ck('含 TON', await ev(`document.getElementById('fbCells').textContent.indexOf('TON')>=0`));

 // 位置：应在块标题下方、网络上方
 const posOk = await ev(`(function(){
   var f=document.getElementById('favbarHost');
   var n=document.querySelector('.network');
   return f && n && (f.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
 })()`);
 ck('位置在网络上方', posOk);

 // 点选收藏项
 await ev(`(function(){var c=document.querySelector('#fbCells .fb-cell'); c.click();})()`);
 await sleep(300);
 ck('可选中收藏项', await ev(`FavBar.state.selected===0`), await ev(`String(FavBar.state.selected)`));

 // Delete 键【不再】删除收藏项（容易误触），删除改到右键菜单
 const beforeCnt = await ev(`FavBar.items().length`);
 const elBefore = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns[0].branches[0].map(function(e){return e.type;}))`);
 await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
 await sleep(500);
 const afterCnt = await ev(`FavBar.items().length`);
 ck('Delete 不再删除收藏项', afterCnt===beforeCnt, beforeCnt+' -> '+afterCnt);
 const elAfter = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns[0].branches[0].map(function(e){return e.type;}))`);
 ck('删除收藏时不影响画布元件', elBefore===elAfter, elBefore+' / '+elAfter);

 // 右键菜单删除收藏项
 await ev(`(function(){
   var c=document.querySelectorAll('#fbCells .fb-cell')[0];
   var b=c.getBoundingClientRect();
   c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+8,clientY:b.top+8}));
   return true;
 })()`);
 await sleep(400);
 const favMenu = await ev(`(function(){var m=document.getElementById('ladMenu');return m?m.textContent:'NONE';})()`);
 ck('收藏项右键菜单可弹出', favMenu!=='NONE', favMenu.slice(0,40));
 ck('菜单里有「排序」', favMenu.indexOf('排序')>=0);
 await ev(`(function(){
   var rows=document.querySelectorAll('#ladMenu .lm-item');
   for(var i=0;i<rows.length;i++){
     if(rows[i].textContent.indexOf('删除该收藏项')>=0){ rows[i].click(); return true; }
   }
   return false;
 })()`);
 await sleep(500);
 const afterCnt2 = await ev(`FavBar.items().length`);
 ck('右键菜单可删除收藏项', afterCnt2===beforeCnt-1, beforeCnt+' -> '+afterCnt2);

 // 排序模式：可进入、可拖动、Esc 退出
 await ev(`FavBar.enterSort()`);
 await sleep(400);
 ck('可进入排序模式', (await ev(`FavBar.isSorting()`))===true);
 ck('排序模式有变暗遮罩', (await ev(`!!document.getElementById('fbSortMask')`))===true);
 ck('排序模式有退出按钮', (await ev(`!!document.getElementById('fbSortExit')`))===true);
 const orderBefore = await ev(`JSON.stringify(FavBar.items())`);
 await ev(`(function(){
   var cells=document.querySelectorAll('#fbCells .fb-cell');
   if(cells.length<3) return false;
   var a=cells[0], d=cells[2];
   var ra=a.getBoundingClientRect(), rd=d.getBoundingClientRect();
   function pe(t,x,y,el){ el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,pointerId:1,isPrimary:true,pointerType:'mouse'})); }
   pe('pointerdown', ra.left+10, ra.top+10, a);
   pe('pointermove', ra.left+20, ra.top+10, a);
   pe('pointermove', rd.left+rd.width-3, rd.top+10, a);
   pe('pointerup', rd.left+rd.width-3, rd.top+10, a);
   return true;
 })()`);
 await sleep(400);
 const orderAfter = await ev(`JSON.stringify(FavBar.items())`);
 ck('拖动可调整顺序', orderBefore!==orderAfter, orderAfter);
 await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 await sleep(400);
 ck('Esc 退出排序模式', (await ev(`FavBar.isSorting()`))===false);
 ck('退出后遮罩移除', (await ev(`!document.getElementById('fbSortMask')`))===true);
 ck('退出后顺序保持', (await ev(`JSON.stringify(FavBar.items())`))===orderAfter);
 ck('工具栏没有垃圾桶按钮', (await ev(`!document.getElementById('fbClear')`))===true);

 // 双击收藏项插入指令（跳过两个分支图标：它们双击是"插入分支"）
 const colBefore = await ev(`TIA.project.blocks[0].networks[0].columns.length`);
 await ev(`(function(){
   var cs=document.querySelectorAll('#fbCells .fb-cell');
   for(var i=0;i<cs.length;i++){
     var t=cs[i].dataset.fbtype;
     if(t!=='OPEN_BRANCH' && t!=='OPEN_BRANCH_UP'){
       cs[i].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
       return t;
     }
   }
 })()`);
 await sleep(700);
 const colAfter = await ev(`TIA.project.blocks[0].networks[0].columns.length`);
 ck('双击收藏项可插入指令', colAfter>colBefore, colBefore+' -> '+colAfter);

 // 从指令面板双击加入收藏
 const favBefore = await ev(`FavBar.items().length`);
 await ev(`(function(){
   var g=document.querySelector('[data-group="timer"]'); if(g) g.click();
 })()`);
 await sleep(400);
 // 通过右键菜单加入 LAD 收藏栏（双击语义是"插入"，不改）
 await ev(`(function(){
   var el=document.querySelector('.cat-item[data-ins="TOF"]');
   if(el) el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:300}));
 })()`);
 await sleep(400);
 const hasMenu = await ev(`!!document.getElementById('catMenu')`);
 ck('指令右键菜单可弹出', hasMenu);
 await ev(`(function(){
   var rows=document.querySelectorAll('#catMenu .cat-menu-item');
   for(var i=0;i<rows.length;i++){
     if(rows[i].textContent.indexOf('LAD 收藏栏')>=0){ rows[i].click(); return; }
   }
 })()`);
 await sleep(700);
 const favAfter = await ev(`FavBar.items().length`);
 ck('右键可加入 LAD 收藏栏', favAfter===favBefore+1, favBefore+' -> '+favAfter);
 ck('新收藏项是 TOF', (await ev(`JSON.stringify(FavBar.items())`)).indexOf('TOF')>=0);

 // 持久化
 await send('Page.reload');
 await sleep(2600);
 for(let k=0;k<40;k++){await sleep(250);
   const r=await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
   if(r===true)break;}
 await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
 await sleep(1700);
 const persisted = await ev(`JSON.stringify(FavBar.items())`);
 ck('刷新后收藏仍在', persisted.indexOf('TOF')>=0, persisted);

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v13-favbar.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
