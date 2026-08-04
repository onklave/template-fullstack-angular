# syntax=docker/dockerfile:1
#
# The `web` service: build the Angular bundle, then serve it as static files.
# Build context is ./client (see onklave.yaml) — paths below are relative to it.
#
# Node 24 ("Krypton") is the Active LTS line, supported until 2028-04-30, and
# is the minimum Angular 22 accepts.

# --- Build stage: compile the Angular app to dist/browser ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage ---
# No node_modules at all: serve.js is dependency-free, so none of the Angular
# toolchain — or its transitive tree — reaches production.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist/browser ./dist/browser
COPY --chown=node:node serve.js ./serve.js

# Unprivileged user shipped with the node image; nothing here is written to.
USER node
EXPOSE 3000
CMD ["node", "serve.js"]
