const fs=require('node:fs');
const create=require('../public/core/kirby-link.js');
(async()=>{
const c=await create({wasmBinary:fs.readFileSync('public/core/kirby-link.wasm'),print:()=>{},printErr:console.error});
const rom=fs.readFileSync('data/roms/kirby-amazing-mirror-cn.gba');const p=c._malloc(rom.length);c.HEAPU8.set(rom,p);
for(const n of [1,2,4]){
 if(!c._link_create(n,p,rom.length))throw Error('create failed '+n);
 const start=performance.now();for(let f=0;f<120;f++){const r=c._link_tick(0,0,0,0);if(r<0)throw Error('tick failed '+n+' '+f+' '+r);c._link_audio(0);}
 console.log({players:n,frames:c._link_frame(0),ids:Array.from({length:n},(_,i)=>c._link_player_id(i)),ms:Math.round(performance.now()-start),digest:c._link_digest()>>>0,colors:new Set(c.HEAPU32.subarray(c._link_video(0)/4,c._link_video(0)/4+38400)).size});
 c._link_destroy();
}c._free(p);
})();