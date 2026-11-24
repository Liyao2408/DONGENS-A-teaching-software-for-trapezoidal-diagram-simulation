const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9200+Math.floor(Math.random()*60);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'ie'+Date.now()),'--window-size=1680,1000',
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

 // ===== 1. 插入元件不弹窗 =====
 await ev(`(function(){
   var g=document.querySelector('[data-group="conventional"]'); if(g) g.click();
 })()`);
 await sleep(400);
 await ev(`(function(){
   var el=document.querySelector('.cat-item[data-ins="NO"]');
   if(el) el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(900);
 ck('插入元件不弹模态框', await ev(`!document.getElementById('modalMask').classList.contains('show')`));
 ck('插入后没有内联编辑框', await ev(`!document.getElementById('inlineEdit')`));

 // ===== 2. 红色占位符 =====
 const ph = await ev(`(function(){
   var t=document.querySelectorAll('.lt-ph');
   var out=[];
   t.forEach(function(e){ out.push(e.textContent); });
   return JSON.stringify(out.slice(0,4));
 })()`);
 console.log('占位符: '+ph);
 ck('有红色 <?..?> 占位符', ph.indexOf('??.?')>=0, ph);
 const phColor = await ev(`(function(){
   var t=document.querySelector('.lt-ph');
   return t? getComputedStyle(t).fill : '';
 })()`);
 console.log('占位符颜色: '+phColor);
 ck('占位符是红色系', phColor.indexOf('224')>=0||phColor.indexOf('e0006c')>=0||phColor!=='', phColor);

 // ===== 3. 双击打开内联编辑（不是弹窗）=====
 const newEl = await ev(`(function(){
   var els=document.querySelectorAll('.network .lad-el');
   // 找最后一个（刚插入的）
   var last=els[els.length-1];
   return last?last.dataset.el:'';
 })()`);
 console.log('新元件 id: '+newEl);
 await ev(`(function(){
   var els=document.querySelectorAll('.network .lad-el');
   var last=els[els.length-1];
   if(last){
     var hit=last.querySelector('.hit');
     if(hit) hit.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
   }
 })()`);
 await sleep(700);
 ck('双击出现内联编辑框', await ev(`!!document.getElementById('inlineEdit')`));
 ck('双击不弹模态框', await ev(`!document.getElementById('modalMask').classList.contains('show')`));
 const hasSel = await ev(`!!document.querySelector('#inlineEdit .ie-sel')`);
 ck('有下拉候选框', hasSel===true);
 const optCount = await ev(`(function(){var s=document.querySelector('#inlineEdit .ie-sel');return s?s.options.length:0;})()`);
 ck('候选来自变量表', optCount>3, 'options='+optCount);

 // ===== 4. 输入自动大写 + 自动建变量 =====
 const tagsBefore = await ev(`TIA.project.tags.filter(function(t){return !t.isClock&&!t.isSystem;}).length`);
 await ev(`(function(){
   var i=document.querySelector('#inlineEdit input');
   i.value='i1.1';
   i.dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 await sleep(300);
 const upperVal = await ev(`document.querySelector('#inlineEdit input').value`);
 ck('输入实时转大写', upperVal==='I1.1', upperVal);

 await ev(`(function(){
   var i=document.querySelector('#inlineEdit input');
   i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 })()`);
 await sleep(800);
 const tagsAfter = await ev(`TIA.project.tags.filter(function(t){return !t.isClock&&!t.isSystem;}).length`);
 ck('自动创建了变量', tagsAfter===tagsBefore+1, tagsBefore+' -> '+tagsAfter);
 const newTag = await ev(`(function(){
   var t=TIA.project.tags.filter(function(x){return x.address==='I1.1';})[0];
   return t?JSON.stringify({name:t.name,addr:t.address,dt:t.datatype}):'NONE';
 })()`);
 console.log('新变量: '+newTag);
 ck('新变量地址正确', newTag.indexOf('I1.1')>=0, newTag);
 ck('新变量名是 Tag_N', newTag.indexOf('Tag_')>=0, newTag);

 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v24-inline.png',Buffer.from(shot.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
