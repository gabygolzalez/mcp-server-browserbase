FROM node:22-alpine

WORKDIR /app

# Copy everything at once
COPY . .

# Install all dependencies
RUN npm install

# Install playwright
RUN npx playwright install

# Build the TypeScript code
RUN npm run build

# Remove development dependencies
RUN npm prune --production

# Expose the server port
EXPOSE 3001

# Run the SSE server
CMD ["node", "dist/index-sse.js"]