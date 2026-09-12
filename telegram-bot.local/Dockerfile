FROM node:22-alpine AS build
WORKDIR /workspace
COPY telegram-bot.local/package*.json ./
RUN npm ci
COPY telegram-bot.local/ ./telegram-bot.local/
COPY src/model ./src/model/
WORKDIR /workspace/telegram-bot.local
RUN npm run typecheck && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY telegram-bot.local/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /workspace/telegram-bot.local/dist ./dist
COPY telegram-bot.local/migrations ./migrations
EXPOSE 8080
CMD ["node", "dist/main.js"]
