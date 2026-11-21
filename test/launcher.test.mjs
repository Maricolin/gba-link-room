import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {startOrReuse,PROJECT_ID,APP_ID} from '../tools/launcher.mjs';
async function fixture(t){const root=path.resolve('.tools/tmp');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'launcher-test-'));const romPath=path.join(directory,'test.gba');await writeFile(romPath,'test');t.after(()=>rm(directory,{recursive:true,force:true}));return {romPath,openBrowser:false,log:()=>{}};}
test('repeated launch reuses only this project service, without EADDRINUSE',async t=>{const options=await fixture(t),first=await startOrReuse({...options,port:0});t.after(()=>first.app.close());assert.equal(first.reused,false);assert.equal(first.info.projectId,PROJECT_ID);assert.equal(first.info.appId,APP_ID);const second=await startOrReuse({...options,port:first.port});assert.equal(second.reused,true);assert.equal(second.port,first.port);assert.equal(second.app,null);});
test('a different service keeps running and launcher chooses a free port',async t=>{const options=await fixture(t);const foreign=http.createServer((_,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appId:APP_ID,projectId:'another-project'}));});await new Promise(resolve=>foreign.listen(0,'0.0.0.0',resolve));t.after(()=>new Promise(resolve=>foreign.close(resolve)));const occupied=foreign.address().port;const result=await startOrReuse({...options,port:occupied});t.after(()=>result.app.close());assert.equal(result.reused,false);assert.notEqual(result.port,occupied);assert.equal(foreign.listening,true);});
