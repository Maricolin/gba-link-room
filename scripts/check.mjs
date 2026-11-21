import {readFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(directory){const out=[];for(const item of await readdir(directory,{withFileTypes:true})){if(item.name.startsWith('.'))continue;const file=path.join(directory,item.name);if(item.isDirectory())out.push(...await walk(file));else if(/\.(mjs|cjs|js)$/.test(item.name))out.push(file);}return out;}
const files=[path.join(root,'server.mjs'),...(await Promise.all(['src/server','public/js','scripts','test'].map(p=>walk(path.join(root,p))))).flat()];
for(const file of files){const text=await readFile(file,'utf8');if(text.includes('\0'))throw Error('NUL byte in '+path.relative(root,file));const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(1);}
const html=await readFile(path.join(root,'public/index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="\/([^"#?]+)"/g))await access(path.join(root,'public',match[1]));
for(const file of ['public/core/kirby-link.js','public/core/kirby-link.wasm','public/js/emulator/worker.js','public/js/emulator/hash.js','scripts/launcher.mjs','tools/launcher.mjs','docs/ARCHITECTURE.md','docs/DEPLOYMENT.md','docs/SECURITY.md','src/server/games.mjs','config/games.json','scripts/catalog.mjs','docs/ADDING_GAMES.md'])await access(path.join(root,file));
console.log('Syntax and project layout passed ('+files.length+' JavaScript files).');
