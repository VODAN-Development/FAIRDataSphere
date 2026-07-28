FROM node:22-alpine

WORKDIR /app

# Run the backend in production mode; runtime env values still come from compose.
ENV NODE_ENV=production

# Install only production dependencies before copying source for better layer
# caching and a smaller container.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Apollo/Express listens on this port inside the compose network.
EXPOSE 4000

CMD ["node", "server.js"]
