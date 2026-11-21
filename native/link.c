/* MPL-2.0. Cooperative link scheduling adapted from tangobattle/mgba-rollback
 * src/lib.rs and mgba-rs/src/sio.rs. See THIRD_PARTY.md. */
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/sio/lockstep.h>
#include <mgba-util/vfs.h>
#include <mgba-util/audio-buffer.h>

struct User { struct mLockstepUser d; int asleep, requested, assigned; };
static struct mCore* cores[4];
static struct GBASIOLockstepCoordinator coord;
static struct GBASIOLockstepDriver drivers[4];
static struct User users[4];
static uint32_t video[4][240*160];
static struct VFile* pending[4];
static int count, initialized;
static int16_t pcm[4096*2];
static void* saveBytes;
static size_t saveLen;
static void sleepUser(struct mLockstepUser* u) { ((struct User*)u)->asleep=1; }
static void wakeUser(struct mLockstepUser* u) { ((struct User*)u)->asleep=0; }
static int requestId(struct mLockstepUser* u) { return ((struct User*)u)->requested; }
static void changedId(struct mLockstepUser* u,int id) { ((struct User*)u)->assigned=id; }
void link_destroy(void) {
  for(int i=0;i<4;i++) if(cores[i]) {
    mCoreConfigDeinit(&cores[i]->config);
    cores[i]->deinit(cores[i]); cores[i]=NULL;
  }
  if(initialized) { GBASIOLockstepCoordinatorDeinit(&coord); initialized=0; }
  count=0; free(saveBytes); saveBytes=NULL; saveLen=0;
}
int link_stage_save(int slot,const void* data,int length) {
  if(slot<0||slot>3||length<0||length>131072) return 0;
  if(pending[slot]) pending[slot]->close(pending[slot]);
  pending[slot]=VFileMemChunk(data,length); return pending[slot]!=NULL;
}
int link_create(int n,const void* rom,int length) {
  link_destroy();
  if(n<1||n>4||length<192||length>33554432) return 0;
  memset(users,0,sizeof(users)); memset(drivers,0,sizeof(drivers));
  memset(video,0,sizeof(video));
  GBASIOLockstepCoordinatorInit(&coord); initialized=1; count=n;
  for(int i=0;i<n;i++) {
    struct User* u=&users[i]; u->requested=i; u->assigned=-1;
    u->d.sleep=sleepUser; u->d.wake=wakeUser;
    u->d.requestedId=requestId; u->d.playerIdChanged=changedId;
    if(n>1) { GBASIOLockstepDriverCreate(&drivers[i],&u->d); GBASIOLockstepCoordinatorAttach(&coord,&drivers[i]); }
  }
  for(int i=0;i<n;i++) {
    struct mCore* c=GBACoreCreate(); cores[i]=c;
    if(!c||!c->init(c)) { link_destroy(); return 0; }
    mCoreConfigInit(&c->config,"kirby-link-web");
    mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&c->config,"volume",256);
    mCoreConfigSetDefaultIntValue(&c->config,"logLevel",0);
    /* loadConfig reads opts directly; config defaults alone leave volume at zero. */
    c->opts.volume=256; c->opts.mute=false; c->opts.frameskip=0;
    c->opts.skipBios=true; c->opts.useBios=false;
    c->loadConfig(c,&c->config);
    c->rtc.override=RTC_FIXED; c->rtc.value=0;
    c->setVideoBuffer(c,video[i],240);
    c->setAudioBufferSize(c,4096);
    struct VFile* vf=VFileMemChunk(rom,length);
    if(!vf||!c->loadROM(c,vf)) { if(vf)vf->close(vf); link_destroy(); return 0; }
    struct VFile* sv=pending[i]; pending[i]=NULL;
    if(!sv) sv=VFileMemChunk(NULL,0);
    if(!c->loadSave(c,sv)) { sv->close(sv); link_destroy(); return 0; }
    if(n>1) GBASIOSetDriver(&((struct GBA*)c->board)->sio,&drivers[i].d);
    c->reset(c);
  }
  return 1;
}
int link_tick(int k0,int k1,int k2,int k3) {
  if(!count)return -3;
  int keys[4]={k0,k1,k2,k3};
  for(int i=0;i<count;i++) cores[i]->setKeys(cores[i],keys[i]&1023);
  uint32_t target=cores[0]->frameCounter(cores[0])+1;
  int slices=0;
  while(cores[0]->frameCounter(cores[0])!=target) {
    int progressed=0;
    for(int i=0;i<count;i++) {
      if(count>1&&users[i].asleep)continue;
      if(i==0&&cores[0]->frameCounter(cores[0])==target)continue;
      cores[i]->runLoop(cores[i]); progressed=1; slices++;
    }
    if(!progressed)return -1;
    if(slices>100000)return -2;
  }
  return slices;
}
uint32_t* link_video(int i) { return i>=0&&i<count?video[i]:NULL; }
int link_frame(int i) { return i>=0&&i<count?cores[i]->frameCounter(cores[i]):0; }
int link_player_id(int i) { return i>=0&&i<count?users[i].assigned:-1; }
int link_read16(int i,int address) { return i>=0&&i<count?cores[i]->busRead16(cores[i],(uint32_t)address):0; }
int link_audio(int slot) {
  int samples=0;
  for(int i=0;i<count;i++) {
    struct mAudioBuffer* b=cores[i]->getAudioBuffer(cores[i]);
    if(i==slot) samples=mAudioBufferRead(b,pcm,4096);
    else mAudioBufferClear(b);
  }
  return samples;
}
int16_t* link_pcm(void) { return pcm; }
int link_audio_rate(void) { return count?cores[0]->audioSampleRate(cores[0]):32768; }
int link_export_save(int i) {
  free(saveBytes); saveBytes=NULL; saveLen=0;
  if(i>=0&&i<count) saveLen=cores[i]->savedataClone(cores[i],&saveBytes);
  return saveLen;
}
void* link_save_ptr(void) { return saveBytes; }
uint32_t link_digest(void) {
  uint32_t hash=2166136261u;
  for(int i=0;i<count;i++) {
    /* Game RAM and register state at the same link tick. Avoid host pointers. */
    for(uint32_t a=0x02000000;a<0x02040000;a+=4) { hash^=cores[i]->busRead32(cores[i],a);hash*=16777619u; }
    for(uint32_t a=0x03000000;a<0x03008000;a+=4) { hash^=cores[i]->busRead32(cores[i],a);hash*=16777619u; }
    for(uint32_t a=0x04000120;a<=0x04000134;a+=2) { hash^=cores[i]->busRead16(cores[i],a);hash*=16777619u; }
    hash^=cores[i]->frameCounter(cores[i]);hash*=16777619u;
  }
  return hash;
}
