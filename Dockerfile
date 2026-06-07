ARG NODE_IMAGE=node:24.16.0-alpine3.23


# Builder
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json drizzle.config.ts .
RUN npm ci
COPY . .
RUN node --run build


# Runner
FROM ${NODE_IMAGE} AS runner
RUN apk upgrade -U
WORKDIR /app

COPY --chown=node:node package.json package-lock.json .
RUN npm ci --omit=dev
RUN npm r -g npm

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/drizzle ./drizzle

ENV DATABASE_FILENAME=/app/data/database.sqlite
RUN mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
