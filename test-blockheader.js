const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9700+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'bh'+Date.now()),'--window-size=1680,1000',
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

 ck('BlockHeader 已加载', await ev(`typeof BlockHeader==='object'`));
 ck('块标题区已渲染', await ev(`!!document.getElementById('blkTitleBlock')`));
 ck('有"块标题："标签', await ev(`document.getElementById('blkTitleBlock').textContent.indexOf('块标题')>=0`));
 ck('有"注释"标签', await ev(`document.getElementById('blkTitleBlock').textContent.indexOf('注释')>=0`));

 const titleTxt = await ev(`document.getElementById('btbTitle').textContent`);
 ck('块标题已预填', titleTxt.length>0, titleTxt);
 const cmtTxt = await ev(`document.getElementById('btbComment').textContent`);
 ck('注释已预填', cmtTxt.length>0, cmtTxt.slice(0,30));

 // 位置：应在收藏栏下方、网络上方
 const posOk = await ev(`(function(){
   var f=document.getElementById('favbarHost');
   var b=document.getElementById('blkTitleBlock');
   var n=document.querySelector('.network');
   var a=(f.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)>0;
   var c=(b.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)>0;
   return a && c;
 })()`);
 ck('位置：收藏栏 ↓ 块标题 ↓ 网络', posOk);

 // 可编辑
 ck('标题可编辑', await ev(`document.getElementById('btbTitle').isContentEditable===true`));
 ck('注释可编辑', await ev(`document.getElementById('btbComment').isContentEditable===true`));

 // 修改标题并失焦提交
 await ev(`(function(){
   var el=document.getElementById('btbTitle');
   el.textContent='我的主程序标题';
   el.dispatchEvent(new Event('blur'));
 })()`);
 await sleep(500);
 const savedTitle = await ev(`TIA.project.blocks[0].title`);
 ck('标题修改已保存', savedTitle==='我的主程序标题', savedTitle);

 // 修改注释
 await ev(`(function(){
   var el=document.getElementById('btbComment');
   el.focus();
   el.textContent='AAA第一行' + String.fromCharCode(10) + 'BBB第二行';
   el.dispatchEvent(new Event('input',{bubbles:true}));
   el.blur();
 })()`);
 await sleep(500);
 const savedCmt = await ev(`TIA.project.blocks[0].comment`);
 ck('注释修改已保存（支持换行）', savedCmt.indexOf('第二行')>=0, savedCmt.replace(/\n/g,'|'));

 // 标记为脏
 ck('修改后标签页显示未保存', await ev(`TIA.openTabs.some(function(t){return t.dirty;})`));

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v14-blocktitle.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();


