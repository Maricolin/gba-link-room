import {LAST_GAME_KEY} from './game-storage.js';
export const compatibilityLabel=value=>({untested:'待验证', 'core-tested':'核心测试通过',verified:'维护者已验证'})[value]||'待验证';
export function createGameLibrary({storage,onSelect}){
  const $=id=>document.getElementById(id),select=$('gameSelect');let games=new Map(),selected=null,locked=false;
  function paint(game){
    $('gameDescription').textContent=game.description||'使用模拟 GBA 通信线，与房间里的伙伴一起游戏。';
    $('gameCompatibility').textContent=game.link==='none'?'单人配置 · 未开放联机':compatibilityLabel(game.compatibility);
    $('gameRomIdentity').textContent='ROM '+game.romSha256.slice(0,12)+'… · '+(game.romSize/1048576).toFixed(1)+' MiB';
    $('gamePlayers').textContent=game.players.join(' / ')+' 人';
    $('gameInstructions').textContent=game.instructions||'请按游戏本身的说明进入通信模式。此目录项尚不代表已验证完整联机流程。';
    $('gameTitle').textContent=game.title;document.title=game.title+' · GBA 联机';
    const counts=$('playerCount');counts.replaceChildren();
    for(const count of game.players){const option=document.createElement('option');option.value=count;option.textContent=count===1?(game.link==='none'?'1 人 · 单人游戏':'1 人 · 单人练习'):count+' 人 · 通信联机';counts.append(option);}
    counts.value=String(game.defaultPlayers);
  }
  function choose(id,{remember=true}={}){
    const game=games.get(id);if(!game)return false;
    if(selected?.id===game.id&&selected.romSha256===game.romSha256){select.value=id;return true;}
    selected=game;select.value=id;paint(game);if(remember)storage.set(LAST_GAME_KEY,id);onSelect(game);return true;
  }
  select.addEventListener('change',()=>{if(!locked)choose(select.value);});
  return {
    setCatalog(catalog){
      games=new Map(catalog.games.map(game=>[game.id,game]));select.replaceChildren();
      for(const game of games.values()){const option=document.createElement('option');option.value=game.id;option.textContent=game.title;select.append(option);}
      selected=null;choose(games.has(storage.get(LAST_GAME_KEY))?storage.get(LAST_GAME_KEY):catalog.defaultGameId);select.disabled=locked;
    },
    choose,
    focus(){select.focus({preventScroll:true});select.scrollIntoView({block:'nearest'});},
    useRoom(room){if(!room?.gameId)return;if(room.game){games.set(room.gameId,room.game);if(![...select.options].some(o=>o.value===room.gameId)){const option=document.createElement('option');option.value=room.gameId;option.textContent=room.game.title;select.append(option);}}choose(room.gameId);},
    lock(value){locked=value;select.disabled=locked||!games.size;},
    get selected(){return selected;},
    get(id){return games.get(id);},
  };
}
