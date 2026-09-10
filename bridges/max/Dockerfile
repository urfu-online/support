FROM node:22-alpine AS build
WORKDIR /app
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
COPY max/package.json max/tsconfig.json ./max/
COPY max/src ./max/src
WORKDIR /app/shared
RUN npm install && npm run build
WORKDIR /app/max
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/shared /app/shared
COPY --from=build /app/max/package.json /app/max/package.json
COPY --from=build /app/max/dist /app/max/dist
COPY --from=build /app/max/node_modules /app/max/node_modules
WORKDIR /app/max
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
