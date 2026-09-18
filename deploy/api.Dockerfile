FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/dify-client/package.json packages/dify-client/package.json
RUN pnpm install --filter @heritage/api... --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/dify-client packages/dify-client
RUN pnpm --filter @heritage/contracts build
RUN pnpm --filter @heritage/dify-client build
RUN pnpm --filter @heritage/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml ./
WORKDIR /app/apps/api
EXPOSE 3100
CMD ["node", "dist/main.js"]
