const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9700+Math.floor(Math.random()*50);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'s2'+Date.now()),'--window-size=1680,1000',
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
 // 下载
 await ev(`document.querySelector('.tb[data-act="download"]').click()`);
 await sleep(2600);
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
 await sleep(900);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 // I/Q 数量：按变量表 Bool 地址（V35 起不再固定补齐 14DI / 10DQ）
 const iN = await ev(`document.querySelectorAll('.sim-node[data-kind="I"]').length`);
 const qN = await ev(`document.querySelectorAll('.sim-node[data-kind="Q"]').length`);
 const tagI = await ev(`TIA.project.tags.filter(function(t){return /^I\\d+\\.\\d+$/.test(t.address)&&String(t.datatype).toLowerCase()==='bool';}).length`);
 const tagQ = await ev(`TIA.project.tags.filter(function(t){return /^Q\\d+\\.\\d+$/.test(t.address)&&String(t.datatype).toLowerCase()==='bool';}).length`);
 ck('I 接口数 = 变量表 Bool I 数量', iN===tagI, 'n='+iN+' tags='+tagI);
 ck('Q 接口数 = 变量表 Bool Q 数量', qN===tagQ, 'n='+qN+' tags='+tagQ);

 // Shift 多选（点动模式）
 await ev(`SimPanel.setMode('momentary')`);
 await ev(`SimPanel.render(document.getElementById('simBody'),{plc:TIA.plc,project:TIA.project})`);
 await sleep(500);

 await ev(`(function(){
   // 模拟按住 Shift 依次按下两个 I
   window.__shift=true;
   var nodes=document.querySelectorAll('.sim-node[data-kind="I"]');
   [nodes[0],nodes[2]].forEach(function(n){
     var e=new MouseEvent('mousedown',{bubbles:true,cancelable:true,shiftKey:true});
     n.dispatchEvent(e);
   });
 })()`);
 await sleep(400);
 const twoOn = await ev(`(function(){
   var nodes=document.querySelectorAll('.sim-node[data-kind="I"]');
   var a=nodes[0].dataset.addr, b=nodes[2].dataset.addr;
   return JSON.stringify({a:TIA.plc.read(a), b:TIA.plc.read(b), aAddr:a, bAddr:b});
 })()`);
 console.log('Shift 连按两个 I: '+twoOn);
 const t2 = JSON.parse(twoOn);
 ck('Shift 可让多个 I 同时有信号', t2.a===true && t2.b===true, twoOn);

 // 松开 Shift 全部停止
 await ev(`document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}))`);
 await sleep(500);
 const afterRelease = await ev(`(function(){
   var nodes=document.querySelectorAll('.sim-node[data-kind="I"]');
   var a=nodes[0].dataset.addr, b=nodes[2].dataset.addr;
   return JSON.stringify({a:TIA.plc.read(a), b:TIA.plc.read(b)});
 })()`);
 console.log('松开 Shift 后: '+afterRelease);
 const t3 = JSON.parse(afterRelease);
 ck('松开 Shift 所有 I 停止', t3.a===false && t3.b===false, afterRelease);

 // 切回 LAD 页再检查缩放条
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(900);
 const zoomPos = await ev(`(function(){
   var z=document.querySelector('.lad-zoombar');
   if(!z) return 'NO';
   var st=getComputedStyle(z);
   return JSON.stringify({pos:st.position, right:st.right, bottom:st.bottom});
 })()`);
 console.log('缩放条定位: '+zoomPos);
 ck('缩放条固定定位（右下角）', zoomPos!=='NO' && JSON.parse(zoomPos).pos==='absolute', zoomPos);

 // 缩放实时生效
 const before = await ev(`(function(){var s=document.querySelector('.lad-wrap svg');return s?s.style.width||'auto':'';})()`);
 await ev(`(function(){var s=document.getElementById('ladZoomSel');s.value='60';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await sleep(500);
 const after = await ev(`(function(){var s=document.querySelector('.lad-wrap svg');return s?s.style.width||'auto':'';})()`);
 ck('缩放到 60% 生效', after!=='auto' && after!==before, before+' -> '+after);

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v18-sim2.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();


