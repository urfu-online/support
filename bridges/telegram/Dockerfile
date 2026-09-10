FROM node:22-alpine AS build
WORKDIR /app
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
COPY telegram/package.json telegram/tsconfig.json ./telegram/
COPY telegram/src ./telegram/src
WORKDIR /app/shared
RUN npm install && npm run build
WORKDIR /app/telegram
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/shared /app/shared
COPY --from=build /app/telegram/package.json /app/telegram/package.json
COPY --from=build /app/telegram/dist /app/telegram/dist
COPY --from=build /app/telegram/node_modules /app/telegram/node_modules
WORKDIR /app/telegram
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
