const {chromium}=require('./helpers.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{const {createApp}=await import('../../server.mjs');const app=await createApp({port:0});let browser;const results=[];
 try{const catalog=await fetch(app.url+'/api/games').then(r=>r.json());if(!catalog.games.some(g=>g.id==='pokemon-swsh-10-1-cn')||!catalog.games.some(g=>g.id==='pokemon-swsh-10-2-cheats-cn'))throw Error('Import the user ROM library before running this opt-in test');
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:1024}}),page=await context.newPage(),errors=[],romRequests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/\/api\/games\/[^/]+\/rom$/.test(new URL(r.url()).pathname))romRequests.push(new URL(r.url()).pathname);});
  await page.goto(app.url);await page.waitForFunction(()=>!document.getElementById('gameSelect').disabled);await page.locator('#nickname').fill('ROM-Switch-Test');
  for(const game of catalog.games){if(!game.players.includes(1))continue;
   await page.locator('#gameSelect').selectOption(game.id);await page.locator('#playerCount').selectOption('1');assert.ok((await page.locator('#gameRomIdentity').textContent()).includes(game.romSha256.slice(0,12)));
   if(game.link==='none')assert.equal(await page.locator('#playerCount option').count(),1);
   await page.locator('#createRoom').click();await page.waitForFunction(()=>!document.getElementById('startGame').disabled);assert.equal(await page.locator('#gameSelect').isDisabled(),true);await page.locator('#startGame').click();
   await page.waitForFunction(()=>Number(document.getElementById('frame').textContent)>=360,{},{timeout:25000});
   const colors=await page.locator('#screen').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,240,160).data;return new Set(new Uint32Array(pixels.buffer)).size;});
   assert.ok(colors>1,game.id+' should render a nonuniform game frame');assert.ok(romRequests.includes(game.romUrl));
   results.push({id:game.id,sha256:game.romSha256,frames:Number(await page.locator('#frame').textContent()),colors,mode:game.link});
   await page.locator('#switchRom').click();await page.waitForFunction(()=>!document.getElementById('gameSelect').disabled);
  }
  const pokemon=results.filter(x=>x.id.startsWith('pokemon-swsh'));assert.equal(pokemon.length,2);assert.notEqual(pokemon[0].sha256,pokemon[1].sha256);
  await fs.mkdir('artifacts/rom-compat',{recursive:true});await fs.writeFile('artifacts/rom-compat/browser-library.json',JSON.stringify({generatedAt:new Date().toISOString(),results,errors,scope:'Single-player real-ROM switching in one browser; not proof of linked gameplay.'},null,2)+'\n');await page.screenshot({path:'artifacts/rom-compat/library-browser.png',fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({games:results.length,allRendered:true,distinctPokemonVersions:true,switching:'passed',errors}));
 }catch(error){console.error(error);if(browser)for(const context of browser.contexts())for(const page of context.pages()){console.error(await page.locator('#log').textContent().catch(()=>''));}throw error;}
 finally{if(browser)await browser.close();await app.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
