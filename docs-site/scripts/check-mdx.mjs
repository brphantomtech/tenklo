// Fast MDX compile check of the whole content dir (no bundler): reports every
// file that fails to parse/compile with the Mintlify remark plugins applied.
//   node scripts/check-mdx.mjs [subdir]
import fs from 'node:fs';
import path from 'node:path';

import { compile } from '@mdx-js/mdx';
import { remarkGfm } from 'fumadocs-core/mdx-plugins';

// Node strips the types of a .ts import itself, which needs the extension
// oxlint-disable-next-line import/extensions
import { mintlifyRemarkPlugins } from '../lib/mdx-plugins/mintlify.ts';

const contentDir = path.resolve('content');
const sub = process.argv[2] ?? '';
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.mdx')) files.push(p);
    }
})(path.join(contentDir, sub));

const remarkPlugins = [remarkGfm, ...mintlifyRemarkPlugins({ contentDir, basePath: '/docs' })];
let failed = 0;
for (const file of files) {
    const value = fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, (m) => '\n'.repeat(m.split('\n').length - 1));
    try {
        await compile({ value, path: file }, { remarkPlugins });
    } catch (err) {
        failed++;
        const where = err.place?.start ?? err.place ?? err.position?.start;
        console.log(`${path.relative(contentDir, file)}:${where?.line ?? '?'}:${where?.column ?? '?'} ${String(err.reason ?? err.message).split('\n')[0]}`);
    }
}
console.log(`checked ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
