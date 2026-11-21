import path from 'node:path';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ROOT, ROM_NAME } from './config.mjs';

const MAX_ROM = 32 * 1024 * 1024;
const MAX_MANIFEST = 1024 * 1024;
const DEFAULT_ID = 'kirby-amazing-mirror-cn';
const ACTIONS = new Set(['a', 'b', 'l', 'r', 'start', 'select', 'up', 'down', 'left', 'right']);
const COMPATIBILITY = new Set(['untested', 'core-tested', 'verified']);
const validId = id => typeof id === 'string' && id.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fingerprint = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');

function text(value, max, multiline = false, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max * 2 || !value.isWellFormed() || [...value].length > max || (!allowEmpty && !value.trim()) || /\p{Cc}/u.test(multiline ? value.replace(/[\r\n]/g, '') : value)) throw Error('无效文本字段');
  return value.trim();
}

function relativeRom(value) {
  if (typeof value !== 'string' || value.length > 240 || !/\.gba$/i.test(value) || /[\\:%?#\p{Cc}]/u.test(value) || value.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) throw Error('ROM 必须是目录内相对 .gba 文件');
  return value.split('/');
}

function validateGame(game) {
  const { id, title, rom, players, defaultPlayers, link, compatibility, description = '', instructions = '', labels = {} } = game;
  if (!Array.isArray(players) || players.length < 1 || players.length > 4 || players.some(p => !Number.isInteger(p) || p < 1 || p > 4) || new Set(players).size !== players.length || !players.includes(defaultPlayers)) throw Error('玩家数量配置无效');
  if (!['cable', 'none'].includes(link) || !COMPATIBILITY.has(compatibility)) throw Error('联机方式或兼容性配置无效');
  if (link === 'none' && (players.length !== 1 || players[0] !== 1)) throw Error('单人游戏只能配置 players:[1]');
  if (!object(labels) || Object.keys(labels).some(key => !ACTIONS.has(key))) throw Error('按键标签配置无效');
  return { id, title: text(title, 100), players: Object.freeze([...players]), defaultPlayers, link, compatibility, description: text(description, 500, true, true), instructions: text(instructions, 1000, true, true), labels: Object.freeze(Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, text(label, 32)]))), parts: relativeRom(rom) };
}

async function openRegular(filename, max) {
  const options = { bigint: true };
  const before = await stat(filename, options);
  if (!before.isFile() || before.size < 1n || before.size > BigInt(max)) throw Error();
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const metadata = await file.stat(options);
    if (!metadata.isFile() || fingerprint(before) !== fingerprint(metadata)) throw Error();
    return { file, metadata };
  } catch (error) { await file.close(); throw error; }
}

async function openEntry(entry) {
  const resolved = await realpath(entry.filename);
  if (entry.root) {
    const rel = path.relative(entry.root, resolved);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !/\.gba$/i.test(resolved)) throw Error();
  }
  if (entry.resolved && path.relative(entry.resolved, resolved) !== '') throw Error();
  return { resolved, ...(await openRegular(resolved, MAX_ROM)) };
}

async function loadEntry(entry, profile) {
  try {
    const { resolved, file, metadata } = await openEntry(entry);
    try {
      const sha = createHash('sha256');
      const stream = file.createReadStream({ autoClose: false, start: 0, end: Number(metadata.size) - 1 });
      for await (const chunk of stream) sha.update(chunk);
      if (stream.bytesRead !== Number(metadata.size) || fingerprint(await file.stat({ bigint: true })) !== fingerprint(metadata)) throw Error();
      return Object.freeze({ ...entry, resolved, romName: path.basename(entry.filename), identity: fingerprint(metadata), profile: Object.freeze({ ...profile, romSize: Number(metadata.size), romSha256: sha.digest('hex'), romUrl: '/api/games/' + profile.id + '/rom' }) });
    } finally { await file.close(); }
  } catch { throw Error('ROM 加载失败（游戏 ' + profile.id + '）：请检查文件和权限（普通文件，1 字节至 32 MiB）'); }
}

export async function openGameRom(entry) {
  const { file, metadata } = await openEntry(entry);
  if (fingerprint(metadata) === entry.identity) return file;
  await file.close();
  throw Error('ROM changed');
}

async function readManifest(filename) {
  try {
    const { file, metadata } = await openRegular(filename, MAX_MANIFEST);
    try {
      const bytes = Buffer.alloc(Number(metadata.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw Error();
        offset += bytesRead;
      }
      if (fingerprint(await file.stat({ bigint: true })) !== fingerprint(metadata)) throw Error();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { await file.close(); }
  } catch { throw Error('游戏目录加载失败：请检查 JSON 文件（最大 1 MiB）'); }
}

export async function loadCatalog({ catalogPath, romDirectory, romPath } = {}) {
  if (romPath !== undefined && catalogPath !== undefined) throw Error('ROM_PATH 与 GAME_CATALOG_PATH 不可同时配置');
  const entries = new Map();
  let defaultGameId = DEFAULT_ID;
  if (romPath !== undefined) {
    if (typeof romPath !== 'string' || !romPath) throw Error('ROM_PATH 必须是文件路径');
    entries.set(DEFAULT_ID, await loadEntry({ filename: path.resolve(romPath) }, {
      id: DEFAULT_ID, title: '星之卡比 · 镜之迷宫（单 ROM 模式）', players: Object.freeze([1, 2, 3, 4]), defaultPlayers: 2,
      link: 'cable', compatibility: 'untested', description: '', instructions: '', labels: Object.freeze({}),
    }));
  } else {
    const manifest = await readManifest(catalogPath ?? path.join(ROOT, 'config', 'games.json'));
    if (!object(manifest) || manifest.version !== 1 || !validId(manifest.defaultGameId) || !Array.isArray(manifest.games) || !manifest.games.length || manifest.games.length > 64) throw Error('游戏目录格式无效：需要 version 1 及 1–64 项游戏');
    defaultGameId = manifest.defaultGameId;
    const ids = new Set(), profiles = [];
    for (const [index, row] of manifest.games.entries()) {
      if (!object(row) || !validId(row.id) || ids.has(row.id) || (row.enabled !== undefined && typeof row.enabled !== 'boolean')) throw Error('游戏目录第 ' + (index + 1) + ' 项：无效或重复 ID，或 enabled 配置无效');
      ids.add(row.id);
      if (row.enabled === false) continue;
      try { profiles.push(validateGame(row)); }
      catch (error) { throw Error('游戏目录第 ' + (index + 1) + ' 项：' + error.message); }
    }
    if (!profiles.some(p => p.id === defaultGameId)) throw Error('游戏目录的 defaultGameId 必须指向已启用游戏');
    const directory = romDirectory ?? path.join(ROOT, 'data', 'roms');
    let root;
    try { root = await realpath(directory); if (!(await stat(root)).isDirectory()) throw Error(); }
    catch { throw Error('ROM 加载失败：ROM_DIRECTORY 不可用'); }
    for (const { parts, ...profile } of profiles) {
      let filename = path.join(root, ...parts);
      // Legacy installation compatibility applies only to the bundled default catalog and ROM.
      let entryRoot = root;
      if (catalogPath === undefined && romDirectory === undefined && profile.id === DEFAULT_ID && parts.length === 1 && parts[0] === ROM_NAME) {
        try { await stat(filename); } catch (error) {
          if (error.code === 'ENOENT') { filename = path.join(ROOT, ROM_NAME); entryRoot = ROOT; }
          else throw Error('ROM 加载失败（游戏 ' + profile.id + '）：请检查文件和权限');
        }
      }
      entries.set(profile.id, await loadEntry({ filename, root: entryRoot }, profile));
    }
  }
  const defaultGame = entries.get(defaultGameId);
  const listing = Object.freeze({ defaultGameId, games: Object.freeze([...entries.values()].map(entry => entry.profile)) });
  return { defaultGame, listing, get: id => entries.get(id) };
}
