const PORT = process.env['SERVER_PORT'] || 3003;

export const localhostUrl = `http://localhost:${PORT}`;
export const cloudHost = 'https://api.tenklo.dev';
export const stagingHost = 'https://api-staging.tenklo.dev';

export enum NodeEnv {
    Dev = 'development',
    Staging = 'staging',
    Prod = 'production'
}
