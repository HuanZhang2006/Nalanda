# NestJS 后端 —— pnpm monorepo 多阶段构建
# 构建上下文 = monorepo 根目录（见 docker-compose.yml: api.build.context = ../..）
# 假设：apps/api 包名为 @nalanda/api，产物为 apps/api/dist/main.js
# 注意：apps/api 需在阶段 0 脚手架完成后，本构建才能成功。

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# ── 依赖层（仅复制清单，缓存友好）──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile

# ── 构建层 ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @nalanda/api build

# ── 运行层（精简）──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
