FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV DATABASE_PATH=/app/data/campaign.db PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node_modules/.bin/tsx", "src/server.ts"]
