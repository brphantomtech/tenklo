// `npm run dev`: mirror ../docs into content/ and keep watching it, then run `next dev`.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const track = (child) => {
    children.push(child);
    child.on('exit', (code) => {
        for (const c of children) if (c !== child) c.kill();
        process.exit(code ?? 0);
    });
    return child;
};

const watcher = track(spawn(process.execPath, ['scripts/prepare-content.mjs', '--watch'], { cwd: appDir, stdio: ['ignore', 'pipe', 'inherit'] }));
let started = false;
watcher.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    // start Next once the first copy is complete
    if (!started && chunk.toString().includes('watching for changes')) {
        started = true;
        track(spawn('npx', ['next', 'dev', ...process.argv.slice(2)], { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' }));
    }
});
