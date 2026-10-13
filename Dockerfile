# syntax=docker/dockerfile:1.4
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install system dependencies (git, ripgrep, curl, bubblewrap if available)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Copy repo configuration and package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/safety/package.json ./packages/safety/
COPY packages/state/package.json ./packages/state/
COPY packages/tui/package.json ./packages/tui/
COPY packages/vscode/package.json ./packages/vscode/
COPY packages/cli/package.json ./packages/cli/
COPY packages/bench/package.json ./packages/bench/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY . .
RUN pnpm build

# Set entrypoint to Zenith Code CLI
ENV NODE_ENV=production
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["--help"]
