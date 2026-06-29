ARG NODE_IMAGE=node:24.18.0-alpine3.24


# Builder
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc .
RUN npm ci
COPY . .
RUN node --run build


# Runner
FROM ${NODE_IMAGE} AS runner
RUN apk upgrade -U && npm r -g npm
WORKDIR /app

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
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3000/health || exit 1

CMD ["node", "--no-warnings=ExperimentalWarning", "dist/index.js"]
