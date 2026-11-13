# Single-stage image for a test/staging server (Railway or any Docker host).
# Dev dependencies stay installed: migrations and seed run with tsx at start-up.
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# One id per image, read by next.config.ts at build and at runtime (version-skew protection).
RUN node -e "require('fs').writeFileSync('.deployment-id', Date.now().toString(36))" && npm run build

ENV NODE_ENV=production
# Uploaded evidence; mount a persistent volume here.
ENV STORAGE_DIR=/data/storage

EXPOSE 3000
# Migrations skip files already applied; seed does nothing once data exists.
# DEMO_DATA=1 (test servers only) adds one NCF per status, then the larger SAP-shaped set (30 NCFs), each once;
# a failure there does not stop the app.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts && { [ \"$DEMO_DATA\" != 1 ] || { npx tsx scripts/demo-data.ts || echo 'demo data failed'; npx tsx scripts/demo-sap.ts || echo 'demo-sap data failed'; }; } && exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
