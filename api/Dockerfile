FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl tzdata
ENV TZ=Asia/Riyadh NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts tsconfig.json ./
COPY src ./src
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
# ترحيل قاعدة البيانات ثم تشغيل الخادم
CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/server.js"]
