FROM node:20-alpine

WORKDIR /app

# Layer the dependency install so the npm ci cache stays warm across edits.
COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY src ./src

ENV PORT=8000
EXPOSE 8000

CMD ["node", "src/server.js"]