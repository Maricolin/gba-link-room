const {chromium}=require('./helpers.cjs');const assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),https=require('node:https');
const {spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
(async()=>{
 const {createApp}=await import('../../server.mjs');await fsp.mkdir('.tools/tmp',{recursive:true});
 const directory=await fsp.mkdtemp(path.resolve('.tools/tmp/public-browser-')),key=path.join(directory,'key.pem'),cert=path.join(directory,'cert.pem');
 const openssl=process.env.OPENSSL||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
 const generated=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 if(generated.error||generated.status!==0)throw Error('OpenSSL is required for the isolated HTTPS browser test');
 let app,browser;const sockets=new Set();
 const proxy=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
   const up=http.request({hostname:'127.0.0.1',port:app.port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});up.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(up);
 });
 proxy.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 proxy.on('upgrade',(req,down,head)=>{
   const up=http.request({hostname:'127.0.0.1',port:app.port,path:req.url,headers:req.headers});
   up.on('upgrade',(res,remote,extra)=>{down.write('HTTP/1.1 101 Switching Protocols\r\n'+res.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n');if(head.length)remote.write(head);if(extra.length)down.write(extra);down.pipe(remote).pipe(down);down.on('error',()=>remote.destroy());remote.on('error',()=>down.destroy());down.on('close',()=>remote.destroy());remote.on('close',()=>down.destroy());});
   up.on('response',res=>{down.end('HTTP/1.1 '+res.statusCode+' Rejected\r\nConnection: close\r\n\r\n');});up.on('error',()=>down.destroy());up.end();
 });
 try{
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const origin='https://127.0.0.1:'+proxy.address().port,password=randomBytes(24).toString('hex');
  app=await createApp({port:0,config:{publicMode:true,publicOrigin:origin,accessPassword:password,inputDelayFrames:6}});
  browser=await chromium.launch({channel:'chrome',headless:true});const contexts=await Promise.all([1,2].map(()=>browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1200,height:900}})));const pages=await Promise.all(contexts.map(c=>c.newPage()));const [p,q]=pages,errors=[];
  for(const page of pages){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errors.push(m.text());});await page.goto(origin);await page.locator('#accessDialog[open]').waitFor();assert.equal(await page.locator('#createRoom').isDisabled(),true);}
  assert.equal((await contexts[0].request.get(origin+'/game.gba')).status(),401);
  await p.locator('#accessPassword').fill('wrong-password');await p.locator('#accessForm button[type=submit]').click();await p.locator('#accessError').filter({hasText:/口令|密码|登录/}).waitFor();
  for(const page of pages){await page.locator('#accessPassword').fill(password);await page.locator('#accessForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('createRoom').disabled,{},{timeout:10000});assert.equal(await page.locator('#accessPassword').inputValue(),'');}
  const cookie=(await contexts[0].cookies()).find(c=>c.name==='__Host-kirby_session');assert.ok(cookie?.httpOnly&&cookie.secure&&cookie.sameSite==='Strict');
  const info=await contexts[0].request.get(origin+'/api/info').then(r=>r.json());assert.deepEqual(info.addresses,[origin]);assert.equal(info.projectId,undefined);
  await p.locator('#createRoom').click();await p.waitForFunction(()=>/^\d{6}$/.test(document.getElementById('roomCode').textContent));const code=await p.locator('#roomCode').textContent();await q.locator('#joinCode').fill(code);await q.locator('#joinRoom').click();await p.waitForFunction(()=>!document.getElementById('startGame').disabled);await p.locator('#startGame').click();
  await Promise.all(pages.map(page=>page.waitForFunction(()=>Number(document.getElementById('frame').textContent)>=330,{},{timeout:25000})));
  await p.locator('#chatInput').fill('HTTPS 与 WSS 公网模式测试');await p.locator('#chatInput').press('Enter');await q.locator('.chat-message p').filter({hasText:'HTTPS 与 WSS 公网模式测试'}).waitFor();
  await q.locator('#logout').click();await q.locator('#accessDialog[open]').waitFor();assert.equal((await contexts[1].request.get(origin+'/game.gba')).status(),401);await p.waitForFunction(()=>document.getElementById('restart').disabled);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({tlsProxy:'local test certificate, not public deployment',authentication:'required; wrong secret denied; HttpOnly Secure Strict cookie passed',wss:'two authenticated browsers ran beyond 330 frames',chat:'passed',logout:'ROM and active WebSocket access revoked',errors}));
 }finally{if(browser)await browser.close();if(app)await app.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));await fsp.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
