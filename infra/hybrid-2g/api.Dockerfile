# NestJS backend — multi-stage pnpm monorepo build
# Build context = monorepo root (see docker-compose.yml: api.build.context = ../..)
# Build entry point: apps/api/dist/main.js (package @nalanda/api)
# Older modules mostly still talk to Supabase from the browser; Courses, sharing/market, and speech go through this API.

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Install the whole monorepo together (the pnpm workspace needs every package.json)
COPY . .
RUN pnpm install --frozen-lockfile
# The API imports the workspace package through its published dist contract.
# Build workspace dependencies first so a clean container does not rely on
# artifacts that happened to exist in the checkout used by the caller.
RUN pnpm --filter @nalanda/api... build

# Extract a self-contained directory with production dependencies only
RUN pnpm --filter @nalanda/api deploy --prod /deploy

# ── Runtime stage (slim) ──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
