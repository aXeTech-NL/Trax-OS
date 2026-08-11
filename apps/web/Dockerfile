FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json
RUN npm ci

COPY apps/web ./apps/web
COPY packages/api-client ./packages/api-client
COPY packages/api-contract/generated ./packages/api-contract/generated
RUN npm run build --workspace @trax-os/web

FROM nginxinc/nginx-unprivileged:1.28.0-alpine3.21@sha256:c97ff0bf7cbae369953c6da1232ec14ad9f971d66360c5698db0856a4cd657a0

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /workspace/apps/web/dist /usr/share/nginx/html

USER 101:101
EXPOSE 8080
