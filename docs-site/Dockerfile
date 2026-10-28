# syntax=docker/dockerfile:1.7
#
# Tenklo docs (Fumadocs on Next.js), served by `next start` (standalone output) on port 3000.
#
# Build from the repository root, the content lives in docs/:
#   docker build -f docs-site/Dockerfile -t tenklo-docs .
#   docker run --rm -p 3000:3000 tenklo-docs      # http://localhost:3000/docs
#
# docs-site/Dockerfile.dockerignore replaces the root .dockerignore (which excludes docs/) for this build.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app/docs-site
COPY docs-site/package.json docs-site/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    # ~4.2k MDX files (pages + snippets) go through the bundler
    NODE_OPTIONS=--max-old-space-size=8192
COPY docs ./docs
COPY docs-site ./docs-site
COPY --from=deps /app/docs-site/node_modules ./docs-site/node_modules
WORKDIR /app/docs-site
# prebuild mirrors ../docs into content/ and public/; postbuild completes .next/standalone
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# server, static chunks, public/ and the runtime files (content/docs.json, content/spec.yaml)
COPY --from=build --chown=node:node /app/docs-site/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/docs/getting-started/intro-to-nango').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
