export const LEGACY_GAME_ID='kirby-amazing-mirror-cn';
export const LAST_GAME_KEY='gba.library.last-game.v1';
export function saveStorageKey(game,nickname){return 'gba.save.v1:'+game.id+':'+game.romSha256+':'+encodeURIComponent(nickname.trim());}
export function bindingStorageKey(gameId){return 'gba.bindings.v1:'+gameId;}
function validSave(value){if(typeof value!=='string'||value.length>174764||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))return false;try{return btoa(atob(value))===value&&atob(value).length<=131072;}catch{return false;}}
export function readGameSave(storage,game,nickname){
  if(!game?.id||!game.romSha256)return null;
  const key=saveStorageKey(game,nickname);let value=storage.get(key);
  if(value===null&&game.id===LEGACY_GAME_ID){value=storage.get('kirby.save.'+game.romSha256+'.'+nickname.trim());if(value!==null&&validSave(value))storage.set(key,value);}
  return validSave(value)?value:null;
}
export function readGameBindings(storage,gameId){
  let value=storage.get(bindingStorageKey(gameId));
  if(value===null&&gameId===LEGACY_GAME_ID)value=storage.get('kirby.keybindings.v1');
  return value;
}
export function saveDownloadName(game,slot){return game.id+'-'+(slot+1)+'p.sav';}
