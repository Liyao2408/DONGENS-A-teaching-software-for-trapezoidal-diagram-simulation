const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9500+Math.floor(Math.random()*60);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'sc'+Date.now()),'--window-size=1680,1000',
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

 // 1. 三层结构存在
 ck('有 lad-editor-root 容器', await ev(`!!document.querySelector('.lad-editor-root')`));
 ck('有 lad-scroll 滚动区', await ev(`!!document.querySelector('.lad-scroll')`));

 // 2. 头部不再是 sticky
 const headPos = await ev(`(function(){var e=document.querySelector('.blk-head');return e?getComputedStyle(e).position:'none';})()`);
 ck('块头改为 static（不再 sticky）', headPos==='static', headPos);
 const favPos = await ev(`(function(){var e=document.querySelector('.favbar-host');return e?getComputedStyle(e).position:'none';})()`);
 ck('收藏栏改为 static', favPos==='static', favPos);

 // 3. 滚动区滚动后，头部仍在原位
 const beforeRect = await ev(`JSON.stringify({
   head: document.querySelector('.blk-head').getBoundingClientRect().top,
   fav: document.querySelector('.favbar-host').getBoundingClientRect().top
 })`);
 await ev(`(function(){var s=document.querySelector('.lad-scroll'); if(s) s.scrollTop=300;})()`);
 await sleep(500);
 const afterRect = await ev(`JSON.stringify({
   head: document.querySelector('.blk-head').getBoundingClientRect().top,
   fav: document.querySelector('.favbar-host').getBoundingClientRect().top,
   scrolled: document.querySelector('.lad-scroll').scrollTop
 })`);
 const b=JSON.parse(beforeRect), a=JSON.parse(afterRect);
 console.log('滚动前: '+beforeRect);
 console.log('滚动后: '+afterRect);
 ck('滚动后块头位置不变', Math.abs(b.head-a.head)<1, b.head+' -> '+a.head);
 ck('滚动后收藏栏位置不变', Math.abs(b.fav-a.fav)<1, b.fav+' -> '+a.fav);
 ck('滚动区确实滚动生效', a.scrolled>0, 'scrollTop='+a.scrolled);

 // 4. 指令集扩充
 const defCount = await ev(`Object.keys(INSTR.DEFS).length`);
 ck('指令定义数 >= 87', defCount>=87, 'defs='+defCount);
 const catCount = await ev(`(function(){var n=0;INSTR.CATALOG.forEach(function(s){s.groups.forEach(function(g){n+=g.items.length;});});return n;})()`);
 ck('目录条目 >= 100', catCount>=100, 'items='+catCount);
 ck('有工艺分组', await ev(`document.getElementById('instrBody').textContent.indexOf('工艺')>=0`));
 ck('有通信分组', await ev(`document.getElementById('instrBody').textContent.indexOf('通信')>=0`));

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v17-scroll.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
