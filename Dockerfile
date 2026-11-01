# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter arqqbot-plugin-echo build
RUN pnpm --filter arqqbot-plugin-persona-distill build
RUN pnpm --filter @arqqbot/runtime build
RUN pnpm --filter @arqqbot/desktop build:web
RUN pnpm --filter @arqqbot/server build
RUN pnpm --filter @arqqbot/server deploy --prod --legacy /out/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV ARQQBOT_DATA_DIR=/data
ENV ARQQBOT_HOST=0.0.0.0
ENV ARQQBOT_PORT=17800
WORKDIR /app

COPY --from=build /out/server ./
COPY --from=build /repo/packages/runtime/dist/worker-entry.cjs ./runtime/worker-entry.cjs
COPY --from=build /repo/apps/desktop/out/renderer-web ./web
COPY --from=build /repo/packages/plugin-echo/package.json ./builtin/plugin-echo/package.json
COPY --from=build /repo/packages/plugin-echo/dist ./builtin/plugin-echo/dist
COPY --from=build /repo/packages/plugin-persona-distill/package.json ./builtin/plugin-persona-distill/package.json
COPY --from=build /repo/packages/plugin-persona-distill/dist ./builtin/plugin-persona-distill/dist

RUN groupadd --gid 10001 arqqbot \
  && useradd --uid 10001 --gid 10001 --create-home arqqbot \
  && mkdir -p /data \
  && chown -R arqqbot:arqqbot /data /app

USER arqqbot
VOLUME /data
EXPOSE 17800

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.ARQQBOT_PORT || 17800) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js", "serve", \
  "--data-dir", "/data", \
  "--host", "0.0.0.0", \
  "--port", "17800", \
  "--builtin-plugins", "/app/builtin", \
  "--worker-entry", "/app/runtime/worker-entry.cjs", \
  "--web-root", "/app/web", \
  "--autostart"]
