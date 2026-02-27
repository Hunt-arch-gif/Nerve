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
        width = 1600; height = 1600; botCount = 20; objectCount = 150;

        // Center hub (true maze around it)
        walls.push({ x: 600, y: 600, w: 400, h: 20 });
        walls.push({ x: 600, y: 980, w: 400, h: 20 });
        walls.push({ x: 600, y: 600, w: 20, h: 100 }); // Gap on left
        walls.push({ x: 600, y: 880, w: 20, h: 120 });
        walls.push({ x: 980, y: 600, w: 20, h: 100 }); // Gap on right
        walls.push({ x: 980, y: 880, w: 20, h: 120 });

        // Outer maze walls. Using a fixed pattern to ensure connectivity without procedural deadlocks
        for (let i = 1; i < 10; i++) {
            let x = i * 160;
            if (x > 500 && x < 1100) continue; // Skip area around center hub

            if (i % 2 === 0) {
                walls.push({ x: x, y: 0, w: 20, h: 400 });
                walls.push({ x: x, y: 550, w: 20, h: 500 });
                walls.push({ x: x, y: 1200, w: 20, h: 400 });
            } else {
                walls.push({ x: x, y: 0, w: 20, h: 250 });
                walls.push({ x: x, y: 400, w: 20, h: 800 });
                walls.push({ x: x, y: 1350, w: 20, h: 250 });
            }
        }

        // Add horizontal walls for the top and bottom true maze sections
        for (let j = 1; j < 10; j++) {
            let y = j * 160;
            if (y > 500 && y < 1100) continue;
            if (j % 2 === 0) {
                walls.push({ x: 0, y: y, w: 600, h: 20 });
                walls.push({ x: 1000, y: y, w: 600, h: 20 });
            }
        }

    } else if (type === 'School') {
        width = 2800; height = 1600; botCount = 25; objectCount = 200;

        // Central hallway horizontal walls, left side
        walls.push({ x: 0, y: 700, w: 1200, h: 20 });
        walls.push({ x: 0, y: 900, w: 1200, h: 20 });
        // Gap in the middle for the hallway crossing
        walls.push({ x: 1600, y: 700, w: 1200, h: 20 });
        walls.push({ x: 1600, y: 900, w: 1200, h: 20 });

        for (let i = 1; i < 12; i++) {
            let rx = i * 240;

            // Define Gym (top right) and Principal's Office (bottom left) as dead ends
            let isGym = rx >= 2400;
            let isPrincipal = rx <= 240;

            if (isGym) {
                // Gym: Huge room, only one entrance (dead end)
                if (rx === 2400) walls.push({ x: rx, y: 0, w: 20, h: 700 }); // Left wall
                // No middle walls in gym
            } else if (isPrincipal) {
                // Principal's Office: Small room, only one entrance (dead end)
                if (rx === 240) {
                    walls.push({ x: rx, y: 900, w: 20, h: 700 }); // Right wall
                }
            } else {
                // Classrooms: Need multiple entry points (2 doorways, not large gaps)
                // Top classrooms
                walls.push({ x: rx, y: 0, w: 20, h: 300 });
                walls.push({ x: rx, y: 400, w: 20, h: 300 }); // Gap at y:300-400

                // Bottom classrooms
                walls.push({ x: rx, y: 900, w: 20, h: 300 });
                walls.push({ x: rx, y: 1300, w: 20, h: 300 }); // Gap at y:1200-1300
            }
        }
    } else if (type === 'Forest') {
        width = 3000; height = 3000; botCount = 35; objectCount = 300;

        // Map Border built of trees! Impossibly thick ring of trees around the perimeter
        for (let i = -100; i <= width + 100; i += 60) {
            decorations.push({ type: 'tree', x: i, y: -60, radius: 45 });
            decorations.push({ type: 'tree', x: i, y: height + 60, radius: 45 });
            decorations.push({ type: 'tree', x: i, y: -120, radius: 50 });
            decorations.push({ type: 'tree', x: i, y: height + 120, radius: 50 });
        }
        for (let j = -100; j <= height + 100; j += 60) {
            decorations.push({ type: 'tree', x: -60, y: j, radius: 45 });
            decorations.push({ type: 'tree', x: width + 60, y: j, radius: 45 });
            decorations.push({ type: 'tree', x: -120, y: j, radius: 50 });
            decorations.push({ type: 'tree', x: width + 120, y: j, radius: 50 });
        }

        // Generate normal internal trees with minimum walkable gap
        let attempts = 0;
        while (decorations.length < 200 + 400 && attempts < 2000) {
            let tx = 100 + Math.random() * (width - 200);
            let ty = 100 + Math.random() * (height - 200);
            let tradius = 20 + Math.random() * 40;
            let ok = true;
            for (let d of decorations) {
                let dist = Math.sqrt((tx - d.x) ** 2 + (ty - d.y) ** 2);
                if (dist < tradius + d.radius + 60) { ok = false; break; }
            }
            if (ok) {
                decorations.push({ type: 'tree', x: tx, y: ty, radius: tradius });
            }
            attempts++;
        }
    }

    // Thick solid border walls to ensure pure black perimeter and clear edges
    walls.push({ x: -100, y: -100, w: width + 200, h: 100 });
    walls.push({ x: -100, y: height, w: width + 200, h: 100 });
    walls.push({ x: -100, y: 0, w: 100, h: height });
    walls.push({ x: width, y: 0, w: 100, h: height });

    const objects = [];

    // In Forest: Generate objects in path formations
    if (type === 'Forest') {
        let numPaths = 15;
        let objPerPath = 20;
        for (let p = 0; p < numPaths; p++) {
            let startX = 200 + Math.random() * (width - 400);
            let startY = 200 + Math.random() * (height - 400);
            let angle = Math.random() * Math.PI * 2;
            let currentShape = SHAPES[Math.floor(Math.random() * 3)];

            for (let i = 0; i < objPerPath && objects.length < objectCount; i++) {
                startX += Math.cos(angle) * 70;
                startY += Math.sin(angle) * 70;
                angle += (Math.random() - 0.5) * 0.5; // slight curve

                // Bounds check
                if (startX < 100 || startX > width - 100 || startY < 100 || startY > height - 100) break;

                let valid = true;
                for (let d of decorations) {
                    const dist = Math.sqrt((startX - d.x) ** 2 + (startY - d.y) ** 2);
                    if (dist < d.radius + 40) { valid = false; break; }
                }

                if (valid) {
                    objects.push({
                        id: 'obj_' + objects.length,
                        x: startX, y: startY,
                        shape: currentShape,
                        color: 0x555555
                    });
                }
            }
        }
    }

    // Fill remaining objects randomly for all maps
    for (let i = objects.length; i < objectCount; i++) {
        let attempts = 0;
        let valid = false;
        let x = 100, y = 100;
        while (!valid && attempts < 100) {
            x = 100 + Math.random() * (width - 200);
            y = 100 + Math.random() * (height - 200);
            valid = true;
            for (let w of walls) {
                if (x + 40 > w.x && x - 40 < w.x + w.w && y + 40 > w.y && y - 40 < w.y + w.h) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                for (let d of decorations) {
                    const dist = Math.sqrt((x - d.x) ** 2 + (y - d.y) ** 2);
                    if (dist < d.radius + 40) { valid = false; break; }
                }
            }
            attempts++;
        }

        if (valid) {
            objects.push({
                id: 'obj_' + i,
                x: x,
                y: y,
                shape: SHAPES[Math.floor(Math.random() * 3)],
                color: 0x555555
            });
        }
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
