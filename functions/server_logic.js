const GAME_DURATION = 180;
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
        for (let i = 1; i < 10; i++) {
            let gapY = (i % 2 === 0) ? 250 : 1200;
            walls.push({ x: i * 160, y: 0, w: 20, h: gapY });
            walls.push({ x: i * 160, y: gapY + 250, w: 20, h: 1600 - (gapY + 250) });
            if (i % 2 === 0) walls.push({ x: i * 160, y: 800, w: 160, h: 20 });
        }
    } else if (type === 'School') {
        width = 2800; height = 1600; botCount = 25; objectCount = 200;
        // Central hallway with doors
        walls.push({ x: 0, y: 780, w: 1200, h: 40 });
        // Gap in the middle for the hallway crossing
        walls.push({ x: 1600, y: 780, w: 1200, h: 40 });

        for (let i = 1; i < 12; i++) {
            // Top rooms with gaps at bottom
            walls.push({ x: i * 240, y: 0, w: 20, h: 650 });
            // Bottom rooms with gaps at top
            walls.push({ x: i * 240, y: 950, w: 20, h: 650 });
        }
    } else if (type === 'Forest') {
        width = 3200; height = 3200; botCount = 35; objectCount = 300;
        for (let i = 0; i < 250; i++) {
            decorations.push({
                type: 'tree',
                x: 100 + Math.random() * (width - 200),
                y: 100 + Math.random() * (height - 200),
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
                    valid = false; break;
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
            x: x, y: y,
            shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
            color: 0x555555
        });
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
    const spawnPos = findValidSpawn(room.map);
    return {
        id,
        x: spawnPos.x,
        y: spawnPos.y,
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
            const spawnPos = findValidSpawn(room.map);
            room.players[socket.id] = {
                id: socket.id,
                name: `Player ${Object.keys(room.players).length + 1}`,
                x: spawnPos.x, y: spawnPos.y, rotation: 0,
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
                room.state = 'playing';
                room.gameStartTime = Date.now();
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
                io.to(socket.roomId).emit('init', { players: room.players, map: room.map, timer: GAME_DURATION });
            }
        });

        socket.on('move', (moveData) => {
            const room = rooms[socket.roomId];
            if (room && room.players[socket.id] && !room.players[socket.id].isDead && room.state === 'playing') {
                room.players[socket.id].x = moveData.x;
                room.players[socket.id].y = moveData.y;
                room.players[socket.id].rotation = moveData.rotation;
                socket.to(socket.roomId).emit('playerMoved', room.players[socket.id]);
            }
        });

        socket.on('player_killed', (data) => {
            const { targetId, radius } = data;
            const room = rooms[socket.roomId];
            if (!room || room.state !== 'playing') return;
            const hunter = room.players[socket.id];
            const target = room.players[targetId];
            if (hunter && hunter.role === 'hunter' && target && !target.isDead) {
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
            if (room.state === 'playing' && room.gameStartTime) {
                const timeLeft = Math.max(0, GAME_DURATION - Math.floor((Date.now() - room.gameStartTime) / 1000));
                if (timeLeft === 0) endGame(room, 'Time Expired - Survivor Victory');
            }
        });
    }, 1000);
}

module.exports = { init };
