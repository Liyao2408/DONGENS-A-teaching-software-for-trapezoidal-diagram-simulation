const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9700+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'v6'+Date.now()),'--window-size=1680,1000',
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

 // ===== 1. 双击地址行只改地址 =====
 const addrBefore = await ev(`(function(){var e=document.querySelector('.lad-el .lt-addr');return e?e.textContent:'';})()`);
 await ev(`(function(){
   var t=document.querySelector('.lad-el .lt-addr[data-part="addr"]');
   t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('双击地址行出现蓝色输入框', await ev(`!!document.getElementById('inlineEdit')`));
 const ieVal = await ev(`(function(){var i=document.querySelector('#inlineEdit input');return i?i.value:'';})()`);
 ck('输入框预填当前地址', ieVal===addrBefore, 'val='+ieVal+' before='+addrBefore);
 // 改为 I0.5 并回车
 await ev(`(function(){var i=document.querySelector('#inlineEdit input');i.value='I0.5';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
 await sleep(450);
 const addrAfter = await ev(`(function(){var blk=TIA.project.blocks[0];var el=blk.networks[0].columns[0].branches[0][0];return el?el.addr:'NONE';})()`);
 ck('地址已改为 I0.5', addrAfter==='I0.5', 'addr='+addrAfter);
 const symUnchanged = await ev(`(function(){var blk=TIA.project.blocks[0];var el=blk.networks[0].columns[0].branches[0][0];return el?el.operand:'NONE';})()`);
 ck('新地址自动建变量（Tag_N）', /^Tag_\d+$/.test(symUnchanged) || symUnchanged==='Start_Button', 'sym='+symUnchanged);

 // ===== 2. 双击符号行只改符号 =====
 await ev(`(function(){
   var t=document.querySelector('.lad-el .lt-sym[data-part="sym"]');
   if(t) t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('双击符号行出现输入框', await ev(`!!document.getElementById('inlineEdit')`));
 await ev(`(function(){var i=document.querySelector('#inlineEdit input');i.value='Motor_Run';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
 await sleep(450);
 const symAfter = await ev(`(function(){var blk=TIA.project.blocks[0];var el=blk.networks[0].columns[0].branches[0][0];return el?el.operand:'NONE';})()`);
 ck('符号名已改为 Motor_Run', symAfter==='Motor_Run', 'sym='+symAfter);
 const addrKept = await ev(`(function(){var blk=TIA.project.blocks[0];var el=blk.networks[0].columns[0].branches[0][0];return el?el.addr:'NONE';})()`);
 ck('地址未被符号改名影响（自动带出变量表地址）', addrKept==='Q0.0', 'addr='+addrKept);

 // ===== 3. 系统时钟存储器 =====
 // 先进入变量表页，记录用户变量行数基线
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="tags:0"]');if(n)n.click();})()`);
 await sleep(700);
 const beforeCnt = await ev(`document.querySelectorAll('.tag-grid tr[data-tag]').length`);
 console.log('基线用户变量数: '+beforeCnt);
 // 打开设备组态
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="devconfig"]');if(n)n.click();})()`);
 await sleep(700);
 ck('设备组态页有属性面板', await ev(`!!document.getElementById('propsHost')`));
 // 展开属性面板并定位到"系统和时钟存储器"
 await ev(`(function(){
   if(!PropsPanel.state.open){
     var sp=document.getElementById('ppSplitter');
     if(sp) sp.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
   }
 })()`);
 await sleep(600);
 ck('属性面板已展开', await ev(`PropsPanel.state.open===true`));
 ck('有"启用时钟存储器字节"', await ev(`!!document.getElementById('ppClkEnable')`));
 ck('有时钟位配置项', (await ev(`document.querySelectorAll('#ppContent .pp-field').length`))>=8,
   'fields='+await ev(`document.querySelectorAll('#ppContent .pp-field').length`));
 // 勾选时钟存储器
 await ev(`(function(){var c=document.getElementById('ppClkEnable');c.checked=true;c.onchange();})()`);
 await sleep(700);
 const cmEnabled = await ev(`(function(){return TIA.project.device.clockMemory && TIA.project.device.clockMemory.enabled;})()`);
 ck('时钟存储器已启用', cmEnabled===true);

 // 变量表应多 8 行
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="tags:0"]');if(n)n.click();})()`);
 await sleep(700);
 const clockRows = await ev(`document.querySelectorAll('.tag-grid tr.clock-row').length`);
 ck('变量表出现 8 个时钟位', clockRows===8, 'rows='+clockRows);
 const totalRows = await ev(`document.querySelectorAll('.tag-grid tr[data-tag]').length`);
 ck('用户变量行数未变', totalRows===beforeCnt, 'user='+totalRows+' before='+beforeCnt);
 const firstClock = await ev(`(function(){var r=document.querySelector('.tag-grid tr.clock-row');return r?r.textContent.replace(/\\s+/g,' ').trim().slice(0,40):'';})()`);
 console.log('首个时钟位: '+firstClock);

 // 跑起来验证时钟位真在翻转
 await ev(`(function(){document.querySelector('.tb[data-act="download"]').click();})()`);
 await sleep(2400);
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
 await sleep(400);
 // 采样 12 次（每 150ms 一次，共 1.8s），看 M0.4 是否出现两种状态
 const samples = [];
 for (let k = 0; k < 12; k++) {
   samples.push(await ev(`TIA.plc.read('M0.4')`));
   await sleep(150);
 }
 const uniq = samples.filter(function (v, i, a) { return a.indexOf(v) === i; });
 ck('时钟位 M0.4 在翻转（1Hz）', uniq.length >= 2, 'samples=' + samples.join(','));

 // 快时钟位 M0.0（10Hz）也应翻转
 const fast = [];
 for (let k = 0; k < 8; k++) {
   fast.push(await ev(`TIA.plc.read('M0.0')`));
   await sleep(130);
 }
 const fastUniq = fast.filter(function (v, i, a) { return a.indexOf(v) === i; });
 ck('时钟位 M0.0 在翻转（10Hz）', fastUniq.length >= 2, 'samples=' + fast.join(','));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v7-inline.png',Buffer.from(s.result.data,'base64'));
 console.log('saved docs/v7-inline.png');

 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
