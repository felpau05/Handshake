# ASL Word Battle — single image running the whole app: the Node server
# (Express + Socket.IO, via tsx straight from src) serving the pre-built
# client bundle. Mirrors exactly what `npm run build && npm start` does on a
# laptop today — no behavioral changes, just containerized.
#
# NODE_ENV is deliberately NOT set to "production": auth cookies switch to
# secure-only under production, which breaks login over plain HTTP (e.g.
# nginx on localhost). Behind an HTTPS terminator you can set it at runtime.
FROM node:20-slim

WORKDIR /app

# Manifests first so `npm ci` layer-caches across source-only changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY asl-detector/package.json asl-detector/
COPY asl/package.json asl/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

# Full source (.dockerignore keeps secrets, datasets, and node_modules out),
# then build the client bundle the server will serve from client/dist.
COPY . .
RUN npm run build

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
