# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY manual/package.json manual/package-lock.json ./manual/
RUN npm --prefix manual ci --ignore-scripts

COPY . .
ENV NEXT_PUBLIC_VALOR360_EMBEDDED=1
RUN npm run build \
    && npm --prefix manual run build


FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Voice Capture validates the real container duration server-side. This blocks
# clients from bypassing the 15-minute policy with forged metadata.
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/manual/.next/standalone/manual ./manual
COPY --from=build --chown=node:node /app/manual/.next/static ./manual/.next/static
COPY --from=build --chown=node:node /app/manual/public ./manual/public
COPY --from=build --chown=node:node /app/manual/app/agrofit-products.json /app/manual/app/foliar-products.json ./manual/app/
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node server ./server
COPY --chown=node:node database ./database
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node knowledge ./knowledge

RUN mkdir -p /app/.data \
    && chown node:node /app/.data

USER node

EXPOSE 8080
CMD ["npm", "start"]
