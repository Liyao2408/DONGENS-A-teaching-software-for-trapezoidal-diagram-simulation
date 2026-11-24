const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9900+Math.floor(Math.random()*60);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'sg'+Date.now()),'--window-size=1680,1000',
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

 // 1. 线段元素存在且可点选
 const segs = await ev(`document.querySelectorAll('[data-seg]').length`);
 ck('线段带 data-seg 属性', segs>0, 'segs='+segs);

 // 2. 点线段选中
 await ev(`(function(){
   var s=document.querySelector('[data-seg]');
   s.dispatchEvent(new MouseEvent('click',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('点击线段可选中', await ev(`!!LadEdit.state.selSeg`), await ev(`String(LadEdit.state.selSeg)`));
 ck('选中状态已生效', await ev(`!!(TIA.selSeg||LadEdit.state.selSeg)`), 'selSeg='+await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`));

 // 3. 选中后加分支
 // 记录网络0所有列的分支数总和
 const before = await ev(`(function(){
   var net=TIA.project.blocks[0].networks[0];
   return JSON.stringify(net.columns.map(function(c){return c.branches.length;}));
 })()`);
 await ev(`(function(){
   var n=document.querySelector('[data-net-addbranch]');
   if(n) n.click();
 })()`);
 await sleep(600);
 const after = await ev(`(function(){
   var net=TIA.project.blocks[0].networks[0];
   return JSON.stringify(net.columns.map(function(c){return c.branches.length;}));
 })()`);
 const sumB = JSON.parse(before).reduce(function(a,b){return a+b;},0);
 const sumA = JSON.parse(after).reduce(function(a,b){return a+b;},0);
 ck('选中线段后可加分支', sumA>sumB, before+' -> '+after);

 // 4. 对齐检查：列间连线两端 y 应一致（同分支数时）
 // 检查导线（只检查 lad-wire 类，排除元件内部的常闭触点斜杠）
 const alignOk = await ev(`(function(){
   var bad=0, check=0;
   document.querySelectorAll('.lad-wire').forEach(function(l){
     if(l.tagName!=='line') return;
     var x1=parseFloat(l.getAttribute('x1'));
     var x2=parseFloat(l.getAttribute('x2'));
     var y1=parseFloat(l.getAttribute('y1'));
     var y2=parseFloat(l.getAttribute('y2'));
     var dx=Math.abs(x2-x1), dy=Math.abs(y2-y1);
     // 导线必须水平或垂直（不允许斜线）
     if(dx>1 && dy>1){ bad++; return; }
     check++;
   });
   return JSON.stringify({bad:bad, checked:check});
 })()`);
 const al = JSON.parse(alignOk);
 ck('横向连线水平对齐', al.bad===0, 'checked='+al.checked+' misaligned='+al.bad);

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v15-wires.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();



