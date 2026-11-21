import path from 'node:path';
import { constants } from 'node:fs';
import { chmod, chown, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadCatalog } from '../src/server/games.mjs';
import { loadConfig } from '../src/server/config.mjs';

const settings = { MAX_CONNECTIONS: '160', MAX_TCP_PER_IP: '128', MAX_WS_PER_IP: '80', WS_READ_TIMEOUT_MS: '5000', INPUT_DELAY_FRAMES: '6' };
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function regular(file, directory = false) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile())) throw Error('拒绝符号链接或非普通路径：' + file);
}
async function directory(file, mode) {
  if (!(await exists(file))) await mkdir(file, { mode });
  await regular(file, true);
}
export function validDomain(value) {
  return typeof value === 'string' && value.length <= 253 && !/^[0-9.]+$/.test(value) && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
export function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z_]+)=([a-z0-9.-]+)$/.exec(line);
    if (!match || !['SITE_DOMAIN', ...Object.keys(settings)].includes(match[1]) || Object.hasOwn(result, match[1])) throw Error('deploy/.env 只支持不带引号的已知 KEY=value，且不得重复');
    result[match[1]] = match[2];
  }
  return result;
}
export async function prepare({ project, state, romSource, domain, setSecretOwner = process.platform === 'linux' && process.getuid?.() === 0 }) {
  project = path.resolve(project); state = path.resolve(state); romSource = path.resolve(romSource);
  await regular(state, true);
  const envFile = path.join(state, '.env');
  let env = {};
  if (await exists(envFile)) { await regular(envFile); env = parseEnv(await readFile(envFile, 'utf8')); if (!env.SITE_DOMAIN) throw Error('已有 deploy/.env 缺少 SITE_DOMAIN，请人工补齐'); }
  domain = domain || env.SITE_DOMAIN;
  if (!validDomain(domain)) throw Error('请使用 --domain 指定小写完整域名，不含协议、端口或路径');
  if (env.SITE_DOMAIN && env.SITE_DOMAIN !== domain) throw Error('域名与已有 deploy/.env 不同；请先备份并人工修改该文件');
  const catalogPath = path.join(state, 'games.json');
  const selectedCatalog = await exists(catalogPath) ? catalogPath : path.join(project, 'config', 'games.json');
  await regular(selectedCatalog);
  const manifestBytes = await readFile(selectedCatalog);
  if (manifestBytes.length > 1024 * 1024) throw Error('游戏目录超过 1 MiB');
  const manifest = JSON.parse(manifestBytes);
  if (!Array.isArray(manifest.games)) throw Error('缺少 games 数组');
  const romRoot = path.join(state, 'roms');
  await directory(romRoot, 0o755);
  const stage = await mkdtemp(path.join(state, '.prepare-'));
  const pending = [];
  const stagedPaths = new Set();
  let catalog;
  try {
    const stageCatalog = path.join(stage, 'games.json');
    await writeFile(stageCatalog, manifestBytes, { flag: 'wx', mode: 0o644 });
    for (const game of manifest.games) {
      if (game.enabled === false) continue;
      const relative = game.rom;
      if (typeof relative !== 'string' || relative.length > 240 || !/\.gba$/i.test(relative) || /[\\:%?#\p{Cc}]/u.test(relative) || relative.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p))) throw Error('不安全的 ROM 相对路径');
      if (stagedPaths.has(relative)) continue;
      stagedPaths.add(relative);
      let destination = romRoot;
      for (const part of relative.split('/').slice(0, -1)) { destination = path.join(destination, part); if (await exists(destination)) await regular(destination, true); }
      destination = path.join(romRoot, ...relative.split('/'));
      const present = await exists(destination);
      const source = present ? destination : path.join(romSource, ...relative.split('/'));
      await regular(source);
      const sourceRoot = await realpath(present ? romRoot : romSource);
      const resolved = await realpath(source);
      const inside = path.relative(sourceRoot, resolved);
      if (!inside || inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) throw Error('ROM 越出源目录');
      const staged = path.join(stage, ...relative.split('/'));
      await mkdir(path.dirname(staged), { recursive: true, mode: 0o755 });
      await copyFile(source, staged, constants.COPYFILE_EXCL);
      if (!present) pending.push({ staged, destination });
    }
    catalog = await loadCatalog({ catalogPath: stageCatalog, romDirectory: stage });
    const secrets = path.join(state, 'secrets');
    await directory(secrets, 0o700);
    const secretFile = path.join(secrets, 'access-password.txt');
    let password;
    if (await exists(secretFile)) { await regular(secretFile); const info = await lstat(secretFile); if (info.size > 1024) throw Error('口令文件过大'); password = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(secretFile)).replace(/\r?\n$/, ''); }
    else password = randomBytes(32).toString('hex');
    await loadConfig({ publicMode: true, publicOrigin: 'https://' + domain, accessPassword: password,
      maxConnections: env.MAX_CONNECTIONS, maxTcpPerIp: env.MAX_TCP_PER_IP, maxWsPerIp: env.MAX_WS_PER_IP,
      wsReadTimeoutMs: env.WS_READ_TIMEOUT_MS, inputDelayFrames: env.INPUT_DELAY_FRAMES });
    // Only initialize missing files. Existing deployment content always wins.
    for (const item of pending) {
      let parent = romRoot;
      for (const part of path.relative(romRoot, path.dirname(item.destination)).split(path.sep).filter(Boolean)) { parent = path.join(parent, part); await directory(parent, 0o755); }
      await copyFile(item.staged, item.destination, constants.COPYFILE_EXCL);
      await chmod(item.destination, 0o644);
    }
    if (!(await exists(catalogPath))) await writeFile(catalogPath, manifestBytes, { flag: 'wx', mode: 0o644 });
    if (!(await exists(envFile))) await writeFile(envFile, ['SITE_DOMAIN=' + domain, ...Object.entries(settings).map(([key, value]) => key + '=' + value), ''].join('\n'), { flag: 'wx', mode: 0o600 });
    if (!(await exists(secretFile))) await writeFile(secretFile, password + '\n', { flag: 'wx', mode: 0o600 });
    await chmod(secretFile, 0o600);
    if (setSecretOwner) await chown(secretFile, 1000, 1000);
    const secured = await lstat(secretFile);
    if (process.platform === 'linux' && ((secured.mode & 0o777) !== 0o600 || (setSecretOwner && (secured.uid !== 1000 || secured.gid !== 1000)))) throw Error('文件系统未保留口令 0600/UID1000 权限，请使用原生 Linux 文件系统');
    return { domain, games: catalog.listing.games.length, copiedRoms: pending.length, passwordFile: secretFile };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--project', '--state', '--rom-source', '--domain'].includes(args[i]) || !args[i + 1]) throw Error('准备器参数无效'); options[args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[i + 1]; }
    const result = await prepare(options);
    console.log('部署文件就绪：' + result.games + ' 项游戏，新增 ' + result.copiedRoms + ' 个 ROM；已有文件保留。');
  } catch (error) { console.error('部署准备失败：' + error.message); process.exitCode = 1; }
}
