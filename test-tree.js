const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9800+Math.floor(Math.random()*90);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'tr'+Date.now()),'--window-size=1680,1000',
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
 await sleep(1500);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 ck('树已渲染', (await ev(`document.querySelectorAll('#treeBody .node').length`))>0, 'nodes='+await ev(`document.querySelectorAll('#treeBody .node').length`));
 ck('有 SVG 图标', (await ev(`document.querySelectorAll('#treeBody .ticon svg').length`))>0, 'svg='+await ev(`document.querySelectorAll('#treeBody .ticon svg').length`));

 // 顶层节点存在
 const labels = await ev(`JSON.stringify([].map.call(document.querySelectorAll('#treeBody .node .label'),function(x){return x.textContent;}))`);
 console.log('可见节点: '+labels);

 // 展开 PLC_1（若未展开）
 const plcOpen = await ev(`LadEdit?false:false`);
 await ev(`(function(){
   var n=document.querySelector('#treeBody .node[data-node="plc"]');
   if(n && n.dataset.expandable==='1'){
     var a=n.querySelector('.arrow');
     var st=document.querySelector('#treeBody .node[data-node="devconfig"]');
     if(!st) a.click();   // 未展开则展开
   }
 })()`);
 await sleep(350);
 ck('PLC_1 可展开（出现设备组态）', await ev(`!!document.querySelector('#treeBody .node[data-node="devconfig"]')`));

 // 展开 程序块
 await ev(`(function(){
   var n=document.querySelector('#treeBody .node[data-node="blocks"]');
   if(n){var a=n.querySelector('.arrow'); if(!document.querySelector('#treeBody .node[data-node="addBlock"]')) a.click();}
 })()`);
 await sleep(350);
 ck('程序块可展开（出现 添加新块）', await ev(`!!document.querySelector('#treeBody .node[data-node="addBlock"]')`));
 ck('程序块下有 OB1', await ev(`!!document.querySelector('#treeBody .node[data-node="block:OB1"]')`));

 // 展开 PLC 变量
 await ev(`(function(){
   var n=document.querySelector('#treeBody .node[data-node="variables"]');
   if(n){var a=n.querySelector('.arrow'); if(!document.querySelector('#treeBody .node[data-node="tags:0"]')) a.click();}
 })()`);
 await sleep(350);
 ck('PLC变量可展开（默认变量表带数量）', await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="tags:0"]');return n?/\\[\\d+\\]/.test(n.textContent):false;})()`));

 // 折叠再展开（状态记忆）
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="variables"]');if(n)n.querySelector('.arrow').click();})()`);
 await sleep(250);
 const collapsed = await ev(`!document.querySelector('#treeBody .node[data-node="tags:0"]')`);
 ck('可折叠', collapsed);
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="variables"]');if(n)n.querySelector('.arrow').click();})()`);
 await sleep(300);
 ck('可重新展开', await ev(`!!document.querySelector('#treeBody .node[data-node="tags:0"]')`));

 // 点击块打开标签
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(600);
 ck('点块名可打开编辑器', await ev(`TIA.activeTab && TIA.activeTab.kind==='block'`), await ev(`TIA.activeTab?TIA.activeTab.title:''`));

 // 树结构完整性：检查关键节点都定义了
 const keys = await ev(`JSON.stringify(Tree.build(TIA.project)[0].children.map(function(c){return c.id;}))`);
 console.log('顶层子节点: '+keys);
 const plcChildren = await ev(`(function(){
   var c=Tree.build(TIA.project)[0].children.filter(function(x){return x.id==='plc';})[0];
   return JSON.stringify(c.children.map(function(x){return x.id;}));
 })()`);
 console.log('PLC_1 子节点: '+plcChildren);

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v5-tree.png',Buffer.from(s.result.data,'base64'));
 console.log('saved docs/v5-tree.png');

 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();

