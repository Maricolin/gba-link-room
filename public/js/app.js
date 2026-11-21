import {ACTIONS,defaultBindings,loadBindings,rebind,keyLabel,inputMask,isTyping} from './controls.js';
import {createChat} from './chat.js';
import {createAccess} from './auth.js';
import {createGameLibrary} from './games.js';
import {saveStorageKey,bindingStorageKey,readGameSave,readGameBindings,saveDownloadName} from './game-storage.js';
const $=id=>document.getElementById(id);
const worker=new Worker('/js/emulator/worker.js');
const screen=$('screen'),ctx=screen.getContext('2d',{alpha:false});
let myId=null,room=null,session=null,online=false,romHash='',info=null,saveRoom=null,active=false,selectedGame=null,switchRomPending=false;
let keyboard=0,touch=0,gamepad=0,lastKeys=-1,lastStats=0;
let audio=null,gain=null,sound=false,audioTime=0;
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{log('浏览器存储不可用，请使用导出存档',true);}}};
let bindings=loadBindings(null),pendingBinding=null;
const held=new Set(),touches=new Map();
$('nickname').value=storage.get('kirby.nickname')||'玩家';
const invite=new URL(location.href).searchParams.get('room');if(invite)$('joinCode').value=invite.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
function command(type,extra={}){worker.postMessage({type:'command',data:{type,...extra}});}
function log(message,error=false){const p=document.createElement('div');p.textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false})+' · '+message;if(error)p.className='error';$('log').append(p);while($('log').children.length>50)$('log').firstChild.remove();$('log').scrollTop=$('log').scrollHeight;}
function status(text){$('statusText').textContent=text;}
function playingStatus(slot){return selectedGame?.link==='none'?'单人运行中':(slot+1)+'P · 联机运行中';}
function currentIdentity(){if(!selectedGame)throw Error('请先选择游戏');return {gameId:selectedGame.id,romSha256:selectedGame.romSha256};}
const library=createGameLibrary({storage,onSelect:game=>{release();selectedGame=game;romHash=game.romSha256;active=false;session=null;pendingBinding=null;bindings=loadBindings(readGameBindings(storage,game.id));renderBindings();$('splash').classList.remove('hidden');$('frame').textContent='0';$('exportSave').disabled=true;status('已选择 '+game.title);}});
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
const chat=createChat({send:command,getMyId:()=>myId,release:()=>release()});
const access=createAccess({
  release:()=>release(),
  onReady:()=>{loadInfo().then(ready=>{if(ready)worker.postMessage({type:'connect',url:(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws'});});},
  onLocked:()=>{online=false;worker.postMessage({type:'disconnect'});room=null;renderRoom();$('connectionStatus').textContent='需要访问口令';$('connectionStatus').className='badge';},
});
async function loadInfo(){try{const [details,catalog]=await Promise.all(['/api/info','/api/games'].map(url=>fetch(url,{credentials:'same-origin',cache:'no-store'})));if(details.status===401||catalog.status===401){access.check();return false;}if(!details.ok||!catalog.ok)throw Error('读取游戏目录失败，请确认服务已更新');info=await details.json();library.setCatalog(await catalog.json());for(const url of info.addresses||[])if(!url.includes('169.254.'))log('服务地址：'+url);return true;}catch(error){log(error.message,true);status(error.message);return false;}}
function keyboardBlocked(){return pendingBinding!==null||isTyping(document.activeElement)||!!document.activeElement?.closest?.('#keySettings');}
function renderRoom(){
  chat.setRoom(room);chat.setConnected(online);library.lock(!online||!!room);$('switchRom').disabled=!online||!room;
  const host=room?.host===myId;
  $('createRoom').disabled=!online||!!room||!selectedGame;$('joinRoom').disabled=!online||!!room;
  $('nickname').disabled=!!room;$('playerCount').disabled=!!room;$('joinCode').disabled=!!room;
  $('leaveRoom').disabled=!room;$('copyLink').disabled=!room;
  $('roomCode').textContent=room?.code||'— — —';
  $('startGame').disabled=!online||!host||room?.running||room?.players.length!==room?.count||room?.players.some(player=>player.ready===false);
  $('startGame').textContent=room?.running?'冒险进行中':host?'一起开始游戏 →':room?'等待房主开始游戏':'一起开始游戏 →';
  $('restart').disabled=!active||!host;
  $('importSave').disabled=!!room?.running||!selectedGame;
  $('players').replaceChildren();
  if(!room){const p=document.createElement('li');p.textContent='✧ 等待冒险者加入';p.className='empty-player';$('players').append(p);return;}
  for(let i=0;i<room.count;i++){
    const p=room.players[i],li=document.createElement('li'),avatar=document.createElement('span'),name=document.createElement('span'),hint=document.createElement('span');
    avatar.className='avatar';avatar.textContent=String(i+1);avatar.style.background=['#fbe0eb','#fff0c4','#e3ecff','#e6f3d9'][i];
    name.textContent=p?p.name:'等待加入…';hint.className='you';hint.textContent=p?((p.id===room.host?'房主 ':'')+(p.id===myId?'· 你 ':'')+(p.ready===false?'· 同步存档中':'')):'';
    li.append(avatar,name,hint);$('players').append(li);
  }
}
function release(){held.clear();touches.clear();keyboard=touch=gamepad=0;publishKeys();document.querySelectorAll('[data-key]').forEach(b=>b.classList.remove('pressed'));}
function publishKeys(){const keys=keyboard|touch|gamepad;if(keys!==lastKeys){lastKeys=keys;worker.postMessage({type:'keys',keys});}}
function stopped(reason){active=false;session=null;release();$('restart').disabled=true;status(reason||'游戏已停止');if(reason)log(reason,true);renderRoom();}
async function enableAudio(){
  if(!audio){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error('当前浏览器不支持声音');audio=new C({latencyHint:'interactive'});gain=audio.createGain();gain.gain.value=.6;gain.connect(audio.destination);}
  await audio.resume();sound=true;audioTime=audio.currentTime+.035;$('soundToggle').textContent='♫ 关闭声音';
}
function playAudio(m){if(!sound||!audio||audio.state!=='running')return;const pcm=new Int16Array(m.pcm),samples=pcm.length/2;
  if(audioTime>audio.currentTime+.18)return;
  const buffer=audio.createBuffer(2,samples,m.rate);
  for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let i=0;i<samples;i++)channel[i]=pcm[i*2+c]/32768;}
  const source=audio.createBufferSource();source.buffer=buffer;source.connect(gain);audioTime=Math.max(audioTime,audio.currentTime+.025);source.start(audioTime);audioTime+=samples/m.rate;
}
worker.onmessage=event=>{const m=event.data;
  if(m.type==='connection'){online=m.state==='online'&&!access.locked;if(!online&&access.required)access.check();$('connectionStatus').textContent=access.locked?'需要访问口令':online?'● 联机服务已连接':'○ 服务未连接，重试中';$('connectionStatus').className='badge '+(online?'online':'error');renderRoom();return;}
  if(m.type==='hello'){myId=m.id;log('服务已连接，游戏目录已就绪');return;}
  if(m.type==='room'){room=m.room;if(room){library.useRoom(room);$('playerCount').value=String(room.count);const key=room.code+':'+selectedGame.id+':'+selectedGame.romSha256;if(saveRoom!==key){saveRoom=key;const data=readGameSave(storage,selectedGame,$('nickname').value);command('save',{data:data||'',...currentIdentity()});command('saveReady',currentIdentity());log('已加入 '+selectedGame.title+' 房间 '+room.code+'，你是 '+((room.players.find(p=>p.id===myId)?.slot??0)+1)+'P');}}else{saveRoom=null;stopped();}renderRoom();if(!room&&switchRomPending){switchRomPending=false;if(online)library.focus();status('已退出房间，请选择其他 ROM；存档按游戏版本独立保留');}return;}
  if(m.type==='loading'){status(m.message);log(m.message);return;}
  if(m.type==='begin'){session=m.session;active=true;release();$('splash').classList.add('hidden');$('exportSave').disabled=false;status(playingStatus(m.slot));log(selectedGame.link==='none'?'单人核心已启动；当前配置未开放通信联机。':'GBA 通信线已连接。请在游戏内选择多人模式。');screen.focus({preventScroll:true});audioTime=audio?audio.currentTime+.04:0;renderRoom();return;}
  if(m.type==='video'){if(m.gameId!==selectedGame?.id||m.romSha256!==selectedGame?.romSha256){worker.postMessage({type:'videoAck'});return;}const image=new ImageData(new Uint8ClampedArray(m.rgba),240,160);ctx.putImageData(image,0,0);$('frame').textContent=m.frame;worker.postMessage({type:'videoAck'});return;}
  if(m.type==='audio'){if(m.gameId===selectedGame?.id&&m.romSha256===selectedGame?.romSha256)playAudio(m);return;}
  if(m.type==='stats'){if(m.gameId!==selectedGame?.id||m.romSha256!==selectedGame?.romSha256)return;$('fps').textContent=m.fps;if(active)status(m.waiting?'等待同步输入…':playingStatus(room?.players.find(p=>p.id===myId)?.slot??0));lastStats=m.frame;return;}
  if(m.type==='ping'){$('ping').textContent=m.ms;return;}
  if(m.type==='chat'||m.type==='chatHistory'){chat.receive(m);return;}
  if(m.type==='error'){log(m.message,true);if(m.message.includes('聊天'))chat.error(m.message);else status(m.message);return;}
  if(m.type==='stopped'){stopped(m.reason);return;}
  if(m.type==='save'){
    if(typeof m.gameId!=='string'||!m.romSha256)return;const game={id:m.gameId,romSha256:m.romSha256},nickname=typeof m.nickname==='string'?m.nickname:$('nickname').value;const bytes=new Uint8Array(m.bytes);storage.set(saveStorageKey(game,nickname),base64(bytes));
    if(m.download){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=saveDownloadName(game,m.slot??0);a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);log('电池存档已导出（'+bytes.length+' 字节）');}return;
  }
};
worker.onerror=e=>{log('模拟器工作线程出错：'+e.message,true);status('加载失败，请检查核心文件与浏览器控制台');};
$('createRoom').onclick=()=>{storage.set('kirby.nickname',$('nickname').value.trim()||'卡比');command('create',{name:$('nickname').value,count:Number($('playerCount').value),gameId:selectedGame.id,syncSaves:true});};
$('joinRoom').onclick=()=>{storage.set('kirby.nickname',$('nickname').value.trim()||'卡比');command('join',{name:$('nickname').value,code:$('joinCode').value.trim().toUpperCase(),syncSaves:true});};
$('joinCode').oninput=()=>$('joinCode').value=$('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
$('leaveRoom').onclick=()=>command('leave');
$('switchRom').onclick=()=>{release();switchRomPending=true;command('leave');};
$('startGame').onclick=()=>{enableAudio().catch(e=>log(e.message,true));command('start');};
$('restart').onclick=()=>command('restart',{session});
$('exportSave').onclick=()=>worker.postMessage({type:'exportSave'});
$('soundToggle').onclick=()=>{if(sound){sound=false;gain.gain.value=0;$('soundToggle').textContent='♫ 开启声音';}else enableAudio().then(()=>gain.gain.value=.6).catch(e=>log(e.message,true));};
$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('gamePanel').requestFullscreen?.().catch(e=>log(e.message,true));};
$('copyLink').onclick=async()=>{if(!room)return;let base=location.origin;
  if(['localhost','127.0.0.1'].includes(location.hostname))base=info?.addresses?.find(x=>!x.includes('169.254.')&&!x.includes('172.'))||base;
  const link=base+'/?room='+room.code;
  try{await navigator.clipboard.writeText(link);log('邀请链接已复制：'+link);}catch{const i=document.createElement('input');i.value=link;document.body.append(i);i.select();const ok=document.execCommand('copy');i.remove();log((ok?'邀请链接已复制：':'邀请链接：')+link);}
};
$('importSave').onchange=async()=>{const f=$('importSave').files[0];if(!f)return;
  try{if(!selectedGame)throw Error('请先选择游戏');if(room?.running)throw Error('请先退出游戏，再导入存档');const game=selectedGame,nickname=$('nickname').value;if(![512,8192,32768,65536,131072].includes(f.size))throw Error('不是有效大小的 GBA 电池存档（.sav）');const data=base64(new Uint8Array(await f.arrayBuffer()));if(selectedGame!==game||room?.running||$('nickname').value!==nickname)throw Error('游戏或玩家已变化，请重新导入');storage.set(saveStorageKey(game,nickname),data);command('save',{data,gameId:game.id,romSha256:game.romSha256});log('已导入 '+game.title+' 的存档，下次开机生效');}catch(e){log(e.message,true);}finally{$('importSave').value='';}
};
function renderBindings(){
  const grid=$('keyBindings'),summary=$('keySummary');grid.replaceChildren();summary.replaceChildren();$('resetKeys').disabled=!selectedGame;
  for(const a of ACTIONS){
    const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');
    const actionLabel=selectedGame?.labels?.[a.id]||a.label;row.className='key-binding';label.textContent=actionLabel;button.type='button';button.dataset.bind=a.id;button.disabled=!selectedGame;
    button.className='key-bind-button'+(pendingBinding===a.id?' listening':'');
    button.textContent=pendingBinding===a.id?'请按新键…':bindings[a.id].map(keyLabel).join(' / ');
    button.setAttribute('aria-label','修改 '+actionLabel+' 按键');button.setAttribute('aria-pressed',String(pendingBinding===a.id));
    button.onclick=()=>{release();pendingBinding=a.id;renderBindings();$('keyHint').textContent='正在设置 '+actionLabel+'，按 Esc 取消';grid.querySelector('[data-bind="'+a.id+'"]').focus({preventScroll:true});};
    row.append(label,button);grid.append(row);
    const item=document.createElement('span'),key=document.createElement('kbd');key.textContent=bindings[a.id].map(keyLabel).join(' / ');item.append(key,document.createTextNode(' '+actionLabel));summary.append(item);
  }
}
function updateKeyboard(){keyboard=inputMask(bindings,held);publishKeys();}
addEventListener('keydown',e=>{
  if(pendingBinding){
    e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;
    if(e.code==='Escape'){pendingBinding=null;renderBindings();$('keyHint').textContent='已取消修改';return;}
    if(e.isComposing||e.key==='Process'||e.key==='Dead'){$('keyHint').textContent='请先结束输入法组词，再按新键';return;}
    try{const result=rebind(bindings,pendingBinding,e.code);bindings=result.bindings;pendingBinding=null;release();storage.set(bindingStorageKey(selectedGame.id),JSON.stringify(bindings));renderBindings();$('keyHint').textContent=(result.swapped?'重复按键已自动互换。':'')+'已保存，点击游戏画面继续';}catch(error){$('keyHint').textContent=error.message;}
    return;
  }
  if(e.isComposing||!active||keyboardBlocked()||!ACTIONS.some(a=>bindings[a.id].includes(e.code)))return;
  e.preventDefault();held.add(e.code);updateKeyboard();
},true);
addEventListener('keyup',e=>{if(held.delete(e.code))updateKeyboard();});
$('resetKeys').onclick=()=>{pendingBinding=null;release();bindings=defaultBindings();storage.set(bindingStorageKey(selectedGame.id),JSON.stringify(bindings));renderBindings();$('keyHint').textContent='已恢复默认按键';};
$('keySettings').addEventListener('toggle',()=>{release();if(!$('keySettings').open){pendingBinding=null;renderBindings();}});
renderBindings();
addEventListener('blur',()=>{held.clear();release();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();release();}});
document.addEventListener('focusin',e=>{if(isTyping(e.target)||e.target.closest?.('#keySettings'))release();});
for(const b of document.querySelectorAll('[data-key]')){
  b.addEventListener('pointerdown',e=>{if(!active)return;e.preventDefault();b.setPointerCapture(e.pointerId);touches.set(e.pointerId,Number(b.dataset.key));b.classList.add('pressed');touch=0;for(const k of touches.values())touch|=1<<k;publishKeys();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,e=>{touches.delete(e.pointerId);if(![...touches.values()].includes(Number(b.dataset.key)))b.classList.remove('pressed');touch=0;for(const k of touches.values())touch|=1<<k;publishKeys();});
}
setInterval(()=>{gamepad=0;if(active&&!document.hidden&&!keyboardBlocked()){for(const p of navigator.getGamepads?.()||[]){if(!p||p.mapping!=='standard')continue;const mapping={0:0,1:1,8:2,9:3,15:4,14:5,12:6,13:7,5:8,4:9};for(const [button,key]of Object.entries(mapping))if(p.buttons[button]?.pressed)gamepad|=1<<key;if(p.axes[0]>.45)gamepad|=16;if(p.axes[0]<-.45)gamepad|=32;if(p.axes[1]<-.45)gamepad|=64;if(p.axes[1]>.45)gamepad|=128;break;}}publishKeys();},16);
renderRoom();access.check();
