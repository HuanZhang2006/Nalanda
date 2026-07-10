# NestJS 后端 —— pnpm monorepo 多阶段构建
# 构建上下文 = monorepo 根目录（见 docker-compose.yml: api.build.context = ../..）
# 产物入口：apps/api/dist/main.js（包名 @nalanda/api）
# apps/api 已存在并可构建；当前业务仍主要直连 Supabase，本镜像只是薄 API。

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# 整个 monorepo 一起装（pnpm workspace 需要所有 package.json）
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nalanda/api build

# 抽出仅含生产依赖的自包含目录
RUN pnpm --filter @nalanda/api deploy --prod /deploy

# ── 运行层（精简）──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
