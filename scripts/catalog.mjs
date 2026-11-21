import {loadCatalog} from '../src/server/games.mjs';
const args=process.argv.slice(2),options={};let json=false;
try{
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--help'){console.log('node scripts/catalog.mjs [--catalog path] [--rom-dir path] [--json]');process.exit(0);}
    if(arg==='--json'){json=true;continue;}
    const key=arg==='--catalog'?'catalogPath':arg==='--rom-dir'?'romDirectory':null;
    if(!key||!args[i+1]||args[i+1].startsWith('--')||options[key]!==undefined)throw Error('参数无效；使用 --help 查看用法');options[key]=args[++i];
  }
  options.catalogPath??=process.env.GAME_CATALOG_PATH||undefined;options.romDirectory??=process.env.ROM_DIRECTORY||undefined;if(process.env.ROM_PATH)options.romPath=process.env.ROM_PATH;
  const {listing}=await loadCatalog(options);
  if(json)console.log(JSON.stringify(listing,null,2));
  else{for(const game of listing.games)console.log(game.id+' | '+game.title+' | '+game.players.join('/')+' 人 | '+game.romSize+' bytes | '+game.romSha256.slice(0,12)+'… | '+game.compatibility);console.log('目录校验通过，默认游戏：'+listing.defaultGameId+'。文件可加载不代表已验证游戏联机兼容。');}
}catch(error){console.error('游戏目录检查失败：'+error.message);process.exitCode=1;}
