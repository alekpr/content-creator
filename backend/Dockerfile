FROM node:22-alpine AS builder
WORKDIR /app

# Copy shared package first for workspace resolution
COPY ../shared /shared
COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p temp output

EXPOSE 3001
CMD ["node", "dist/server.js"]
