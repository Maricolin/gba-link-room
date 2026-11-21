import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { readFile, realpath, lstat, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { APP_ID, VERSION, ROOT, PROJECT_ID, loadConfig } from './config.mjs';
import { createSecurity, peerIp } from './security.mjs';
import { createRooms } from './rooms.mjs';
import { attachWebSocket } from './websocket.mjs';
import { loadCatalog, openGameRom } from './games.mjs';

const PUBLIC = path.join(ROOT, 'public');
const BODY_LIMIT = 1024;
const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}));

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bodyPresent = req => !!(req.headers['transfer-encoding'] || Number(req.headers['content-length']));
function rejectBody(req) { if (bodyPresent(req)) throw new RequestError(400, '此请求不接受请求体'); }
function readPassword(req) {
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || type.split(';')[0].trim().toLowerCase() !== 'application/json' || req.headers['content-encoding']) throw new RequestError(415, '请发送 JSON');
  if (Number(req.headers['content-length']) > BODY_LIMIT) throw new RequestError(413, '请求体最大为 1 KiB');
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    const timer = setTimeout(() => finish(new RequestError(408, '请求体读取超时')), 5000); timer.unref();
    function finish(error, password) {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('close', close);
      if (error) { req.pause(); reject(error); } else resolve(password);
    }
    function data(chunk) {
      size += chunk.length;
      if (size > BODY_LIMIT) finish(new RequestError(413, '请求体最大为 1 KiB'));
      else parts.push(chunk);
    }
    function end() {
      try {
        const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size)));
        if (!parsed || Array.isArray(parsed) || typeof parsed.password !== 'string' || !parsed.password.isWellFormed() || Object.keys(parsed).length !== 1) throw Error();
        finish(null, parsed.password);
      } catch { finish(new RequestError(400, '请求体须为包含 password 的 JSON 对象')); }
    }
    function close() { finish(new RequestError(400, '请求体不完整')); }
    req.on('data', data); req.once('end', end); req.once('close', close);
  });
}
function pathnameOf(url) {
  let pathname;
  try { pathname = decodeURIComponent((url || '/').split('?')[0]); }
  catch { throw new RequestError(400, 'Not found'); }
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\p{Cc}\\:]/u.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..')) throw new RequestError(403, 'Forbidden');
  return pathname;
}
async function staticFile(pathname, head) {
  const parts = (pathname === '/' ? '/index.html' : pathname).slice(1).split('/');
  const type = mime.get(path.extname(parts.at(-1)).toLowerCase());
  if (!type || parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) throw new RequestError(404, 'Not found');
  const candidate = path.join(PUBLIC, ...parts);
  try {
    const root = await realpath(PUBLIC);
    if (path.relative(PUBLIC, root) !== '') throw Error();
    const filename = await realpath(candidate);
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.')) || !mime.has(path.extname(filename).toLowerCase())) throw Error();
    // Reject aliases/symlinks even when they happen to resolve inside public.
    if (path.relative(candidate, filename) !== '' || (await lstat(candidate)).isSymbolicLink()) throw Error();
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) throw Error();
    return { data: head ? undefined : await readFile(filename), size: metadata.size, type };
  } catch { throw new RequestError(404, 'Not found'); }
}

/** Programmatic calls use isolated defaults; server.mjs supplies CLI environment configuration. */
export async function createApp({ port = 8765, host, romPath, catalogPath, romDirectory, config: options = {} } = {}) {
  const config = await loadConfig(options);
  host ??= config.publicMode ? '127.0.0.1' : '0.0.0.0';
  const catalog = await loadCatalog({ catalogPath, romDirectory, romPath });
  const defaultGame = catalog.defaultGame.profile;
  const { romSize, romSha256, id: defaultGameId } = defaultGame;
  const security = createSecurity(config);
  const info = { appId: APP_ID, version: VERSION, romName: catalog.defaultGame.romName, romSize, romSha256, defaultGameId, gameCount: catalog.listing.games.length, addresses: config.publicMode ? [config.publicOrigin] : [], ...(!config.publicMode && { projectId: PROJECT_ID }) };
  const sockets = new Set(), perIp = new Map();
  let closing = false;
  const acceptSocket = socket => !closing && sockets.has(socket) && !socket.destroyed;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 3000, connectionsCheckingInterval: 1000, requireHostHeader: true }, async (req, res) => {
    if (!acceptSocket(req.socket)) { req.socket.destroy(); return; }
    const ip = peerIp(req.socket);
    for (const [name, value] of Object.entries(security.headers)) res.setHeader(name, value);
    const json = (status, payload) => {
      const data = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    const sendError = (status, error) => {
      if (!req.complete || bodyPresent(req)) {
        res.setHeader('Connection', 'close');
        const socket = req.socket;
        const timer = setTimeout(() => socket.destroy(), 1000); timer.unref();
        socket.once('close', () => clearTimeout(timer));
      }
      json(status, { error });
    };
    try {
      if (!security.hostAllowed(req)) { sendError(403, '站点主机不允许'); return; }
      if (!security.httpAttempt(ip)) { sendError(429, '请求过于频繁，请稍后再试'); return; }
      const pathname = pathnameOf(req.url);
      const get = req.method === 'GET' || req.method === 'HEAD';
      if (pathname === '/api/session') {
        const required = security.required;
        const token = security.session(req);
        if (get) { rejectBody(req); json(200, { required, authenticated: !required || !!token }); return; }
        if (req.method !== 'POST' && req.method !== 'DELETE') { res.setHeader('Allow', 'GET, HEAD, POST, DELETE'); sendError(405, 'Method not allowed'); return; }
        if (!security.originAllowed(req)) { sendError(403, '站点来源不允许'); return; }
        if (req.method === 'DELETE') {
          rejectBody(req);
          if (token) { security.revoke(token); websocket.revoke(token); }
          res.setHeader('Set-Cookie', security.cookie(null));
          json(200, { required, authenticated: !required }); return;
        }
        if (!security.loginAttempt(ip)) { res.setHeader('Retry-After', '12'); sendError(429, '登录尝试过于频繁，请稍后重试'); return; }
        const password = await readPassword(req);
        if (!required) { json(200, { required, authenticated: true }); return; }
        if (!security.checkPassword(password)) { sendError(401, '访问密码错误'); return; }
        // Concurrent logins can share the same existing cookie; re-check after reading the body.
        if (token && security.isActive(token)) { security.revoke(token); websocket.revoke(token); }
        const next = security.issue();
        if (!next) { sendError(503, '登录会话已满，请稍后再试'); return; }
        res.setHeader('Set-Cookie', security.cookie(next));
        json(200, { required, authenticated: true }); return;
      }
      if (!get) { res.setHeader('Allow', 'GET, HEAD'); sendError(405, 'Method not allowed'); return; }
      rejectBody(req);
      if (pathname === '/healthz') { json(200, { ok: true }); return; }
      const gameRoute = pathname === '/api/games' || pathname.startsWith('/api/games/');
      const token = security.session(req);
      if (gameRoute || ['/api/info', '/game.gba', '/ws'].includes(pathname)) {
        if (security.required && !token) { sendError(401, '请先登录'); return; }
        // Browser same-origin GETs may omit Origin. If supplied, it must match.
        if ((gameRoute || pathname === '/game.gba') && req.headers.origin !== undefined && !security.originAllowed(req)) { sendError(403, '站点来源不允许'); return; }
      }
      if (pathname === '/api/games') { json(200, catalog.listing); return; }
      if (gameRoute || pathname === '/game.gba') {
        const match = /^\/api\/games\/([a-z0-9-]{1,48})\/rom$/.exec(pathname);
        const entry = pathname === '/game.gba' ? catalog.defaultGame : match && catalog.get(match[1]);
        if (!entry) { sendError(404, '游戏不存在'); return; }
        if (req.method === 'GET' && !security.romAttempt(ip, token)) {
          res.setHeader('Retry-After', '6'); sendError(429, 'ROM 下载过于频繁，请稍后再试'); return;
        }
        let file;
        try { file = await openGameRom(entry); }
        catch { sendError(503, 'ROM 已更改或不可用，请重新启动服务'); return; }
        try {
          if (res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': entry.profile.romSize, 'Cache-Control': 'private, no-store' });
          if (req.method === 'HEAD') res.end();
          else await pipeline(file.createReadStream({ autoClose: false, start: 0, end: entry.profile.romSize - 1 }), res);
        } finally { await file.close(); }
        return;
      }
      if (pathname === '/api/info') { json(200, info); return; }
      if (pathname === '/ws') { sendError(426, '需要 WebSocket 升级'); return; }
      const head = req.method === 'HEAD';
      const asset = await staticFile(pathname, head);
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.size, 'Cache-Control': 'no-cache' });
      res.end(asset.data);
    } catch (error) {
      if (res.destroyed) return;
      if (!res.headersSent) sendError(error instanceof RequestError ? error.status : 500, error instanceof RequestError ? error.message : '服务器请求失败');
      else res.destroy();
    }
  });
  server.maxConnections = config.maxConnections;
  server.maxRequestsPerSocket = 100;
  server.setTimeout(10000, socket => socket.destroy());
  server.on('connection', socket => {
    const ip = peerIp(socket);
    if (!security.tcpAttempt(ip) || (perIp.get(ip) || 0) >= config.maxTcpPerIp) { socket.destroy(); return; }
    sockets.add(socket); perIp.set(ip, (perIp.get(ip) || 0) + 1);
    socket.once('close', () => {
      sockets.delete(socket);
      const remaining = perIp.get(ip) - 1;
      if (remaining) perIp.set(ip, remaining); else perIp.delete(ip);
    });
  });
  server.on('clientError', (_, socket) => { if (!socket.destroyed && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); else socket.destroy(); });
  let websocket;
  const rooms = createRooms({ send: (client, message) => websocket.send(client, message), catalog, roomAttempt: security.roomAttempt, inputDelayFrames: config.inputDelayFrames });
  websocket = attachWebSocket(server, { config, security, rooms, defaultGame, acceptSocket });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { websocket.close(); rooms.close(); throw error; }
  const actualPort = server.address().port;
  if (!config.publicMode) {
    const addresses = new Set();
    for (const entries of Object.values(networkInterfaces())) {
      for (const address of entries || []) if (!address.internal && address.family === 'IPv4') addresses.add('http://' + address.address + ':' + actualPort);
    }
    info.addresses = [...addresses];
  }
  let closePromise;
  return {
    server, port: actualPort, url: 'http://127.0.0.1:' + actualPort, info, publicMode: config.publicMode,
    close() {
      return closePromise ||= new Promise((resolve, reject) => {
        closing = true; websocket.close(); rooms.close();
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
