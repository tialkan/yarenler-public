FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build --workspace @yarenler/web
FROM node:24-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
# Start-up migrations: dbmate files ("up" only) and the runner; pg comes from the traced standalone node_modules.
COPY --chown=node:node db/migrations ./db/migrations
COPY --chown=node:node apps/web/scripts/migrate.mjs apps/web/scripts/migrate-lib.mjs apps/web/scripts/start.sh apps/web/scripts/front-server.mjs apps/web/scripts/csp-lib.mjs apps/web/scripts/purge-cdn.mjs ./apps/web/scripts/
RUN cd apps/web/scripts && node -e "require.resolve('pg')" && node --check migrate.mjs && node --check front-server.mjs && node --check purge-cdn.mjs && ls ../../../db/migrations/*.sql >/dev/null
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations first (MIGRATION_DATABASE_URL, advisory lock); the server starts only if they succeed.
# front-server.mjs listens on PORT, runs Next.js on 127.0.0.1:3001 (host name localhost) and adds the hash based CSP to HTML.
CMD ["sh","apps/web/scripts/start.sh"]
