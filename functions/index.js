const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Global options for performance
setGlobalOptions({
    maxInstances: 1, // MUST BE 1 for stateful in-memory rooms and socket.io without Redis!
    concurrency: 80, // Allow more concurrent requests for WebSockets
    cpu: 1,
    memory: "512MiB"
});

// Import the existing server logic but adapt it to be exportable
// We will create the server components here to ensure they are tied to the Cloud Function lifecycle correctly
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Load the shared game logic from our local server.js but modify it to use the 'io' defined here
// Since server.js is written as a standalone script, we'll require it and it will handle the socket logic
// However, Firebase Function expects us to pass the 'request' and 'response'.
// Socket.io on Firebase Functions v2 works via Cloud Run's streaming support.

// Export the function as 'gameServer' to match firebase.json rewrites
exports.gameServer = onRequest({
    cors: true,
    invoker: 'public'
}, (req, res) => {
    server.emit('request', req, res);
});

// Re-integrate the socket logic from server.js here or require it
// For simplicity and reliability in the function environment, we'll keep the logic in this file or a helper.
const gameLogic = require('./server_logic'); // We'll create this from the functional parts of server.js
gameLogic.init(io);
