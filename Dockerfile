# Use Node 18 as base image
FROM node:18

# Create and set the working directory
WORKDIR /app

# Copy everything into the container
COPY . .

# Install dependencies
RUN npm install

# Expose the default port (change if needed)
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
