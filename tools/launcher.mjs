// Backward-compatible entry; maintained implementation lives in scripts/.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runLauncher} from '../scripts/launcher.mjs';
export * from '../scripts/launcher.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runLauncher();
