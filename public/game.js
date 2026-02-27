let player;
let otherPlayers = {};
let walls = [];
let camoObjects = [];
let shroudGraphics;
let killBar;
let isKillCharging = false;
let killChargeTimer = 0;
const KILL_TIME = 2000; // Faster for better feel
let currentScene;
let dustParticles;
let socketRef;
let gameDataBuffer = null;
let gameTimerValue = 180;
let sprintTimeLeft = 3000;
let staminaBar;

// Mobile/Touch Globals
let isMobile = false;
let joystickVector = { x: 0, y: 0 };
let mobileActionDown = false;
let mobileFlipped = false;
let mobileFDown = false;

const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 800,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 } }
    },
    scene: { preload, create, update }
};

const phaserGame = new Phaser.Game(config);

function preload() {
    this.load.image('forest_floor', 'assets/forest_floor.png');
    this.load.image('school_floor', 'assets/school_floor.png');
    this.load.image('wall_texture', 'assets/wall_texture.png');
    this.load.image('wall', 'assets/wall.png');
    this.load.image('survivor', 'assets/survivor.png');
    this.load.image('hunter', 'assets/hunter.png');
    this.load.image('dust', 'https://labs.phaser.io/assets/particles/white.png');
}

function create() {
    currentScene = this;

    // Depth Hierarchy:
    // ...
    // 0: Floor
    // 5: Camo Objects & Hidden Survivors
    // 10: Darkness Shroud
    // 50: Revealed Entities & Hunter
    // 100: Walls & Decorations (Always Visible)

    shroudGraphics = this.add.graphics().setDepth(10);
    killBar = this.add.graphics().setDepth(1000);
    staminaBar = this.add.graphics().setDepth(2000).setScrollFactor(0);

    dustParticles = this.add.particles(0, 0, 'dust', {
        scale: { start: 0.05, end: 0 },
        alpha: { start: 0.1, end: 0 },
        speed: { min: 1, max: 10 },
        lifespan: 5000,
        frequency: 100,
        blendMode: 'ADD',
        emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(0, 0, 5000, 5000) }
    });

    // Create a red trail particle for the hunter
    scene = this; // store globally for particle emit
    this.hunterParticles = this.add.particles(0, 0, 'dust', {
        scale: { start: 0.2, end: 0 },
        alpha: { start: 0.5, end: 0 },
        speed: { min: 10, max: 30 },
        tint: 0xff0000,
        lifespan: 800,
        frequency: 20,
        blendMode: 'ADD',
        emitting: false // start off, we emit manually in update
    });
    this.hunterParticles.setDepth(45);

    if (gameDataBuffer) {
        setupGame(this, gameDataBuffer);
    }

    // Mobile Check
    isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isMobile) {
        setupMobileControls();
    }

    this.time.addEvent({
        delay: 1000,
        callback: () => {
            if (gameTimerValue > 0) {
                gameTimerValue--;
                const mins = Math.floor(gameTimerValue / 60);
                const secs = gameTimerValue % 60;
                const timerEl = document.getElementById('game-timer');
                if (timerEl) timerEl.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
        },
        loop: true
    });
}

function startGameWithSocket(socket, roomId, roomType = 'match', requestedRole) {
    socketRef = socket;
    socket.emit('joinRoom', { roomId, roomType, requestedRole });

    socket.on('init', (data) => {
        gameDataBuffer = data;
        gameTimerValue = data.timer || 180;
        if (currentScene) setupGame(currentScene, data);
    });

    socket.on('hunter_charging', (data) => {
        if (player && data.id === player.id) {
            // locally handled, but could sync if needed
        } else if (otherPlayers[data.id]) {
            otherPlayers[data.id].chargeProgress = data.progress;
        }
    });

    socket.on('playerJoined', (pData) => {
        if (currentScene && gameDataBuffer) spawnPlayer(currentScene, pData, false);
    });

    socket.on('playerMoved', (pData) => {
        if (!currentScene) return;
        if (otherPlayers[pData.id]) {
            otherPlayers[pData.id].x = pData.x;
            otherPlayers[pData.id].y = pData.y;
            otherPlayers[pData.id].rotation = pData.rotation;
        }
    });

    socket.on('lightToggled', (data) => {
        if (otherPlayers[data.id]) otherPlayers[data.id].isLightOn = data.isLightOn;
        else if (player && player.id === data.id) player.isLightOn = data.isLightOn;
    });

    socket.on('lightCharging', (data) => {
        if (otherPlayers[data.id]) otherPlayers[data.id].isCharging = data.isCharging;
        else if (player && player.id === data.id) player.isCharging = data.isCharging;
    });

    socket.on('player_died', (id) => {
        console.log('Player died event received for ID:', id);
        let deadPlayer = (id === socket.id && player) ? player : otherPlayers[id];

        if (deadPlayer) {
            deadPlayer.isDead = true;
            if (deadPlayer.visualGraphic) deadPlayer.visualGraphic.setVisible(false);
            if (deadPlayer.shapeGraphic) deadPlayer.shapeGraphic.setVisible(false);

            if (deadPlayer === player) {
                if (deadPlayer.body) deadPlayer.body.checkCollision.none = true;
                const statusPill = document.getElementById('role-text');
                if (statusPill) { statusPill.innerText = "SPECTATING"; statusPill.style.color = "#aaaaaa"; }
            }

            if (currentScene) {
                const blood = currentScene.add.particles(deadPlayer.x, deadPlayer.y, 'dust', {
                    speed: { min: 50, max: 200 },
                    lifespan: { min: 1000, max: 2000 },
                    scale: { start: 0.3, end: 0 },
                    tint: 0xff0000,
                    alpha: { start: 1, end: 0 },
                    blendMode: 'NORMAL'
                });
                blood.explode(50);
            }
        }

        if (id === socket.id && currentScene) {
            currentScene.cameras.main.shake(1000, 0.05);
            currentScene.cameras.main.flash(500, 255, 0, 0); // Red flash
        }
    });

    socket.on('hunter_restored', (id) => {
        if (player && player.id === id) player.isSlowed = false;
        else if (otherPlayers[id]) otherPlayers[id].isSlowed = false;
    });

    socket.on('playerLeft', (id) => {
        if (otherPlayers[id]) {
            if (otherPlayers[id].visualGraphic) otherPlayers[id].visualGraphic.destroy();
            if (otherPlayers[id].shapeGraphic) otherPlayers[id].shapeGraphic.destroy();
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });

    socket.on('gameOver', (data) => {
        if (currentScene) {
            currentScene.physics.pause();
            currentScene.cameras.main.fadeOut(1000, 0, 0, 0);
        }
        player = null;
        Object.values(otherPlayers).forEach(p => {
            if (p.visualGraphic) p.visualGraphic.destroy();
            if (p.shapeGraphic) p.shapeGraphic.destroy();
        });
        otherPlayers = {};
    });

    socket.on('game_reset', () => {
        if (currentScene) {
            const centerX = currentScene.cameras.main.worldView.x + currentScene.cameras.main.width / 2;
            const centerY = currentScene.cameras.main.worldView.y + currentScene.cameras.main.height / 2;
            const text = currentScene.add.text(centerX, centerY - 50, 'MATCH ENDED', {
                fontFamily: 'Outfit, sans-serif',
                fontSize: '64px',
                color: '#ff2a2a',
                fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(9999).setScrollFactor(0);
            text.setShadow(0, 0, 'rgba(255,42,42,0.8)', 20, false, true);
        }
        setTimeout(() => location.reload(), 3000);
    });
}

function setupGame(scene, data) {
    if (scene.mapSetupDone) return;
    scene.mapSetupDone = true;

    const floorKey = data.map.type === 'Forest' ? 'forest_floor' : 'school_floor';

    const statusPill = document.getElementById('status-pill');
    if (statusPill) statusPill.innerText = data.map.type.toUpperCase();
    const roleText = document.getElementById('role-text');
    if (roleText && data.players[socketRef.id]) roleText.innerText = data.players[socketRef.id].role.toUpperCase();

    scene.physics.world.setBounds(0, 0, data.map.width, data.map.height);
    scene.cameras.main.setBounds(0, 0, data.map.width, data.map.height);
    scene.obstacles = [];
    scene.propObstacles = [];

    for (let x = 0; x < data.map.width; x += 512) {
        for (let y = 0; y < data.map.height; y += 512) {
            scene.add.image(x, y, floorKey).setOrigin(0).setAlpha(0.8).setDepth(0);
        }
    }

    // Add a dark vignette tile overlay for atmosphere
    const vignette = scene.add.graphics().setDepth(1).setScrollFactor(0);
    vignette.fillStyle(0x000000, 0.2);
    vignette.fillRect(0, 0, config.width, config.height);

    data.map.walls.forEach(w => {
        const wall = scene.add.tileSprite(w.x, w.y, w.w, w.h, 'wall_texture').setOrigin(0).setDepth(100);
        wall.setTint(0x888888);
        const border = scene.add.graphics().setDepth(101);
        border.lineStyle(2, 0x444444, 1);
        border.strokeRect(w.x, w.y, w.w, w.h);
        scene.physics.add.existing(wall, true);
        walls.push(wall);
        scene.obstacles.push(new Phaser.Geom.Rectangle(w.x, w.y, w.w, w.h));
    });

    if (data.map.decorations) {
        data.map.decorations.forEach(d => {
            const tree = scene.add.circle(d.x, d.y, d.radius, 0x1a4a1a).setDepth(100);
            scene.physics.add.existing(tree, true);
            walls.push(tree);
            scene.obstacles.push(new Phaser.Geom.Circle(d.x, d.y, d.radius));
        });
    }

    data.map.objects.forEach(obj => {
        const shape = drawShape(scene, obj.x, obj.y, obj.shape, 0x555555).setDepth(5);
        camoObjects.push(shape);
        // Camo props only block light, not movement/attacks
        if (obj.shape === 'box') scene.propObstacles.push(new Phaser.Geom.Rectangle(obj.x - 12, obj.y - 12, 24, 24));
        else scene.propObstacles.push(new Phaser.Geom.Circle(obj.x, obj.y, 12));
    });

    Object.keys(data.players).forEach(id => {
        spawnPlayer(scene, data.players[id], id === socketRef.id);
    });

    if (player) {
        scene.cameras.main.startFollow(player, true, 0.1, 0.1);
    } else {
        console.warn("Player not found in init data, camera follow deferred.");
        // We'll queue it to try again when spawnPlayer is next called locally.
    }
}

function spawnPlayer(scene, data, isLocal) {
    if (isLocal && player) return;
    if (!isLocal && otherPlayers[data.id]) return;

    const spriteKey = data.role === 'hunter' ? 'hunter' : 'survivor';
    const p = scene.physics.add.sprite(data.x, data.y, spriteKey);
    p.setAlpha(0.001); // Hide the problematic asset entirely while keeping physics body active!
    p.setScale(0.15);

    // Properly set the circular physics hitbox unscaled size.
    // Making hitboxes equal for both roles so hunters don't get stuck in terrain survivors can pass.
    const rad = 20;
    const unscaledRad = rad / 0.15;
    p.body.setCircle(unscaledRad, (p.width / 2) - unscaledRad, (p.height / 2) - unscaledRad);

    p.id = data.id;
    p.role = data.role;
    p.isLightOn = data.isLightOn;
    p.isCharging = data.isCharging || false;
    p.isDead = data.isDead;
    if (p.isDead) {
        if (p.visualGraphic) p.visualGraphic.setVisible(false);
        if (p.shapeGraphic) p.shapeGraphic.setVisible(false);
        if (isLocal && p.body) p.body.checkCollision.none = true;
    }
    p.camouflage = data.camouflage || 'circle';

    // Create a beautiful decoupled visual graphic
    p.visualGraphic = scene.add.graphics().setDepth(data.role === 'hunter' ? 50 : 5);

    // Create the camouflage shape for survivors as well
    if (data.role === 'survivor') {
        p.shapeGraphic = drawShape(scene, data.x, data.y, p.camouflage, 0x555555).setDepth(5);
    }

    p.setDepth(data.role === 'hunter' ? 50 : 5);

    if (isLocal) {
        player = p;
        p.setCollideWorldBounds(true);
        // Start follow here in case we joined late or it was deferred
        if (currentScene && currentScene.cameras.main) {
            currentScene.cameras.main.startFollow(player, true, 0.1, 0.1);
        }
        // Add a slight delay to allow world to settle
        scene.time.delayedCall(100, () => {
            scene.physics.add.collider(player, walls);
        });
    } else {
        otherPlayers[data.id] = p;
        p.setCollideWorldBounds(true);
        scene.time.delayedCall(100, () => {
            scene.physics.add.collider(p, walls);
        });
    }
}

function update(time, delta) {
    if (!player) return;

    if (!this.keys) {
        const saved = localStorage.getItem('nerve_keys');
        const conf = saved ? JSON.parse(saved) : {
            up: 'W', down: 'S', left: 'A', right: 'D', sprint: 'SHIFT', flash: 'F', action: 'SPACE', flashMode: 'toggle'
        };
        this.flashMode = conf.flashMode || 'toggle';

        this.keys = {
            up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.up] || Phaser.Input.Keyboard.KeyCodes.W),
            down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.down] || Phaser.Input.Keyboard.KeyCodes.S),
            left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.left] || Phaser.Input.Keyboard.KeyCodes.A),
            right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.right] || Phaser.Input.Keyboard.KeyCodes.D),
            sprint: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.sprint] || Phaser.Input.Keyboard.KeyCodes.SHIFT),
            flash: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.flash] || Phaser.Input.Keyboard.KeyCodes.F),
            action: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[conf.action] || Phaser.Input.Keyboard.KeyCodes.SPACE)
        };
        this.cursors = this.input.keyboard.createCursorKeys();
    }

    if (player.isDead) {
        // Freecam mode for spectators
        let vx = 0, vy = 0;
        const speed = 500;
        if (this.cursors.left.isDown || this.keys.left.isDown) vx = -1;
        else if (this.cursors.right.isDown || this.keys.right.isDown) vx = 1;
        if (this.cursors.up.isDown || this.keys.up.isDown) vy = -1;
        else if (this.cursors.down.isDown || this.keys.down.isDown) vy = 1;

        if (isMobile && (Math.abs(joystickVector.x) > 0.1 || Math.abs(joystickVector.y) > 0.1)) {
            vx = joystickVector.x;
            vy = joystickVector.y;
        }

        if (!isMobile && (vx !== 0 || vy !== 0)) {
            const length = Math.sqrt(vx * vx + vy * vy);
            vx /= length;
            vy /= length;
        }

        player.body.setVelocity(vx * speed, vy * speed);
        renderLighting(this);
        return;
    }

    // Game Stats UI (Timer & Survivor Count)
    const isHunter = player.role === 'hunter';
    const survivorsAlive = [player, ...Object.values(otherPlayers)].filter(p => p && p.role === 'survivor' && !p.isDead).length;
    const survivorCounter = document.getElementById('survivor-count-container');
    const survivorVal = document.getElementById('survivor-count-val');

    if (survivorCounter && survivorVal) {
        if (isHunter) {
            survivorCounter.style.display = 'block';
            survivorVal.innerText = survivorsAlive;
        } else {
            survivorCounter.style.display = 'none';
        }
    }

    // Sprint logic
    const isSprintRequested = this.keys.sprint.isDown || (isMobile && player.role === 'survivor' && mobileActionDown); // Action button acts as sprint for survivors
    let isSprinting = false;

    if (player.role === 'survivor') {
        if (isSprintRequested && sprintTimeLeft > 0) {
            isSprinting = true;
            sprintTimeLeft -= delta;
            if (sprintTimeLeft < 0) sprintTimeLeft = 0;
        } else {
            sprintTimeLeft += delta * 0.3; // takes 10s to recharge 3000ms
            if (sprintTimeLeft > 3000) sprintTimeLeft = 3000;
        }

        // ... stamina bar draw remains same ...
        staminaBar.clear();
        staminaBar.fillStyle(0x000000, 0.5);
        staminaBar.fillRoundedRect(20, 750, 204, 18, 9);
        const staminaColor = isSprinting ? 0xffcc00 : 0x00ffcc;
        staminaBar.fillStyle(staminaColor, 1);
        const width = Math.max(0, 200 * (sprintTimeLeft / 3000));
        staminaBar.fillRoundedRect(22, 752, width, 14, 7);
        staminaBar.fillStyle(0xffffff, 0.1);
        staminaBar.fillRect(22, 752, width, 5);
    } else {
        isSprinting = isSprintRequested;
    }

    // Speed calculation
    const baseSurvivorSpeed = 320;
    const baseSpeed = player.isSlowed ? 150 : (player.role === 'hunter' ? baseSurvivorSpeed * 1.5 : baseSurvivorSpeed);
    let speed = isSprinting ? baseSpeed * 1.5 : baseSpeed;

    let vx = 0, vy = 0;

    if (this.cursors.left.isDown || this.keys.left.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.keys.right.isDown) vx = 1;
    if (this.cursors.up.isDown || this.keys.up.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.keys.down.isDown) vy = 1;

    // Apply Joystick
    if (isMobile && (Math.abs(joystickVector.x) > 0.1 || Math.abs(joystickVector.y) > 0.1)) {
        vx = joystickVector.x;
        vy = joystickVector.y;
    }

    // Normalize diagonal movement (only if using keys, joystick is already normalized by length in setup)
    if (!isMobile && vx !== 0 && vy !== 0) {
        const length = Math.sqrt(vx * vx + vy * vy);
        vx /= length;
        vy /= length;
    }

    player.body.setVelocity(vx * speed, vy * speed);

    const pointer = this.input.activePointer;
    if (isMobile && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1)) {
        player.rotation = Math.atan2(vy, vx);
    } else if (pointer && pointer.worldX !== undefined && !isMobile) {
        player.rotation = Phaser.Math.Angle.Between(player.x, player.y, pointer.worldX, pointer.worldY);
    } else if (isMobile && pointer.isDown && pointer.x > 300) { // Rotate towards touch if not move-thumbing
        player.rotation = Phaser.Math.Angle.Between(player.x, player.y, pointer.worldX, pointer.worldY);
    }

    if (vx !== 0 || vy !== 0 || Math.abs(player.rotation - player.oldRotation) > 0.01) {
        if (socketRef) socketRef.emit('move', { x: player.x, y: player.y, rotation: player.rotation });
        player.oldRotation = player.rotation;
    }

    const flashJustDown = Phaser.Input.Keyboard.JustDown(this.keys.flash) || (mobileFDown && !this.wasMobileFDown);
    this.wasMobileFDown = mobileFDown;
    const isFlashHeld = this.keys.flash.isDown || mobileFDown;

    if (player.role === 'hunter') {
        if (flashJustDown) {
            if (player.isLightOn) {
                player.isLightOn = false;
                if (socketRef) socketRef.emit('toggleLight', false);
            } else if (!player.isCharging) {
                player.isCharging = true;
                player.scanChargeTimer = 0;
                if (socketRef) socketRef.emit('chargeLight', true);
            }
        }

        if (player.isCharging) {
            player.scanChargeTimer = (player.scanChargeTimer || 0) + delta;
            if (player.scanChargeTimer >= 2000) {
                player.isCharging = false;
                player.isLightOn = true;
                if (socketRef) {
                    socketRef.emit('chargeLight', false);
                    socketRef.emit('toggleLight', true);
                }
            }
        }

        const attackRequested = this.keys.action.isDown || (isMobile && mobileActionDown);
        if (attackRequested && !player.isCharging) {
            isKillCharging = true;
            killChargeTimer += delta;
            if (killChargeTimer >= KILL_TIME) {
                performKill(this);
                killChargeTimer = 0;
            }
        } else {
            if (isKillCharging) {
                performKill(this); // Trigger on release
            }
            isKillCharging = false;
            killChargeTimer = 0;
        }
        drawKillBars();
    } else {
        if (!player.isDead) {
            if (this.flashMode === 'hold') {
                if (player.isLightOn !== isFlashHeld) {
                    player.isLightOn = isFlashHeld;
                    if (socketRef) socketRef.emit('toggleLight', player.isLightOn);
                }
            } else {
                if (flashJustDown) {
                    player.isLightOn = !player.isLightOn;
                    if (socketRef) socketRef.emit('toggleLight', player.isLightOn);
                }
            }
        }
        handleProximityShake(this);
    }

    renderLighting(this);

    // Sync shape graphics and emit particles for hunters
    let allPlayers = [player, ...Object.values(otherPlayers)].filter(p => p !== undefined);

    // Hunter Particle Trail
    const hunters = allPlayers.filter(p => p && p.role === 'hunter' && !p.isDead);
    if (hunters.length > 0) {
        this.hunterParticles.emitting = true;
        // set emit zone to the first hunter
        this.hunterParticles.setPosition(hunters[0].x, hunters[0].y);
    } else {
        this.hunterParticles.emitting = false;
    }

    allPlayers.forEach(p => {
        if (p.shapeGraphic) {
            p.shapeGraphic.x = p.x;
            p.shapeGraphic.y = p.y;
        }
        if (p.visualGraphic && !p.isDead) {
            p.visualGraphic.clear();
            p.visualGraphic.x = p.x;
            p.visualGraphic.y = p.y;
            p.visualGraphic.rotation = p.rotation;

            if (p.role === 'hunter') {
                // Menacing shadowy core with subtle pulse
                const pulse = Math.sin(time / 200) * 2;
                p.visualGraphic.fillStyle(0x000000, 1);
                p.visualGraphic.fillCircle(0, 0, 24 + pulse);

                // Outer glow
                p.visualGraphic.lineStyle(3, 0xff2a2a, 0.6);
                p.visualGraphic.strokeCircle(0, 0, 26 + pulse);

                if (p.isCharging) {
                    const chargeRadius = (time % 800) / 800 * 360;
                    p.visualGraphic.lineStyle(4, 0xff2a2a, 0.8 * (1 - (chargeRadius / 360)));
                    p.visualGraphic.strokeCircle(0, 0, chargeRadius);

                    const chargeRadius2 = ((time + 400) % 800) / 800 * 360;
                    p.visualGraphic.lineStyle(2, 0xff2a2a, 0.4 * (1 - (chargeRadius2 / 360)));
                    p.visualGraphic.strokeCircle(0, 0, chargeRadius2);
                }

                // Inner core
                p.visualGraphic.fillStyle(0x1a0000, 1);
                p.visualGraphic.fillCircle(0, 0, 18);

                // Piercing red eyes that "stare" forward
                p.visualGraphic.fillStyle(0xff0000, 1);
                p.visualGraphic.fillCircle(12, -7, 4);
                p.visualGraphic.fillCircle(12, 7, 4);

                // Small highlight on eyes
                p.visualGraphic.fillStyle(0xffffff, 0.8);
                p.visualGraphic.fillCircle(14, -7, 1.5);
                p.visualGraphic.fillCircle(14, 7, 1.5);
            } else {
                // Survivor - Cleaner, more "functional" look
                const isHighlight = p.isAllyIlluminated && p !== player && player.role !== 'hunter';
                const bodyColor = isHighlight ? 0xff0000 : 0x2c3e50;
                const shoulderColor = isHighlight ? 0xcc0000 : 0x34495e;
                const headColor = isHighlight ? 0xffcccc : 0xecf0f1;
                const packColor = isHighlight ? 0x990000 : 0x7f8c8d;
                const rimColor = isHighlight ? 0xff6666 : 0x95a5a6;

                // Body
                p.visualGraphic.fillStyle(bodyColor, 1);
                p.visualGraphic.fillCircle(0, 0, 20);

                // Shoulder/Arms hint
                p.visualGraphic.fillStyle(shoulderColor, 1);
                p.visualGraphic.fillCircle(-4, -12, 8);
                p.visualGraphic.fillCircle(-4, 12, 8);

                // Head
                p.visualGraphic.fillStyle(headColor, 1);
                p.visualGraphic.fillCircle(8, 0, 12);

                // Directional hint (small backpack or gear)
                p.visualGraphic.fillStyle(packColor, 1);
                p.visualGraphic.fillRect(-14, -8, 10, 16);

                // Rim light
                p.visualGraphic.lineStyle(2, rimColor, 0.4);
                p.visualGraphic.strokeCircle(0, 0, 21);
            }
        } else if (p.visualGraphic && p.isDead) {
            p.visualGraphic.setVisible(false);
        }
    });
}

function handleProximityShake(scene) {
    const hunter = Object.values(otherPlayers).find(p => p.role === 'hunter');
    if (hunter && !hunter.isDead) {
        const dist = Phaser.Math.Distance.Between(player.x, player.y, hunter.x, hunter.y);
        if (dist < 400) {
            const intensity = (1 - (dist / 400)) * 0.015;
            if (Math.random() < 0.2) scene.cameras.main.shake(100, intensity);
        }
    }
}

function renderLighting(scene) {
    if (!shroudGraphics) return;
    shroudGraphics.clear();
    shroudGraphics.fillStyle(0x000000, 1.0);

    // Draw over the whole camera view but with 1.0 alpha
    shroudGraphics.fillRect(scene.cameras.main.worldView.x - 50, scene.cameras.main.worldView.y - 50, 1300, 900);

    const isHunter = player.role === 'hunter';

    // Light sources (Both survivors and hunters with their respective lights on)
    const activeLights = [player, ...Object.values(otherPlayers)].filter(p => p && p.isLightOn && !p.isDead);

    shroudGraphics.blendMode = Phaser.BlendModes.ERASE;

    // Hunter's personal radius (slightly revealed area)
    const activeHunters = [player, ...Object.values(otherPlayers)].filter(p => p && p.role === 'hunter' && !p.isDead);
    activeHunters.forEach(hunter => {
        shroudGraphics.fillCircle(hunter.x, hunter.y, 40);
    });

    // Flashlight cones and 360 fields - raycasted polygons
    activeLights.forEach(s => {
        const isHunterLight = s.role === 'hunter';
        const radius = isHunterLight ? 360 : 550;
        const spread = isHunterLight ? Math.PI : 0.5;

        // Shroud removal is only blocked by actual walls, not props (to keep the map visible)
        // BUT Flashlight reveal of survivors is blocked by props.
        const points = getLightPolygon(scene, s, radius, spread, false);

        // Soft gradient effect using overlapping polygons
        for (let i = 0; i < 5; i++) {
            const scale = 1 - (i * 0.1);
            const alphaMod = (i === 0) ? 0.2 : 0.8;
            shroudGraphics.fillStyle(0x000000, alphaMod);
            shroudGraphics.beginPath();
            shroudGraphics.moveTo(s.x, s.y);
            for (let p = 0; p < points.length; p++) {
                const px = s.x + (points[p].x - s.x) * scale;
                const py = s.y + (points[p].y - s.y) * scale;
                shroudGraphics.lineTo(px, py);
            }
            shroudGraphics.closePath();
            shroudGraphics.fillPath();
        }

        // Emit small circle at the source
        shroudGraphics.fillStyle(0x000000, 1.0);
        shroudGraphics.fillCircle(s.x, s.y, 30);
    });

    shroudGraphics.blendMode = Phaser.BlendModes.NORMAL;

    // Visibility Logic - Survivors are always somewhat visible to everyone
    [player, ...Object.values(otherPlayers)].forEach(p => {
        if (!p) return;
        p.setAlpha(0.001); // ALWAYS keep the sprite hidden to mask flawed assets!

        // Visibility Logic - Survivors are always somewhat visible to everyone
        if (p.isDead) {
            if (p.visualGraphic) p.visualGraphic.setVisible(false);
            if (p.shapeGraphic) p.shapeGraphic.setVisible(false);
            if (p === player && p.visualGraphic) {
                p.visualGraphic.setVisible(true);
                p.visualGraphic.setAlpha(0.2); // Ghostly spectate form for yourself
            }
            return;
        }

        let shouldShowHuman = false;
        let shouldShowShape = false;
        let finalAlpha = 1.0;
        p.isAllyIlluminated = false;

        if (p.role === 'hunter') {
            shouldShowHuman = true;
        } else {
            const allySources = [player, ...Object.values(otherPlayers)].filter(s => s && s.role === 'survivor' && s.isLightOn && !s.isDead && s.id !== p.id);
            const hunterSources = [player, ...Object.values(otherPlayers)].filter(s => s && s.role === 'hunter' && s.isLightOn && !s.isDead && s.id !== p.id);

            const illuminatedByAlly = checkIlluminated(p, allySources, true);
            const illuminatedByHunter = checkIlluminated(p, hunterSources, false); // Hunters ignore camo-props for spotting
            const illuminatedBySelf = p.isLightOn;

            const closeHunters = activeHunters.filter(h => Phaser.Math.Distance.Between(p.x, p.y, h.x, h.y) < 40);
            const nearHunter = closeHunters.length > 0;

            const revealedToHunter = illuminatedByHunter || illuminatedBySelf || nearHunter || illuminatedByAlly; // Ally lights reveal to hunter too

            if (isHunter) {
                if (revealedToHunter) {
                    shouldShowHuman = true;
                } else {
                    shouldShowShape = true;
                }
            } else {
                // Survivor viewing another survivor
                if (illuminatedByAlly) {
                    shouldShowHuman = true;
                    p.isAllyIlluminated = true; // Red highlight!
                } else {
                    shouldShowShape = true;
                    if (p.shapeGraphic) p.shapeGraphic.setAlpha(1.0);
                }

                // Always see yourself (as human)
                if (p === player) {
                    shouldShowHuman = true;
                    if (p.visualGraphic) {
                        p.visualGraphic.setAlpha(revealedToHunter ? 1.0 : 0.6);
                    }
                }
            }
        }

        if (p.shapeGraphic) {
            p.shapeGraphic.setVisible(shouldShowShape);
            p.shapeGraphic.setDepth(55);
        }

        if (p.visualGraphic) {
            p.visualGraphic.setVisible(shouldShowHuman);
            p.visualGraphic.setDepth(55);
        }
    });

    // Draw visible light cones for all players so others see their flashlights
    activeLights.forEach(s => {
        const isHunterLight = s.role === 'hunter';
        const radius = isHunterLight ? 360 : 550;
        const spread = isHunterLight ? Math.PI : 0.5;
        const color = isHunterLight ? 0xff2a2a : 0xffffaa;
        const alpha = isHunterLight ? 0.1 : 0.15;

        const points = getLightPolygon(scene, s, radius, spread);

        // Draw the light cone on top of the map
        const lightGraphic = scene.add.graphics().setDepth(48).setAlpha(alpha);
        lightGraphic.fillStyle(color, 1);
        lightGraphic.beginPath();
        lightGraphic.moveTo(s.x, s.y);
        points.forEach(p => lightGraphic.lineTo(p.x, p.y));
        lightGraphic.closePath();
        lightGraphic.fillPath();

        // destroy after one frame (it will be redrawn)
        scene.time.delayedCall(0, () => lightGraphic.destroy());
    });
}

function getLightPolygon(scene, source, radius, spread, blockByProps = false) {
    const points = [];
    const numRays = (radius > 400) ? 50 : 30;
    const obstacles = blockByProps ? [...scene.obstacles, ...scene.propObstacles] : scene.obstacles;

    for (let r = 0; r <= numRays; r++) {
        const rayAngle = source.rotation - spread + (spread * 2 * r / numRays);
        const targetX = source.x + Math.cos(rayAngle) * radius;
        const targetY = source.y + Math.sin(rayAngle) * radius;
        const line = new Phaser.Geom.Line(source.x, source.y, targetX, targetY);
        let minDist = radius;
        let endX = targetX;
        let endY = targetY;

        obstacles.forEach(obs => {
            const out = [];
            if (obs.type === 5) Phaser.Geom.Intersects.GetLineToRectangle(line, obs, out);
            else if (obs.type === 0) Phaser.Geom.Intersects.GetLineToCircle(line, obs, out);
            out.forEach(p => {
                const d = Phaser.Math.Distance.Between(source.x, source.y, p.x, p.y);
                if (d < minDist) { minDist = d; endX = p.x; endY = p.y; }
            });
        });
        points.push({ x: endX, y: endY });
    }
    return points;
}

function checkLineOfSight(x1, y1, x2, y2, blockByProps = false) {
    if (!currentScene || !currentScene.obstacles) return true;
    const obstacles = blockByProps ? [...currentScene.obstacles, ...currentScene.propObstacles] : currentScene.obstacles;
    const line = new Phaser.Geom.Line(x1, y1, x2, y2);
    for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i];
        if (obs.type === 5) {
            if (Phaser.Geom.Intersects.LineToRectangle(line, obs)) return false;
        } else if (obs.type === 0) {
            if (Phaser.Geom.Intersects.LineToCircle(line, obs)) return false;
        }
    }
    return true;
}

function checkIlluminated(target, sources, blockByProps = false) {
    for (let s of sources) {
        const isHunterLight = s.role === 'hunter';
        const radius = isHunterLight ? 360 : 550;
        const spread = isHunterLight ? Math.PI : 0.5;

        const dist = Phaser.Math.Distance.Between(s.x, s.y, target.x, target.y);
        if (dist < radius) {
            const angle = Phaser.Math.Angle.Between(s.x, s.y, target.x, target.y);
            if (isHunterLight || Math.abs(Phaser.Math.Angle.Wrap(angle - s.rotation)) <= spread + 0.01) {
                if (checkLineOfSight(s.x, s.y, target.x, target.y, blockByProps)) return true;
            }
        }
    }
    return false;
}

function drawShape(scene, x, y, type, color) {
    const container = scene.add.container(x, y);
    let shape;
    const strokeColor = 0x333333;

    if (type === 'triangle') {
        shape = scene.add.triangle(0, 0, 0, 24, 12, 0, 24, 24, color);
        const border = scene.add.graphics();
        border.lineStyle(2, strokeColor, 1);
        border.strokeTriangle(0, 24, 12, 0, 24, 24);
        container.add([shape, border]);
    } else if (type === 'box') {
        shape = scene.add.rectangle(0, 0, 24, 24, color);
        const border = scene.add.graphics();
        border.lineStyle(2, strokeColor, 1);
        border.strokeRect(-12, -12, 24, 24);
        container.add([shape, border]);
    } else {
        shape = scene.add.circle(0, 0, 12, color);
        const border = scene.add.graphics();
        border.lineStyle(2, strokeColor, 1);
        border.strokeCircle(0, 0, 12);
        container.add([shape, border]);
    }

    // Add a very subtle "shadow" base
    const base = scene.add.circle(0, 4, 10, 0x000000, 0.2).setDepth(-1);
    container.addAt(base, 0);

    return container;
}

function drawKillBars() {
    if (!killBar) return;
    killBar.clear();

    const chargers = [player, ...Object.values(otherPlayers)].filter(p => {
        if (!p || p.isDead || p.role !== 'hunter') return false;
        return (p === player) ? isKillCharging : (p.chargeProgress > 0);
    });

    chargers.forEach(p => {
        const progress = (p === player) ? (killChargeTimer / 2000) : p.chargeProgress;
        const radius = 20 + (Math.min(1.0, progress) * 130);
        const alpha = Math.min(0.6, 0.2 + progress * 0.4);
        const isMaxed = progress >= 1.0;
        const color = isMaxed ? 0xff0000 : 0xff2a2a;

        // Outer glow
        killBar.lineStyle(isMaxed ? 6 : 4, color, alpha);
        killBar.strokeCircle(p.x, p.y, radius);

        if (isMaxed) {
            // Pulse at max charge
            const pulse = (Math.sin(Date.now() / 50) + 1) / 2;
            killBar.lineStyle(2, 0xffffff, 0.3 * pulse);
            killBar.strokeCircle(p.x, p.y, radius + 5 * pulse);
        }

        killBar.fillStyle(color, 0.1 * alpha);
        killBar.fillCircle(p.x, p.y, radius);
    });
}

function performKill(scene) {
    let killedAnyone = false;
    const chargeProgress = Math.min(1.0, killChargeTimer / 2000);
    const killRadius = 20 + (chargeProgress * 130); // Dynamic radius: starts at 20, ramps to 150

    console.log(`Hunter triggering kill. Charge: ${Math.round(chargeProgress * 100)}%, Radius: ${Math.round(killRadius)}`);

    Object.values(otherPlayers).forEach(s => {
        if (s.role === 'survivor' && !s.isDead) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, s.x, s.y);
            if (dist <= killRadius + 10) { // Small buffer
                if (checkLineOfSight(player.x, player.y, s.x, s.y)) {
                    console.log('Target', s.id, 'eliminated in blast!');
                    if (socketRef) socketRef.emit('player_killed', { targetId: s.id, radius: killRadius });
                    killedAnyone = true;
                }
            }
        }
    });

    // Intense feedback on release
    if (chargeProgress > 0.8) {
        scene.cameras.main.shake(400, 0.03 * chargeProgress);
    }

    if (killedAnyone) {
        scene.cameras.main.flash(300, 255, 0, 0);
    }

    if (socketRef) socketRef.emit('hunter_slowdown');
}

function setupMobileControls() {
    const base = document.getElementById('joystick-container');
    const thumb = document.getElementById('joystick-thumb');
    const actionBtn = document.getElementById('action-main-btn');
    const flashBtn = document.getElementById('flashlight-btn');

    if (!base || !thumb) return;

    let dragging = false;
    let baseRect = base.getBoundingClientRect();
    const maxDist = 60;

    const handleMove = (e) => {
        if (!dragging) return;
        const touch = e.touches[0];
        const dx = touch.clientX - (baseRect.left + baseRect.width / 2);
        const dy = touch.clientY - (baseRect.top + baseRect.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const finalDist = Math.min(dist, maxDist);
        const moveX = Math.cos(angle) * finalDist;
        const moveY = Math.sin(angle) * finalDist;

        thumb.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;

        joystickVector.x = moveX / maxDist;
        joystickVector.y = moveY / maxDist;
    };

    base.addEventListener('touchstart', (e) => {
        dragging = true;
        baseRect = base.getBoundingClientRect();
        handleMove(e);
    });

    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', () => {
        dragging = false;
        thumb.style.transform = 'translate(-50%, -50%)';
        joystickVector.x = 0;
        joystickVector.y = 0;
    });

    if (actionBtn) {
        actionBtn.addEventListener('touchstart', (e) => { e.preventDefault(); mobileActionDown = true; });
        actionBtn.addEventListener('touchend', (e) => { e.preventDefault(); mobileActionDown = false; });
    }

    if (flashBtn) {
        flashBtn.addEventListener('touchstart', (e) => { e.preventDefault(); mobileFDown = true; });
        flashBtn.addEventListener('touchend', (e) => { e.preventDefault(); mobileFDown = false; });
    }
}
