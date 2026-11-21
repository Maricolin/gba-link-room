const {chromium}=require('./helpers.cjs');
const fs=require('node:fs');
const BASE_URL=process.env.BASE_URL||'http://127.0.0.1:8765';
const LAN_URL=process.env.LAN_URL||BASE_URL;
(async()=>{
 fs.mkdirSync('artifacts/test-results',{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const a=await browser.newContext({viewport:{width:1440,height:1100}}),b=await browser.newContext({viewport:{width:1100,height:850}});
 const p=await a.newPage(),q=await b.newPage();const errors=[];
 for(const page of [p,q]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
 await Promise.all([p.goto(BASE_URL),q.goto(BASE_URL)]);
 await p.locator('#createRoom').waitFor();await p.waitForFunction(()=>!document.getElementById('createRoom').disabled);
 await p.locator('#nickname').fill('测试 1P');await p.locator('#createRoom').click();
 await p.waitForFunction(()=>/^\d{6}$/.test(document.getElementById('roomCode').textContent));const code=(await p.locator('#roomCode').textContent()).trim();
 await q.locator('#nickname').fill('测试 2P');await q.locator('#joinCode').fill(code);await q.locator('#joinRoom').click();
 await p.waitForFunction(()=>!document.getElementById('startGame').disabled);await p.locator('#startGame').click();
 await Promise.all([p.waitForFunction(()=>Number(document.getElementById('frame').textContent)>=960,{},{timeout:40000}),q.waitForFunction(()=>Number(document.getElementById('frame').textContent)>=960,{},{timeout:40000})]);
 console.log(JSON.stringify({code,frames:[await p.locator('#frame').textContent(),await q.locator('#frame').textContent()],status:[await p.locator('#statusText').textContent(),await q.locator('#statusText').textContent()],fps:[await p.locator('#fps').textContent(),await q.locator('#fps').textContent()],errors,logs:await p.locator('#log').textContent()}));
 await p.screenshot({path:'artifacts/test-results/browser-2p.png',fullPage:true});
 await p.locator('#screen').screenshot({path:'artifacts/test-results/game-1p.png'});
 await q.locator('#screen').screenshot({path:'artifacts/test-results/game-2p.png'});
 await p.locator('#screen').click();await p.keyboard.press('Enter',{delay:100});await q.locator('#screen').click();await q.keyboard.press('Enter',{delay:100});
 await p.locator('#restart').click();await Promise.all([p.waitForFunction(()=>Number(document.getElementById('frame').textContent)<100,{},{timeout:15000}),q.waitForFunction(()=>Number(document.getElementById('frame').textContent)<100,{},{timeout:15000})]);
 await p.waitForFunction(()=>Number(document.getElementById('frame').textContent)>100,{},{timeout:15000});
 await q.locator('#leaveRoom').click();await p.waitForFunction(()=>!document.getElementById('leaveRoom').disabled&&document.getElementById('restart').disabled);
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(LAN_URL);await mobile.waitForFunction(()=>!document.getElementById('createRoom').disabled);await mobile.screenshot({path:'artifacts/test-results/mobile.png',fullPage:true});
 const layout=await mobile.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,touchControls:getComputedStyle(document.getElementById('touchControls')).display,secureContext:isSecureContext}));
 console.log(JSON.stringify({restart:'passed',leave:'passed',lanHttp:layout,errors}));
 if(errors.length||layout.document>layout.viewport)process.exitCode=1;
 }catch(e){console.error(e);for(const context of browser.contexts())for(const page of context.pages()){console.log(await page.locator('#log').textContent().catch(()=>''));await page.screenshot({path:'artifacts/test-results/failure-'+Math.random().toString(36).slice(2)+'.png'}).catch(()=>{});}process.exitCode=1;}finally{await browser.close();}
})();