FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.mts ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM nginx:1.27-alpine AS gateway
COPY --from=build /app/dist/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/ms-flota/schema.sql ./dist/ms-flota/schema.sql
COPY src/ms-tarifas/schema.sql ./dist/ms-tarifas/schema.sql
EXPOSE 3000 3001 3002
CMD ["node", "dist/ms-viajes/servidor.js"]
