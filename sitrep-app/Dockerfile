FROM node:22-alpine AS build

WORKDIR /app

# Vite replaces this at build time, so the frontend bundle knows the public API
# endpoint before nginx serves static files.
ARG VITE_GRAPHQL_URL
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_GRAPHQL_URL=$VITE_GRAPHQL_URL
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

# Runtime image only needs nginx plus the compiled static assets.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
