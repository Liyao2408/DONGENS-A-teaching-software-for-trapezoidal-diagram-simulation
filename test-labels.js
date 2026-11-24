const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9900+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'v5'+Date.now()),'--window-size=1680,1000',
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
 await sleep(1600);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 // 1. 两行标签（地址 + 符号名）
 const addrCnt = await ev(`document.querySelectorAll('.lad-el .lt-addr').length`);
 const symCnt = await ev(`document.querySelectorAll('.lad-el .lt-sym').length`);
 ck('元件显示绝对地址行', addrCnt>0, 'addr='+addrCnt);
 ck('元件显示符号名行', symCnt>0, 'sym='+symCnt);
 const firstAddr = await ev(`(function(){var e=document.querySelector('.lad-el .lt-addr');return e?e.textContent:'';})()`);
 const firstSym = await ev(`(function(){var e=document.querySelector('.lad-el .lt-sym');return e?e.textContent:'';})()`);
 console.log('首个元件标签: 地址="'+firstAddr+'" 符号='+firstSym);
 ck('地址形如 I0.0', /^[IQM]\d+\.\d+$/.test(firstAddr)||/^[IQM][BWD]\d+$/.test(firstAddr), firstAddr);
 ck('符号名带引号', /^".*"$/.test(firstSym), firstSym);

 // 2. 单击元件 → 出现类型下拉
 await ev(`(function(){
   var g=document.querySelector('.lad-el .hit');
   g.dispatchEvent(new MouseEvent('click',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('单击元件出现类型下拉', await ev(`!!document.getElementById('typeDd')`));
 const ddRows = await ev(`document.querySelectorAll('#typeDd .td-row').length`);
 ck('下拉含多种类型', ddRows>=3, 'rows='+ddRows);
 const ddNames = await ev(`JSON.stringify([].map.call(document.querySelectorAll('#typeDd .td-name'),function(x){return x.textContent;}))`);
 console.log('下拉类型: '+ddNames);

 // 3. 点击下拉换类型（常开 -> 常闭）
 const beforeType = await ev(`(function(){
   var blk=TIA.project.blocks[0];
   var el=blk.networks[0].columns[0].branches[0][0];
   return el ? el.type : 'NONE';
 })()`);
 await ev(`(function(){
   var rows=document.querySelectorAll('#typeDd .td-row');
   for(var i=0;i<rows.length;i++){ if(rows[i].textContent.indexOf('常闭')>=0){ rows[i].click(); return; } }
 })()`);
 await sleep(400);
 const afterType = await ev(`(function(){
   var blk=TIA.project.blocks[0];
   var el=blk.networks[0].columns[0].branches[0][0];
   return el ? el.type : 'NONE';
 })()`);
 ck('可通过下拉切换元件类型', beforeType!==afterType, beforeType+' -> '+afterType);

 // 4. 双击触点/线圈 → 内联编辑（V24 起不再弹窗）
 await ev(`(function(){
   var g=document.querySelector('.lad-el .hit');
   g.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('双击出现内联编辑框', await ev(`!!document.getElementById('inlineEdit')`));
 ck('双击不再弹模态框', await ev(`!document.getElementById('modalMask').classList.contains('show')`));
 const hasTagSel = await ev(`!!document.querySelector('#inlineEdit .ie-sel')`);
 ck('内联编辑含符号下拉', hasTagSel);
 // 关闭
 await ev(`(function(){var i=document.querySelector('#inlineEdit input'); if(i) i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
 await sleep(250);

 // 5. 树：常用项双击
 const treeChecks = [
   ['block:OB1','OB1 块'],
   ['tags:0','默认变量表'],
   ['watchlist','监控表']
 ];
 for (const [key,label] of treeChecks) {
   const has = await ev(`!!document.querySelector('#treeBody .node[data-node="${key}"]')`);
   ck('树中存在 '+label, has);
 }

 // 6. 双击"默认变量表"应打开标签页
 await ev(`(function(){
   var n=document.querySelector('#treeBody .node[data-node="tags:0"]');
   if(n) n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(600);
 ck('双击默认变量表可打开', await ev(`TIA.activeTab && TIA.activeTab.kind==='tags'`), await ev(`TIA.activeTab?TIA.activeTab.kind:''`));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v6-labels.png',Buffer.from(s.result.data,'base64'));
 console.log('saved docs/v6-labels.png');

 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
