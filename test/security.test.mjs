import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { ROOT } from '../src/server/config.mjs';
import { createSecurity } from '../src/server/security.mjs';

const host = 'friends.example.test', origin = 'https://' + host;
const password = 'unit-testing-only ' + randomBytes(16).toString('hex');
const config = { publicMode: true, publicOrigin: origin, accessPassword: password };
const json = { 'Content-Type': 'application/json', Origin: origin };

async function fixture(t, options = config, secretFile = false) {
  const tmp = join(ROOT, '.tools', 'tmp');
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, 'kirby-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const romPath = join(dir, 'test.gba');
  await writeFile(romPath, 'fake GBA');
  if (secretFile) {
    const accessPasswordFile = join(dir, 'password');
    await writeFile(accessPasswordFile, password + '\r\n');
    options = { ...options, accessPassword: undefined, accessPasswordFile };
  }
  const app = await createApp({ port: 0, romPath, config: options });
  t.after(() => app.close());
  return app;
}
function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(app.url, { path, method, agent: false, headers: { Host: host, ...headers } }, res => {
      const parts = []; res.on('data', chunk => parts.push(chunk)); res.on('end', () => {
        const text = Buffer.concat(parts).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      }); res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(2500, () => req.destroy(Error('HTTP test timeout'))); req.end(body);
  });
}
const login = (app, value = password, headers = json) => request(app, '/api/session', { method: 'POST', headers, body: JSON.stringify({ password: value }) });
async function authCookie(app) {
  const res = await login(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { required: true, authenticated: true });
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /^__Host-kirby_session=[a-zA-Z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  assert.equal(res.text.includes(password), false);
  return cookie.split(';')[0];
}
function upgrade(app, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(app.url + '/ws', { agent: false, headers: { Host: host, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...headers } });
    req.on('error', reject); req.setTimeout(2500, () => req.destroy(Error('Upgrade test timeout')));
    req.on('upgrade', (res, socket, head) => {
      socket.on('error', () => {});
      let buffer = head;
      const frames = [], pending = [];
      function parse() {
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 15;
          let size = buffer[1] & 127, offset = 2;
          if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
          if (size === 127) throw Error('Unexpected long test frame');
          if (buffer.length < offset + size) return;
          const frame = { opcode, data: buffer.subarray(offset, offset + size) };
          buffer = buffer.subarray(offset + size);
          const waiter = pending.shift();
          if (waiter) waiter(frame); else frames.push(frame);
        }
      }
      socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); parse(); });
      parse();
      resolve({ status: res.statusCode, socket, next() {
        if (frames.length) return Promise.resolve(frames.shift());
        return new Promise((ready, fail) => {
          const timer = setTimeout(() => fail(Error('WS frame timeout')), 1500);
          pending.push(frame => { clearTimeout(timer); ready(frame); });
        });
      } });
    });
    req.on('response', res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.end();
  });
}
function send(socket, value) {
  const payload = Buffer.from(JSON.stringify(value));
  assert.ok(payload.length < 126);
  const mask = randomBytes(4);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload]));
}

test('public configuration fails closed on noncanonical origins and missing passwords', async () => {
  for (const publicOrigin of [undefined, 'http://friends.test', origin + '/', origin + '?a', origin + '#a', 'https://name@friends.test', 'https://*.test', origin + ':443']) {
    await assert.rejects(createApp({ port: 0, config: { ...config, publicOrigin } }), /PUBLIC_ORIGIN/);
  }
  await assert.rejects(createApp({ config: { ...config, accessPassword: 'too short' } }), /ACCESS_PASSWORD/);
  await assert.rejects(createApp({ config: { ...config, accessPassword: undefined } }), /ACCESS_PASSWORD/);
  await assert.rejects(createApp({ config: { publicMode: 'maybe' } }), /PUBLIC_MODE/);
});

test('public HTTP permits shell and health only before login, with security headers and private metadata', async t => {
  const app = await fixture(t, config, true);
  const index = await request(app, '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-security-policy'], /connect-src 'self' wss:\/\/friends\.example\.test/);
  assert.match(index.headers['content-security-policy'], /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(index.headers['x-frame-options'], 'DENY');
  assert.equal(index.headers['referrer-policy'], 'no-referrer');
  assert.equal(index.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(index.headers['cross-origin-embedder-policy'], 'require-corp');
  assert.deepEqual((await request(app, '/healthz')).json(), { ok: true });
  assert.deepEqual((await request(app, '/api/session')).json(), { required: true, authenticated: false });
  for (const path of ['/api/info', '/game.gba', '/ws', '/api/games', '/api/games/kirby-amazing-mirror-cn/rom']) {
    assert.equal((await request(app, path)).status, 401);
    assert.equal((await request(app, path, { headers: { Cookie: '__Host-kirby_session=' + randomBytes(32).toString('base64url') } })).status, 401);
  }
  for (const path of ['/src/server/config.mjs', '/.env', '/core/package.json', '/data/roms/kirby-amazing-mirror-cn.gba']) assert.equal((await request(app, path)).status, 404);
  assert.equal((await request(app, '/%2e%2e/server.mjs')).status, 403);
  assert.equal((await request(app, '/healthz', { headers: { Host: 'wrong.test', 'X-Forwarded-Host': host } })).status, 403);
  const Cookie = await authCookie(app);
  const res = await request(app, '/api/info', { headers: { Cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.json().addresses, [origin]);
  assert.equal('projectId' in res.json(), false);
  assert.equal(res.json().romName, 'test.gba');
  assert.equal((await request(app, '/game.gba', { headers: { Cookie } })).text, 'fake GBA');
});

test('exact Host and Origin, body limit, and shared socket-IP login rate', async t => {
  const app = await fixture(t);
  for (const Origin of [undefined, 'null', 'http://' + host, origin + '.evil.test']) {
    const headers = Origin === undefined ? { 'Content-Type': 'application/json' } : { ...json, Origin };
    assert.equal((await login(app, password, headers)).status, 403);
  }
  const oversized = 'x'.repeat(1025);
  assert.equal((await request(app, '/api/session', { method: 'POST', headers: { ...json, 'Content-Length': oversized.length }, body: oversized })).status, 413);
  assert.equal((await request(app, '/api/session', { method: 'POST', headers: { ...json, 'Transfer-Encoding': 'chunked' }, body: oversized })).status, 413);
  for (let i = 0; i < 3; i++) assert.equal((await login(app, 'incorrect', { ...json, 'X-Forwarded-For': '198.51.100.' + i })).status, 401);
  assert.equal((await login(app, password, { ...json, 'X-Forwarded-For': '203.0.113.11' })).status, 429);
});

test('logout enforces origin and revokes all sockets for only its cookie', async t => {
  const app = await fixture(t), Cookie = await authCookie(app), otherCookie = await authCookie(app);
  assert.equal((await upgrade(app, { Origin: origin })).status, 401);
  for (const Origin of [undefined, 'null', origin + '/']) assert.equal((await upgrade(app, { Cookie, ...(Origin && { Origin }) })).status, 403);
  const [a, b, c] = await Promise.all([upgrade(app, { Cookie, Origin: origin }), upgrade(app, { Cookie, Origin: origin }), upgrade(app, { Cookie: otherCookie, Origin: origin })]);
  for (const p of [a, b, c]) {
    assert.equal(p.status, 101);
    t.after(() => p.socket.destroy());
    assert.equal(JSON.parse((await p.next()).data).type, 'hello');
  }
  assert.equal((await request(app, '/api/session', { method: 'DELETE', headers: { Cookie } })).status, 403);
  const gone = await request(app, '/api/session', { method: 'DELETE', headers: { Cookie, Origin: origin } });
  assert.deepEqual(gone.json(), { required: true, authenticated: false });
  assert.match(gone.headers['set-cookie'][0], /Max-Age=0; Secure$/);
  for (const p of [a, b]) assert.equal((await p.next()).opcode, 8);
  send(c.socket, { type: 'ping', time: 1 });
  assert.deepEqual(JSON.parse((await c.next()).data), { type: 'pong', time: 1 });
  assert.equal((await request(app, '/game.gba', { headers: { Cookie } })).status, 401);
  assert.equal((await upgrade(app, { Origin: origin, Cookie })).status, 401);
});

test('incomplete login body returns 408 and closes the socket', { timeout: 8000 }, async t => {
  const app = await fixture(t);
  const socket = net.connect(app.port, '127.0.0.1');
  t.after(() => socket.destroy());
  const result = new Promise((resolve, reject) => {
    let text = '';
    socket.on('data', chunk => { text += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(text));
  });
  socket.write('POST /api/session HTTP/1.1\r\nHost: ' + host + '\r\nOrigin: ' + origin + '\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n{');
  const text = await result;
  assert.match(text, /^HTTP\/1\.1 408 /);
  assert.match(text, /\r\nConnection: close\r\n/i);
  assert.equal((await request(app, '/healthz')).status, 200);
});

test('ROM has its own download budget and HEAD does not spend it', async t => {
  const app = await fixture(t);
  const Cookie = await authCookie(app);
  const listing = await request(app, '/api/games', { headers: { Cookie } });
  const url = listing.json().games[0].romUrl;
  assert.equal((await request(app, url, { headers: { Cookie, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request(app, '/api/games', { headers: { Cookie, Origin: 'https://evil.test' } })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await request(app, i % 2 ? url : '/game.gba', { headers: { Cookie } })).status, 200);
  assert.equal((await request(app, '/game.gba', { headers: { Cookie } })).status, 429);
  assert.equal((await request(app, url, { headers: { Cookie } })).status, 429);
  assert.equal((await request(app, '/game.gba', { headers: { Cookie }, method: 'HEAD' })).status, 200);
  assert.equal((await request(app, '/api/info', { headers: { Cookie } })).status, 200);
  const second = await authCookie(app);
  assert.equal((await request(app, '/game.gba', { headers: { Cookie: second } })).status, 200);
});

test('lockstep begin advertises the correct mode default and configured delay', async t => {
  for (const value of [0, 13, 1.5, 'eleven']) await assert.rejects(createApp({ config: { inputDelayFrames: value } }), /INPUT_DELAY_FRAMES/);
  for (const [options, expected] of [[config, 6], [{}, 3], [{ ...config, inputDelayFrames: 12 }, 12], [{ inputDelayFrames: 1 }, 1]]) {
    const app = await fixture(t, options);
    const headers = options.publicMode ? { Cookie: await authCookie(app), Origin: origin } : {};
    const ws = await upgrade(app, headers);
    assert.equal(ws.status, 101); t.after(() => ws.socket.destroy());
    const next = async type => {
      while (true) {
        const msg = JSON.parse((await ws.next()).data);
        if (msg.type === type) return msg;
      }
    };
    await next('hello');
    send(ws.socket, { type: 'create', count: 1, name: 'Tester' }); await next('room');
    send(ws.socket, { type: 'start' });
    const { session } = await next('prepare');
    send(ws.socket, { type: 'ready', session });
    assert.deepEqual(await next('begin'), { type: 'begin', session, delay: expected });
  }
});

test('session store retains at most 256 sessions and tokens expire at 12 hours', t => {
  const now = 1700000000000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const sessions = createSecurity({ publicMode: true, publicOrigin: origin, passwordHash: Buffer.alloc(32) });
  const tokens = Array.from({ length: 256 }, () => sessions.issue());
  assert.equal(new Set(tokens).size, 256);
  assert.equal(sessions.issue(), null);
  t.mock.timers.setTime(now + 43200000 - 1);
  assert.equal(sessions.isActive(tokens[0]), true);
  t.mock.timers.setTime(now + 43200000);
  assert.equal(sessions.isActive(tokens[0]), false);
  assert.ok(sessions.issue());
});

test('LAN upgrade is compatible; WebSocket peer caps and read deadlines release slots', { timeout: 5000 }, async t => {
  const app = await fixture(t, { maxWsPerIp: 1, wsReadTimeoutMs: 100 });
  assert.deepEqual((await request(app, '/api/session')).json(), { required: false, authenticated: true });
  assert.equal((await upgrade(app, { Origin: 'https://wrong.test', 'X-Forwarded-Host': 'wrong.test' })).status, 403);
  const a = await upgrade(app, { Origin: origin });
  assert.equal(a.status, 101); t.after(() => a.socket.destroy());
  await a.next();
  a.socket.write(Buffer.from([0x81]));
  assert.equal((await upgrade(app, { 'X-Forwarded-For': '203.0.113.10' })).status, 429);
  assert.equal((await a.next()).data.readUInt16BE(), 1008);
  const b = await upgrade(app);
  assert.equal(b.status, 101); t.after(() => b.socket.destroy());
  await b.next();
  b.socket.write(Buffer.from([0x01, 0x80, 1, 2, 3, 4]));
  assert.equal((await b.next()).data.readUInt16BE(), 1008);
  const c = await upgrade(app);
  assert.equal(c.status, 101); t.after(() => c.socket.destroy());
  await c.next();
  for (let i = 0; i < 10; i++) {
    send(c.socket, { type: 'join', name: 'guest', code: '000000' });
    assert.match(JSON.parse((await c.next()).data).message, /不存在/);
  }
  send(c.socket, { type: 'create', name: 'guest', count: 1 });
  assert.match(JSON.parse((await c.next()).data).message, /过于频繁/);
});
