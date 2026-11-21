import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './src/server/config.mjs';
import { createApp } from './src/server/app.mjs';

export { createApp };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await createApp({ port: Number(process.env.PORT || 8765), host: process.env.HOST || undefined, romPath: process.env.ROM_PATH || undefined, catalogPath: process.env.GAME_CATALOG_PATH || undefined, romDirectory: process.env.ROM_DIRECTORY || undefined, config: configFromEnv() });
    console.log('GBA 联机服务器已启动: ' + (app.publicMode ? app.info.addresses[0] : app.url));
    if (!app.publicMode) for (const address of app.info.addresses) console.log('局域网: ' + address);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().catch(() => { process.exitCode = 1; }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
