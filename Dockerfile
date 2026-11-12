# Single-stage image for a test/staging server (Railway or any Docker host).
# Dev dependencies stay installed: migrations and seed run with tsx at start-up.
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Uploaded evidence; mount a persistent volume here.
ENV STORAGE_DIR=/data/storage

EXPOSE 3000
# Migrations skip files already applied; seed does nothing once data exists.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts && exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
