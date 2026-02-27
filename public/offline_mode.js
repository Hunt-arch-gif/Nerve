// Offline mode mimics the server functionality for Solo / Bot operations while the master server boots

const OFFLINE_GAME_DURATION = 180;
const OFFLINE_MAP_TYPES = ['Maze', 'Forest', 'School'];
const OFFLINE_SHAPES = ['triangle', 'box', 'circle'];

class OfflineSocket {
    constructor() {
        this.callbacks = {};
        this.id = 'local_client_' + Math.floor(Math.random() * 100000);
        this.roomId = null;
        this.room = null;
        this.gameLoopInterval = null;
        this.botLoopInterval = null;
        this.gameStartTime = null;
    }

    on(event, callback) {
        if (!this.callbacks[event]) this.callbacks[event] = [];
        this.callbacks[event].push(callback);
    }

    once(event, callback) {
        const wrapper = (data) => {
            callback(data);
            this.callbacks[event] = this.callbacks[event].filter(cb => cb !== wrapper);
        };
        this.on(event, wrapper);
    }

    serverEmit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }

    emit(event, data) {
        setTimeout(() => this.handleClientEvent(event, data), 10);
    }

    handleClientEvent(event, data) {
        switch (event) {
            case 'joinRoom':
                this.roomId = data.roomId;
                const hunterCount = 0;
                let role = data.requestedRole || 'survivor';

                this.room = {
                    id: this.roomId,
                    players: {},
                    state: 'lobby',
                    maxHunters: 1,
                    maxSurvivors: 7,
                    map: this.generateMap(OFFLINE_MAP_TYPES[Math.floor(Math.random() * OFFLINE_MAP_TYPES.length)])
                };

                this.room.players[this.id] = {
                    id: this.id,
                    name: 'You (Offline)',
                    x: this.room.map.width / 2, y: this.room.map.height / 2, rotation: 0,
                    role: role, camouflage: OFFLINE_SHAPES[Math.floor(Math.random() * OFFLINE_SHAPES.length)],
                    isLightOn: false, isCharging: false, isDead: false, isSlowed: false, isBot: false,
                    stats: { kills: 0, reveals: 0, surviveTime: 0, placement: 0 }
                };

                this.serverEmit('roomUpdate', {
                    roomId: this.room.id, players: this.room.players, state: this.room.state, hostId: this.id,
                    settings: { hunters: this.room.maxHunters, survivors: this.room.maxSurvivors }
                });
                break;

            case 'startGame':
                if (this.room && this.room.state === 'lobby') {
                    this.room.state = 'starting';
                    this.startDelayTimer = Date.now();

                    // Force everyone to center for the countdown
                    Object.values(this.room.players).forEach(p => {
                        p.x = this.room.map.width / 2;
                        p.y = this.room.map.height / 2;
                    });

                    if (data.fillBots) {
                        const targetTotal = this.room.maxSurvivors + this.room.maxHunters;
                        const botCount = targetTotal - 1;
                        for (let i = 0; i < botCount; i++) {
                            const botId = `offline_bot_${Math.random().toString(36).substr(2, 5)}`;
                            const hCount = Object.values(this.room.players).filter(p => p.role === 'hunter').length;
                            const botRole = hCount < this.room.maxHunters ? 'hunter' : 'survivor';
                            this.room.players[botId] = this.createBot(botId, botRole, this.room);
                        }
                    }

                    this.serverEmit('init', { players: this.room.players, map: this.room.map, timer: OFFLINE_GAME_DURATION, state: 'starting' });

                    // Start Offline Loops
                    let lastTime = Date.now();
                    this.botLoopInterval = setInterval(() => {
                        const now = Date.now();
                        this.updateBots(now - lastTime);
                        lastTime = now;
                    }, 33);

                    this.gameLoopInterval = setInterval(() => {
                        if (this.room.state === 'starting') {
                            const elapsed = (Date.now() - this.startDelayTimer) / 1000;
                            if (elapsed >= 10) {
                                this.room.state = 'playing';
                                this.gameStartTime = Date.now();
                                this.serverEmit('gameStateUpdate', { state: 'playing' });
                            }
                        } else if (this.room.state === 'playing') {
                            const timeLeft = Math.max(0, OFFLINE_GAME_DURATION - Math.floor((Date.now() - this.gameStartTime) / 1000));
                            if (timeLeft === 0) this.endGame('Time Expired - Survivor Victory');
                        }
                    }, 1000);
                }
                break;

            case 'move':
                if (this.room && this.room.players[this.id] && !this.room.players[this.id].isDead) {
                    const p = this.room.players[this.id];
                    if (this.room.state === 'starting' && p.role === 'hunter') return;
                    if (this.room.state === 'starting' || this.room.state === 'playing') {
                        p.x = data.x;
                        p.y = data.y;
                        p.rotation = data.rotation;
                    }
                }
                break;

            case 'player_killed':
                const targetId = data.targetId;
                const radius = data.radius;
                if (!this.room || this.room.state !== 'playing') return;
                const hunter = this.room.players[this.id];
                const target = this.room.players[targetId];

                if (hunter && hunter.role === 'hunter' && target && !target.isDead) {
                    const dist = Math.sqrt((hunter.x - target.x) ** 2 + (hunter.y - target.y) ** 2);
                    if (dist <= (radius || 150) + 30) {
                        target.isDead = true; hunter.stats.kills++;
                        const survivors = Object.values(this.room.players).filter(p => p.role === 'survivor' && !p.isDead);
                        target.stats.placement = survivors.length + 1;
                        target.stats.surviveTime = Math.floor((Date.now() - this.gameStartTime) / 1000);
                        this.serverEmit('player_died', targetId);
                        if (survivors.length === 0) this.endGame('Hunter Victory - All Survivors Eliminated');
                    }
                }
                break;

            case 'playAgain':
                this.cleanupLoops();
                if (window.originalSocket) {
                    // Try to restore main menu
                    location.reload();
                }
                break;
        }
    }

    generateMap(type) {
        const walls = [];
        const decorations = [];
        let width = 2400;
        let height = 1600;
        let objectCount = 200;

        if (type === 'Maze') {
            width = 1600; height = 1600; objectCount = 150;
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
            width = 2800; height = 1600; objectCount = 200;

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
            width = 3000; height = 3000; objectCount = 300;

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
                let currentShape = OFFLINE_SHAPES[Math.floor(Math.random() * 3)];

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

        for (let i = objects.length; i < objectCount; i++) {
            let attempts = 0;
            let x = 100, y = 100;
            let valid = false;
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
                    shape: OFFLINE_SHAPES[Math.floor(Math.random() * OFFLINE_SHAPES.length)],
                    color: 0x555555
                });
            }
        }

        return { type, width, height, botCount: 15, walls, decorations, objects };
    }

    createBot(id, role, room) {
        return {
            id, x: room.map.width / 2, y: room.map.height / 2,
            rotation: 0, role, camouflage: OFFLINE_SHAPES[Math.floor(Math.random() * OFFLINE_SHAPES.length)],
            isLightOn: Math.random() > 0.3, isDead: false, isSlowed: false, isBot: true, moveTick: 0,
            stats: { kills: 0, reveals: 0, surviveTime: 0, placement: 0 }
        };
    }

    updateBots(deltaMs) {
        if (!this.room || this.room.state !== 'playing') return;

        // Player collision logic for offline
        const myPlayer = this.room.players[this.id];

        Object.values(this.room.players).filter(p => p.isBot && !p.isDead).forEach(bot => {
            bot.moveTick += deltaMs;
            if (Math.random() < 0.05) bot.targetRotation = bot.rotation + (Math.random() * 2 - 1);
            if (bot.targetRotation !== undefined) bot.rotation += (bot.targetRotation - bot.rotation) * 0.1;

            const dist = 100 * (deltaMs / 1000);
            let nextX = bot.x + Math.cos(bot.rotation) * dist;
            let nextY = bot.y + Math.sin(bot.rotation) * dist;

            let collide = false;
            for (let w of this.room.map.walls) {
                if (nextX + 12 > w.x && nextX - 12 < w.x + w.w && nextY + 12 > w.y && nextY - 12 < w.y + w.h) { collide = true; break; }
            }
            if (!collide) {
                bot.x = Math.max(30, Math.min(this.room.map.width - 30, nextX));
                bot.y = Math.max(30, Math.min(this.room.map.height - 30, nextY));
            } else {
                bot.targetRotation = bot.rotation + Math.PI + (Math.random() - 0.5);
            }

            // Offline Hunter Logic - bots auto attack if hunter
            if (bot.role === 'hunter' && myPlayer && !myPlayer.isDead) {
                const playerDist = Math.sqrt((bot.x - myPlayer.x) ** 2 + (bot.y - myPlayer.y) ** 2);
                if (playerDist < 100 && Math.random() < 0.05) {
                    myPlayer.isDead = true;
                    myPlayer.stats.surviveTime = Math.floor((Date.now() - this.gameStartTime) / 1000);
                    this.serverEmit('player_died', myPlayer.id);
                    bot.stats.kills++;
                    this.endGame('Hunter Offline Bot Victory');
                }
            }

            if (bot.moveTick > 100) {
                this.serverEmit('playerMoved', { id: bot.id, x: bot.x, y: bot.y, rotation: bot.rotation });
                bot.moveTick = 0;
            }
        });
    }

    endGame(reason) {
        if (this.room.state !== 'playing') return;
        this.room.state = 'results';
        this.cleanupLoops();
        const duration = Math.floor((Date.now() - this.gameStartTime) / 1000);
        Object.values(this.room.players).forEach(p => {
            if (p.role === 'survivor' && !p.isDead) { p.stats.placement = 1; p.stats.surviveTime = duration; }
        });
        this.serverEmit('gameOver', { reason, results: this.room.players, duration });
    }

    cleanupLoops() {
        if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
        if (this.botLoopInterval) clearInterval(this.botLoopInterval);
    }
}
