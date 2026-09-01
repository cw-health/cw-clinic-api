# Local development/testing only — Plesk deployment does not use this image
# (see docs/DEPLOYMENT.md). Not tuned as a hardened production image.
FROM node:20-bookworm-slim

# The slim base image has no OpenSSL — without it, Prisma can't detect
# which libssl version it's running against and silently guesses wrong,
# which can pull an engine binary that doesn't match binaryTargets in
# prisma/schema.prisma (debian-openssl-3.0.x) and fail at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# prisma.config.ts and prisma/ must be present before `npm ci`, since its
# `postinstall` hook runs `prisma generate`, which reads both.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/main.js"]
