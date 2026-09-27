# Backend image: the Node WebSocket + API + bot-sim server only.
# The static client is deployed separately on Vercel, so no client build here.
FROM node:24-slim

WORKDIR /app

# Install deps first for layer caching. tsx (used to run the TS server) lives in
# devDependencies, so install everything.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# App source. public/maps/*/collision.glb is required for server-side bot
# collision; render-only assets are dropped by .dockerignore.
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV WEBSTRAFE_DATA_DIR=/tmp/webstrafe

EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
