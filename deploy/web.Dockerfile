ARG APP=web
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
ARG APP
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/${APP}/package.json apps/${APP}/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @heritage/${APP}... --frozen-lockfile

FROM deps AS build
ARG APP
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY apps/${APP} apps/${APP}
COPY packages/contracts packages/contracts
RUN pnpm --filter @heritage/${APP} build

FROM base AS runtime
ARG APP
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app .
WORKDIR /app/apps/${APP}
EXPOSE 3000
CMD ["pnpm", "start", "--", "-p", "3000"]
