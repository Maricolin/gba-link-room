import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { peerIp } from './security.mjs';

const FRAME_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 200 * 1024;
const BUFFER_LIMIT = 2 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
function frame(opcode, payload = Buffer.alloc(0), fin = true) {
  const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10);
  header[0] = (fin ? 128 : 0) | opcode;
  if (header.length === 2) header[1] = payload.length;
  else if (header.length === 4) { header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}

export function attachWebSocket(server, { config, security, rooms, defaultGame, acceptSocket }) {
  const clients = new Set(), perIp = new Map();
  let closing = false;
  function send(client, data) {
    if (client.closed || client.socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify(data));
    if (client.socket.writableLength + payload.length > BUFFER_LIMIT) {
      if (!client.overloaded) { client.overloaded = true; queueMicrotask(() => client.shutdown(1008, '发送缓冲区超限')); }
      return;
    }
    for (let offset = 0; offset < payload.length; offset += FRAME_LIMIT) {
      const end = Math.min(offset + FRAME_LIMIT, payload.length);
      client.socket.write(frame(offset === 0 ? 1 : 0, payload.subarray(offset, end), end === payload.length));
    }
  }
  server.on('upgrade', (req, socket, head) => {
    const reject = (status, error) => {
      const body = JSON.stringify({ error });
      socket.setTimeout(1000, () => socket.destroy());
      socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    };
    if (!acceptSocket(socket)) { socket.destroy(); return; }
    const ip = peerIp(socket);
    if (closing || clients.size >= 80) { reject('503 Service Unavailable', '连接已满'); return; }
    if (!security.hostAllowed(req) || !security.originAllowed(req)) { reject('403 Forbidden', '站点来源不允许'); return; }
    if (!security.wsAttempt(ip) || (perIp.get(ip) || 0) >= config.maxWsPerIp) { reject('429 Too Many Requests', '连接过于频繁或已满'); return; }
    const auth = security.session(req);
    if (security.required && !auth) { reject('401 Unauthorized', '请先登录'); return; }
    const key = req.headers['sec-websocket-key'];
    if (req.method !== 'GET' || req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers.connection?.toLowerCase().split(/\s*,\s*/).includes('upgrade') || req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || Buffer.from(key, 'base64').toString('base64') !== key || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) { reject('400 Bad Request', '无效 WebSocket 请求'); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true); socket.setTimeout(0);
    const client = { id: randomUUID(), socket, ip, auth, room: null, saves: new Map(), chatTimes: [], closed: false, lastPong: Date.now(), tokens: 600, tokenTime: Date.now(), byteTokens: 1024 * 1024, frameTokens: 1200 };
    clients.add(client);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    let buffer = Buffer.alloc(0), fragments = [], fragmentBytes = 0, fragmenting = false;
    let readTimer;
    const clearReadDeadline = () => { clearTimeout(readTimer); readTimer = undefined; };
    const armReadDeadline = () => {
      if (!readTimer) { readTimer = setTimeout(() => client.shutdown(1008, 'WebSocket 读取超时'), config.wsReadTimeoutMs); readTimer.unref(); }
    };
    const cleanup = () => {
      if (client.closed) return;
      client.closed = true; clients.delete(client); clearReadDeadline();
      const remaining = perIp.get(ip) - 1;
      if (remaining) perIp.set(ip, remaining); else perIp.delete(ip);
      rooms.leave(client);
    };
    client.shutdown = (code = 1000, reason = '') => {
      if (client.closed) return;
      const payload = Buffer.alloc(2); payload.writeUInt16BE(code);
      socket.end(frame(8, Buffer.concat([payload, Buffer.from(reason).subarray(0, 123)])));
      cleanup(); const timer = setTimeout(() => socket.destroy(), 1000); timer.unref();
    };
    socket.on('error', cleanup); socket.on('end', () => { cleanup(); socket.end(); }); socket.on('close', cleanup);
    function consume(chunk) {
      if (client.closed) return;
      if (auth && !security.isActive(auth)) { client.shutdown(1008, '登录会话已结束'); return; }
      const now = Date.now(), elapsed = (now - client.tokenTime) / 1000; client.tokenTime = now;
      client.tokens = Math.min(600, client.tokens + elapsed * 240);
      client.frameTokens = Math.min(1200, client.frameTokens + elapsed * 480);
      client.byteTokens = Math.min(1024 * 1024, client.byteTokens + elapsed * 256 * 1024) - chunk.length;
      if (client.byteTokens < 0 || buffer.length + chunk.length > 2 * MESSAGE_LIMIT + 14) { client.shutdown(1009, '接收缓冲区超限'); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) armReadDeadline();
      while (buffer.length >= 2 && !client.closed) {
        const first = buffer[0], second = buffer[1], opcode = first & 15, fin = !!(first & 128);
        let length = second & 127, offset = 2;
        if (first & 112 || !(second & 128) || ![0, 1, 8, 9, 10].includes(opcode)) { client.shutdown(1002, '无效 WebSocket 帧'); return; }
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; if (length < 126) { client.shutdown(1002); return; } }
        else if (length === 127) { if (buffer.length < 10) return; const large = buffer.readBigUInt64BE(2); if (large < 65536n) { client.shutdown(1002); return; } if (large >= (1n << 63n)) { client.shutdown(1002); return; } if (large > BigInt(MESSAGE_LIMIT)) { client.shutdown(1009); return; } length = Number(large); offset = 10; }
        if (opcode >= 8 && (!fin || length > 125)) { client.shutdown(1002); return; }
        if (buffer.length < offset + 4 + length) return;
        if (--client.frameTokens < 0) { client.shutdown(1008, '帧频率超限'); return; }
        const mask = buffer.subarray(offset, offset + 4), payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
        for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
        buffer = buffer.subarray(offset + 4 + length);
        if (opcode === 8) {
          if (length === 1) { client.shutdown(1002); return; }
          if (length >= 2) { const code = payload.readUInt16BE(0); if (!(code >= 3000 && code <= 4999) && ![1000,1001,1002,1003,1007,1008,1009,1010,1011,1012,1013,1014].includes(code)) { client.shutdown(1002); return; } try { utf8.decode(payload.subarray(2)); } catch { client.shutdown(1007); return; } }
          socket.end(frame(8, payload)); cleanup(); return;
        }
        if (!fragmenting && opcode !== 0 && (opcode !== 1 || fin)) {
          clearReadDeadline(); if (buffer.length) armReadDeadline();
        }
        if (opcode === 9) { socket.write(frame(10, payload)); continue; }
        if (opcode === 10) { client.lastPong = Date.now(); continue; }
        if ((opcode === 0 && !fragmenting) || (opcode === 1 && fragmenting)) { client.shutdown(1002); return; }
        fragments.push(payload); fragmentBytes += length;
        if (fragmentBytes > MESSAGE_LIMIT || fragments.length > 256) { client.shutdown(1009, '消息最大 200KiB'); return; }
        fragmenting = !fin;
        if (!fin) continue;
        clearReadDeadline(); if (buffer.length) armReadDeadline();
        const messageBytes = fragmentBytes;
        let text;
        try { text = utf8.decode(Buffer.concat(fragments, fragmentBytes)); } catch { client.shutdown(1007); return; }
        fragments = []; fragmentBytes = 0;
        let message;
        try { message = JSON.parse(text); }
        catch {
          if (messageBytes > FRAME_LIMIT) { client.shutdown(1009, '非存档消息最大 64KiB'); return; }
          if (--client.tokens < 0) { client.shutdown(1008, '消息频率超限'); return; }
          send(client, { type: 'error', message: '无效 JSON' }); continue;
        }
        // Browser WebSocket.send() cannot select frame boundaries for large saves.
        if (messageBytes > FRAME_LIMIT && message?.type !== 'save') { client.shutdown(1009, '非存档消息最大 64KiB'); return; }
        // Keep chat out of the game message budget; wire-level byte/frame limits still apply.
        if (message?.type !== 'chat' && --client.tokens < 0) { client.shutdown(1008, '消息频率超限'); return; }
        try { rooms.handle(client, message); }
        catch (error) { send(client, { type: 'error', message: error.message }); }
      }
    }
    socket.on('data', consume);
    send(client, { type: 'hello', id: client.id, romSha256: defaultGame.romSha256, defaultGameId: defaultGame.id });
    if (head.length) consume(head);
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.auth && !security.isActive(client.auth)) client.shutdown(1008, '登录会话已结束');
      else if (Date.now() - client.lastPong > 60000) client.shutdown(1001, '心跳超时');
      else if (client.socket.writableLength > BUFFER_LIMIT) client.shutdown(1008, '缓冲区超限');
      else client.socket.write(frame(9, randomBytes(4)));
    }
  }, 20000); heartbeat.unref();
  return { send, revoke(token) { for (const client of clients) if (client.auth === token) client.shutdown(1008, '登录会话已结束'); }, close() { closing = true; clearInterval(heartbeat); for (const client of [...clients]) client.shutdown(1001, '服务器关闭'); } };
}
