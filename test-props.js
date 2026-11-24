const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9400+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'pp'+Date.now()),'--window-size=1680,1000',
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
 await sleep(2600);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 ck('PropsPanel 已加载', await ev(`typeof PropsPanel==='object'`));

 // 建项目进工程
 await ev(`Portal.show('new')`); await sleep(450);
 await ev(`(function(){document.getElementById('npName').value='属性面板测试';})()`);
 await ev(`document.getElementById('btnCreateProject').click()`);
 await sleep(1300);
 await ev(`(function(){var s=document.querySelector('.fs-step[data-target="projectview"]'); if(s)s.click();})()`);
 await sleep(1400);
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="devconfig"]'); if(n)n.click();})()`);
 await sleep(900);

 ck('属性面板容器已渲染', await ev(`!!document.getElementById('propsHost')`));
 ck('默认收起', await ev(`PropsPanel.state.open===false`));
 ck('标题条显示设备名', await ev(`(document.querySelector('.pp-title')||{}).textContent.indexOf('PLC_1')>=0`));
 ck('有三个页签', await ev(`document.querySelectorAll('.pp-tab').length===3`));

 // 双击分隔条展开
 await ev(`(function(){
   var s=document.getElementById('ppSplitter');
   s.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 })()`);
 await sleep(600);
 ck('双击分隔条可展开', await ev(`PropsPanel.state.open===true`));
 ck('展开区可见', await ev(`getComputedStyle(document.getElementById('ppBody')).display!=='none'`));

 // 四个标签
 const tabs = await ev(`Array.from(document.querySelectorAll('.pp-t2')).map(function(e){return e.textContent;})`);
 ck('四个标签齐全', JSON.stringify(tabs)===JSON.stringify(['常规','IO 变量','系统常数','文本']), JSON.stringify(tabs));

 // 属性树
 ck('属性树有节点', (await ev(`document.querySelectorAll('#ppTree .pp-node').length`))>8,
   'nodes='+await ev(`document.querySelectorAll('#ppTree .pp-node').length`));
 ck('含"系统和时钟存储器"', await ev(`document.getElementById('ppTree').textContent.indexOf('系统和时钟存储器')>=0`));
 ck('含"防护与安全"', await ev(`document.getElementById('ppTree').textContent.indexOf('防护与安全')>=0`));
 ck('含"OPC UA"', await ev(`document.getElementById('ppTree').textContent.indexOf('OPC UA')>=0`));

 // 系统存储器配置
 ck('有"启用系统存储器字节"', await ev(`!!document.getElementById('ppSysEnable')`));
 ck('有系统存储器字节地址输入', await ev(`!!document.getElementById('ppSysByte')`));
 ck('系统存储器默认未勾选时地址禁用', await ev(`document.getElementById('ppSysByte').disabled===true`));

 // 勾选系统存储器
 await ev(`(function(){var c=document.getElementById('ppSysEnable');c.checked=true;c.onchange();})()`);
 await sleep(600);
 ck('启用后地址可编辑', await ev(`document.getElementById('ppSysByte').disabled===false`));
 const sysAddr = await ev(`document.querySelectorAll('#ppContent .pp-inp')[1].value`);
 ck('系统存储器位显示地址', sysAddr.indexOf('%M1.')>=0, sysAddr);

 // 时钟存储器配置
 ck('有"启用时钟存储器字节"', await ev(`!!document.getElementById('ppClkEnable')`));
 ck('有时钟存储器字节地址输入', await ev(`!!document.getElementById('ppClkByte')`));
 await ev(`(function(){var c=document.getElementById('ppClkEnable');c.checked=true;c.onchange();})()`);
 await sleep(600);
 const clkFields = await ev(`document.querySelectorAll('#ppContent .pp-field').length`);
 ck('时钟位地址已显示', clkFields>=12, 'fields='+clkFields);

 // 截图（展开态）
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v11-props.png',Buffer.from(s.result.data,'base64'));

 // 切到 IO 变量标签
 await ev(`(function(){var e=document.querySelector('[data-ppt="io"]'); if(e)e.click();})()`);
 await sleep(400);
 ck('可切到 IO 变量标签', await ev(`PropsPanel.state.activeTab==='io'`));

 // 拖动分隔条调整高度
 const h0 = await ev(`PropsPanel.state.height`);
 await ev(`(function(){
   var sp=document.getElementById('ppSplitter');
   var r=sp.getBoundingClientRect();
   sp.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientY:r.top+3}));
   document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientY:r.top-80}));
   document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 })()`);
 await sleep(400);
 const h1 = await ev(`PropsPanel.state.height`);
 ck('拖动可调整面板高度', h1>h0, h0+' -> '+h1);

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
