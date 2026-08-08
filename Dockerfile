# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build


FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node server ./server
COPY --chown=node:node database ./database
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node knowledge ./knowledge

RUN mkdir -p /app/.data \
    && chown node:node /app/.data

USER node

EXPOSE 3000
CMD ["npm", "start"]
