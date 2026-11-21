/* SPDX-License-Identifier: MPL-2.0 */
/* MPL-2.0. SIO MULTI ping-pong adapted from
 * tangobattle/mgba-rollback/src/testrom.rs (ec6c1364...). */
module.exports=function build({tone=false}={}){
 const w=[];const here=()=>w.length,emit=x=>(w.push(x>>>0),w.length-1);
 const bw=(c,a,t)=>(c<<28)|0x0a000000|((t-a-2)&0xffffff);
 const branch=(c,t)=>emit(bw(c,here(),t));const fix=c=>emit(c<<28|0x0a000000);const patch=(a,t)=>w[a]=bw(w[a]>>>28,a,t)>>>0;
 const dp=(c,op,s,rn,rd,rot,imm)=>(c<<28)|(1<<25)|(op<<21)|(s<<20)|(rn<<16)|(rd<<12)|(rot<<8)|imm;
 const mov=(rd,rot,imm)=>emit(dp(14,13,0,0,rd,rot,imm));
 const orr=(rd,rn,rot,imm)=>emit(dp(14,12,0,rn,rd,rot,imm));
 const add=(rd,rn,imm)=>emit(dp(14,4,0,rn,rd,0,imm));
 const subs=(rd,rn,imm)=>emit(dp(14,2,1,rn,rd,0,imm));
 const tst=(rn,imm)=>emit(dp(14,8,1,rn,0,0,imm));
 const cmp=(rn,rm)=>emit((14<<28)|(10<<21)|(1<<20)|(rn<<16)|rm);
 const half=(load,rd,rn,off)=>emit((14<<28)|(28<<20)|(load<<20)|(rn<<16)|(rd<<12)|((off&240)<<4)|0xb0|(off&15));
 const ld=(rd,rn,off)=>half(1,rd,rn,off),st=(rd,rn,off)=>half(0,rd,rn,off);
 emit(bw(14,0,48));while(here()<48)emit(0);
 mov(0,4,4);
 if(tone){mov(1,0,0x80);st(1,0,0x84);mov(1,0,0x77);orr(1,1,12,0xff);st(1,0,0x80);mov(1,0,2);st(1,0,0x82);mov(1,0,0);st(1,0,0x60);mov(1,12,0xf0);st(1,0,0x62);mov(1,12,0x84);orr(1,1,0,3);st(1,0,0x64);}
 orr(0,0,14,0x12);mov(1,0,0);st(1,0,0x14);
 mov(3,0,255);orr(3,3,12,255);mov(5,4,2);mov(9,0,0);
 const outer=here();add(8,9,1);mov(1,10,2);orr(1,1,0,3);st(1,0,8);ld(1,0,8);tst(1,8);branch(0,outer);
 emit(dp(14,0,0,1,2,0,0x30));emit((14<<28)|(12<<21)|(8<<16)|(7<<12)|(10<<7)|2);
 st(7,0,10);tst(1,4);const toSlave=fix(1);
 mov(6,12,8);const settle=here();subs(6,6,1);branch(1,settle);
 ld(1,0,8);orr(1,1,0,128);st(1,0,8);mov(6,12,128);
 const busy=here();ld(1,0,8);tst(1,128);const masterRecord=fix(0);subs(6,6,1);branch(1,busy);branch(14,outer);
 const slave=here();mov(6,12,64);const wait=here();ld(2,0,0);cmp(2,9);const toNext=fix(0);cmp(2,3);const slaveRecord=fix(1);
 const next=here();patch(toNext,next);subs(6,6,1);branch(1,wait);branch(14,outer);
 const record=here();for(let i=0;i<4;i++){ld(2,0,i*2);st(2,5,i*2);}add(5,5,8);ld(9,0,0);branch(14,outer);
 patch(toSlave,slave);patch(masterRecord,record);patch(slaveRecord,record);
 const rom=Buffer.alloc(1024);w.forEach((v,i)=>rom.writeUInt32LE(v>>>0,i*4));return rom;
};
