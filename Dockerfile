# Backend image: the Node WebSocket + API + bot-sim server.
# The static client is deployed separately (e.g. Vercel); this image serves the
# multiplayer backend that Vercel cannot host.
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. tsx (used to run the TS server) lives in
# devDependencies, so install everything.
COPY package.json package-lock.json ./
RUN npm ci

# App source. public/maps/*/collision.glb is required for server-side bot
# collision, so the full repo (minus .dockerignore) is copied.
COPY . .

# Build the client bundle too, so this server can also serve it standalone if
# desired (single-origin deploy). Harmless for the split (Vercel) deploy.
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
# Persisted leaderboard lives on a mounted volume in production.
ENV WEBSTRAFE_DATA_DIR=/data

EXPOSE 8080
CMD ["npm", "run", "serve"]
