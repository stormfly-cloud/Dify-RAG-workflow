FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @heritage/mobile... --frozen-lockfile

FROM deps AS build
ARG TARO_APP_API_BASE_URL
ENV TARO_APP_API_BASE_URL=${TARO_APP_API_BASE_URL}
COPY apps/mobile apps/mobile
COPY packages/contracts packages/contracts
RUN pnpm --filter @heritage/mobile build:h5

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html
COPY deploy/nginx/mobile.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
