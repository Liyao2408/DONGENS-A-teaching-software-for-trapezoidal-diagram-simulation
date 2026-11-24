const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CP=9300+Math.floor(Math.random()*80);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
function killTree(p){try{spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore'});}catch(e){}}
(async()=>{
 const p=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+CP,
   '--user-data-dir='+path.join(process.env.TEMP,'rk'+Date.now()),'--window-size=1680,1000',
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

 ck('Rack 模块已加载', await ev(`typeof Rack==='object'`));

 // 建项目 → 进工程 → 打开设备组态
 await ev(`Portal.show('new')`); await sleep(450);
 await ev(`(function(){document.getElementById('npName').value='机架测试';})()`);
 await ev(`document.getElementById('btnCreateProject').click()`);
 await sleep(1300);
 await ev(`(function(){var s=document.querySelector('.fs-step[data-target="projectview"]'); if(s)s.click();})()`);
 await sleep(1400);
 ck('已进入工程', await ev(`!!TIA.project`));

 // 打开设备组态
 await ev(`(function(){var n=document.querySelector('#treeBody .node[data-node="devconfig"]'); if(n)n.click();})()`);
 await sleep(900);

 ck('机架视图已渲染', await ev(`!!document.querySelector('.rack-svg')`));
 const slots = await ev(`document.querySelectorAll('.rack-slot').length`);
 ck('9 个插槽', (await ev(`document.querySelectorAll('[data-slot]').length`))>=8, 'slots='+await ev(`document.querySelectorAll('[data-slot]').length`));
 ck('CPU 图形已绘制', await ev(`!!document.querySelector('.rack-cpu')`));
 ck('槽号 1-9 已显示', await ev(`(function(){
   var t=[].map.call(document.querySelectorAll('.rack-svg text'),function(e){return e.textContent;});
   return ['1','2','3','4','5','6','7','8','9'].every(function(n){return t.indexOf(n)>=0;});
 })()`));
 ck('左侧 PLC_1 斜标', await ev(`document.querySelector('.rack-svg').textContent.indexOf('PLC_1')>=0`));
 ck('右侧设备概览', await ev(`!!document.querySelector('.rack-side')`));
 ck('概览含 HSC 项', await ev(`document.querySelector('.rack-side').textContent.indexOf('HSC_1')>=0`));
 ck('工具条有设备下拉', await ev(`!!document.getElementById('rackDevSel')`));

 // 选中 CPU
 await ev(`(function(){var g=document.querySelector('.rack-cpu');g.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
 await sleep(500);
 ck('点 CPU 可选中', await ev(`TIA.rackSel==='cpu'`), await ev(`String(TIA.rackSel)`));

 // 右键 CPU → 菜单
 await ev(`(function(){
   var g=document.querySelector('.rack-cpu');
   g.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}));
 })()`);
 await sleep(400);
 ck('右键 CPU 弹出菜单', await ev(`!!document.getElementById('rackMenu')`));
 const menuItems = await ev(`document.querySelectorAll('#rackMenu .lm-item').length`);
 ck('菜单项数量合理', menuItems>=18, 'items='+menuItems);
 const menuText = await ev(`document.getElementById('rackMenu').textContent`);
 console.log('菜单项: '+menuText.replace(/\s+/g,'|').slice(0,300));
 ck('含"更改设备"', menuText.indexOf('更改设备')>=0);
 ck('含"交叉引用"', menuText.indexOf('交叉引用')>=0);
 ck('含"显示目录"', menuText.indexOf('显示目录')>=0);
 ck('含"导出模块标签条"', menuText.indexOf('导出模块标签条')>=0);

 // 截图
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v10-rack-menu.png',Buffer.from(s.result.data,'base64'));

 // 关菜单
 await ev(`(function(){document.body.click();})()`);
 await sleep(300);

 // 右键空槽 → 插入模块
 await ev(`(function(){
   var el=document.querySelector('.rack-slot[data-slot="3"]');
   if(el) el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:400}));
 })()`);
 await sleep(400);
 const slotMenu = await ev(`document.getElementById('rackMenu') ? document.getElementById('rackMenu').textContent : ''`);
 ck('右键空槽菜单含"插入模块"', slotMenu.indexOf('插入模块')>=0, slotMenu.replace(/\s+/g,'|').slice(0,80));

 // 点插入模块
 await ev(`(function(){
   var rows=document.querySelectorAll('#rackMenu .lm-item');
   for(var i=0;i<rows.length;i++){ if(rows[i].textContent.indexOf('插入模块')>=0){ rows[i].click(); return; } }
 })()`);
 await sleep(500);
 ck('弹出插入模块对话框', await ev(`document.getElementById('modalMask').classList.contains('show')`));
 ck('模块类型下拉有选项', (await ev(`(function(){var s=document.getElementById('modType');return s?s.options.length:0;})()`))>=5);

 // 确认插入
 await ev(`(function(){var b=document.querySelector('.modal-foot .btn.primary'); if(b)b.click();})()`);
 await sleep(700);
 const mods = await ev(`TIA.project.devices[0].modules ? TIA.project.devices[0].modules.length : 0`);
 ck('模块已插入', mods>=1, 'modules='+mods);
 ck('插槽显示模块图形', await ev(`document.querySelectorAll('.rack-mod').length>=1`));

 s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('docs/v10-rack.png',Buffer.from(s.result.data,'base64'));

 if(logs.length){console.log('--- 异常 ---');logs.slice(0,5).forEach(l=>console.log(l));}
 const pass=R.filter(x=>x.ok).length;
 console.log('\n通过 '+pass+'/'+R.length);
 ws.close();killTree(p);process.exit(pass===R.length?0:1);
})();
