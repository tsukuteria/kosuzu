# syntax=docker/dockerfile:1
# Node 24.22 系 / Debian Bookworm (glibc) を両 stage で統一。
# patch 更新は取り込み、minor 更新はこのタグを明示的に変更する。
FROM node:24.22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json index.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/
# build の型チェックには tests も含まれる。
COPY tests/ ./tests/
RUN npm run build

FROM node:24.22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# DAVE の platform 別 optionalDependencies は production でも必要。
RUN npm ci --omit=dev --include=optional && npm cache clean --force
# slim 上で GNU バイナリと Opus を実際にロードし、不足があれば build を失敗させる。
RUN node -e "require('@snazzah/davey-linux-' + process.arch + '-gnu'); require('@snazzah/davey'); const Opus = require('opusscript'); new Opus(48000, 2, Opus.Application.AUDIO).delete(); require('@discordjs/voice')"
COPY --from=builder --chown=node:node /app/dist/ ./dist/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
# Discord にアクセスせず、本番依存だけで全コマンドの import / serialize を検証。
RUN node dist/scripts/deploy-commands.js --dry-run
CMD ["node", "dist/index.js"]
