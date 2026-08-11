FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY sql ./sql
COPY src ./src

ENV PORT=3080
EXPOSE 3080

CMD ["node", "src/server.js"]
