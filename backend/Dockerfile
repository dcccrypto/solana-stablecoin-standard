FROM node:20-slim AS builder
WORKDIR /app

COPY sdk/package.json sdk/package-lock.json* sdk/
COPY sdk/src sdk/src
COPY sdk/tsconfig.json sdk/
RUN cd sdk && npm ci && npm run build

COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm ci

COPY backend/src backend/src
COPY backend/tsconfig.json backend/
RUN cd backend && npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/sdk/package.json sdk/
COPY --from=builder /app/sdk/dist sdk/dist
COPY --from=builder /app/sdk/node_modules sdk/node_modules

COPY --from=builder /app/backend/package.json backend/
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/node_modules backend/node_modules

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
