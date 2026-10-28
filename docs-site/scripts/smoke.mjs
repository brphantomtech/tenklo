// Smoke test against a running server: node scripts/smoke.mjs [http://localhost:3000]
const base = process.argv[2] ?? 'http://localhost:3000';

const checks = [
    { path: '/', status: 307, location: '/getting-started/intro-to-nango' },
    { path: '/getting-started/intro-to-nango', text: ['Tenklo', 'Tool calling for AI agents'] },
    { path: '/getting-started/quickstart', text: ['Quickstart', 'fd-step'] },
    { path: '/api-integrations/whatsapp-web', text: ['WhatsApp (QR code)', 'Pair a number', 'id="pair-number"', 'POST /whatsapp/messages'] },
    { path: '/api-integrations/telegram', text: ['Telegram'] },
    { path: '/reference/backend/http-api/connections/get', text: ['Get connection', '/connections/{connectionId}'] },
    { path: '/updates/changelog', text: ['Changelog'] },
    { path: '/integrations/all/snowflake', status: 308, location: '/api-integrations/snowflake' },
    { path: '/api/search?query=whatsapp', text: ['whatsapp'] },
    { path: '/api/openapi/tenklo', text: ['"openapi"'] },
    { path: '/images/Tenklo-Light-Mode.svg', text: ['<svg'] },
    { path: '/does-not-exist', status: 404 }
];

let failed = 0;
for (const check of checks) {
    const started = Date.now();
    const res = await fetch(base + check.path, { redirect: 'manual' });
    const body = res.status < 300 ? await res.text() : '';
    const problems = [];
    const expected = check.status ?? 200;
    if (res.status !== expected) problems.push(`status ${res.status} != ${expected}`);
    if (check.location && !(res.headers.get('location') ?? '').endsWith(check.location)) problems.push(`location ${res.headers.get('location')}`);
    for (const t of check.text ?? []) if (!body.toLowerCase().includes(t.toLowerCase())) problems.push(`missing "${t}"`);
    if (problems.length) failed++;
    console.log(
        `${problems.length ? 'FAIL' : 'ok  '} ${res.status} ${check.path} (${Date.now() - started}ms, ${body.length} bytes)${problems.length ? ' - ' + problems.join(', ') : ''}`
    );
}
process.exit(failed ? 1 : 0);
