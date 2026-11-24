const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9800+Math.floor(Math.random()*50);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'fx'+Date.now()),'--window-size=1680,1000',
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

 async function realDrag(from, to, steps) {
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
   await sleep(70);
   const n = steps||14;
   for(let i=1;i<=n;i++){
     const x=from.x+(to.x-from.x)*i/n, y=from.y+(to.y-from.y)*i/n;
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1,pointerType:'mouse'});
     await sleep(35);
   }
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
   await sleep(500);
 }

 // ===== 1. 真实拖拽：指令面板 -> 收藏栏 =====
 // 先清空收藏栏确保可测
 await ev(`(function(){try{localStorage.removeItem('dongens.ladFavbar');}catch(e){} FavBar.state.items=[]; })()`);
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(900);
 await ev(`(function(){ FavBar.state.items=[]; if(document.getElementById('favbarHost')) { FavBar.render(document.getElementById('favbarHost'),{}); } })()`);
 await sleep(500);

 const favCountBefore = await ev(`FavBar.items().length`);
 console.log('拖前收藏数 = '+favCountBefore);

 // 取一个可见的指令项
 await ev(`(function(){var g=document.querySelector('[data-group="timer"]'); if(g) g.click();})()`);
 await sleep(500);
 const src = await ev(`(function(){
   var el=document.querySelector('.cat-item[data-ins="TON"]');
   if(!el) return null;
   var r=el.getBoundingClientRect();
   if(r.width===0) return null;
   return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
 })()`);
 const dst = await ev(`(function(){
   var el=document.getElementById('favbarHost');
   if(!el) return null;
   var r=el.getBoundingClientRect();
   return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
 })()`);
 console.log('src='+JSON.stringify(src)+' dst='+JSON.stringify(dst));

 if(src && dst){
   await realDrag(src, dst, 16);
   const after = await ev(`FavBar.items().length`);
   ck('真实鼠标拖拽可加入收藏栏', after===favCountBefore+1, favCountBefore+' -> '+after);
   const hasTON = await ev(`FavBar.items().indexOf('TON')>=0`);
   ck('加入的是 TON', hasTON===true, await ev(`JSON.stringify(FavBar.items())`));
 } else {
   ck('真实鼠标拖拽可加入收藏栏', false, '未取到坐标');
 }

 // ===== 2. 指令面板关闭 =====
 ck('面板初始可见', await ev(`(function(){var p=document.getElementById('instrPanel');return p && p.style.display!=='none';})()`));
 ck('有关闭按钮', await ev(`!!document.getElementById('ipClose')`));
 await ev(`document.getElementById('ipClose').click()`);
 await sleep(500);
 ck('点关闭后面板隐藏', await ev(`(function(){var p=document.getElementById('instrPanel');return p && p.style.display==='none';})()`));
 const leftover = await ev(`(function(){var p=document.getElementById('instrPanel');return p?p.getBoundingClientRect().width:0;})()`);
 ck('关闭后不再占宽度', leftover===0, 'width='+leftover);

 // 从菜单重新打开
 await ev(`(function(){
   var m=document.querySelector('.menu[data-menu="视图"]');
   if(m) m.click();
 })()`);
 await sleep(400);
 const menuHas = await ev(`(function(){var d=document.getElementById('dropdown');return d?d.textContent.indexOf('指令面板')>=0:false;})()`);
 ck('视图菜单有"指令面板"项', menuHas===true);
 await ev(`(function(){
   var d=document.getElementById('dropdown');
   var items=d.querySelectorAll('.item');
   for(var i=0;i<items.length;i++){
     if(items[i].textContent.indexOf('指令面板')>=0){ items[i].click(); return; }
   }
 })()`);
 await sleep(600);
 ck('可从菜单重新打开面板', await ev(`(function(){var p=document.getElementById('instrPanel');return p && p.style.display!=='none';})()`));

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v19-fixes.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
