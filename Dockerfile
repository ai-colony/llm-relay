ARG NODE_IMAGE=node:24.16.0-alpine3.23


# Builder
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json drizzle.config.ts .
RUN apk add --no-cache python3 make g++ && npm ci
COPY . .
RUN node --run build
RUN npm prune --omit=dev


# Runner
FROM ${NODE_IMAGE} AS runner
RUN apk upgrade -U
WORKDIR /app

COPY --chown=node:node package.json .
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
RUN npm r -g npm

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/drizzle ./drizzle

ENV DATABASE_FILENAME=/app/data/database.sqlite
RUN mkdir -p /app/data && chown node:node /app/data

LABEL org.opencontainers.image.description="HTTP relay server that queues LLM prompts against OpenAI-compatible APIs with SQLite persistence and async callback delivery" \
      org.opencontainers.image.source="https://github.com/ai-colony/llm-relay" \
      org.opencontainers.image.licenses="ISC"

USER node
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
