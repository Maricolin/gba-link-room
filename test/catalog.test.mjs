import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/server/config.mjs';
import { loadCatalog } from '../src/server/games.mjs';
import { createApp } from '../server.mjs';

const base = { id: 'alpha', title: '测试甲', rom: 'one.gba', players: [1, 3], defaultPlayers: 1, compatibility: 'core-tested', link: 'cable', labels: { a: '跳跃' } };
const second = { ...base, id: 'bravo', rom: 'nested/two.gba', players: [2], defaultPlayers: 2, compatibility: 'untested' };
const rom1 = Buffer.from([1, 5, 9]), rom2 = Buffer.from([4, 6, 11, 18]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function setup(t) {
  const temp = path.join(ROOT, '.tools', 'tmp');
  await mkdir(temp, { recursive: true });
  const dir = await mkdtemp(path.join(temp, 'catalog-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const romDirectory = path.join(dir, 'roms'), catalogPath = path.join(dir, 'games.json');
  await mkdir(path.join(romDirectory, 'nested'), { recursive: true });
  await writeFile(path.join(romDirectory, 'one.gba'), rom1);
  await writeFile(path.join(romDirectory, 'nested', 'two.gba'), rom2);
  const manifest = async (games = [base, second], defaultGameId = 'alpha') => writeFile(catalogPath, JSON.stringify({ version: 1, defaultGameId, games }));
  await manifest();
  return { dir, romDirectory, catalogPath, manifest };
}

test('catalog projects enabled games and streams the intended ROM, refusing changed files', async t => {
  const options = await setup(t);
  await options.manifest([base, second, { id: 'template', enabled: false }], 'bravo');
  const app = await createApp({ ...options, port: 0 });
  t.after(() => app.close());
  const get = (url, method = 'GET') => fetch(app.url + url, { method });
  const listing = await (await get('/api/games')).json();
  assert.equal(listing.defaultGameId, 'bravo');
  const info = await (await get('/api/info')).json();
  assert.equal(info.defaultGameId, 'bravo'); assert.equal(info.gameCount, 2); assert.equal(info.romSha256, sha(rom2)); assert.equal(info.romName, 'two.gba');
  assert.deepEqual(listing.games.map(game => [game.id, game.players, game.romSha256]), [['alpha', [1, 3], sha(rom1)], ['bravo', [2], sha(rom2)]]);
  for (const game of listing.games) {
    assert.equal('rom' in game, false); assert.equal('filename' in game, false); assert.equal(game.romUrl, '/api/games/' + game.id + '/rom');
    const head = await get(game.romUrl, 'HEAD'); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), game.romSize); assert.equal(await head.text(), '');
  }
  assert.equal((await get('/api/games', 'HEAD')).status, 200);
  assert.deepEqual(Buffer.from(await (await get('/game.gba')).arrayBuffer()), rom2);
  assert.deepEqual(Buffer.from(await (await get(listing.games[0].romUrl)).arrayBuffer()), rom1);
  for (const url of ['/api/games/template/rom', '/api/games/unknown/rom', '/api/games/nested/two.gba/rom', '/api/games/one.gba/rom']) assert.equal((await get(url)).status, 404);
  assert.equal((await get('/api/games/%2e%2e%2ffoo/rom')).status, 403);
  await writeFile(path.join(options.romDirectory, 'nested', 'two.gba'), Buffer.from([8, 8, 8, 8]));
  for (const url of ['/game.gba', '/api/games/bravo/rom']) assert.equal((await get(url)).status, 503);
  assert.deepEqual(Buffer.from(await (await get(listing.games[0].romUrl)).arrayBuffer()), rom1);
});

test('single-player profiles reject multiplayer configuration',async t=>{const options=await setup(t);await options.manifest([{...base,link:'none',players:[1],defaultPlayers:1}]);const catalog=await loadCatalog(options);assert.equal(catalog.defaultGame.profile.link,'none');assert.deepEqual(catalog.defaultGame.profile.players,[1]);await options.manifest([{...base,link:'none',players:[1,2],defaultPlayers:1}]);await assert.rejects(loadCatalog(options),/单人游戏/);});

test('catalog fails closed for malformed rows and missing, empty or oversized ROMs', async t => {
  const options = await setup(t);
  for (const row of [{ id: 'Upper_Case' }, { players: [1, 1] }, { defaultPlayers: 4 }, { players: [0] }, { link: 'wireless' }, { compatibility: 'certified' }, { title: 'x'.repeat(101) }, { labels: { foo: 'x' } }, { labels: { a: '😀'.repeat(33) } }, { enabled: 'false' }]) {
    await options.manifest([{ ...base, ...row }]);
    await assert.rejects(loadCatalog(options), /游戏目录/);
  }
  for (const games of [[], [base, { ...base, enabled: false }], [{ ...base, enabled: false }], Array.from({ length: 65 }, (_, i) => ({ ...base, id: 'game-' + i }))]) {
    await options.manifest(games);
    await assert.rejects(loadCatalog(options), /游戏目录/);
  }
  await options.manifest([{ ...base, rom: 'missing.gba' }]);
  await assert.rejects(loadCatalog(options), error => /ROM 加载失败/.test(error.message) && !error.message.includes(options.dir));
  await options.manifest([base]);
  const romPath = path.join(options.romDirectory, 'one.gba');
  await assert.rejects(loadCatalog({ ...options, romPath }), /不可同时配置/);
  await truncate(romPath, 0);
  await assert.rejects(loadCatalog(options), /ROM 加载失败/);
  await truncate(romPath, 32 * 1024 * 1024 + 1);
  await assert.rejects(loadCatalog(options), /ROM 加载失败/);
});

test('catalog rejects absolute, traversal, URL and symlink escapes', async t => {
  const options = await setup(t);
  for (const rom of ['../away.gba', 'nested/../../away.gba', '/absolute.gba', 'C:/absolute.gba', 'C:relative.gba', 'nested\\one.gba', 'https://example.test/one.gba', '%2e%2e/away.gba', '.hidden.gba', 'nested/../one.gba']) {
    await options.manifest([{ ...base, rom }]);
    await assert.rejects(loadCatalog(options), /相对 .gba/);
  }
  const outside = path.join(options.dir, 'outside.gba');
  await writeFile(outside, rom2);
  try { await symlink(outside, path.join(options.romDirectory, 'link.gba'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.diagnostic('Host does not grant symlink creation'); return; } throw error; }
  await options.manifest([{ ...base, rom: 'link.gba' }]);
  await assert.rejects(loadCatalog(options), /ROM 加载失败/);
});
