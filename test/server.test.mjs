import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = { timeout: 10000 };
function wire(opcode, payload = Buffer.alloc(0), fin = true, masked = true) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  const size = payload.length, extra = size < 126 ? 0 : size < 65536 ? 2 : 8;
  const header = Buffer.alloc(2 + extra + (masked ? 4 : 0));
  header[0] = (fin ? 128 : 0) | opcode;
  header[1] = (masked ? 128 : 0) | (extra === 0 ? size : extra === 2 ? 126 : 127);
  if (extra === 2) header.writeUInt16BE(size, 2);
  if (extra === 8) header.writeBigUInt64BE(BigInt(size), 2);
  const data = Buffer.from(payload);
  if (masked) { const mask = randomBytes(4); mask.copy(header, 2 + extra); for (let i = 0; i < size; i++) data[i] ^= mask[i % 4]; }
  return Buffer.concat([header, data]);
}
async function peer(port, origin) {
  const socket = net.connect(port, '127.0.0.1');
  const queue = [], waiters = [];
  let buffer = Buffer.alloc(0), upgraded = false, parts = [], closed = false;
  const emit = value => {
    const index = waiters.findIndex(w => w.type === value.type && w.predicate(value));
    if (index < 0) queue.push(value);
    else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(value); }
  };
  const wait = (type, predicate = () => true) => {
    const index = queue.findIndex(value => value.type === type && predicate(value));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    if (closed) return Promise.reject(Error('Socket closed waiting for ' + type));
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve, reject, timer: setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); reject(Error('Timed out waiting for ' + type)); }, 4000) };
      waiters.push(waiter);
    });
  };
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const index = buffer.indexOf('\r\n\r\n'); if (index < 0) return;
      const header = buffer.subarray(0, index).toString(); buffer = buffer.subarray(index + 4);
      emit({ type: 'upgrade', status: Number(header.split(' ')[1]) }); upgraded = header.includes(' 101 ');
      if (!upgraded) return;
    }
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15, fin = !!(buffer[0] & 128); let length = buffer[1] & 127, offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) return;
      const data = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
      if (opcode === 9) { socket.write(wire(10, data)); continue; }
      if (opcode === 10) { emit({ type: 'controlPong', data: data.toString() }); continue; }
      if (opcode === 8) { emit({ type: 'close', code: data.length >= 2 ? data.readUInt16BE(0) : 1005 }); socket.end(); continue; }
      parts.push(data);
      if (fin) { emit(JSON.parse(Buffer.concat(parts).toString())); parts = []; }
    }
  });
  socket.on('close', () => { closed = true; for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(Error('Socket closed waiting for ' + w.type)); } });
  socket.on('error', () => {});
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + randomBytes(16).toString('base64') + '\r\n' + (origin ? 'Origin: ' + origin + '\r\n' : '') + '\r\n');
  const upgrade = await wait('upgrade');
  return { socket, wait, queue, status: upgrade.status,
    send(value) { const data = Buffer.from(JSON.stringify(value)); const packets = []; for (let i = 0; i < data.length; i += 65536) packets.push(wire(i ? 0 : 1, data.subarray(i, i + 65536), i + 65536 >= data.length)); socket.write(Buffer.concat(packets)); },
    raw(opcode, data, fin = true, masked = true) { socket.write(wire(opcode, data, fin, masked)); },
    destroy() { socket.destroy(); }
  };
}
async function fixture(t) {
  const tempRoot = path.join(ROOT, '.tools', 'tmp');
  await mkdir(tempRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tempRoot, 'kirby-server-'));
  const rom = Buffer.from('test GBA ROM'), romPath = path.join(directory, 'test.gba');
  await writeFile(romPath, rom);
  const app = await createApp({ port: 0, romPath });
  const peers = [];
  t.after(async () => { for (const p of peers) p.destroy(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, rom, async connect(origin) { const p = await peer(app.port, origin); peers.push(p); if (p.status === 101) p.hello = await p.wait('hello'); return p; } };
}
function get(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) })); }); req.on('error', reject); req.end(); });
}
async function roomFor(app, count = 2) {
  const players = [];
  for (let i = 0; i < count; i++) players.push(await app.connect());
  const host = players[0]; host.send({ type: 'create', count, name: 'Host' });
  const room = await host.wait('room');
  for (let i = 1; i < count; i++) { players[i].send({ type: 'join', code: room.code, name: 'Player ' + i }); await players[i].wait('room'); }
  return { players, host, code: room.code };
}
async function start(players) {
  players[0].send({ type: 'start' });
  const prepared = await Promise.all(players.map(p => p.wait('prepare')));
  const session = prepared[0].session;
  for (const p of players) p.send({ type: 'ready', session });
  const began = await Promise.all(players.map(p => p.wait('begin')));
  assert.ok(began.every(b => b.session === session && b.delay === 3));
  return session;
}

test('HTTP serves metadata, original ROM, public assets only, and rejects traversal', options, async t => {
  const app = await fixture(t), response = await get(app.port, '/api/info');
  assert.equal(response.status, 200);
  const info = JSON.parse(response.data);
  assert.equal(info.romName, 'test.gba'); assert.equal(info.romSize, app.rom.length);
  assert.equal(info.romSha256, createHash('sha256').update(app.rom).digest('hex'));
  assert.ok(Array.isArray(info.addresses));
  assert.equal(info.appId, 'kirby-lan-netplay');
  assert.equal(info.version, JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(info.projectId, createHash('sha256').update(ROOT).digest('hex'));
  assert.notEqual(info.projectId, info.romSha256);
  const game = await get(app.port, '/game.gba'); assert.equal(game.status, 200); assert.deepEqual(game.data, app.rom);
  assert.equal((await get(app.port, '/game.gba', 'HEAD')).data.length, 0);
  assert.equal((await get(app.port, '/server.mjs')).status, 404);
  for (const pathname of ['/../server.mjs', '/%2e%2e/package.json', '/%2e%2e%5cserver.mjs', '/%00']) assert.equal((await get(app.port, pathname)).status, 403);
  assert.equal((await get(app.port, '/%ZZ')).status, 400);
  assert.equal((await get(app.port, '/api/info', 'POST')).status, 405);
  for (const [url, file] of [['/', 'index.html'], ['/js/app.js', 'js/app.js'], ['/css/base.css', 'css/base.css']]) {
    const asset = await get(app.port, url);
    assert.equal(asset.status, 200);
    assert.deepEqual(asset.data, await readFile(path.join(ROOT, 'public', file)));
  }
});

test('chat stays in its room and trusts only connection identity', options, async t => {
  const app = await fixture(t), a = await app.connect(), b = await app.connect(), outsider = await app.connect();
  outsider.send({ type: 'chat', text: 'not in a room' });
  assert.match((await outsider.wait('error')).message, /加入房间/);
  a.send({ type: 'create', count: 2, name: 'Alice' });
  a.send({ type: 'ping', time: 1 }); await a.wait('pong');
  assert.deepEqual(a.queue.map(message => message.type), ['room', 'chatHistory']);
  const room = await a.wait('room');
  assert.deepEqual(await a.wait('chatHistory'), { type: 'chatHistory', room: room.code, messages: [] });
  outsider.send({ type: 'create', count: 1, name: 'Other room' });
  const other = await outsider.wait('room'); await outsider.wait('chatHistory');
  b.send({ type: 'join', code: room.code, name: 'Bob' });
  b.send({ type: 'ping', time: 2 }); await b.wait('pong');
  assert.deepEqual(b.queue.map(message => message.type), ['room', 'chatHistory']);
  await b.wait('room'); await b.wait('chatHistory'); await a.wait('room');
  assert.equal(a.queue.some(message => message.type === 'chatHistory'), false);
  const text = '<b>大家好</b> 🌈';
  const before = Date.now();
  b.send({ type: 'chat', text: '  ' + text + ' ', room: other.code, id: 'fake', senderId: a.hello.id, name: 'Alice', time: -1 });
  const received = await a.wait('chat');
  assert.deepEqual(received, { type: 'chat', room: room.code, id: received.id, senderId: b.hello.id, name: 'Bob', text, time: received.time });
  assert.match(received.id, /^[a-f0-9-]{36}$/);
  assert.ok(received.time >= before && received.time <= Date.now());
  assert.deepEqual(await b.wait('chat'), received);
  outsider.send({ type: 'ping', time: 3 }); await outsider.wait('pong');
  assert.equal(outsider.queue.some(message => message.type === 'chat'), false);
  b.send({ type: 'leave' }); await b.wait('left'); await a.wait('room');
  a.send({ type: 'chat', text: 'after leave' }); await a.wait('chat');
  b.send({ type: 'chat', text: 'left' }); await b.wait('error');
  assert.equal(b.queue.some(message => message.type === 'chat'), false);
});

test('chat limits Unicode and sending rate without blocking input', options, async t => {
  const now = Date.now(); t.mock.timers.enable({ apis: ['Date'], now });
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players;
  const valid = '😀'.repeat(300);
  for (const invalid of [null, 12, '', '  ', valid + '中', '\0abc', 'abc\t', 'A\nB', '\rA', 'A\x7f', 'A\u2028B']) {
    a.send({ type: 'chat', text: invalid }); assert.match((await a.wait('error')).message, /聊天消息/);
  }
  a.send({ type: 'start' }); const preparation = await a.wait('prepare'); await b.wait('prepare');
  a.send({ type: 'chat', text: '  ' + valid + '  ' });
  assert.equal((await b.wait('chat')).text, valid); await a.wait('chat');
  const session = preparation.session;
  for (const p of players) p.send({ type: 'ready', session }); await a.wait('begin'); await b.wait('begin');
  for (let i = 0; i < 4; i++) {
    a.send({ type: 'chat', text: 'running ' + i }); assert.equal((await a.wait('chat')).text, 'running ' + i);
  }
  a.send({ type: 'chat', text: 'blocked' }); assert.match((await a.wait('error')).message, /过于频繁/);
  b.send({ type: 'chat', text: 'own quota' }); assert.equal((await a.wait('chat')).text, 'own quota');
  a.send({ type: 'input', session, frame: 0, keys: 1 }); b.send({ type: 'input', session, frame: 0, keys: 4 });
  assert.deepEqual((await a.wait('tick')).keys, [1, 4]);
  t.mock.timers.setTime(now + 4999);
  a.send({ type: 'chat', text: 'still blocked' }); assert.match((await a.wait('error')).message, /过于频繁/);
  t.mock.timers.setTime(now + 5000);
  a.send({ type: 'chat', text: 'quota restored' }); assert.equal((await a.wait('chat')).text, 'quota restored');
});

test('chat history is capped, survives restart, and is discarded with the room', options, async t => {
  const now = Date.now(); t.mock.timers.enable({ apis: ['Date'], now });
  const app = await fixture(t), { players, code } = await roomFor(app), [a, b] = players;
  await a.wait('chatHistory'); await b.wait('chatHistory');
  const chats = [];
  for (let i = 0; i < 55; i++) {
    t.mock.timers.setTime(now + Math.floor(i / 5) * 5000);
    a.send({ type: 'chat', text: '😀'.repeat(298) + String(i).padStart(2, '0') });
    chats.push(await a.wait('chat'));
  }
  assert.equal(new Set(chats.map(chat => chat.id)).size, 55);
  const session = await start(players);
  a.send({ type: 'restart', session }); await a.wait('stopped'); await a.wait('prepare'); await b.wait('prepare');
  b.send({ type: 'leave' }); await b.wait('left');
  b.send({ type: 'join', name: 'Back', code });
  await b.wait('room');
  assert.deepEqual(await b.wait('chatHistory'), { type: 'chatHistory', room: code, messages: chats.slice(-50) });
  a.send({ type: 'ping', time: 1 }); await a.wait('pong');
  assert.equal(a.queue.some(message => message.type === 'chatHistory'), false);
  for (const p of [b, a]) { p.send({ type: 'leave' }); await p.wait('left'); }
  b.send({ type: 'join', name: 'Back', code }); assert.match((await b.wait('error')).message, /不存在/);
  b.send({ type: 'create', name: 'Back', count: 1 });
  const room = await b.wait('room', state => state.count === 1);
  assert.deepEqual(await b.wait('chatHistory'), { type: 'chatHistory', room: room.code, messages: [] });
});

test('missing ROM fails before server starts', options, async () => {
  await assert.rejects(createApp({ port: 0, romPath: path.join(os.tmpdir(), 'nonexistent-rom-' + randomBytes(8).toString('hex')) }), /ROM 加载失败/);
});

test('same-origin upgrade, invalid JSON, fragment/ping interleave, masking and close', options, async t => {
  const app = await fixture(t);
  const denied = await app.connect('http://evil.example'); assert.equal(denied.status, 403);
  const p = await app.connect(app.url); assert.match(p.hello.id, /^[0-9a-f-]{36}$/);
  p.raw(1, '{broken'); assert.match((await p.wait('error')).message, /JSON/);
  p.raw(1, '{"type":"pi', false); p.raw(9, 'probe'); p.raw(0, 'ng","time":123}');
  assert.equal((await p.wait('controlPong')).data, 'probe'); assert.equal((await p.wait('pong')).time, 123);
  p.raw(1, '{}', true, false); assert.equal((await p.wait('close')).code, 1002);
  const closePeer = await app.connect(); closePeer.raw(8, Buffer.from([3, 232])); assert.equal((await closePeer.wait('close')).code, 1000);
});

test('room validates count, fullness, permissions and starts only after every ready', options, async t => {
  const app = await fixture(t), host = await app.connect(), guest = await app.connect();
  host.send({ type: 'create', name: 'Host', count: 5 }); await host.wait('error');
  host.send({ type: 'create', name: 'Host', count: 2 }); const room = await host.wait('room'); assert.match(room.code, /^\d{6}$/);
  host.send({ type: 'start' }); assert.match((await host.wait('error')).message, /人数/);
  guest.send({ type: 'join', code: room.code, name: 'Guest' }); const joined = await guest.wait('room');
  assert.deepEqual(joined.players.map(p => p.slot), [0, 1]); assert.equal(joined.host, host.hello.id);
  guest.send({ type: 'start' }); assert.match((await guest.wait('error')).message, /房主/);
  const third = await app.connect(); third.send({ type: 'join', code: room.code, name: 'Third' }); await third.wait('error');
  host.send({ type: 'start' }); const prepare = await host.wait('prepare'); await guest.wait('prepare'); assert.deepEqual(prepare.saves, [null, null]);
  host.send({ type: 'ready', session: prepare.session });
  host.send({ type: 'input', session: prepare.session, frame: 0, keys: 1 }); assert.match((await host.wait('error')).message, /ready/);
  guest.send({ type: 'ready', session: prepare.session }); await host.wait('begin'); await guest.wait('begin');
});

test('lockstep ticks wait for every slot, enforce ordering, reject forged slot and stale session', options, async t => {
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players, session = await start(players);
  a.send({ type: 'input', session, frame: 0, keys: 1, slot: 1 });
  a.send({ type: 'ping', time: 0 }); await a.wait('pong'); assert.equal(a.queue.filter(x => x.type === 'tick').length, 0);
  b.send({ type: 'input', session, frame: 0, keys: 2, slot: 0 });
  const ticks = await Promise.all(players.map(p => p.wait('tick'))); assert.deepEqual(ticks[0], { type: 'tick', session, frame: 0, keys: [1, 2] });
  a.send({ type: 'input', session, frame: 0, keys: 0 }); await a.wait('error');
  a.send({ type: 'input', session, frame: 2, keys: 0 }); await a.wait('error');
  b.send({ type: 'input', session: 'stale', frame: 1, keys: 0 }); await b.wait('error');
  a.send({ type: 'input', session, frame: 1, keys: 1024 }); await a.wait('error');
  for (const p of players) p.send({ type: 'input', session, frame: 1, keys: 0 });
  assert.deepEqual((await a.wait('tick')).keys, [0, 0]);
});

test('disconnect stops session, releases seat, renumbers slots and transfers host', options, async t => {
  const app = await fixture(t), { players, code } = await roomFor(app, 3), session = await start(players), [a, b, c] = players;
  a.send({ type: 'input', session, frame: 0, keys: 1023 }); a.destroy();
  assert.match((await b.wait('stopped')).reason, /离开/);
  const room = await b.wait('room', x => x.players.length === 2);
  assert.equal(room.running, false); assert.equal(room.host, b.hello.id); assert.deepEqual(room.players.map(p => p.slot), [0, 1]);
  c.send({ type: 'input', session, frame: 0, keys: 1 }); await c.wait('error');
  const replacement = await app.connect(); replacement.send({ type: 'join', code, name: 'Replacement' }); assert.equal((await replacement.wait('room')).players.length, 3);
  const next = await start([b, c, replacement]); assert.notEqual(next, session);
  for (const p of [b, c, replacement]) p.send({ type: 'input', session: next, frame: 0, keys: 0 });
  assert.deepEqual((await b.wait('tick')).keys, [0, 0, 0]);
});

test('battery saves are private per connection, survive restart, and reject oversized/invalid base64', options, async t => {
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players;
  const data = Buffer.alloc(128 * 1024, 7).toString('base64');
  a.raw(1, JSON.stringify({ type: 'save', data, slot: 1 })); assert.equal((await a.wait('saved')).size, 128 * 1024);
  b.send({ type: 'save', data: '%%%' }); await b.wait('error');
  b.send({ type: 'save', data: Buffer.alloc(128 * 1024 + 1).toString('base64') }); await b.wait('error');
  a.send({ type: 'start' }); const prepared = await a.wait('prepare'); await b.wait('prepare'); assert.deepEqual(prepared.saves, [data, null]);
  for (const p of players) p.send({ type: 'ready', session: prepared.session }); await a.wait('begin'); await b.wait('begin');
  b.send({ type: 'save', data: 'AQI=' }); await b.wait('saved');
  b.send({ type: 'restart', session: prepared.session }); await b.wait('error');
  a.send({ type: 'restart', session: prepared.session }); await a.wait('stopped');
  const restarted = await a.wait('prepare'); await b.wait('prepare'); assert.notEqual(restarted.session, prepared.session); assert.deepEqual(restarted.saves, [data, 'AQI=']);
  for (const p of players) p.send({ type: 'ready', session: restarted.session }); await a.wait('begin'); await b.wait('begin');
  for (const p of players) p.send({ type: 'input', session: restarted.session, frame: 0, keys: 0 }); assert.equal((await a.wait('tick')).frame, 0);
});

test('checksum disagreement stops entire room and fatal permits fresh start', options, async t => {
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players, session = await start(players);
  for (let frame = 0; frame < 300; frame++) { a.send({ type: 'input', session, frame, keys: 0 }); b.send({ type: 'input', session, frame, keys: 0 }); if (frame % 60 === 59) await a.wait('tick', tick => tick.frame === frame); }
  await b.wait('tick', tick => tick.frame === 299);
  a.send({ type: 'checksum', session, frame: 300, digest: 'aaaa' }); b.send({ type: 'checksum', session, frame: 300, digest: 'bbbb' });
  assert.match((await a.wait('stopped')).reason, /^检测到不同步/); await b.wait('stopped');
  const next = await start(players); a.send({ type: 'fatal', session: next, message: 'Core failed' }); assert.match((await b.wait('stopped')).reason, /Core failed/);
});

test('input lookahead is bounded to nextFrame plus 180', options, async t => {
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players, session = await start(players);
  for (let frame = 0; frame <= 180; frame++) a.send({ type: 'input', session, frame, keys: 1 });
  a.send({ type: 'input', session, frame: 181, keys: 1 });
  assert.match((await a.wait('error')).message, /180/);
  b.send({ type: 'input', session, frame: 0, keys: 2 }); await a.wait('tick');
  a.send({ type: 'input', session, frame: 181, keys: 1 });
  a.send({ type: 'ping', time: 181 }); await a.wait('pong');
  assert.equal(a.queue.filter(x => x.type === 'error').length, 0);
});

test('prepare and running sessions recover after load or input timeout', options, async t => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players;
  a.send({ type: 'start' }); await a.wait('prepare'); await b.wait('prepare');
  t.mock.timers.setTime(now + 31000);
  assert.match((await a.wait('stopped')).reason, /加载超时/); await b.wait('stopped');
  const session = await start(players);
  t.mock.timers.setTime(now + 47000);
  assert.match((await a.wait('stopped')).reason, /输入同步超时/);
  a.send({ type: 'input', session, frame: 0, keys: 0 }); await a.wait('error');
});

test('leave during prepare stops everyone and frame/message limits close offending peer', options, async t => {
  const app = await fixture(t), { players } = await roomFor(app), [a, b] = players;
  a.send({ type: 'start' }); await a.wait('prepare'); await b.wait('prepare'); b.send({ type: 'leave' }); await a.wait('stopped'); await b.wait('left');
  const room = await a.wait('room', x => x.players.length === 1); assert.equal(room.running, false);
  const p = await app.connect(); p.raw(1, Buffer.alloc(65537, 32)); assert.equal((await p.wait('close')).code, 1009);
  const fragmented = await app.connect(); fragmented.raw(1, Buffer.alloc(65536, 32), false); fragmented.raw(0, Buffer.alloc(65536, 32), false); fragmented.raw(0, Buffer.alloc(65536, 32), false); fragmented.raw(0, Buffer.alloc(10000, 32)); assert.equal((await fragmented.wait('close')).code, 1009);
});
