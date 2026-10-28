// Completes the standalone server (.next/standalone) with what `next build`
// leaves out: static chunks, public/, and the files read at runtime
// (content/docs.json for navigation, content/spec.yaml for the API reference).
// Then `node .next/standalone/server.js` serves the whole site, locally or in Docker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(appDir, '.next', 'standalone');
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
    console.error('postbuild: .next/standalone/server.js not found, run `next build` first');
    process.exit(1);
}

const copy = (from, to) => fs.cpSync(path.join(appDir, from), path.join(standalone, to), { recursive: true });
copy('.next/static', '.next/static');
copy('public', 'public');
fs.mkdirSync(path.join(standalone, 'content'), { recursive: true });
copy('content/docs.json', 'content/docs.json');
copy('content/spec.yaml', 'content/spec.yaml');
console.log('postbuild: standalone server ready, run `npm start` (node .next/standalone/server.js)');
