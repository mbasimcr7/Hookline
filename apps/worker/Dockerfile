FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY packages/mq ./packages/mq
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @hookline/db generate
RUN pnpm --filter @hookline/shared build
RUN pnpm --filter @hookline/mq build
RUN pnpm --filter @hookline/db build
RUN pnpm --filter @hookline/worker build

CMD ["pnpm", "--filter", "@hookline/worker", "start"]
