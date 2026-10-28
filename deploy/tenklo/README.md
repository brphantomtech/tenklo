# Tenklo production deploy

Pushing to `master` deploys it: `.github/workflows/deploy-tenklo.yml` runs on a self-hosted runner installed on the production host, builds `tenklo/server:<sha>` there and runs `deploy.sh`.

| File                 | What it is                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml` | The stack: Postgres, Redis, server, WhatsApp gateway and its S3 (RustFS). No secrets.                          |
| `deploy.sh`          | Build, write the `.env` from the environment, `docker compose up`, health checks, media bucket, image pruning. |

## Configuration

Set in the GitHub `production` environment (Settings → Environments), never in the repository:

- Variables: `TENKLO_API_URL`, `TENKLO_APP_URL`, `TENKLO_CONNECT_URL`, optionally `NPM_NETWORK` (default `nginx-proxy-manager_default`).
- Secrets: `DB_PASSWORD`, `ENCRYPTION_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `WHATSAPP_GATEWAY_SECRET`, `WHATSAPP_SESSION_ENCRYPTION_KEY`, `WHATSAPP_S3_ACCESS_KEY`, `WHATSAPP_S3_SECRET_KEY`, `TELEGRAM_GATEWAY_SECRET`.

`deploy.sh` writes them to `/root/tenklo/deploy/.env` (mode 600) on every deploy, so a change takes effect on the next run.

Do not rotate `ENCRYPTION_KEY` or `WHATSAPP_SESSION_ENCRYPTION_KEY` casually: the first encrypts the stored credentials, the second the WhatsApp sessions (every number would have to scan its QR code again).

## Host

- Docker (the snap package: the build context must stay under `/root`, which is why the runner lives in `/root/actions-runner`).
- Nginx Proxy Manager, whose network the server joins, publishes `api`, `app` and `connect` to the server's ports 3003 and 3009.
- The GitHub Actions runner as a systemd service, label `tenklo-production`.

## Manual deploy

From a checkout on the host, with the configuration exported:

```bash
bash deploy/tenklo/deploy.sh
```
