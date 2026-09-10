FROM node:22-alpine AS build
WORKDIR /app
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
COPY vk/package.json vk/tsconfig.json ./vk/
COPY vk/src ./vk/src
WORKDIR /app/shared
RUN npm install && npm run build
WORKDIR /app/vk
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/shared /app/shared
COPY --from=build /app/vk/package.json /app/vk/package.json
COPY --from=build /app/vk/dist /app/vk/dist
COPY --from=build /app/vk/node_modules /app/vk/node_modules
WORKDIR /app/vk
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
