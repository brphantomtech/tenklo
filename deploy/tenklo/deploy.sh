#!/usr/bin/env bash
# Builds the Tenklo image from the checked-out commit and rolls the production stack forward.
# Run by .github/workflows/deploy-tenklo.yml on the self-hosted runner, which is the production host.
# Configuration comes from the environment (the workflow maps the GitHub secrets and variables onto it).
set -euo pipefail

REPO_DIR=$(git rev-parse --show-toplevel)
DEPLOY_DIR=${TENKLO_DEPLOY_DIR:-/root/tenklo/deploy}
KEEP_IMAGES=${TENKLO_KEEP_IMAGES:-3}

required=(
    TENKLO_API_URL TENKLO_APP_URL TENKLO_CONNECT_URL
    DB_PASSWORD ENCRYPTION_KEY DASHBOARD_USERNAME DASHBOARD_PASSWORD
    WHATSAPP_GATEWAY_SECRET WHATSAPP_SESSION_ENCRYPTION_KEY WHATSAPP_S3_ACCESS_KEY WHATSAPP_S3_SECRET_KEY
)
missing=()
for name in "${required[@]}"; do
    [ -n "${!name:-}" ] || missing+=("$name")
    case "${!name:-}" in
        *"'"*)
            echo "::error::$name contains a single quote, which the .env can't hold"
            exit 1
            ;;
    esac
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "::error::Missing configuration: ${missing[*]}"
    exit 1
fi

cd "$REPO_DIR"
SHA=$(git rev-parse --short HEAD)
echo "::group::Build tenklo/server:$SHA"
DOCKER_BUILDKIT=1 docker build --build-arg git_hash="$SHA" -t "tenklo/base:$SHA" -f Dockerfile .
docker build --build-arg BASE_IMAGE=tenklo/base --build-arg BASE_IMAGE_HASH="$SHA" -t "tenklo/server:$SHA" -t tenklo/server:latest -f Dockerfile.self_hosted .
echo "::endgroup::"

echo "::group::Configure $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cp deploy/tenklo/docker-compose.yml "$DEPLOY_DIR/docker-compose.yml"
(
    umask 077
    {
        echo "TENKLO_IMAGE_TAG=$SHA"
        for name in "${required[@]}" NPM_NETWORK; do
            if [ -n "${!name:-}" ]; then
                # Single quotes keep compose from interpolating a `$` in a password.
                printf "%s='%s'\n" "$name" "${!name}"
            fi
        done
    } > "$DEPLOY_DIR/.env.next"
)
mv "$DEPLOY_DIR/.env.next" "$DEPLOY_DIR/.env"
cd "$DEPLOY_DIR"
docker compose config -q
echo "::endgroup::"

echo "::group::Roll out"
# The shell's value would win over the .env one, so a stale export can't pin the old image.
export TENKLO_IMAGE_TAG=$SHA
docker compose up -d --remove-orphans
for container in tenklo-server tenklo-whatsapp; do
    running=$(docker inspect --format '{{.Config.Image}}' "$container")
    if [ "$running" != "tenklo/server:$SHA" ]; then
        echo "::error::$container runs $running, not tenklo/server:$SHA"
        exit 1
    fi
done
echo "::endgroup::"

echo "::group::Health"
healthy=false
for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$TENKLO_API_URL/health")" = 200 ]; then
        healthy=true
        break
    fi
    sleep 5
done
if [ "$healthy" != true ]; then
    echo "::error::$TENKLO_API_URL/health is not answering 200"
    docker compose ps
    docker logs --tail 50 tenklo-server
    exit 1
fi
healthy=false
for _ in $(seq 1 30); do
    if docker exec tenklo-whatsapp node -e "fetch('http://localhost:3010/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
        healthy=true
        break
    fi
    sleep 2
done
if [ "$healthy" != true ]; then
    echo "::error::the whatsapp-gateway is not ready"
    docker logs --tail 50 tenklo-whatsapp
    exit 1
fi
echo "server and whatsapp-gateway are healthy"
echo "::endgroup::"

echo "::group::WhatsApp media bucket"
# Idempotent: creates the bucket on a fresh host.
docker exec tenklo-whatsapp node -e "
    const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ endpoint: process.env.WHATSAPP_S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
        credentials: { accessKeyId: process.env.WHATSAPP_S3_ACCESS_KEY, secretAccessKey: process.env.WHATSAPP_S3_SECRET_KEY } });
    const Bucket = process.env.WHATSAPP_S3_BUCKET;
    s3.send(new HeadBucketCommand({ Bucket }))
        .then(() => console.log('bucket ' + Bucket + ' exists'))
        .catch(() => s3.send(new CreateBucketCommand({ Bucket })).then(() => console.log('bucket ' + Bucket + ' created')))
        .catch((err) => { console.error(err); process.exit(1); });
"
echo "::endgroup::"

echo "::group::Prune old images (keeping $KEEP_IMAGES)"
for repo in tenklo/server tenklo/base; do
    docker images "$repo" --format '{{.Tag}} {{.CreatedAt}}' | grep -v '^latest ' | sort -k2 -r | awk -v keep="$KEEP_IMAGES" 'NR > keep { print $1 }' |
        while read -r tag; do docker image rm "$repo:$tag" >/dev/null 2>&1 && echo "removed $repo:$tag" || true; done
done
docker builder prune -f --filter until=168h >/dev/null || true
echo "::endgroup::"

echo "Deployed tenklo/server:$SHA"
