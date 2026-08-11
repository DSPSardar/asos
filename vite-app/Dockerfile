FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Vite bakes import.meta.env.VITE_* into the bundle at build time (`npm run
# build` below), not at runtime. Docker isolates a Dockerfile build from the
# host environment by design — Railway does not automatically forward its
# service Variables into a Dockerfile build the way it does for Nixpacks.
# Every VITE_* variable this app reads must be declared here with ARG or it
# silently bakes in as empty, no matter what is set in the Railway dashboard.
# https://docs.railway.com/guides/build-time-vs-runtime-secrets
#
# This was the actual reason a fresh redeploy after setting new bank-transfer
# variables still shipped the old (empty) values: Docker also reused its
# cached RUN npm run build layer, since none of the earlier COPY layers had
# changed — so even a correct ARG list needs a build with --no-cache, or a
# source change, the first time new variables are added.
#
# Keep this list in sync with every `import.meta.env.VITE_*` read in src/ —
# grep for it if a new one is ever added:
#   grep -rhoE "import\.meta\.env\.VITE_[A-Z0-9_]+" src | sort -u
ARG VITE_API_URL
ARG VITE_UPLOADS_ORIGIN
ARG VITE_WHATSAPP_WEBHOOK_URL
ARG VITE_MARKETING_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GA4_MEASUREMENT_ID
ARG VITE_BRAND_NAME
ARG VITE_SALES_EMAIL
ARG VITE_SUPPORT_EMAIL
ARG VITE_BANK_NAME
ARG VITE_BANK_ACCOUNT_TITLE
ARG VITE_BANK_ACCOUNT_NUMBER
ARG VITE_BANK_IBAN
ARG VITE_BANK_BRANCH
ARG VITE_BANK_BRANCH_CODE
ARG VITE_SENTRY_DSN

# RAILWAY_GIT_COMMIT_SHA is Railway's own automatically-provided variable
# (docs.railway.com/variables/reference#git-variables), not one set by hand
# in the dashboard — but it is subject to the exact same rule as every other
# variable above: Railway does not forward it into a Dockerfile build unless
# it's declared with ARG here too. Remapped to a VITE_-prefixed name via ENV
# because Vite only bakes import.meta.env values whose name actually starts
# with VITE_; the source variable's name does not.
ARG RAILWAY_GIT_COMMIT_SHA
ENV VITE_APP_VERSION=$RAILWAY_GIT_COMMIT_SHA

RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
