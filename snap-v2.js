const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9800+Math.floor(Math.random()*150);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,'--user-data-dir='+path.join(process.env.TEMP,'snap'+Date.now()),'--window-size=1680,1040','http://127.0.0.1:8931/index.html'],{stdio:'ignore'});
 let t=null;
 for(let i=0;i<60;i++){await sleep(300);try{const l=JSON.parse(await get('http://127.0.0.1:'+CP+'/json/list'));t=l.filter(x=>x.url.includes('index.html'));if(t.length)break;}catch(e){}}
 const ws=new WebSocket(t[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.on('open',r));
 let id=0;const pend=new Map();
 ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
 const send=(m2,p2={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m2,params:p2}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(let i=0;i<60;i++){await sleep(250);if(await ev('document.querySelectorAll(".network").length')>0)break;}
 await sleep(700);

 // 展开几个分组让面板更好看
 await ev(`(function(){
   ['timer','compare','math','datetime'].forEach(function(g){
     var el=document.querySelector('[data-group="'+g+'"]');
     if(el) el.click();
   });
 })()`);
 await sleep(400);

 const s1=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v2-editor.png',Buffer.from(s1.result.data,'base64'));
 console.log('saved docs/v2-editor.png');

 // 在线监视 + 选中态
 await ev('document.querySelector(".tb[data-act=download]").click()');
 await sleep(2300);
 await ev('document.querySelector(".modal-foot .btn") && document.querySelector(".modal-foot .btn").click()');
 await sleep(300);
 await ev('TIA.plc.write("I0.0",true)');
 await sleep(400);
 await ev('document.querySelector(".tb[data-act=monitor]").click()');
 await sleep(700);
 await ev(`(function(){var g=document.querySelector('.lad-el .hit'); if(g) g.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
 await sleep(400);
 const s2=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v2-monitor.png',Buffer.from(s2.result.data,'base64'));
 console.log('saved docs/v2-monitor.png');

 ws.close();killTree(p);process.exit(0);
})();
