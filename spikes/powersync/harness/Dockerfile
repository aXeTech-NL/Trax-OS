ARG NODE_IMAGE=node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
FROM ${NODE_IMAGE}

WORKDIR /spike
COPY package.json package-lock.json ./
RUN npx --yes npm@10.9.4 ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npx --yes npm@10.9.4 run build

USER node
EXPOSE 6060
CMD ["node", "lib/src/token-server.js"]
