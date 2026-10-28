// Mirrors the Mintlify site (../docs, or $DOCS_SOURCE_DIR) into this app:
//   - pages, snippets, docs.json, spec.yaml  -> content/
//   - images/, logo/, favicon-*.svg          -> public/
// docs/ stays the single source; content/ and the copied public assets are git-ignored.
// A plain copy (no symlink) keeps every module the bundler sees inside this
// project, and works the same on Linux, in Docker and on Windows.
//
//   node scripts/prepare-content.mjs           one-off copy
//   node scripts/prepare-content.mjs --watch   copy, then keep mirroring changes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.resolve(appDir, process.env.DOCS_SOURCE_DIR ?? '../docs');
const contentDir = path.join(appDir, 'content');
const publicDir = path.join(appDir, 'public');

const PUBLIC_DIRS = ['images', 'logo'];
// favicons, and the generated LLM indexes (served at /docs/llms.txt like on Mintlify)
const isPublicFile = (rel) => /^favicon[^/\\]*\.(svg|png|ico)$/.test(rel) || /^(llms|llms-full|api-catalog)\.txt$/.test(rel);
const CONTENT_EXT = /\.(mdx?|json|ya?ml)$/;

if (!fs.existsSync(path.join(srcDir, 'docs.json'))) {
    console.error(`prepare-content: no docs.json in ${srcDir}`);
    process.exit(1);
}

/** where a file of the source dir goes, or null when it isn't needed */
function destination(rel) {
    const top = rel.split(/[\\/]/)[0];
    if (PUBLIC_DIRS.includes(top) || isPublicFile(rel)) return path.join(publicDir, rel);
    if (CONTENT_EXT.test(rel)) return path.join(contentDir, rel);
    return null;
}

/**
 * Copy one file. MDX gets the one normalization the frontmatter parser needs and
 * Mintlify tolerates: blank lines before the opening `---`.
 */
function copyFile(abs, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!abs.endsWith('.mdx')) return fs.copyFileSync(abs, dest);
    const text = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(dest, /^\s+---\r?\n/.test(text) ? text.replace(/^\s+/, '') : text);
}

function copyAll() {
    fs.rmSync(contentDir, { recursive: true, force: true });
    for (const dir of PUBLIC_DIRS) fs.rmSync(path.join(publicDir, dir), { recursive: true, force: true });
    let count = 0;
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                walk(abs);
                continue;
            }
            const rel = path.relative(srcDir, abs);
            const dest = destination(rel);
            if (!dest) continue;
            copyFile(abs, dest);
            count++;
        }
    };
    walk(srcDir);
    return count;
}

const started = Date.now();
const count = copyAll();
console.log(`prepare-content: ${count} files from ${path.relative(appDir, srcDir) || '.'} in ${Date.now() - started}ms`);

if (process.argv.includes('--watch')) {
    console.log('prepare-content: watching for changes');
    fs.watch(srcDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        const dest = destination(rel);
        if (!dest) return;
        const abs = path.join(srcDir, rel);
        try {
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                copyFile(abs, dest);
            } else {
                fs.rmSync(dest, { force: true });
            }
        } catch (err) {
            console.error(`prepare-content: ${rel}: ${err.message}`);
        }
    });
}
