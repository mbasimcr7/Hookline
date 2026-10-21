FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/receiver ./apps/receiver

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @hookline/shared build
RUN pnpm --filter @hookline/receiver build

EXPOSE 4000
CMD ["pnpm", "--filter", "@hookline/receiver", "start"]
