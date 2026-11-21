// Runs the complete cable in one worker. Every peer receives identical key vectors.
importScripts('/core/kirby-link.js', '/js/emulator/hash.js');
let corePromise, core, romCache, socket, id, room=null, slot=0;
let loadedGame=null,loadedSlot=0,loadedNickname='';
let shouldReconnect=false,retryTimer=null;
let session=null, generation=0, running=false, loaded=false, keys=0, nextFrame=0, nextSend=0, delay=3;
let queue=[], due=0, timer=null, lastTick=0, lastStats=0, framesSince=0, imageBusy=false;
const FPS=16777216/280896, STEP=1000/FPS;
function out(type, data={}) { postMessage({type,...data}); }
function send(data) { if(socket?.readyState===1) socket.send(JSON.stringify(data)); }
function report(error) { out('error',{message:String(error.message||error)}); }
function stop(reason) {
  running=false; loaded=false; keys=0; generation++; queue=[]; clearTimeout(timer);
  if(core && session) exportSave();
  session=null; if(reason)out('stopped',{reason});
}
function exportSave(download=false) {
  if(!core||!loadedGame)return;
  const len=core._link_export_save(loadedSlot);
  if(len>0&&len<=131072){const ptr=core._link_save_ptr();const bytes=core.HEAPU8.slice(ptr,ptr+len),identity={gameId:loadedGame.id,romSha256:loadedGame.romSha256};out('save',{bytes:bytes.buffer,download,...identity,nickname:loadedNickname,slot:loadedSlot});if(!room||room.gameId===loadedGame.id)send({type:'save',data:base64(bytes),...identity});}
}
function base64(bytes) { let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s); }
function decode(s) { return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }
function connect(url) {
  clearTimeout(retryTimer);socket=new WebSocket(url);
  const connection=socket;
  socket.onopen=()=>out('connection',{state:'online'});
  socket.onclose=()=>{if(socket!==connection)return;stop('与服务断开，请重新加入房间');room=null;out('room',{room:null});out('connection',{state:'offline'});if(shouldReconnect)retryTimer=setTimeout(()=>connect(url),1800);};
  socket.onerror=()=>out('connection',{state:'error'});
  socket.onmessage=async event=>{
    if(socket!==connection)return;
    try { const m=JSON.parse(event.data);
      if(m.type==='hello'){id=m.id;out('hello',m);return;}
      if(m.type==='room'){room=m.code?m:null;if(room){slot=room.players.find(p=>p.id===id)?.slot??0;}out('room',{room});return;}
      if(m.type==='left'){stop();room=null;out('room',{room:null});return;}
      if(m.type==='chat'||m.type==='chatHistory'){out(m.type,m);return;}
      if(m.type==='prepare'){try{await prepare(m);}catch(error){if(session!==m.session)return;throw error;}return;}
      if(m.type==='begin'&&m.session===session&&loaded){
        running=true; nextFrame=0;nextSend=0;delay=m.delay||3;queue=[];
        for(let f=0;f<delay;f++)send({type:'input',session,frame:nextSend++,keys:0});
        due=performance.now()+STEP;lastTick=performance.now();lastStats=lastTick;framesSince=0;
        out('begin',{session,slot,...gameIdentity()});pump();return;
      }
      if(m.type==='tick'&&m.session===session&&running){queue.push(m);return;}
      if(m.type==='stopped'){stop(m.reason);return;}
      if(m.type==='pong'){out('ping',{ms:Math.round(Date.now()-m.time)});return;}
      if(m.type==='error'){out('error',{message:m.message});return;}
    } catch(error){report(error);if(session)send({type:'fatal',session,message:String(error.message||error)});stop('核心或通信出现错误，请重新开机');}
  };
}
async function prepare(m) {
  stop(); session=m.session;const gen=++generation;loaded=false;
  out('loading',{message:'正在读取 ROM 与 WebAssembly 核心…'});
  corePromise??=createKirbyCore({locateFile:p=>'/core/'+p,print:()=>{},printErr:s=>out('diagnostic',{message:s})});
  const game=m.game||{id:m.gameId||'kirby-amazing-mirror-cn',romSha256:m.romSha256,romUrl:m.romUrl||'/game.gba'};
  if(game.link&&!['cable','none'].includes(game.link))throw Error('当前核心只支持通信线或单人模式');
  if(game.link==='none'&&m.count!==1)throw Error('此游戏仅支持单人模式');
  const url=m.romUrl||game.romUrl;if(typeof url!=='string'||(!/^\/api\/games\/[a-z0-9-]+\/rom$/.test(url)&&url!=='/game.gba'))throw Error('游戏 ROM 地址无效');
  const cacheKey=game.id+':'+m.romSha256;
  if(!romCache||romCache.key!==cacheKey){romCache?.controller.abort();const entry={key:cacheKey,controller:new AbortController()};entry.promise=fetch(url,{credentials:'same-origin',signal:entry.controller.signal}).then(r=>{if(!r.ok)throw Error(r.status===401?'访问会话已过期，请重新登录':'读取 ROM 失败');return r.arrayBuffer();}).catch(error=>{if(romCache===entry)romCache=null;throw error;});romCache=entry;}
  const [c,rom]=await Promise.all([corePromise,romCache.promise]);
  if(gen!==generation)return;core=c;
  const hash=await sha256hex(rom);
  if(gen!==generation)return;
  if(hash!==m.romSha256)throw Error('ROM SHA-256 不匹配，请关闭页面并重新加载');
  core._link_destroy();loadedGame=null;
  for(let i=0;i<m.count;i++){
    const bytes=m.saves?.[i]?decode(m.saves[i]):new Uint8Array();
    const p=core._malloc(Math.max(bytes.length,1));core.HEAPU8.set(bytes,p);
    const ok=core._link_stage_save(i,p,bytes.length);core._free(p);if(!ok)throw Error('读取玩家存档失败');
  }
  const p=core._malloc(rom.byteLength);core.HEAPU8.set(new Uint8Array(rom),p);
  const ok=core._link_create(m.count,p,rom.byteLength);core._free(p);
  if(!ok)throw Error('GBA 核心初始化失败');
  loadedGame={id:game.id,romSha256:m.romSha256};loadedSlot=slot;loadedNickname=room?.players?.find(p=>p.id===id)?.name||'';
  loaded=true;send({type:'ready',session});out('loading',{message:'核心就绪，等待其他玩家…'});
}
function gameIdentity(){return {gameId:loadedGame?.id,romSha256:loadedGame?.romSha256};}
function display(frame){
  if(imageBusy)return;imageBusy=true;
  const p=core._link_video(slot),rgba=core.HEAPU8.slice(p,p+240*160*4);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  postMessage({type:'video',frame,rgba:rgba.buffer,...gameIdentity()},[rgba.buffer]);
}
function pump(){
  if(!running)return;
  try{
    const now=performance.now();let n=0;
    while(queue.length&&performance.now()>=due&&n<4){
      const m=queue.shift();if(m.frame!==nextFrame)throw Error('输入帧不连续：'+m.frame+' / '+nextFrame);
      const result=core._link_tick(...[0,1,2,3].map(i=>m.keys[i]||0));
      if(result<0)throw Error('GBA 通信调度错误 '+result);
      nextFrame++;framesSince++;lastTick=performance.now();
      send({type:'input',session,frame:nextSend++,keys});
      const samples=core._link_audio(slot);
      if(samples){const p=core._link_pcm();const pcm=core.HEAP16.slice(p/2,p/2+samples*2);postMessage({type:'audio',rate:core._link_audio_rate(),pcm:pcm.buffer,...gameIdentity()},[pcm.buffer]);}
      if(nextFrame%300===0){send({type:'checksum',session,frame:nextFrame,digest:(core._link_digest()>>>0).toString(16).padStart(8,'0')});exportSave();}
      due+=STEP;n++;
      if(performance.now()-due>160)due=performance.now();
    }
    if(n)display(nextFrame);
    if(now-lastStats>=1000){out('stats',{...gameIdentity(),frame:nextFrame,fps:Math.round(framesSince*1000/(now-lastStats)),waiting:now-lastTick>1000});lastStats=now;framesSince=0;}
    timer=setTimeout(pump,Math.max(2,Math.min(8,due-performance.now())));
  }catch(error){report(error);send({type:'fatal',session,message:String(error.message||error)});stop('核心已暂停，请重新开始');}
}
onmessage=event=>{const m=event.data;
  if(m.type==='connect'){shouldReconnect=true;if(!socket||socket.readyState>1)connect(m.url);}
  else if(m.type==='disconnect'){shouldReconnect=false;clearTimeout(retryTimer);stop();socket?.close();socket=null;room=null;romCache?.controller.abort();romCache=null;loadedGame=null;core?._link_destroy();imageBusy=false;out('room',{room:null});}
  else if(m.type==='keys')keys=m.keys&1023;
  else if(m.type==='videoAck')imageBusy=false;
  else if(m.type==='exportSave')exportSave(true);
  else if(m.type==='command'){if(m.data.type==='leave')stop();if(m.data.type==='restart')exportSave();send(m.data);}
};
setInterval(()=>send({type:'ping',time:Date.now()}),2500);
