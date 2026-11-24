const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9700+Math.floor(Math.random()*200);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,'--user-data-dir='+path.join(process.env.TEMP,'v4'+Date.now()),'--window-size=1600,1000','http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();const logs=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||'').slice(0,300));
 });
 const send=(m2,p2={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m2,params:p2}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
   if(r.result?.exceptionDetails)return 'THROW: '+(r.result.exceptionDetails.exception?.description||'').slice(0,300);
   return r.result?.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
  const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x?'  ['+x+']':''));};

  // __PORTAL_ENTRY__
  {
    let ok = false;
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      const r = await ev("(function(){var p=document.getElementById('portal');return !!(p && getComputedStyle(p).display!=='none' && document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
      if (r === true) { ok = true; break; }
    }
    if (ok) {
      await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
    }
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await ev('document.querySelectorAll(".network").length') > 0) break;
    }
  }
;

 // 修复验证：移动后空列应被清理
 const res = await ev(`(function(){
   var blk=TIA.project.blocks[0];
   var cols0 = blk.networks[0].columns.length;
   // 找线圈
   var coil=null;
   for(var c=0;c<blk.networks[0].columns.length;c++){
     var col=blk.networks[0].columns[c];
     for(var b=0;b<col.branches.length;b++)
       for(var e=0;e<col.branches[b].length;e++)
         if(col.branches[b][e].type==='COIL') coil=col.branches[b][e];
   }
   if(!coil) return 'NO_COIL';
   // 手工复刻 moveElement 的清理逻辑验证：直接调用不可见，故用 DOM drag 事件
   return JSON.stringify({cols0:cols0, coilId:coil.id});
 })()`);
 console.log('前置: '+res);

 // 真实鼠标跨网络拖拽（旧的 HTML5 dragstart/drop 模拟已失效：现在是 DragLayer 指针拖拽）
 const realDrag = async function(from, to, steps){
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
   await sleep(60);
   const n = steps || 14;
   for(let i=1;i<=n;i++){
     const x = from.x + (to.x-from.x)*i/n, y = from.y + (to.y-from.y)*i/n;
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1,pointerType:'mouse'});
     await sleep(30);
   }
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
   await sleep(500);
 };

 const dragSrc = await ev(`(function(){
   var g=document.querySelector('.network[data-net="0"] .lad-el .hit');
   if(!g) return null;
   var r=g.getBoundingClientRect();
   return {x:r.left+r.width/2, y:r.top+r.height/2, id:g.dataset.el};
 })()`);
 const dragDst = await ev(`(function(){
   var ns=document.querySelectorAll('.network');
   if(ns.length<2) return null;
   var svg=ns[1].querySelector('svg');
   if(!svg) return null;
   var r=svg.getBoundingClientRect();
   return {x:r.left+r.width-40, y:r.top+30};
 })()`);
 let dragMove = 'NO_TARGET';
 if (dragSrc && dragDst) {
   await realDrag(dragSrc, dragDst, 14);
   const leftNet1 = await ev(`(function(){
     var net=TIA.project.blocks[0].networks[0], found=false;
     net.columns.forEach(function(c){c.branches.forEach(function(b){b.forEach(function(e){
       if(e.id===${JSON.stringify(dragSrc.id)}) found=true; });});});
     return !found;
   })()`);
   const inNet2 = await ev(`JSON.stringify(TIA.project.blocks[0].networks[1]).indexOf(${JSON.stringify(dragSrc.id)})>=0`);
   dragMove = (leftNet1 && inNet2) ? 'DONE' : ('LEFT='+leftNet1+' IN2='+inNet2);
 }
 await sleep(300);
 const colsAfter = await ev('JSON.stringify(TIA.project.blocks[0].networks.map(n=>n.columns.length))');
 console.log('列数分布: '+colsAfter);
 ck('跨网络拖拽完成', dragMove==='DONE', dragMove);

 // 编译验证结构仍合法
 await ev('document.querySelector(".tb[data-act=compile]").click()');
 const e2=await ev('TIA.diags.filter(d=>d.level==="error").length');
 ck('拖拽后编译通过', e2===0, 'errors='+e2);
 if(e2>0)console.log(' '+await ev('JSON.stringify(TIA.diags.filter(d=>d.level==="error").slice(0,4))'));

 // 在线监视中不打断选中
 // 注意：下载完成后会自动切到"仿真面板"并弹着下载对话框，得先关掉、再切回 OB1
 await ev('document.querySelector(".tb[data-act=download]").click()');
 await sleep(2800);
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn'); if(b) b.click();})()`);
 await sleep(400);
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(900);
 await ev('document.querySelector(".tb[data-act=monitor]").click()');
 await sleep(400);
 const selKeep = await ev(`(function(){
   var g=document.querySelector('.lad-el .hit'); if(!g) return 'NO_EL';
   var r=g.getBoundingClientRect();
   g.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+5}));
   var id1=LadEdit.state.selId;
   return id1;
 })()`);
 await sleep(700);
 const selStill = await ev('LadEdit.state.selId');
 ck('监视刷新不丢失选中', selKeep===selStill && selKeep!=='NO_EL', 'sel='+selKeep);

 ws.close();killTree(p);
 if(logs.length){console.log('--- 异常 ---');logs.slice(0,6).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 process.exit(pass===R.length?0:1);
})();
