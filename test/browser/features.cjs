const {chromium}=require('./helpers.cjs');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const {createApp}=await import('../../server.mjs');const app=await createApp({port:0});let browser;
 try{
  fs.mkdirSync('artifacts/test-results',{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true});
  const contexts=await Promise.all([1,2,3].map(()=>browser.newContext({viewport:{width:1200,height:950}})));
  for(const context of contexts)await context.addInitScript(()=>{const Original=window.Worker;window.__keyEvents=[];window.Worker=class extends Original{postMessage(m,...args){if(m?.type==='keys')window.__keyEvents.push(m.keys);super.postMessage(m,...args);}};});
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const [p,q,o]=pages,errors=[];
  for(const page of pages){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto(app.url);await page.waitForFunction(()=>!document.getElementById('createRoom').disabled);}
  assert.equal(await p.locator('#chatInput').isDisabled(),true);
  await p.locator('#keySettings summary').click();await p.locator('[data-bind="a"]').click();await p.keyboard.press('j');assert.equal(await p.locator('[data-bind="a"]').textContent(),'J');
  await p.locator('[data-bind="b"]').click();await p.keyboard.press('j');assert.equal(await p.locator('[data-bind="a"]').textContent(),'X');
  await p.locator('#resetKeys').click();assert.equal(await p.locator('[data-bind="a"]').textContent(),'Z');
  await p.locator('[data-bind="a"]').click();await p.keyboard.press('j');await p.reload();await p.waitForFunction(()=>!document.getElementById('createRoom').disabled);assert.equal(await p.locator('[data-bind="a"]').textContent(),'J');assert.equal(await q.locator('[data-bind="a"]').textContent(),'Z');
  await p.locator('#nickname').fill('一号');await p.locator('#createRoom').click();await p.waitForFunction(()=>/^\d{6}$/.test(document.getElementById('roomCode').textContent));const code=await p.locator('#roomCode').textContent();
  await q.locator('#nickname').fill('二号');await q.locator('#joinCode').fill(code);await q.locator('#joinRoom').click();await q.waitForFunction(()=>!document.getElementById('chatInput').disabled);
  await o.locator('#nickname').fill('隔壁');await o.locator('#playerCount').selectOption('1');await o.locator('#createRoom').click();
  const text='你好，二号 🌟 <img src=x onerror=alert(1)>';
  await p.locator('#chatInput').fill(text);await p.locator('#chatInput').press('Enter');await q.locator('.chat-message p').filter({hasText:text}).waitFor();assert.equal(await q.locator('#chatMessages img').count(),0);assert.equal(await o.locator('.chat-message').count(),0);
  await q.reload();await q.waitForFunction(()=>!document.getElementById('joinRoom').disabled);await q.locator('#joinCode').fill(code);await q.locator('#joinRoom').click();await q.locator('.chat-message p').filter({hasText:text}).waitFor();assert.equal(await q.locator('.chat-message').count(),1);
  await p.waitForFunction(()=>!document.getElementById('startGame').disabled);await p.locator('#startGame').click();await Promise.all([p,q].map(page=>page.waitForFunction(()=>Number(document.getElementById('frame').textContent)>100,{},{timeout:25000})));
  await p.locator('#screen').click();await p.evaluate(()=>window.__keyEvents=[]);await p.keyboard.down('j');await p.waitForFunction(()=>window.__keyEvents.includes(1));await p.keyboard.up('j');
  await p.keyboard.down('j');await p.locator('#chatInput').focus();assert.equal(await p.evaluate(()=>window.__keyEvents.at(-1)),0);await p.keyboard.up('j');
  await p.evaluate(()=>window.__keyEvents=[]);const frameBefore=Number(await p.locator('#frame').textContent());await p.locator('#chatInput').fill('jjz 游戏中聊天');await p.locator('#chatInput').press('Enter');await q.locator('.chat-message p').filter({hasText:'jjz 游戏中聊天'}).waitFor();assert.equal(await p.evaluate(()=>window.__keyEvents.some(k=>k!==0)),false);
  await p.locator('#chatInput').fill('中文输入法确认');await p.locator('#chatInput').dispatchEvent('compositionstart');await p.locator('#chatInput').press('Enter');assert.equal(await q.locator('.chat-message p').filter({hasText:'中文输入法确认'}).count(),0);await p.locator('#chatInput').dispatchEvent('compositionend');await p.locator('#chatInput').press('Enter');await q.locator('.chat-message p').filter({hasText:'中文输入法确认'}).waitFor();
  await p.waitForFunction(f=>Number(document.getElementById('frame').textContent)>f,frameBefore+20);
  await p.screenshot({path:'artifacts/test-results/features-desktop.png',fullPage:true});
  await p.setViewportSize({width:390,height:844});await p.locator('#keySettings summary').click();await p.screenshot({path:'artifacts/test-results/features-mobile.png',fullPage:true});const layout=await p.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.equal(layout.width,layout.viewport);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({customKeys:'saved and restored across reload',duplicates:'swapped',keyboardIsolation:'passed',chat:'same-room, history, HTML text, in-game, IME all passed',mobile:layout,errors}));
 }finally{if(browser)await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
