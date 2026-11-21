import { randomInt, randomUUID } from 'node:crypto';

const SAVE_LIMIT = 128 * 1024;
const SAVE_CACHE_ENTRIES = 8;
const SAVE_CACHE_BYTES = 512 * 1024;
const CHAT_LIMIT = 5;
const CHAT_WINDOW_MS = 5000;
const CHAT_HISTORY_LIMIT = 50;

export function createRooms({ send, catalog, roomAttempt, inputDelayFrames }) {
  const rooms = new Map();
  const broadcast = (room, data) => { for (const player of [...room.players]) send(player, data); };
  const roomState = room => ({ type: 'room', gameId: room.game.id, game: room.game, code: room.code, count: room.count, host: room.players[0]?.id, players: room.players.map((p, slot) => ({ id: p.id, name: p.name, slot, ready: p.saveReady })), running: !!room.session });
  const publish = room => broadcast(room, roomState(room));
  function enter(room, client, name, syncSaves) {
    client.saveReady = syncSaves !== true;
    client.name = name;
    client.room = room;
    room.players.push(client);
    publish(room);
    send(client, { type: 'chatHistory', room: room.code, messages: room.chat });
  }
  function stop(room, reason, publishState = true) {
    if (!room.session) return;
    room.session = null;
    broadcast(room, { type: 'stopped', reason });
    if (publishState) publish(room);
  }
  function leave(client) {
    const room = client.room;
    if (!room) return;
    stop(room, '玩家离开，游戏已停止并释放全部按键', false);
    room.players = room.players.filter(p => p !== client);
    client.room = null;
    client.saveReady = false;
    if (!room.players.length) rooms.delete(room.code);
    else publish(room);
  }
  const saveKey = game => game.id + ':' + game.romSha256;
  function takeSave(client, game) {
    const key = saveKey(game);
    const entry = client.saves.get(key);
    if (!entry) return null;
    client.saves.delete(key); client.saves.set(key, entry);
    return entry.data;
  }
  function cacheSave(client, game, data) {
    const key = saveKey(game);
    // Count encoded bytes as stored, not only the decoded battery save size.
    client.saves.delete(key); client.saves.set(key, { data, size: data.length });
    let total = [...client.saves.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (client.saves.size > SAVE_CACHE_ENTRIES || total > SAVE_CACHE_BYTES) {
      const oldest = client.saves.keys().next().value;
      total -= client.saves.get(oldest).size;
      client.saves.delete(oldest);
    }
  }
  const selectGame = id => {
    const profile = typeof id === 'string' && catalog.get(id)?.profile;
    if (!profile) throw Error('未知游戏');
    return profile;
  };
  function prepare(room) {
    const session = { id: randomUUID(), ready: new Set(), begun: false, nextFrame: 0, startedAt: Date.now(), progressAt: Date.now(), inputs: new Map(), checksums: new Map(), checkFrame: 300, submitted: new Map(room.players.map(p => [p.id, 0])) };
    room.session = session;
    broadcast(room, { type: 'prepare', session: session.id, count: room.count, gameId: room.game.id, game: room.game, romSha256: room.game.romSha256, romUrl: room.game.romUrl, saves: room.players.map(p => takeSave(p, room.game)) });
    publish(room);
  }
  function handle(client, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') throw Error('消息必须是带 type 的 JSON 对象');
    const room = client.room;
    const validName = name => { if (typeof name !== 'string' || !name.trim() || name.trim().length > 32 || /[\u0000-\u001f]/u.test(name)) throw Error('名字长度应为 1–32 字符'); return name.trim(); };
    if (msg.type === 'ping') {
      if (!(typeof msg.time === 'number' && Number.isFinite(msg.time)) && !(typeof msg.time === 'string' && msg.time.length <= 100)) throw Error('无效 time');
      send(client, { type: 'pong', time: msg.time }); return;
    }
    if (msg.type === 'save') {
      const game = msg.gameId === undefined ? room?.game ?? catalog.defaultGame.profile : selectGame(msg.gameId);
      if (room && game !== room.game) throw Error('存档的游戏与房间不匹配');
      if (msg.romSha256 !== undefined && msg.romSha256 !== game.romSha256) throw Error('存档的 ROM 版本不匹配');
      if (typeof msg.data !== 'string' || msg.data.length > Math.ceil(SAVE_LIMIT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(msg.data)) throw Error('无效电池存档（最大 128KiB）');
      const bytes = Buffer.from(msg.data, 'base64');
      if (bytes.length > SAVE_LIMIT || bytes.toString('base64') !== msg.data) throw Error('无效电池存档');
      cacheSave(client, game, msg.data);
      send(client, { type: 'saved', gameId: game.id, romSha256: game.romSha256, size: bytes.length }); return;
    }
    if (msg.type === 'leave') { leave(client); send(client, { type: 'left' }); return; }
    if ((msg.type === 'create' || msg.type === 'join') && !roomAttempt(client.ip)) throw Error('房间操作过于频繁，请稍后再试');
    if (msg.type === 'create') {
      if (room) throw Error('请先离开当前房间');
      const game = msg.gameId === undefined ? catalog.defaultGame.profile : selectGame(msg.gameId);
      if (!game.players.includes(msg.count)) throw Error('此游戏不支持所选玩家人数');
      if (rooms.size >= 20) throw Error('房间已满');
      const name = validName(msg.name);
      let code; do { code = String(randomInt(0, 1000000)).padStart(6, '0'); } while (rooms.has(code));
      const created = { code, game, count: msg.count, players: [], session: null, chat: [] };
      rooms.set(code, created); enter(created, client, name, msg.syncSaves); return;
    }
    if (msg.type === 'join') {
      if (room) throw Error('请先离开当前房间');
      if (typeof msg.code !== 'string' || !/^\d{6}$/.test(msg.code)) throw Error('无效房间码');
      const target = rooms.get(msg.code), name = validName(msg.name);
      if (!target) throw Error('房间不存在');
      if (msg.gameId !== undefined && msg.gameId !== target.game.id) throw Error('游戏与目标房间不匹配');
      if (target.session || target.players.length >= target.count) throw Error('房间已满或正在游戏');
      enter(target, client, name, msg.syncSaves); return;
    }
    if (!room) throw Error('请先加入房间');
    if (msg.type === 'saveReady') {
      if (msg.gameId !== room.game.id || msg.romSha256 !== room.game.romSha256) throw Error('存档准备的游戏或 ROM 版本不匹配');
      if (!client.saveReady) {
        client.saveReady = true;
        publish(room);
      }
      return;
    }
    if (msg.type === 'chat') {
      if (typeof msg.text !== 'string' || /[\p{Cc}\u2028\u2029]/u.test(msg.text)) throw Error('聊天消息必须是单行文本，且不能含控制字符');
      const text = msg.text.trim();
      if (!text || [...text].length > 300) throw Error('聊天消息须为 1–300 个字符');
      const time = Date.now();
      client.chatTimes = client.chatTimes.filter(previous => time - previous < CHAT_WINDOW_MS);
      if (client.chatTimes.length >= CHAT_LIMIT) throw Error('聊天发送过于频繁，每 5 秒最多 5 条');
      client.chatTimes.push(time);
      const chat = { type: 'chat', room: room.code, id: randomUUID(), senderId: client.id, name: client.name, text, time };
      room.chat.push(chat);
      if (room.chat.length > CHAT_HISTORY_LIMIT) room.chat.shift();
      broadcast(room, chat);
      return;
    }
    if (msg.type === 'start' || msg.type === 'restart') {
      if (room.players[0] !== client) throw Error('只有房主可以开始或重启');
      if (room.players.length !== room.count) throw Error('人数尚未到齐');
      if (room.players.some(player => !player.saveReady)) throw Error('请等待所有玩家完成存档准备');
      if (msg.type === 'restart') {
        if (!room.session || msg.session !== room.session.id) throw Error('无效 session');
        stop(room, '房主重新开始，已释放全部按键');
      } else if (room.session) throw Error('游戏已开始');
      prepare(room); return;
    }
    const session = room.session;
    if (!session || msg.session !== session.id) throw Error('无效 session');
    if (msg.type === 'fatal') {
      if (typeof msg.message !== 'string' || !msg.message.trim() || msg.message.length > 500) throw Error('无效错误信息');
      stop(room, '客户端错误: ' + msg.message); return;
    }
    if (msg.type === 'ready') {
      if (session.begun || session.ready.has(client.id)) throw Error('重复 ready');
      session.ready.add(client.id);
      if (session.ready.size === room.count) { session.begun = true; session.progressAt = Date.now(); broadcast(room, { type: 'begin', session: session.id, delay: inputDelayFrames }); }
      return;
    }
    if (!session.begun) throw Error('请等待所有玩家 ready');
    if (msg.type === 'input') {
      if (!Number.isSafeInteger(msg.frame) || msg.frame !== session.submitted.get(client.id) || msg.frame > session.nextFrame + 180) throw Error('输入帧必须从 0 顺序提交且不得超过 180 帧窗口');
      if (!Number.isInteger(msg.keys) || msg.keys < 0 || msg.keys > 1023) throw Error('无效按键位掩码');
      let inputs = session.inputs.get(msg.frame);
      if (!inputs) { inputs = new Map(); session.inputs.set(msg.frame, inputs); }
      inputs.set(client.id, msg.keys); session.submitted.set(client.id, msg.frame + 1);
      while (session.inputs.get(session.nextFrame)?.size === room.count) {
        const frameNumber = session.nextFrame, all = session.inputs.get(frameNumber);
        broadcast(room, { type: 'tick', session: session.id, frame: frameNumber, keys: room.players.map(p => all.get(p.id)) });
        session.inputs.delete(frameNumber); session.nextFrame++; session.progressAt = Date.now();
        if (session.nextFrame - session.checkFrame > 600) { stop(room, '检测到不同步：校验超时'); break; }
      }
      return;
    }
    if (msg.type === 'checksum') {
      if (!Number.isSafeInteger(msg.frame) || msg.frame !== session.checkFrame || msg.frame > session.nextFrame || typeof msg.digest !== 'string' || !msg.digest.length || msg.digest.length > 128 || session.checksums.has(client.id)) throw Error('无效校验帧或摘要（从 300 帧起每 300 帧）');
      session.checksums.set(client.id, msg.digest);
      if (session.checksums.size === room.count) {
        if (new Set(session.checksums.values()).size !== 1) stop(room, '检测到不同步：各玩家状态校验不一致');
        else { session.checksums.clear(); session.checkFrame += 300; }
      }
      return;
    }
    throw Error('未知消息类型');
  }
  const watchdog = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const session = room.session;
      if (!session) continue;
      if (!session.begun && now - session.startedAt > 30000) stop(room, '玩家加载超时（30秒），请重新开始');
      else if (session.begun && now - session.progressAt > 15000) stop(room, '输入同步超时（15秒无进展），已释放全部按键');
    }
  }, 1000); watchdog.unref();
  return { handle, leave, close: () => clearInterval(watchdog) };
}
