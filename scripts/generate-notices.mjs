import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async p=>(await readFile(path.join(root,p),'utf8')).replace(/\r\n/g,'\n');
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pkg=JSON.parse(await read('package.json')),manifest=JSON.parse(await read('licenses/manifest.json'));
const texts=[{title:'MPL-2.0 — project covered source',text:await read('LICENSE')},{title:'Project attribution NOTICE',text:await read('NOTICE')}];
for(const file of manifest.files){if(!/^[a-z0-9-]+\.txt$/i.test(file.file))throw Error('Unexpected license filename');const raw=await readFile(path.join(root,'licenses',file.file)),text=raw.toString('utf8').replace(/\r\n/g,'\n');if(createHash('sha256').update(raw).digest('hex')!==file.sha256)throw Error('License copy changed: '+file.file);texts.push({title:file.file,text});}
const wasm=await readFile(path.join(root,'public/core/kirby-link.wasm')),digest=createHash('sha256').update(wasm).digest('hex');
const html='<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>开源许可与来源 · GBA Link Room</title><link rel="stylesheet" href="/css/legal.css"></head><body><main><p><a href="/">返回联机大厅</a></p><h1>开源许可与代码来源</h1><p>GBA Link Room '+escape(pkg.version)+'。项目覆盖代码采用MPL-2.0，第三方原始声明和例外优先；以下文本不会为ROM、商标或其他游戏内容授予许可。</p><p>核心SHA-256：<code>'+digest+'</code></p><h2>对应源码</h2><p>本项目保留核心适配、上游源码与构建配置。接收JS/WASM副本的用户应能合理取得匹配源码，请向此实例维护者取得同版本源码包或其授予访问的仓库；仅提供无法访问的私库链接并不能证明源码可得。此页面提供许可原文，不自动提供源码下载。</p><p><a href="https://www.mozilla.org/en-US/MPL/2.0/">MPL官方正文</a> · <a href="https://www.mozilla.org/en-US/MPL/2.0/FAQ/">官方FAQ</a> · <a href="https://github.com/tangobattle/mgba">mGBA fork</a> · <a href="https://github.com/tangobattle/mgba-rollback">调度参考</a> · <a href="https://github.com/tangobattle/mgba-rs">SIO胶水参考</a></p>'+texts.map((entry,i)=>'<section id="license-'+i+'"><h2>'+escape(entry.title)+'</h2><pre>'+escape(entry.text)+'</pre></section>').join('')+'<p>Generated from LICENSE, NOTICE and licenses/; third-party original notices remain applicable. No game ROM is embedded in this page.</p></main></body></html>\n';
const target=path.join(root,'public/legal/notices.html');
if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==html)throw Error('Regenerate public legal notices');console.log('License notices match their retained texts and current core.');}
else{await mkdir(path.dirname(target),{recursive:true});await writeFile(target,html,'utf8');console.log('Generated public/legal/notices.html');}
