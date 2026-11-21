FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765

COPY server.mjs package.json LICENSE THIRD_PARTY.md ./
COPY src/server/ ./src/server/
COPY config/games.json ./config/games.json
COPY public/ ./public/

USER node
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node","-e","const origin = process.env.PUBLIC_ORIGIN; require('node:http').get({ hostname: '127.0.0.1', port: process.env.PORT, path: '/healthz', headers: origin ? { Host: new URL(origin).host } : {}, signal: AbortSignal.timeout(3000) }, res => { res.resume(); if (res.statusCode !== 200) process.exitCode = 1; }).on('error', () => { process.exitCode = 1; });"]
CMD ["node", "server.mjs"]
