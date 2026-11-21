import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function discover(directory){const files=[];for(const item of await readdir(directory,{withFileTypes:true})){if(item.name.startsWith('.'))continue;const filename=path.join(directory,item.name);if(item.isDirectory())files.push(...await discover(filename));else if(/\.test\.(mjs|cjs)$/.test(item.name))files.push(filename);}return files;}
const tests=(await discover(path.join(root,'test'))).sort();
if(!tests.length)throw Error('No test files found');
const child=spawn(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
