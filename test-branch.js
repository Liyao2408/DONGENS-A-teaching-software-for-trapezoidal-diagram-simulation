const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9500+Math.floor(Math.random()*50);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'bd'+Date.now()),'--window-size=1680,1000',
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

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 // ===== 1. 线段有长度（可点选）=====
 const segLens = await ev(`JSON.stringify([].map.call(document.querySelectorAll('.lad-seg'),function(s){
   return Math.abs(+s.getAttribute('x2') - +s.getAttribute('x1'));
 }))`);
 const lenArr = JSON.parse(segLens);
 const clickable = lenArr.filter(function(l){return l>4;}).length;
 ck('列间线段有实际长度（可点选）', clickable>0, '可点='+clickable+'/'+lenArr.length+' 长度='+JSON.stringify(lenArr.slice(0,4)));
 ck('线段长度约等于列间距', lenArr.length>0 && lenArr[0]>=20, 'len='+lenArr[0]);

 // ===== 2. 点选线段 =====
 // 找出真正可命中的线段（top 元素就是 lad-hit）
 const hittable = await ev(`(function(){
   var ok=[];
   document.querySelectorAll('.lad-hit').forEach(function(h){
     var x1=+h.getAttribute('x1'), x2=+h.getAttribute('x2'), y=+h.getAttribute('y1');
     var svg=h.closest('svg');
     var r=svg.getBoundingClientRect();
     var cx=r.left+(x1+x2)/2, cy=r.top+y;
     var top=document.elementFromPoint(cx,cy);
     if(top && top.getAttribute && top.getAttribute('class')==='lad-hit'){
       ok.push({x:Math.round(cx), y:Math.round(cy), seg:h.getAttribute('data-seg')});
     }
   });
   return JSON.stringify(ok);
 })()`);
 const hittableArr = JSON.parse(hittable);
 console.log('可直接命中的线段: '+hittableArr.length+' 条 '+hittable);
 ck('有可直接点中的线段', hittableArr.length>0, hittableArr.length+' 条');

 if(hittableArr.length){
   const pick = hittableArr[0];
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pick.x,y:pick.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
   await sleep(60);
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pick.x,y:pick.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
   await sleep(600);
 }
 await sleep(600);
 ck('点击可选中线段', await ev(`!!(TIA.selSeg||LadEdit.state.selSeg)`), await ev(`String(TIA.selSeg||LadEdit.state.selSeg)`));
 ck('选中状态已生效', await ev(`!!(TIA.selSeg||LadEdit.state.selSeg)`), 'selSeg='+await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`));

 // ===== 3. 收藏栏有分支图标 =====
 const favItems = await ev(`JSON.stringify(FavBar.items())`);
 console.log('收藏栏: '+favItems);
 ck('收藏栏含"插入分行"图标', favItems.indexOf('OPEN_BRANCH')>=0);
 ck('收藏栏含"插入分列"图标', favItems.indexOf('OPEN_BRANCH_UP')>=0);
 ck('收藏栏共 8 格（含 2 个分支图标）', (await ev(`document.querySelectorAll('#fbCells .fb-cell').length`))===8,
    await ev(`document.querySelectorAll('#fbCells .fb-cell').length`));

 // ===== 4. 点分支图标可插入分支 =====
 const branchesBefore = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.length;}))`);
 console.log('插入前分支数: '+branchesBefore);
 await ev(`(function(){
   var cells=document.querySelectorAll('#fbCells .fb-cell');
   for(var i=0;i<cells.length;i++){
     if(cells[i].dataset.fbtype==='OPEN_BRANCH'){ cells[i].click(); return; }
   }
 })()`);
 await sleep(700);
 const branchesAfter = await ev(`JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(function(c){return c.branches.length;}))`);
 console.log('插入后分支数: '+branchesAfter);
 const bA = JSON.parse(branchesBefore).reduce(function(a,b){return a+b;},0);
 const bB = JSON.parse(branchesAfter).reduce(function(a,b){return a+b;},0);
 ck('点分支图标可插入分支', bB>bA, branchesBefore+' -> '+branchesAfter);

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v21-branch.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();



