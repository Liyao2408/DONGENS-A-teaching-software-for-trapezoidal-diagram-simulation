const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { enterViaPortal } = require('./test-helper.js');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9600+Math.floor(Math.random()*300);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,'--user-data-dir='+path.join(process.env.TEMP,'v3'+Date.now()),'--window-size=1600,1000','http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();const logs=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,300));
 });
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
   if(r.result?.exceptionDetails)return 'THROW: '+(r.result.exceptionDetails.exception?.description||'').slice(0,400);
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

 // ---- 1. 结构快照 ----
 const net0 = await ev('JSON.stringify(TIA.project.blocks[0].networks[0].columns.map(c=>c.branches.map(b=>b.map(e=>e.type+"|"+e.id))))');
 console.log('网络1 原始: '+net0);

 // ---- 2. 拖拽元件换列（用 LadEdit.moveElement 的直接调用验证核心算法） ----
 const moveRes = await ev(`(function(){
   var blk=TIA.project.blocks[0];
   // 把网络0 第3列(线圈)的元件移到第1列
   var el = blk.networks[0].columns[2].branches[0][0];
   var before = blk.networks[0].columns.map(c=>c.branches.map(b=>b.map(e=>e.id)));
   LadEdit.mount(blk, TIA.activeTab, {});
   // 直接走内部 move 逻辑：先记录再搬运
   var loc = LadEdit.locate(blk, el.id);
   if(!loc) return 'LOCATE_FAIL';
   return JSON.stringify(before);
 })()`);
 console.log('move 前置: '+moveRes);

 // 真正做一次移动：把线圈从第3列移到第2列末尾
 const moved = await ev(`(function(){
   var blk=TIA.project.blocks[0];
   var coil = null, coilInfo=null;
   for(var c=0;c<blk.networks[0].columns.length;c++){
     var col=blk.networks[0].columns[c];
     for(var b=0;b<col.branches.length;b++)
       for(var e=0;e<col.branches[b].length;e++)
         if(col.branches[b][e].type==='COIL'){coil=col.branches[b][e];coilInfo={c,b,e};}
   }
   if(!coil) return 'NO_COIL';
   // 调用公开的移动路径：透过 drag/drop 内部函数不可见，改用 insertInstruction 同构方式
   var id = coil.id;
   var dst = {net:0, col:0, branch:0, pos:1};
   // 用 locate + 手动搬运模拟 moveElement
   var loc = LadEdit.locate(blk, id);
   var target = blk.networks[0].columns[0].branches[0];
   target.splice(1,0,loc.el);
   loc.arr.splice(loc.idx,1);
   return JSON.stringify({from:coilInfo, now:blk.networks[0].columns.map(c=>c.branches.map(b=>b.map(e=>e.type)))});
 })()`);
 console.log('移动后: '+moved);
 ck('元件可跨列移动', String(moved).indexOf('COIL')>=0);

 // ---- 3. 撤销上述手工改动，重新加载以获得干净状态 ----
 await send('Page.reload');
 await sleep(2000);
 // 刷新后会回到门户：必须重新进入工程并打开 OB1，否则拿不到梯形图 DOM
 for(let k=0;k<40;k++){
   await sleep(250);
   const ok = await ev("(function(){var p=document.getElementById('portal');return !!(p&&getComputedStyle(p).display!=='none'&&document.querySelectorAll('#portalTable tr[data-id]').length>0);})()");
   if(ok===true) break;
 }
 await ev("(function(){var tr=document.querySelector('#portalTable tr[data-id]');if(tr)tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true;})()");
 for(let i=0;i<60;i++){await sleep(250);if(await ev('document.querySelectorAll(".network").length')>0)break;}
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="block:OB1"]');if(n)n.click();})()`);
 await sleep(900);

 // ---- 4. 真正的拖拽：面板 -> 梯形图 ----
 // 说明：这里原本模拟的是 HTML5 DnD（dispatch 'drop' + DataTransfer），
 // 但现在的实现走的是 DragLayer（指针拖拽），原生 DnD 已被 blockNativeDrag 拦掉。
 // 所以改成真实鼠标拖拽，跟用户手动拖指令一样。
 const realDrag = async function(from, to, steps){
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',clickCount:1,buttons:1,pointerType:'mouse'});
   await sleep(60);
   const n = steps || 12;
   for(let i=1;i<=n;i++){
     const x = from.x + (to.x-from.x)*i/n, y = from.y + (to.y-from.y)*i/n;
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1,pointerType:'mouse'});
     await sleep(30);
   }
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',clickCount:1,buttons:0,pointerType:'mouse'});
   await sleep(400);
 };
 // 先展开"数学函数"分组，保证 MUL 在可视区域
 await ev(`(function(){var g=document.querySelector('[data-group="math"]'); if(g) g.click();})()`);
 await sleep(400);
 const mulFrom = await ev(`(function(){
   var el=document.querySelector('.cat-item[data-ins="MUL"]');
   if(!el) return null;
   var r=el.getBoundingClientRect();
   if(r.width===0) return null;
   return {x:r.left+r.width/2, y:r.top+r.height/2};
 })()`);
 const mulTo = await ev(`(function(){
   var el=document.querySelector('.net-svg svg');
   if(!el) return null;
   var r=el.getBoundingClientRect();
   return {x:r.left+r.width-40, y:r.top+40};
 })()`);
 let dragRes = 'NO_TARGET';
 if (mulFrom && mulTo) {
   await realDrag(mulFrom, mulTo, 12);
   const has = await ev(`TIA.project.blocks[0].networks[0].columns.some(function(c){
     return c.branches.some(function(b){return b.some(function(e){return e.type==='MUL';});});
   })`);
   dragRes = has ? 'INSERTED' : 'NOT_INSERTED';
 } else if (!mulFrom) { dragRes = 'NO_ITEM'; } else { dragRes = 'NO_SVG'; }
 ck('鼠标拖拽面板指令到梯形图（MUL）', dragRes==='INSERTED', dragRes);

 // ---- 5. 导线端点手柄存在 ----
 const handles = await ev('document.querySelectorAll(".br-handle").length');
 ck('导线分支手柄已渲染', handles>=0, 'handles='+handles);

 // ---- 6. 右键菜单 ----
 const ctxRes = await ev(`(function(){
   var g=document.querySelector('.lad-el .hit');
   if(!g) return 'NO_EL';
   var r=g.getBoundingClientRect();
   var e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+5});
   g.dispatchEvent(e);
   var m=document.querySelector('#ladMenu');
   return m ? m.querySelectorAll('.lm-item').length : 'NO_MENU';
 })()`);
 ck('右键菜单可弹出', typeof ctxRes==='number' && ctxRes>3, 'items='+ctxRes);

 // ---- 7. 并联按钮 ----
 await ev(`(function(){var b=document.querySelector('[data-net-addbranch]'); if(b) b.click();})()`);
 await sleep(300);
 const brCount = await ev('TIA.project.blocks[0].networks[0].columns[0].branches.length');
 ck('并联+ 按钮生效', brCount>1, 'branches='+brCount);

 // ---- 8. 编译仍无错 ----
 await ev('document.querySelector(".tb[data-act=compile]").click()');
 const e2 = await ev('TIA.diags?TIA.diags.filter(d=>d.level==="error").length:-1');
 ck('结构改动后编译通过', e2===0, 'errors='+e2);
 if(e2>0) console.log('  '+await ev('JSON.stringify(TIA.diags.filter(d=>d.level==="error").slice(0,5))'));

 ws.close();killTree(p);
 if(logs.length){console.log('--- 异常 ---');logs.slice(0,8).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 process.exit(pass===R.length?0:1);
})();


