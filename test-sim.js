const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9600+Math.floor(Math.random()*60);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'sim'+Date.now()),'--window-size=1680,1000',
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

 ck('SimPanel 已加载', await ev(`typeof SimPanel==='object'`));

 // ===== 1. 缩放条 =====
 ck('有缩放下拉', await ev(`!!document.getElementById('ladZoomSel')`));
 ck('有缩放滑块', await ev(`!!document.getElementById('ladZoomSlider')`));
 const svgBefore = await ev(`(function(){var s=document.querySelector('.lad-wrap svg');return s?{w:s.getAttribute('width'),styleW:s.style.width}:null;})()`);
 await ev(`(function(){var s=document.getElementById('ladZoomSel');s.value='70';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await sleep(500);
 const svgAfter = await ev(`(function(){var s=document.querySelector('.lad-wrap svg');return s?{w:s.getAttribute('width'),styleW:s.style.width}:null;})()`);
 console.log('缩放前: '+JSON.stringify(svgBefore)+' 后: '+JSON.stringify(svgAfter));
 ck('缩放生效（SVG 尺寸变化）', svgAfter.styleW && svgAfter.styleW.indexOf('px')>0, svgAfter.styleW);
 // 恢复 100%
 await ev(`(function(){var s=document.getElementById('ladZoomSel');s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await sleep(400);

 // ===== 2. 下载建立真实连接 =====
 await ev(`document.querySelector('.tb[data-act="download"]').click()`);
 await sleep(2600);
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn');if(b)b.click();})()`);
 await sleep(900);

 ck('下载后已在线', await ev(`TIA.online===true`));
 ck('下载后 CPU 运行', await ev(`TIA.running===true`));
 ck('已装载程序块数 > 0', (await ev(`TIA.plc.loadedBlocks||0`))>0, 'blocks='+await ev(`TIA.plc.loadedBlocks`));
 ck('扫描循环在跑', (await ev(`TIA.plc.cycleCount`))>3, 'cycles='+await ev(`TIA.plc.cycleCount`));
 ck('自动打开仿真面板', await ev(`TIA.activeTab && TIA.activeTab.kind==='sim'`), await ev(`TIA.activeTab?TIA.activeTab.kind:''`));

 // ===== 3. 仿真面板结构 =====
 ck('仿真面板已渲染', await ev(`!!document.getElementById('simBody')`));
 ck('有 I 接口', (await ev(`document.querySelectorAll('.sim-node[data-kind="I"]').length`))>0,
   await ev(`document.querySelectorAll('.sim-node[data-kind="I"]').length`));
 ck('有 Q 接口', (await ev(`document.querySelectorAll('.sim-node[data-kind="Q"]').length`))>0,
   await ev(`document.querySelectorAll('.sim-node[data-kind="Q"]').length`));
 ck('接口是圆形', await ev(`(function(){var c=document.querySelector('.sn-circle');if(!c)return false;var st=getComputedStyle(c);return st.borderRadius.indexOf('50%')>=0||parseFloat(st.borderRadius)>10;})()`));
 ck('默认点动模式', await ev(`SimPanel.state.mode==='momentary'`), await ev(`SimPanel.state.mode`));

 // ===== 4. 默认点动：按住有信号，松开失去 =====
 const iAddr = await ev(`(function(){var n=document.querySelector('.sim-node[data-kind="I"]');return n?n.dataset.addr:'';})()`);
 console.log('测试用 I 地址: '+iAddr);
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
 })()`);
 await sleep(350);
 ck('默认点动：按住 I 接口导通', await ev(`TIA.plc.read('${iAddr}')===true`), await ev(`String(TIA.plc.read('${iAddr}'))`));
 const circleOn = await ev(`document.querySelector('.sim-node[data-kind="I"] .sn-circle').classList.contains('on')`);
 ck('接口变绿', circleOn===true);
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 })()`);
 await sleep(350);
 ck('默认点动：松开即失去信号', await ev(`TIA.plc.read('${iAddr}')===false`), await ev(`String(TIA.plc.read('${iAddr}'))`));

 // ===== 5. 切到自锁：点一下锁住，再点取消 =====
 await ev(`SimPanel.setMode('latch')`);
 await sleep(300);
 await ev(`(function(){
   var host=document.getElementById('simBody');
   SimPanel.render(host,{plc:TIA.plc,project:TIA.project});
 })()`);
 await sleep(600);
 ck('可切换为自锁模式', await ev(`SimPanel.state.mode==='latch'`), await ev(`SimPanel.state.mode`));
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
   n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('自锁：点一下 I 接口导通', await ev(`TIA.plc.read('${iAddr}')===true`), await ev(`String(TIA.plc.read('${iAddr}'))`));
 // 再点一次取消
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
   n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 })()`);
 await sleep(400);
 ck('自锁：再点一下取消', await ev(`TIA.plc.read('${iAddr}')===false`), await ev(`String(TIA.plc.read('${iAddr}'))`));

 // ===== 6. 再切回点动 =====
 await ev(`SimPanel.setMode('momentary')`);
 await sleep(300);
 await ev(`(function(){
   var host=document.getElementById('simBody');
   SimPanel.render(host,{plc:TIA.plc,project:TIA.project});
 })()`);
 await sleep(600);
 ck('可切回点动模式', await ev(`SimPanel.state.mode==='momentary'`));
 // 点动：按下有信号
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
 })()`);
 await sleep(350);
 ck('点动：按下有信号', await ev(`TIA.plc.read('${iAddr}')===true`), await ev(`String(TIA.plc.read('${iAddr}'))`));
 // 松开失去
 await ev(`(function(){
   var n=document.querySelector('.sim-node[data-kind="I"]');
   n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 })()`);
 await sleep(350);
 ck('点动：松开失去信号', await ev(`TIA.plc.read('${iAddr}')===false`), await ev(`String(TIA.plc.read('${iAddr}'))`));

 // ===== 6. Q 接口跟随输出 =====
 const qOn = await ev(`(function(){
   // 手动给 Q0.0 置位再检查面板
   TIA.plc.write('Q0.0', true);
   var nodes=document.querySelectorAll('.sim-node[data-kind="Q"]');
   for(var i=0;i<nodes.length;i++){
     if(nodes[i].dataset.addr==='Q0.0'){
       SimPanel.refresh();
       return nodes[i].querySelector('.sn-circle').classList.contains('on');
     }
   }
   return 'NOT_FOUND';
 })()`);
 ck('Q 接口跟随输出变绿', qOn===true, String(qOn));

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v18-simpanel.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
