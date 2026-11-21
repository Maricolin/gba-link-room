import {readdir,readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readRomSource} from './lib/rom-source.mjs';
import {loadCatalog} from '../src/server/games.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const profiles={
 AHUJ:{id:'shining-soul-user',title:'光明之魂（用户ROM）',players:[1,2,3,4],defaultPlayers:2,instructions:'单人可直接进入游戏；多人请在各端使用同一ROM并寻找游戏内通信线／多人入口。此版本提供2–4核联机候选配置，尚未验证完整多人流程。'},
 AB4J:{id:'summon-night-swordcraft-1-user',title:'召唤之夜 铸剑物语（用户ROM）',players:[1,2],defaultPlayers:1,instructions:'主线可单人进行。双人仅作为通信线测试候选，请在游戏内寻找通信／交换／对战入口；不代表双人共同推进主线，当前ROM的具体入口仍需实测。'},
 BSKJ:{id:'summon-night-swordcraft-2-user',title:'召唤之夜 铸剑物语2（用户ROM）',players:[1,2],defaultPlayers:1,instructions:'主线可单人进行。双人仅作为通信线测试候选，具体通信／交换／对战入口以当前汉化ROM菜单为准，不代表主线双人合作。'},
 B3CJ:{id:'summon-night-hajimari-user',title:'召唤之夜 铸剑物语 起源之石（用户ROM）',players:[1,2],defaultPlayers:1,instructions:'这是CRAFTSWORD H／B3CJ底本。单人主线与双人通信候选分开；请按当前ROM实际保留的通信菜单操作，未验证完整双人玩法。'},
 AZLE:{id:'zelda-alttp-four-swords-cn',title:'塞尔达 众神的三角力量＋四人之剑（中文版）',players:[1,2,3,4],defaultPlayers:2,instructions:'单人请选择《众神的三角力量》；2–4人请选择《四人之剑》，每台模拟GBA使用同一份ROM，各端都进入相同模式。此ROM已通过核心运行，实际关卡通信仍需人工验收。'},
 AF5J:{id:'shining-force-cn',title:'光明力量 黑暗龙的复活（中文版）',players:[1],defaultPlayers:1,link:'none',instructions:'本项目对此ROM仅开放单人游戏，不提供多人房间。源文件是改名为.gba的ZIP，已安全提取真正ROM；请直接开始单人流程。'},
};
function profileFor(file,source){
 const h=source.metadata;let base=profiles[h.gameCode];
 if(h.gameCode==='BPRE'){const newer=/10[._]2/.test(file),older=/10[._]1/.test(file);base={id:newer?'pokemon-swsh-10-2-cheats-cn':older?'pokemon-swsh-10-1-cn':'pokemon-firered-user-'+h.sha256.slice(0,8),title:newer?'宝可梦 剑盾10.2 汉化（内置修改器）':older?'宝可梦 剑盾10.1 汉化':'宝可梦 火红底本（用户ROM）',players:[1,2],defaultPlayers:1,instructions:'这是BPRE／火红底本的改版，不是原生Switch剑盾。先单人推进到游戏允许通信的进度，再在宝可梦中心等位置寻找有线交换／对战；无线俱乐部不受支持。10.1和10.2必须各建独立房间，不能混联；改版是否保留完整有线功能仍需实测。'};}
 if(!base)base={id:'user-'+(h.gameCode.toLowerCase().replace(/[^a-z0-9]/g,'')||'rom')+'-'+h.sha256.slice(0,8),title:h.title||'用户GBA ROM',players:[1],defaultPlayers:1,link:'none',instructions:'尚未配置此游戏的联机能力，暂只开放单人模式。请实测并确认通信方式后再编辑人数配置。'};
 return {...base,rom:'imported/'+base.id+'-'+h.sha256.slice(0,12)+'.gba',link:base.link||'cable',compatibility:'untested',description:'ROM 标头 '+h.title+' / '+h.gameCode+'。已导入私有游戏目录；兼容状态以逐ROM核心探测和实际联机验收为准。',labels:{a:h.gameCode==='AHUJ'?'A / 动作':'A / 确认',b:'B / 返回'}};
}
try{
 const args=process.argv.slice(2);if(args.includes('--help')){console.log('node scripts/import-rom-directory.mjs [directory] [--dry-run]');process.exit(0);}const dry=args.includes('--dry-run'),positional=args.filter(x=>x!=='--dry-run');if(positional.length>1||positional.some(x=>x.startsWith('--')))throw Error('参数无效');
 const directory=path.resolve(positional[0]||path.join(root,'ROM')),catalogFile=path.join(root,'config/games.json'),destination=path.join(root,'data/roms'),catalog=JSON.parse(await readFile(catalogFile,'utf8'));
 if(catalog.version!==1||!Array.isArray(catalog.games))throw Error('现有游戏目录格式无效');
 const files=(await readdir(directory,{withFileTypes:true})).filter(x=>!x.name.startsWith('.')&&/\.gba$/i.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name));if(!files.length)throw Error('目录没有 .gba 文件');if(files.length>64)throw Error('导入文件过多');
 const report=[];const ids=new Set();
 for(const file of files){const source=await readRomSource(path.join(directory,file.name)),profile=profileFor(file.name,source);if(ids.has(profile.id))throw Error('同一版本有重复文件，请先保留一个：'+profile.id);ids.add(profile.id);
  const entry={source:file.name,sourceSha256:source.sourceSha256,archive:source.archive,archiveMember:source.member,gameId:profile.id,rom:profile.rom,...source.metadata};report.push(entry);
  if(!dry){const target=path.join(destination,profile.rom);await mkdir(path.dirname(target),{recursive:true});try{await writeFile(target,source.bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const hash=createHash('sha256').update(await readFile(target)).digest('hex');if(hash!==source.metadata.sha256)throw Error('目标文件内容不匹配，拒绝覆盖：'+profile.id);}}
  const existing=catalog.games.findIndex(x=>x.id===profile.id);if(existing<0)catalog.games.push(profile);else if(catalog.games[existing].rom!==profile.rom){catalog.games[existing]={...catalog.games[existing],rom:profile.rom,compatibility:'untested'};}
 }
 if(catalog.games.length>64)throw Error('目录总游戏数超过64');
 if(!dry){const temp=catalogFile+'.import-'+process.pid;try{await writeFile(temp,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});await loadCatalog({catalogPath:temp,romDirectory:destination});await rename(temp,catalogFile);}finally{await unlink(temp).catch(()=>{});}await mkdir(path.join(root,'artifacts/rom-compat'),{recursive:true});await writeFile(path.join(root,'artifacts/rom-compat/import-report.json'),JSON.stringify({importedAt:new Date().toISOString(),items:report},null,2)+'\n');}
 console.log(JSON.stringify({dryRun:dry,count:report.length,items:report.map(x=>({source:x.source,gameId:x.gameId,title:x.title,gameCode:x.gameCode,archive:x.archive,rom:x.rom,size:x.size,sha256:x.sha256,headerChecksumValid:x.headerChecksumValid}))},null,2));
}catch(error){console.error('ROM 导入失败：'+error.message);process.exitCode=1;}
