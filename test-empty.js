const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9500+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'em'+Date.now()),'--window-size=1680,1000',
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
 // 进门户
 for(let k=0;k<40;k++){await sleep(250);
   const r=await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
   if(r===true)break;}
 await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
 await sleep(1600);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 // 确保在 OB1
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]'); if(n)n.click();})()`);
 await sleep(800);

 // 1. 初始不应有 EMPTY 文本
 ck('初始无 EMPTY 字样', await ev(`document.querySelector('.lad-wrap').textContent.indexOf('EMPTY')<0`));

 // 2. 删除网络2的第1个元件（P 触点）
 const before2 = await ev(`TIA.project.blocks[0].networks[1].columns.length`);
 await ev(`(function(){
   var g=document.querySelector('.network[data-net="1"] .lad-el .hit');
   g.dispatchEvent(new MouseEvent('click',{bubbles:true}));
 })()`);
 await sleep(300);
 await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);
 await sleep(600);

 ck('删除后仍无 EMPTY 字样', await ev(`document.querySelector('.lad-wrap').textContent.indexOf('EMPTY')<0`));
 const emptyBoxes = await ev(`document.querySelectorAll('.lad-el text').length`);
 const redBoxes = await ev(`(function(){
   var t=document.querySelectorAll('.lad-wrap text');
   var bad=0;
   for(var i=0;i<t.length;i++){ if(t[i].textContent==='EMPTY') bad++; }
   return bad;
 })()`);
 ck('没有红色 EMPTY 标记', redBoxes===0, 'bad='+redBoxes);

 // 3. 结构里也不应有 EMPTY
 const structEmpty = await ev(`JSON.stringify(TIA.project.blocks[0]).split('"EMPTY"').length-1`);
 ck('工程数据中无 EMPTY 节点', structEmpty===0, 'count='+structEmpty);

 // 4. 删到整列空 —— 列应被移除
 const beforeCols = await ev(`TIA.project.blocks[0].networks[1].columns.length`);
 await ev(`(function(){
   var blk=TIA.project.blocks[0];
   var net=blk.networks[1];
   // 把最后一列的唯一元件删掉
   var last=net.columns[net.columns.length-1];
   if(last && last.branches[0] && last.branches[0][0]){
     LadEdit.mount(blk, TIA.activeTab, {});
     LadEdit.deleteElement(last.branches[0][0].id);
   }
 })()`);
 await sleep(600);
 const afterCols = await ev(`TIA.project.blocks[0].networks[1].columns.length`);
 ck('清空的列被移除', afterCols < beforeCols, beforeCols+' -> '+afterCols);

 // 5. 连线仍然存在（视觉直通）
 const wires = await ev(`document.querySelectorAll('.network[data-net="1"] .lad-wire').length`);
 ck('空处仍有导线连接', wires>0, 'wires='+wires);

 // 截图
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v12-empty-fix.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
