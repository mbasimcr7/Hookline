FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/dashboard ./apps/dashboard

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @hookline/shared build
RUN pnpm --filter @hookline/dashboard build

EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@hookline/dashboard", "start"]
