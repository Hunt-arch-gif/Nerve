const GAME_DURATION = 180;
const START_DELAY = 10;
const MAP_TYPES = ['Maze', 'Forest', 'School'];
const SHAPES = ['triangle', 'box', 'circle'];

let rooms = {};
let matchmakingQueue = [];
let io;

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

function findValidSpawn(map) {
    for (let i = 0; i < 100; i++) {
        const x = 50 + Math.random() * (map.width - 100);
        const y = 50 + Math.random() * (map.height - 100);
        let valid = true;
        for (let w of map.walls) {
            if (x + 30 > w.x && x - 30 < w.x + w.w && y + 30 > w.y && y - 30 < w.y + w.h) {
                valid = false; break;
            }
        }
        if (valid) return { x, y };
    }
    return { x: map.width / 2, y: map.height / 2 };
}

function createBot(id, role, room) {
    return {
        id,
        x: room.map.width / 2,
        y: room.map.height / 2,
        rotation: 0,
        role,
        camouflage: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        isLightOn: Math.random() > 0.3,
        isDead: false,
        isSlowed: false,
        isBot: true,
        moveTick: 0,
        stats: { kills: 0, reveals: 0, surviveTime: 0, placement: 0 }
    };
}

function updateBots(roomId, deltaMs) {
    const room = rooms[roomId];
    if (!room || room.state !== 'playing') return;

    Object.values(room.players).filter(p => p.isBot && !p.isDead).forEach(bot => {
        bot.moveTick += deltaMs;
        if (Math.random() < 0.05) bot.targetRotation = bot.rotation + (Math.random() * 2 - 1);
        if (bot.targetRotation !== undefined) bot.rotation += (bot.targetRotation - bot.rotation) * 0.1;

        const dist = 100 * (deltaMs / 1000);
        let nextX = bot.x + Math.cos(bot.rotation) * dist;
        let nextY = bot.y + Math.sin(bot.rotation) * dist;

        let collide = false;
        for (let w of room.map.walls) {
            if (nextX + 12 > w.x && nextX - 12 < w.x + w.w && nextY + 12 > w.y && nextY - 12 < w.y + w.h) {
                collide = true; break;
            }
        }
        if (!collide) {
            bot.x = Math.max(30, Math.min(room.map.width - 30, nextX));
            bot.y = Math.max(30, Math.min(room.map.height - 30, nextY));
        } else {
            bot.targetRotation = bot.rotation + Math.PI + (Math.random() - 0.5);
        }

        if (bot.moveTick > 100) {
            io.to(roomId).emit('playerMoved', { id: bot.id, x: bot.x, y: bot.y, rotation: bot.rotation });
            bot.moveTick = 0;
        }
    });
}

function endGame(room, reason) {
    if (room.state !== 'playing') return;
    room.state = 'results';
    const duration = Math.floor((Date.now() - room.gameStartTime) / 1000);
    Object.values(room.players).forEach(p => {
        if (p.role === 'survivor' && !p.isDead) {
            p.stats.placement = 1;
            p.stats.surviveTime = duration;
        }
    });
    io.to(room.id).emit('gameOver', { reason, results: room.players, duration });
}

function init(socketIo) {
    io = socketIo;
    io.on('connection', (socket) => {
        socket.on('joinQueue', () => {
            if (!matchmakingQueue.find(p => p.id === socket.id)) {
                matchmakingQueue.push({ id: socket.id, startTime: Date.now() });
            }
        });

        socket.on('joinRoom', (data) => {
            const { roomId } = data;
            socket.join(roomId);
            if (!rooms[roomId]) {
                rooms[roomId] = {
                    id: roomId,
                    players: {},
                    hostId: socket.id,
                    state: 'lobby',
                    gameStartTime: null,
                    maxHunters: 1,
                    maxSurvivors: 7,
                    map: generateMap(MAP_TYPES[Math.floor(Math.random() * MAP_TYPES.length)])
                };
            }
            const room = rooms[roomId];
            const hunterCount = Object.values(room.players).filter(p => p.role === 'hunter').length;
            let role = (hunterCount < room.maxHunters) ? 'hunter' : 'survivor';
            if (data.requestedRole && Object.keys(room.players).length === 0) role = data.requestedRole;

            const isLateJoin = room.state === 'playing';
            room.players[socket.id] = {
                id: socket.id,
                name: `Player ${Object.keys(room.players).length + 1}`,
                x: room.map.width / 2, y: room.map.height / 2, rotation: 0,
                role: role, camouflage: SHAPES[Math.floor(Math.random() * SHAPES.length)],
                isLightOn: false, isCharging: false, isDead: isLateJoin, isSlowed: false, isBot: false,
                stats: { kills: 0, reveals: 0, surviveTime: 0, placement: 0 }
            };
            socket.roomId = roomId;
            io.to(roomId).emit('roomUpdate', {
                roomId: room.id, players: room.players, state: room.state, hostId: room.hostId,
                settings: { hunters: room.maxHunters, survivors: room.maxSurvivors }
            });
        });

        socket.on('startGame', (config) => {
            const room = rooms[socket.roomId];
            if (room && room.hostId === socket.id && room.state === 'lobby') {
                room.state = 'starting';
                room.startTimer = Date.now();

                // Move everyone to center for the countdown start
                Object.values(room.players).forEach(p => {
                    p.x = room.map.width / 2;
                    p.y = room.map.height / 2;
                });

                if (config.fillBots) {
                    const targetTotal = room.maxSurvivors + room.maxHunters;
                    const botCount = targetTotal - Object.keys(room.players).length;
                    for (let i = 0; i < botCount; i++) {
                        const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
                        const hCount = Object.values(room.players).filter(p => p.role === 'hunter').length;
                        const bot = createBot(botId, hCount < room.maxHunters ? 'hunter' : 'survivor', room);
                        room.players[botId] = bot;
                    }
                }
                io.to(socket.roomId).emit('init', { players: room.players, map: room.map, timer: GAME_DURATION, state: 'starting' });
            }
        });

        socket.on('move', (moveData) => {
            const room = rooms[socket.roomId];
            if (!room || room.players[socket.id]?.isDead) return;

            const p = room.players[socket.id];
            // Hunter is locked in center during countdown
            if (room.state === 'starting' && p.role === 'hunter') return;
            // Otherwise allow move if in starting or playing state
            if (room.state === 'starting' || room.state === 'playing') {
                p.x = moveData.x;
                p.y = moveData.y;
                p.rotation = moveData.rotation;
                socket.to(socket.roomId).emit('playerMoved', p);
            }
        });

        socket.on('player_killed', (data) => {
            const { targetId, radius } = data;
            const room = rooms[socket.roomId];
            const hunter = room?.players[socket.id];
            const target = room?.players[targetId];
            if (room && room.state === 'playing' && hunter && hunter.role === 'hunter' && target && !target.isDead) {
                const dist = Math.sqrt((hunter.x - target.x) ** 2 + (hunter.y - target.y) ** 2);
                if (dist <= (radius || 150) + 30) {
                    target.isDead = true; hunter.stats.kills++;
                    const survivors = Object.values(room.players).filter(p => p.role === 'survivor' && !p.isDead);
                    target.stats.placement = survivors.length + 1;
                    target.stats.surviveTime = Math.floor((Date.now() - room.gameStartTime) / 1000);
                    io.to(socket.roomId).emit('player_died', targetId);
                    if (survivors.length === 0) endGame(room, 'Hunter Victory - All Survivors Eliminated');
                }
            }
        });

        socket.on('disconnect', () => {
            const roomId = socket.roomId;
            if (roomId && rooms[roomId]) {
                const room = rooms[roomId];
                delete room.players[socket.id];
                if (Object.keys(room.players).filter(id => !room.players[id].isBot).length === 0) delete rooms[roomId];
            }
        });

        socket.on('toggleLight', (isOn) => {
            const room = rooms[socket.roomId];
            if (room && room.players[socket.id]) {
                room.players[socket.id].isLightOn = isOn;
                socket.to(socket.roomId).emit('lightToggled', { id: socket.id, isLightOn: isOn });
            }
        });

        socket.on('chargeLight', (isCharging) => {
            const room = rooms[socket.roomId];
            if (room && room.players[socket.id]) {
                room.players[socket.id].isCharging = isCharging;
                socket.to(socket.roomId).emit('lightCharging', { id: socket.id, isCharging });
            }
        });

        socket.on('kill_charging', (isCharging) => {
            const room = rooms[socket.roomId];
            if (room && room.players[socket.id]) {
                room.players[socket.id].isKillCharging = isCharging;
                socket.to(socket.roomId).emit('kill_charging', { id: socket.id, isCharging });
            }
        });
    });

    // Game Loops
    setInterval(() => {
        const now = Date.now();
        matchmakingQueue.forEach((p, index) => {
            if (now - p.startTime > 10000) {
                const roomId = `bot_match_${now}`;
                io.to(p.id).emit('matchFound', { roomId });
                matchmakingQueue.splice(index, 1);
            }
        });
    }, 1000);

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
            if (room.state === 'starting') {
                const elapsed = (Date.now() - room.startTimer) / 1000;
                if (elapsed >= START_DELAY) {
                    room.state = 'playing';
                    room.gameStartTime = Date.now();
                    io.to(roomId).emit('gameStateUpdate', { state: 'playing' });
                }
            } else if (room.state === 'playing' && room.gameStartTime) {
                const timeLeft = Math.max(0, GAME_DURATION - Math.floor((Date.now() - room.gameStartTime) / 1000));
                if (timeLeft === 0) endGame(room, 'Time Expired - Survivor Victory');
            }
        });
    }, 1000);
}

module.exports = { init };
