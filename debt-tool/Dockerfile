# Mlinjana Financial Group — Client Debt Tool
#
# Node 22 is required: the database layer uses the built-in node:sqlite, which
# means there is nothing to compile and no native module to go wrong on deploy.

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not re-run npm ci on every build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The database lives on a mounted volume, not in the image. Without a volume
# mounted here the file is lost every time the container restarts — see
# DEPLOY.md, this is the single most important thing to get right.
ENV DATABASE_FILE=/data/mfg-debt-tool.db
VOLUME ["/data"]

# Run as an unprivileged user. The node image ships a `node` user for this.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4000

# Platforms that inject their own PORT are honoured by src/config.js.
CMD ["node", "src/server.js"]
