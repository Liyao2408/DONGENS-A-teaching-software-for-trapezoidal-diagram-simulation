const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9600+Math.floor(Math.random()*40);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'al'+Date.now()),'--window-size=1680,1000',
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

 // ===== 1. 中线对齐：触点/线圈/盒式的中线 y 必须一致 =====
 const align = await ev(`(function(){
   var net=document.querySelector('.network[data-net="1"]');
   if(!net) return 'NO_NET';
   var svg=net.querySelector('svg');
   var out=[];
   // 触点的引线 y（lad-lead）
   svg.querySelectorAll('.lad-lead').forEach(function(l){
     out.push ({kind:'lead', y:+l.getAttribute('y1')});
   });
   // 盒式的引线
   svg.querySelectorAll('.lad-el').forEach(function(g){
     var leads=g.querySelectorAll('.lad-lead');
     leads.forEach(function(l){ out.push({kind:'el-lead', y:+l.getAttribute('y1')}); });
   });
   var ys=out.map(function(o){return o.y;});
   var uniq={}; ys.forEach(function(y){uniq[y]=1;});
   return JSON.stringify({count:ys.length, uniqueY:Object.keys(uniq).map(Number).sort(function(a,b){return a-b;})});
 })()`);
 console.log('网络2 所有引线 y: '+align);

 // ===== 2. 末端竖杠 =====
 const bus = await ev(`(function(){
   var nets=document.querySelectorAll('.network');
   var out=[];
   nets.forEach(function(n){
     var b=n.querySelector('.lad-bus');
     if(b) out.push({net:n.dataset.net, x1:b.getAttribute('x1'), y1:b.getAttribute('y1'), y2:b.getAttribute('y2')});
   });
   return JSON.stringify(out);
 })()`);
 console.log('末端竖杠: '+bus);
 const busArr = JSON.parse(bus);
 ck('有末端竖杠封口', busArr.length>0, busArr.length+' 个');

 // ===== 3. 选中样式不是橙色 =====
 const selStyle = await ev(`(function(){
   var s=document.createElement('div');
   s.className='lad-seg sel';
   document.body.appendChild(s);
   var st=getComputedStyle(document.querySelector('.lad-seg.sel')||s);
   var stroke=st.stroke||'';
   s.remove();
   return stroke;
 })()`);
 console.log('选中描边色: '+selStyle);

 // ===== 4. 点空白清除选中 =====
 // 先选中一段
 const hittable = await ev(`(function(){
   var ok=null;
   document.querySelectorAll('.lad-hit').forEach(function(h){
     if(ok) return;
     var x1=+h.getAttribute('x1'), x2=+h.getAttribute('x2'), y=+h.getAttribute('y1');
     var svg=h.closest('svg'); var rc=svg.getBoundingClientRect();
     var cx=rc.left+(x1+x2)/2, cy=rc.top+y;
     if(cy<60||cy>window.innerHeight-60) return;
     if(document.elementFromPoint(cx,cy)===h) ok={x:Math.round(cx),y:Math.round(cy),seg:h.getAttribute('data-seg')};
   });
   return ok?JSON.stringify(ok):'NONE';
 })()`);
 if(hittable!=='NONE'){
   const pk=JSON.parse(hittable);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pk.x,y:pk.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
   await sleep(50);
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pk.x,y:pk.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
   await sleep(500);
   ck('点击可选中线段', await ev(`!!(TIA.selSeg||LadEdit.state.selSeg)`), await ev(`String(TIA.selSeg||'')`));

   // 找一个真正的空白点（该位置 top 元素是 div/svg 而不是线或元件）
   const blank = await ev(`(function(){
     var wrap=document.querySelector('.lad-wrap');
     var rc=wrap.getBoundingClientRect();
     for(var yy=Math.round(rc.top)+120; yy<Math.round(rc.bottom)-40; yy+=20){
       for(var xx=Math.round(rc.left)+420; xx<Math.round(rc.right)-60; xx+=30){
         var el=document.elementFromPoint(xx,yy);
         if(!el) continue;
         var cls=(el.getAttribute('class')||'');
         if(cls.indexOf('lad-hit')>=0||cls.indexOf('lad-seg')>=0||cls.indexOf('hit')>=0||
            el.tagName==='line'||el.tagName==='text'||el.tagName==='circle'||el.tagName==='rect') continue;
         return JSON.stringify({x:xx,y:yy,tag:el.tagName,cls:cls});
       }
     }
     return 'NONE';
   })()`);
   console.log('空白点: '+blank);
   if(blank!=='NONE'){
     const bp=JSON.parse(blank);
     await send('Input.dispatchMouseEvent',{type:'mousePressed',x:bp.x,y:bp.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
     await sleep(50);
     await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:bp.x,y:bp.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
     await sleep(600);
   }
   const after = await ev(`String(TIA.selSeg||LadEdit.state.selSeg||'')`);
   ck('点空白处清除选中', after==='', 'selSeg="'+after+'"');
 }

 // ===== 5. I/Q 数量按变量表 Bool 地址生成（V35 起不再补齐 DI14/DQ10）=====
 await ev(`document.querySelector('.tb[data-act="download"]').click()`);
 await sleep(2600);
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
 await sleep(1000);
 const iN = await ev(`document.querySelectorAll('.sim-node[data-kind="I"]').length`);
 const qN = await ev(`document.querySelectorAll('.sim-node[data-kind="Q"]').length`);
 const tagI = await ev(`TIA.project.tags.filter(function(t){return /^I\\d+\\.\\d+$/.test(t.address)&&String(t.datatype).toLowerCase()==='bool';}).length`);
 const tagQ = await ev(`TIA.project.tags.filter(function(t){return /^Q\\d+\\.\\d+$/.test(t.address)&&String(t.datatype).toLowerCase()==='bool';}).length`);
 ck('I 接口数 = 变量表 Bool I 数量', iN===tagI, 'n='+iN+' tags='+tagI);
 ck('Q 接口数 = 变量表 Bool Q 数量', qN===tagQ, 'n='+qN+' tags='+tagQ);
 const iAddrs = await ev(`JSON.stringify([].map.call(document.querySelectorAll('.sim-node[data-kind="I"]'),function(n){return n.dataset.addr;}))`);
 const qAddrs = await ev(`JSON.stringify([].map.call(document.querySelectorAll('.sim-node[data-kind="Q"]'),function(n){return n.dataset.addr;}))`);
 console.log('I 地址: '+iAddrs);
 console.log('Q 地址: '+qAddrs);
 ck('I 地址就是变量表里的 I0.0', iAddrs.indexOf('I0.0')>=0);
 ck('Q 地址就是变量表里的 Q0.1', qAddrs.indexOf('Q0.1')>=0);
 ck('不再有 CPU 固定补齐的 I1.5', iAddrs.indexOf('I1.5')<0);
 ck('不再有 CPU 固定补齐的 Q1.1', qAddrs.indexOf('Q1.1')<0);

 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v22-align.png',Buffer.from(shot.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();


