FROM node:20-slim

WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy server code and public assets (so server can still serve them if hit directly)
COPY . .

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Run the server
CMD [ "npm", "start" ]
