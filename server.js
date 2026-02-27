const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Load the shared game logic
const gameLogic = require('./functions/server_logic');
gameLogic.init(io);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Local test server running on port ${PORT}`));
