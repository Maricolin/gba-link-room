import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { ROOT } from '../src/server/config.mjs';

async function setup(t, count = 2) {
  const temp = path.join(ROOT, '.tools', 'tmp');
  await mkdir(temp, { recursive: true });
  const dir = await mkdtemp(path.join(temp, 'multigame-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const catalogPath = path.join(dir, 'games.json');
  const games = Array.from({ length: count }, (_, i) => ({ id: 'game-' + i, title: 'Game ' + i, rom: 'rom-' + i + '.gba', players: i === 0 ? [1, 2] : [1], defaultPlayers: 1, link: 'cable', compatibility: 'untested' }));
  for (const [i, game] of games.entries()) await writeFile(path.join(dir, game.rom), Buffer.from([i, 140, 160]));
  await writeFile(catalogPath, JSON.stringify({ version: 1, defaultGameId: 'game-0', games }));
  const app = await createApp({ port: 0, catalogPath, romDirectory: dir });
  t.after(() => app.close());
  const listing = await (await fetch(app.url + '/api/games')).json();
  return { app, games: listing.games };
}
function connect(t, app) {
  const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/ws');
  t.after(() => socket.close());
  const queue = [], pending = [];
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    const index = pending.findIndex(waiter => waiter.type === msg.type);
    if (index < 0) queue.push(msg);
    else pending.splice(index, 1)[0].resolve(msg);
  });
  return {
    queue,
    send(type, fields = {}) { socket.send(JSON.stringify({ type, ...fields })); },
    next(type) {
      const index = queue.findIndex(msg => msg.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Timeout waiting for ' + type)), 2500);
        pending.push({ type, resolve: msg => { clearTimeout(timer); resolve(msg); } });
      });
    },
  };
}

test('rooms bind a single game and save packets never cross game or ROM versions', { timeout: 8000 }, async t => {
  const { app, games: [alpha, beta] } = await setup(t);
  const a = connect(t, app), b = connect(t, app);
  const hello = await a.next('hello'); await b.next('hello');
  assert.equal(hello.defaultGameId, alpha.id); assert.equal(hello.romSha256, alpha.romSha256);
  a.send('create', { name: 'Host', count: 1, gameId: 'not-installed' }); assert.match((await a.next('error')).message, /未知游戏/);
  a.send('create', { name: 'Host', count: 2, gameId: beta.id }); assert.match((await a.next('error')).message, /人数/);
  a.send('save', { gameId: beta.id, romSha256: beta.romSha256, data: 'Qg==' });
  assert.deepEqual(await a.next('saved'), { type: 'saved', gameId: beta.id, romSha256: beta.romSha256, size: 1 });
  a.send('create', { name: 'Host', count: 2 }); const room = await a.next('room');
  assert.equal(room.gameId, alpha.id); assert.deepEqual(room.game, alpha);
  b.send('join', { name: 'Guest', code: room.code, gameId: beta.id }); assert.match((await b.next('error')).message, /不匹配/);
  b.send('join', { name: 'Guest', code: room.code });
  assert.equal((await b.next('room')).gameId, alpha.id); await a.next('room');
  a.send('save', { gameId: beta.id, romSha256: beta.romSha256, data: 'eA==' }); assert.match((await a.next('error')).message, /房间不匹配/);
  a.send('save', { gameId: alpha.id, romSha256: beta.romSha256, data: 'eA==' }); assert.match((await a.next('error')).message, /版本不匹配/);
  a.send('save', { data: 'QQ==' }); assert.equal((await a.next('saved')).gameId, alpha.id);
  a.send('start'); const prepare = await a.next('prepare'); await b.next('prepare');
  assert.deepEqual(prepare.game, alpha); assert.equal(prepare.gameId, alpha.id); assert.equal(prepare.romUrl, alpha.romUrl);
  assert.deepEqual(prepare.saves, ['QQ==', null]);
  a.send('restart', { session: prepare.session, gameId: beta.id });
  const restarted = await a.next('prepare');
  assert.equal(restarted.gameId, alpha.id); assert.deepEqual(restarted.saves, prepare.saves);
  a.send('leave'); await a.next('left');
  a.send('create', { name: 'Host', count: 1, gameId: beta.id }); await a.next('room');
  a.send('save', { gameId: alpha.id, romSha256: alpha.romSha256, data: 'eA==' }); assert.match((await a.next('error')).message, /不匹配/);
  a.send('start'); const other = await a.next('prepare');
  assert.equal(other.gameId, beta.id); assert.equal(other.romSha256, beta.romSha256); assert.equal(other.romUrl, beta.romUrl);
  assert.deepEqual(other.saves, ['Qg==']);
});

test('opted-in members finish loading saves before the host can start', { timeout: 8000 }, async t => {
  const { app, games: [alpha, beta] } = await setup(t);
  const host = connect(t, app), guest = connect(t, app);
  await Promise.all([host.next('hello'), guest.next('hello')]);
  host.send('create', { name: 'Host', count: 2, syncSaves: true });
  const { code, players } = await host.next('room');
  assert.equal(players[0].ready, false);
  const identity = { gameId: alpha.id, romSha256: alpha.romSha256 };
  host.send('saveReady', identity);
  assert.equal((await host.next('room')).players[0].ready, true);
  guest.send('join', { code, name: 'Guest', syncSaves: true });
  await guest.next('room');
  assert.deepEqual((await host.next('room')).players.map(p => p.ready), [true, false]);
  for (const wrong of [{ ...identity, gameId: beta.id }, { ...identity, romSha256: beta.romSha256 }, {}]) {
    guest.send('saveReady', wrong);
    assert.match((await guest.next('error')).message, /不匹配/);
  }
  host.send('start');
  assert.match((await host.next('error')).message, /存档准备/);
  guest.send('save', { ...identity, data: 'Qg==' });
  guest.send('saveReady', identity);
  guest.send('saveReady', identity);
  guest.send('ping', { time: 1 });
  await guest.next('saved'); await guest.next('pong');
  assert.deepEqual((await guest.next('room')).players.map(p => p.ready), [true, true]);
  assert.equal(guest.queue.some(msg => msg.type === 'room'), false);
  assert.deepEqual((await host.next('room')).players.map(p => p.ready), [true, true]);
  host.send('start');
  const prep = await host.next('prepare');
  assert.deepEqual(prep.saves, [null, 'Qg==']);
  host.send('restart', { session: prep.session });
  assert.deepEqual((await host.next('prepare')).saves, [null, 'Qg==']);
  guest.send('leave'); await guest.next('left');
  guest.queue.length = 0;
  guest.send('join', { code, name: 'Guest', syncSaves: true });
  assert.deepEqual((await guest.next('room')).players.map(p => p.ready), [true, false]);
});

test('the per-connection save cache evicts the least recently used game', { timeout: 8000 }, async t => {
  const { app, games } = await setup(t, 9);
  const a = connect(t, app); await a.next('hello');
  const save = async index => {
    a.send('save', { gameId: games[index].id, data: Buffer.from([index]).toString('base64') });
    await a.next('saved');
  };
  const play = async index => {
    a.send('create', { name: 'Tester', count: 1, gameId: games[index].id });
    a.send('start'); const msg = await a.next('prepare');
    a.send('leave'); await a.next('left');
    return msg.saves[0];
  };
  for (let i = 0; i < 8; i++) await save(i);
  assert.equal(await play(0), 'AA==');
  await save(8);
  assert.equal(await play(1), null);
  assert.equal(await play(0), 'AA==');
  assert.equal(await play(8), 'CA==');
});
