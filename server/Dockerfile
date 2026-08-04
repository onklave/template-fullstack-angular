# syntax=docker/dockerfile:1
#
# The `api` service: Express + node-postgres. Build context is ./server
# (see onklave.yaml) — paths below are relative to it.
#
# Node 24 ("Krypton") is the Active LTS line, supported until 2028-04-30.

# --- Build stage: production dependencies only ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Runtime stage ---
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src

# Unprivileged user shipped with the node image. Nothing is written to disk:
# state lives in PostgreSQL, reached via the injected DATABASE_URL.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
