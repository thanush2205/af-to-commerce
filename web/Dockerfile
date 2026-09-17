FROM node:20-alpine

WORKDIR /app

# ---- Dependencies (cached layer) ----
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

# ---- Source ----
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development

EXPOSE 3001

# Dev-mode server for the documented demo stack. Payload's postgres adapter
# pushes schema changes on boot when NODE_ENV=development.
CMD ["sh", "-c", "npm run dev -- -H 0.0.0.0 -p 3001"]