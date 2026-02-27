const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

const GAME_DURATION = 180;
const MAP_TYPES = ['Maze', 'Forest', 'School'];
const SHAPES = ['triangle', 'box', 'circle'];

let rooms = {};
let matchmakingQueue = [];

function generateMap(type) {
    const walls = [];
    const decorations = [];
    let width = 2400;
    let height = 1600;
    let botCount = 15;
    let objectCount = 200;

    if (type === 'Maze') {
        width = 1600;
        height = 1600;
        botCount = 20;
        objectCount = 150;
        for (let i = 0; i < 15; i++) {
            walls.push({ x: i * 160, y: 0, w: 20, h: 1600 });
            if (i % 2 === 0) {
                walls.push({ x: i * 160, y: 400, w: 160, h: 20 });
                walls.push({ x: i * 160, y: 1200, w: 160, h: 20 });
            } else {
                walls.push({ x: i * 160, y: 800, w: 160, h: 20 });
            }
        }
    } else if (type === 'School') {
        width = 2800;
        height = 1600;
        botCount = 25;
        objectCount = 200;
        walls.push({ x: 0, y: 780, w: width, h: 40 });
        for (let i = 0; i < 12; i++) {
            walls.push({ x: i * 240, y: 0, w: 20, h: 700 });
            walls.push({ x: i * 240, y: 900, w: 20, h: 700 });
        }
    } else if (type === 'Forest') {
        width = 3200;
        height = 3200;
        botCount = 35;
        objectCount = 300;
        for (let i = 0; i < 250; i++) {
            decorations.push({
                type: 'tree',
                x: Math.random() * width,
                y: Math.random() * height,
                radius: 20 + Math.random() * 40
            });
        }
    }

    walls.push({ x: 0, y: 0, w: width, h: 20 });
    walls.push({ x: 0, y: height - 20, w: width, h: 20 });
    walls.push({ x: 0, y: 0, w: 20, h: height });
    walls.push({ x: width - 20, y: 0, w: 20, h: height });

    const objects = [];
    for (let i = 0; i < objectCount; i++) {
        let attempts = 0;
        let x = 100, y = 100;
        let valid = false;
        while (!valid && attempts < 100) {
            x = 100 + Math.random() * (width - 200);
            y = 100 + Math.random() * (height - 200);
            valid = true;
            for (let w of walls) {
                if (x + 24 > w.x && x - 24 < w.x + w.w && y + 24 > w.y && y - 24 < w.y + w.h) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                for (let d of decorations) {
                    const dx = x - d.x; const dy = y - d.y;
                    if (dx * dx + dy * dy < (d.radius + 24) * (d.radius + 24)) { valid = false; break; }
                }
            }
            attempts++;
        }

        objects.push({
            id: 'obj_' + i,
            x: x,
            y: y,
            shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
            color: 0x555555
        });
    }

    return { type, width, height, botCount, walls, decorations, objects };
}

function createBot(id, role, room) {
    return {
        id,
        x: room.map.width / 2 + (Math.random() * 400 - 200),
        y: room.map.height / 2 + (Math.random() * 400 - 200),
        rotation: 0,
        role,
        camouflage: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        isLightOn: Math.random() > 0.3,
        isDead: false,
        isSlowed: false,
        isBot: true,
        moveTick: 0
    };
}

function updateBots(roomId, deltaMs) {
    const room = rooms[roomId];
    if (!room) return;

    Object.values(room.players).filter(p => p.isBot && !p.isDead).forEach(bot => {
        bot.moveTick += deltaMs;

        // Randomly change direction occasionally
        if (Math.random() < 0.05) {
            bot.targetRotation = bot.rotation + (Math.random() * 2 - 1);
        }

        if (bot.targetRotation !== undefined) {
            // smooth rotate
            bot.rotation += (bot.targetRotation - bot.rotation) * 0.1;
        }

        const dist = 100 * (deltaMs / 1000); // 100 px per second
        let nextX = bot.x + Math.cos(bot.rotation) * dist;
        let nextY = bot.y + Math.sin(bot.rotation) * dist;

        let collide = false;
        for (let w of room.map.walls) {
            if (nextX + 12 > w.x && nextX - 12 < w.x + w.w && nextY + 12 > w.y && nextY - 12 < w.y + w.h) {
                collide = true; break;
            }
        }
        for (let d of room.map.decorations || []) {
            const dx = nextX - d.x; const dy = nextY - d.y;
            if (dx * dx + dy * dy < (d.radius + 12) * (d.radius + 12)) { collide = true; break; }
        }

        if (!collide) {
            bot.x = Math.max(30, Math.min(room.map.width - 30, nextX));
            bot.y = Math.max(30, Math.min(room.map.height - 30, nextY));
        } else {
            bot.targetRotation = bot.rotation + Math.PI + (Math.random() - 0.5);
        }

        // Emit batched or less frequently? Let's just emit moves if significant or periodically
        // since it's a small app, we can emit bot moves often, or every 100ms
        if (bot.moveTick > 100) {
            io.to(roomId).emit('playerMoved', { id: bot.id, x: bot.x, y: bot.y, rotation: bot.rotation });
            bot.moveTick = 0;
        }

        if (Math.random() < 0.005) {
            bot.isLightOn = !bot.isLightOn;
            io.to(roomId).emit('lightToggled', { id: bot.id, isLightOn: bot.isLightOn });
        }
    });
}

io.on('connection', (socket) => {
    socket.on('joinQueue', () => {
        if (!matchmakingQueue.find(p => p.id === socket.id)) {
            matchmakingQueue.push({ id: socket.id, startTime: Date.now() });
        }
    });

    socket.on('joinRoom', (data) => {
        const { roomId, roomType } = data;
        onPlayerJoin(socket, roomId, roomType);
    });

    socket.on('move', (moveData) => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id] && !room.players[socket.id].isDead) {
            room.players[socket.id].x = moveData.x;
            room.players[socket.id].y = moveData.y;
            room.players[socket.id].rotation = moveData.rotation;
            socket.to(socket.roomId).emit('playerMoved', room.players[socket.id]);
        }
    });

    socket.on('toggleLight', (isOn) => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isLightOn = isOn;
            io.to(socket.roomId).emit('lightToggled', { id: socket.id, isLightOn: isOn });
        }
    });

    socket.on('chargeLight', (isCharging) => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isCharging = isCharging;
            io.to(socket.roomId).emit('lightCharging', { id: socket.id, isCharging });
        }
    });

    socket.on('player_killed', (targetId) => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id] && room.players[socket.id].role === 'hunter' && room.players[targetId]) {
            room.players[targetId].isDead = true;
            io.to(socket.roomId).emit('player_died', targetId);
        }
    });

    socket.on('hunter_slowdown', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id] && room.players[socket.id].role === 'hunter') {
            room.players[socket.id].isSlowed = true;
            setTimeout(() => {
                if (room.players[socket.id]) room.players[socket.id].isSlowed = false;
                io.to(socket.roomId).emit('hunter_restored', socket.id);
            }, 3000);
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            delete room.players[socket.id];
            if (socket.id === room.hunterId) {
                room.hunterId = Object.keys(room.players).find(id => room.players[id].role === 'survivor') || null;
            }
            io.to(roomId).emit('playerLeft', socket.id);
            if (Object.keys(room.players).filter(id => !room.players[id].isBot).length === 0) {
                delete rooms[roomId];
            }
        }
    });
});

function onPlayerJoin(socket, roomId, roomType) {
    socket.join(roomId);
    if (!rooms[roomId]) {
        rooms[roomId] = {
            id: roomId,
            players: {},
            hunterId: null,
            gameStartTime: Date.now(),
            map: generateMap(MAP_TYPES[Math.floor(Math.random() * MAP_TYPES.length)])
        };
    }

    const room = rooms[roomId];
    room.players[socket.id] = {
        id: socket.id,
        x: room.map.width / 2,
        y: room.map.height / 2,
        rotation: 0,
        role: 'survivor',
        camouflage: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        isLightOn: false,
        isCharging: false,
        isDead: false,
        isSlowed: false,
        isBot: false
    };

    if (!room.hunterId) {
        room.hunterId = socket.id;
        room.players[socket.id].role = 'hunter';
    }

    socket.emit('init', {
        id: socket.id,
        players: room.players,
        map: room.map,
        timer: Math.max(0, GAME_DURATION - Math.floor((Date.now() - room.gameStartTime) / 1000))
    });

    socket.to(roomId).emit('playerJoined', room.players[socket.id]);
    socket.roomId = roomId;

    // Private rooms used to autofill with bots entirely, 
    // blocking real players from joining. We removed that.
    // Real players can seamlessly join a private room via the Room ID now!
}

setInterval(() => {
    const now = Date.now();
    if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();
        const roomId = `match_${now}`;
        io.to(p1.id).emit('matchFound', { roomId });
        io.to(p2.id).emit('matchFound', { roomId });
    }

    matchmakingQueue.forEach((p, index) => {
        if (now - p.startTime > 10000) {
            const roomId = `bot_match_${now}`;
            io.to(p.id).emit('matchFound', { roomId });
            matchmakingQueue.splice(index, 1);

            setTimeout(() => {
                if (rooms[roomId]) {
                    for (let i = 0; i < rooms[roomId].map.botCount; i++) {
                        const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
                        const bot = createBot(botId, 'survivor', rooms[roomId]);
                        rooms[roomId].players[botId] = bot;
                        io.to(roomId).emit('playerJoined', bot);
                    }
                }
            }, 1000);
        }
    });
}, 1000);

// separate game loop for smooth bot movement and physics if any
let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    const delta = now - lastTime;
    lastTime = now;
    Object.keys(rooms).forEach(id => updateBots(id, delta));
}, 33);

setInterval(() => {
    Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        const timeLeft = Math.max(0, GAME_DURATION - Math.floor((Date.now() - room.gameStartTime) / 1000));
        if (timeLeft === 0) {
            io.to(roomId).emit('game_reset');
            delete rooms[roomId];
        }
    });
}, 1000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
