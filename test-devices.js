const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9200+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'dv'+Date.now()),'--window-size=1680,1000',
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

 ck('设备目录已加载', await ev(`typeof DeviceCatalog==='object'`));
 ck('1215C DC/DC/DC 在目录中', await ev(`!!DeviceCatalog.find('CPU 1215C DC/DC/DC')`));
 const c1215 = await ev(`JSON.stringify(DeviceCatalog.find('CPU 1215C DC/DC/DC'))`);
 ck('1215C 订货号正确', c1215.indexOf('6ES7 215-1AG40-0XB0')>=0);

 // 先建项目以便有 pendingProject
 await ev(`Portal.show('new')`); await sleep(500);
 await ev(`(function(){document.getElementById('npName').value='设备测试项目';})()`);
 await ev(`document.getElementById('btnCreateProject').click()`);
 await sleep(1400);
 ck('项目已创建', await ev(`!!Portal.getPending()`), await ev(`Portal.getPending()?Portal.getPending().name:''`));

 // 进设备与网络
 await ev(`Portal.switchView('devices')`); await sleep(600);
 ck('切到"显示所有设备"', await ev(`Portal.view()==='devices'`));
 ck('动作栏切到设备组', await ev(`getComputedStyle(document.querySelector('.pa-group[data-group="devices"]')).display!=='none'`));
 ck('项目组动作栏已隐藏', await ev(`getComputedStyle(document.querySelector('.pa-group[data-group="project"]')).display==='none'`));
 const cardCount = await ev(`document.querySelectorAll('#devCards .dev-card').length`);
 ck('已有设备显示为卡片', cardCount>=1, 'cards='+cardCount);

 // 添加新设备
 await ev(`document.getElementById('actAddDevice').click()`); await sleep(700);
 ck('切到"添加新设备"', await ev(`Portal.view()==='adddevice'`));
 ck('4 个类别方块', await ev(`document.querySelectorAll('#adCats .ad-cat').length===4`),
   await ev(`document.querySelectorAll('#adCats .ad-cat').length`));
 ck('设备树已渲染', (await ev(`document.querySelectorAll('#adTree .ad-tnode').length`))>0,
   'nodes='+await ev(`document.querySelectorAll('#adTree .ad-tnode').length`));
 ck('S7-1200 节点存在', await ev(`Array.from(document.querySelectorAll('#adTree .ad-tlabel')).some(function(e){return e.textContent.indexOf('S7-1200')>=0;})`));
 const cpuCount = await ev(`Array.from(document.querySelectorAll('#adTree .ad-tnode[data-kind="item"]')).length`);
 ck('CPU 型号列表已展开', cpuCount>10, 'items='+cpuCount);

 // 选中 1215C
 await ev(`(function(){
   var nodes=document.querySelectorAll('#adTree .ad-tnode[data-kind="item"]');
   for(var i=0;i<nodes.length;i++){
     if(nodes[i].textContent.indexOf('CPU 1215C DC/DC/DC')>=0){ nodes[i].click(); return; }
   }
 })()`);
 await sleep(500);
 const devName = await ev(`document.getElementById('adDevName').textContent`);
 ck('选中后详情显示型号', devName==='CPU 1215C DC/DC/DC', devName);
 const orderNo = await ev(`document.getElementById('adOrderNo').value`);
 ck('详情显示订货号', orderNo==='6ES7 215-1AG40-0XB0', orderNo);
 const desc = await ev(`document.getElementById('adDesc').textContent`);
 ck('详情显示说明', desc.length>30, 'len='+desc.length);
 ck('版本下拉有选项', (await ev(`document.getElementById('adVersion').options.length`))>=5);
 ck('"添加"按钮可用', await ev(`document.getElementById('btnAddDevice').disabled===false`));

 // 截图1：添加新设备
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v9-adddevice.png',Buffer.from(s.result.data,'base64'));

 // 添加设备
 const beforeN = await ev(`Portal.getPending().devices.length`);
 await ev(`(function(){document.getElementById('adName').value='PLC_2';})()`);
 await ev(`document.getElementById('btnAddDevice').click()`);
 await sleep(700);
 ck('添加后回到"显示所有设备"', await ev(`Portal.view()==='devices'`));
 const afterN = await ev(`Portal.getPending().devices.length`);
 ck('设备数量增加', afterN===beforeN+1, beforeN+' -> '+afterN);
 const devNames = await ev(`JSON.stringify(Portal.getPending().devices.map(function(d){return d.name;}))`);
 console.log('设备列表: '+devNames);

 // 截图2：显示所有设备
 s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v9-devices.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
