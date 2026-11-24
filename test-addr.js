const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9900+Math.floor(Math.random()*40);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'ad'+Date.now()),'--window-size=1680,1000',
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
 // 打开变量表
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="tags:0"]');if(n)n.click();})()`);
 await sleep(900);

 const R=[];const ck=(n,c,x)=>{R.push({n,ok:!!c});console.log((c?'ok   : ':'FAIL : ')+n+(x!==undefined?'  ['+x+']':''));};

 ck('地址输入框已加下拉按钮', (await ev(`document.querySelectorAll('.addr-dd-btn').length`))>0,
   await ev(`document.querySelectorAll('.addr-dd-btn').length`));
 ck('已移除 datalist', await ev(`!document.getElementById('addrList')`));

 // 点下拉按钮
 await ev(`(function(){var b=document.querySelector('.addr-dd-btn'); b.click();})()`);
 await sleep(600);
 ck('点击箭头弹出下拉面板', await ev(`!!document.getElementById('addrDd')`));
 ck('有筛选输入框', await ev(`!!document.getElementById('addSearch')`));
 const groupCount = await ev(`document.querySelectorAll('#addrDd .add-group').length`);
 ck('下拉分组显示', groupCount>=2, 'groups='+groupCount);
 const itemCount = await ev(`document.querySelectorAll('#addrDd .add-item').length`);
 ck('候选条目充足', itemCount>30, 'items='+itemCount);

 const firstGroup = await ev(`(function(){var g=document.querySelector('#addrDd .add-group');return g?g.textContent:'';})()`);
 console.log('首个分组: '+firstGroup);

 // 筛选
 await ev(`(function(){var s=document.getElementById('addSearch'); s.value='MD'; s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await sleep(500);
 const filtered = await ev(`document.querySelectorAll('#addrDd .add-item').length`);
 ck('筛选生效', filtered>0 && filtered<itemCount, filtered+' (总 '+itemCount+')');
 const firstFiltered = await ev(`(function(){var i=document.querySelector('#addrDd .add-item');return i?i.dataset.val:'';})()`);
 console.log('筛选后首个: '+firstFiltered);
 ck('筛选结果含 MD', firstFiltered.indexOf('MD')>=0, firstFiltered);

 // 点选一个
 await ev(`(function(){var i=document.querySelector('#addrDd .add-item'); i.click();})()`);
 await sleep(600);
 ck('选后下拉关闭', await ev(`!document.getElementById('addrDd')`));
 const newAddr = await ev(`(function(){var i=document.querySelector('.addr-input');return i?i.value:'';})()`);
 ck('地址已填入', newAddr.indexOf('MD')>=0, newAddr);
 const modelAddr = await ev(`(function(){var t=TIA.project.tags.filter(function(x){return !x.isClock&&!x.isSystem;})[0];return t?t.address:'';})()`);
 ck('已写回工程数据', modelAddr.indexOf('MD')>=0, modelAddr);

 // Esc 关闭
 await ev(`(function(){var b=document.querySelectorAll('.addr-dd-btn')[1]; if(b) b.click();})()`);
 await sleep(500);
 const opened2 = await ev(`!!document.getElementById('addrDd')`);
 await ev(`(function(){var s=document.getElementById('addSearch'); if(s) s.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
 await sleep(400);
 ck('Esc 可关闭下拉', opened2 && await ev(`!document.getElementById('addrDd')`));

 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v20-addr.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,4).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
