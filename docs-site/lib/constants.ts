/** Public path the site is served under, at the root of its own host: `https://docs.tenklo.dev/<page>`. */
export const BASE_PATH = '';

/**
 * The content directory, relative to `docs-site/` (the process cwd at build and run time).
 * It is a copy of the Mintlify site in `../docs`, made by `scripts/prepare-content.mjs`,
 * so the bundler never resolves modules outside this project.
 */
export const CONTENT_DIR = 'content';

export const SITE_NAME = 'Tenklo';
export const SITE_URL = 'https://tenklo.dev';
export const DOCS_URL = 'https://docs.tenklo.dev';
export const DASHBOARD_URL = 'https://app.tenklo.dev';
export const API_URL = 'https://api.tenklo.dev';
