const {chromium}=require('./helpers.cjs'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const build=require('../sio-rom.cjs');
(async()=>{
 const {createApp}=await import('../../server.mjs');const {defaultBindings}=await import('../../public/js/controls.js');const {saveStorageKey,bindingStorageKey}=await import('../../public/js/game-storage.js');
 await fs.mkdir('.tools/tmp',{recursive:true});const dir=await fs.mkdtemp(path.resolve('.tools/tmp/browser-games-'));let app,browser;
 const alphaId='kirby-amazing-mirror-cn',betaId='sio-test-demo',alphaFile=path.join(dir,'alpha.gba');
 try{
  await fs.copyFile('data/roms/kirby-amazing-mirror-cn.gba',alphaFile);await fs.writeFile(path.join(dir,'beta.gba'),build());
  const alphaHash=createHash('sha256').update(await fs.readFile(alphaFile)).digest('hex');
  const catalogPath=path.join(dir,'games.json');await fs.writeFile(catalogPath,JSON.stringify({version:1,defaultGameId:alphaId,games:[
   {id:alphaId,title:'卡比兼容测试',rom:'alpha.gba',players:[1,2],defaultPlayers:1,link:'cable',compatibility:'core-tested',instructions:'卡比通信说明',labels:{a:'A / 跳跃'}},
   {id:betaId,title:'自制 SIO 通信测试',rom:'beta.gba',players:[1,2],defaultPlayers:1,link:'cable',compatibility:'untested',instructions:'自制测试 ROM，不是商业游戏兼容声明',labels:{a:'A / 确认'}}]}));
  app=await createApp({port:0,catalogPath,romDirectory:dir});const catalog=await fetch(app.url+'/api/games').then(r=>r.json());const alpha=catalog.games[0],beta=catalog.games[1];
  browser=await chromium.launch({channel:'chrome',headless:true});const first=await browser.newContext({viewport:{width:1250,height:1000}}),second=await browser.newContext({viewport:{width:1050,height:850}});
  const bindings=defaultBindings();bindings.a=['KeyJ'];const oldSave=Buffer.alloc(8192,255).toString('base64');
  await first.addInitScript(({hash,bindings,save})=>{try{localStorage.setItem('kirby.nickname','TesterA');localStorage.setItem('kirby.keybindings.v1',JSON.stringify(bindings));localStorage.setItem('kirby.save.'+hash+'.TesterA',save);}catch{}},{hash:alphaHash,bindings,save:oldSave});
  const p=await first.newPage(),q=await second.newPage(),errors=[],downloads=[];
  for(const page of [p,q]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
  p.on('request',r=>{if(/\/api\/games\/[^/]+\/rom$/.test(new URL(r.url()).pathname))downloads.push(new URL(r.url()).pathname);});
  for(const page of [p,q]){await page.goto(app.url);await page.waitForFunction(()=>!document.getElementById('createRoom').disabled);}
  assert.equal(await p.locator('#gameSelect').inputValue(),alphaId);assert.equal(await p.locator('[data-bind=a]').textContent(),'J');
  await p.locator('#createRoom').click();await p.waitForFunction(()=>!document.getElementById('startGame').disabled);assert.equal(await p.evaluate(key=>localStorage.getItem(key),saveStorageKey(alpha,'TesterA')),oldSave);
  await p.locator('#leaveRoom').click();await p.waitForFunction(()=>!document.getElementById('gameSelect').disabled);
  await p.locator('#gameSelect').selectOption(betaId);assert.equal(await p.locator('#playerCount').inputValue(),'1');assert.equal(await p.locator('[data-bind=a]').textContent(),'Z');
  await p.locator('#keySettings summary').click();await p.locator('[data-bind=a]').click();await p.keyboard.press('k');await p.locator('#keySettings summary').click();
  const betaSave=Buffer.alloc(8192,17),betaBase64=betaSave.toString('base64');await p.locator('#importSave').setInputFiles({name:'beta.sav',mimeType:'application/octet-stream',buffer:betaSave});
  await p.waitForFunction(({key,value})=>localStorage.getItem(key)===value,{key:saveStorageKey(beta,'TesterA'),value:betaBase64});
  await p.locator('#createRoom').click();await p.waitForFunction(()=>!document.getElementById('startGame').disabled);await p.locator('#startGame').click();await p.waitForFunction(()=>Number(document.getElementById('frame').textContent)>100,{},{timeout:15000});
  await p.locator('#leaveRoom').click();await p.waitForFunction(()=>!document.getElementById('gameSelect').disabled);await p.locator('#gameSelect').selectOption(alphaId);assert.equal(await p.locator('[data-bind=a]').textContent(),'J');
  await p.locator('#createRoom').click();await p.waitForFunction(()=>!document.getElementById('startGame').disabled);await p.locator('#startGame').click();await p.waitForFunction(()=>Number(document.getElementById('frame').textContent)>330,{},{timeout:15000});
  assert.equal(await p.evaluate(key=>localStorage.getItem(key),saveStorageKey(beta,'TesterA')),betaBase64);
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#exportSave').click()]);assert.equal(download.suggestedFilename(),alphaId+'-1p.sav');assert.ok((await fs.stat(await download.path())).size>0);
  await p.locator('#leaveRoom').click();await p.waitForFunction(()=>!document.getElementById('gameSelect').disabled);await p.locator('#gameSelect').selectOption(betaId);assert.equal(await p.locator('[data-bind=a]').textContent(),'K');
  await p.locator('#playerCount').selectOption('2');await p.locator('#createRoom').click();await p.waitForFunction(()=>/^\d{6}$/.test(document.getElementById('roomCode').textContent));const code=await p.locator('#roomCode').textContent();
  assert.equal(await q.locator('#gameSelect').inputValue(),alphaId);await q.locator('#nickname').fill('TesterB');await q.locator('#joinCode').fill(code);await q.locator('#joinRoom').click();await q.waitForFunction(id=>document.getElementById('gameSelect').value===id,betaId);
  await p.waitForFunction(()=>!document.getElementById('startGame').disabled);assert.equal(await q.locator('#gameSelect').isDisabled(),true);await p.locator('#startGame').click();await Promise.all([p,q].map(page=>page.waitForFunction(()=>Number(document.getElementById('frame').textContent)>330,{},{timeout:20000})));
  assert.ok(downloads.includes('/api/games/'+alphaId+'/rom'));assert.equal(downloads.filter(url=>url==='/api/games/'+betaId+'/rom').length,2);assert.equal(await p.evaluate(key=>!!localStorage.getItem(key),bindingStorageKey(betaId)),true);
  await fs.mkdir('artifacts/test-results',{recursive:true});await p.screenshot({path:'artifacts/test-results/multigame-desktop.png',fullPage:true});await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({catalog:'Kirby plus self-built SIO fixture',legacyMigration:'save and bindings preserved',gameSwitch:'correct ROM URLs and cache invalidation',isolation:'bindings, saves and export filename passed',room:'guest auto-selected host game; both SIO peers passed 330 frames',mobile:'390px no overflow',errors}));
 }finally{if(browser)await browser.close();if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
