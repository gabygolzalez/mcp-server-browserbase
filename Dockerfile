FROM node:18

# Set working directory to the actual app folder
WORKDIR /app

# Copy only the folder that has the package.json
COPY browserbase/package*.json ./

# Install deps
RUN npm install

# Copy the rest of the app
COPY browserbase .

# Set port (if your app needs one)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
