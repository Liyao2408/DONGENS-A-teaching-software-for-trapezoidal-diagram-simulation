const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9000+Math.floor(Math.random()*60);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'vj'+Date.now()),'--window-size=1680,1000',
   'http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();const logs=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||'').slice(0,300));
 });
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
   if(r.result?.exceptionDetails)return 'THROW: '+(r.result.exceptionDetails.exception?.description||'').slice(0,300);
   return r.result?.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(let k=0;k<40;k++){await sleep(250);
   const r=await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
   if(r===true)break;}
 await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
 await sleep(1700);
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(900);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   ':'FAIL ')+n+(x!==undefined?'  ['+x+']':''));};

 // 检查网络1的竖线（x1==x2 的线）
 const verticals = await ev(`(function(){
   var net=document.querySelector('.network[data-net="0"]');
   var svg=net.querySelector('svg');
   var out=[];
   svg.querySelectorAll('line').forEach(function(l){
     var x1=+l.getAttribute('x1'), x2=+l.getAttribute('x2');
     var y1=+l.getAttribute('y1'), y2=+l.getAttribute('y2');
     var cls=l.getAttribute('class')||'';
     // 只看导线类，排除元件符号内部的竖笔画(lad-body)
     if(cls.indexOf('lad-body')>=0) return;
     if(Math.abs(x2-x1)<0.5 && Math.abs(y2-y1)>4){
       out.push({cls:cls, x:x1, y1:y1, y2:y2});
     }
   });
   return JSON.stringify(out);
 })()`);
 console.log('网络1 竖线: '+verticals);
 const vArr = JSON.parse(verticals);
 // 按 x 分组，看同一 x 是否有重复
 const byX = {};
 vArr.forEach(function(v){ byX[v.x] = (byX[v.x]||0)+1; });
 // 母线(lad-rail/bus)与 join 重合时视为同一根（母线本身充当竖线）
 const dup = Object.keys(byX).filter(function(x){
   if(byX[x]<=1) return false;
   var clsList = vArr.filter(function(v){ return String(v.x)===String(x); }).map(function(v){return v.cls;});
   var hasRail = clsList.some(function(c){return c.indexOf('lad-rail')>=0||c.indexOf('lad-bus')>=0;});
   var wires = clsList.filter(function(c){return c.indexOf('lad-wire')>=0;});
   // 母线 + 1根导线 = 正常；导线 >=2 根 = 重复
   return wires.length >= 2;
 });
 console.log('各 x 的竖线数: '+JSON.stringify(byX));
 ck('同一位置只有一根竖线', dup.length===0, dup.length? 'x='+dup.join(',')+' 重复' : '无重复');

 // 检查元素中线一致性
 const midAlign = await ev(`(function(){
   var net=document.querySelector('.network[data-net="0"]');
   var ys=[];
   net.querySelectorAll('.lad-lead').forEach(function(l){ ys.push(+l.getAttribute('y1')); });
   var uniq={}; ys.forEach(function(y){uniq[y]=1;});
   return JSON.stringify({count:ys.length, uniq:Object.keys(uniq).map(Number).sort(function(a,b){return a-b;})});
 })()`);
 console.log('引线 y: '+midAlign);

 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v23-join.png',Buffer.from(shot.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();

