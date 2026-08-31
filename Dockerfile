# Local development/testing only — Plesk deployment does not use this image
# (see docs/DEPLOYMENT.md). Not tuned as a hardened production image.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/main.js"]
