const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score-value');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const livesContainer = document.getElementById('lives-container');
const gameFrame = document.getElementById('game-frame');
const gameContainer = document.getElementById('game-container');

// Game state
let score = 0;
let lives = 3;
let extraLifeAwarded = false;
let level = 1;
let gameOver = false;
let gameStarted = false;
let animationId;
const SIM_FPS = 60;
const FIXED_DT = 1 / SIM_FPS;
const MAX_FRAME_TIME = 0.1;
const MAX_UPDATES_PER_FRAME = 5;
let lastFrameTime = 0;
let accumulator = 0;
let frameScale = 1;
let dotsRemaining = 0;
let totalPelletsThisLevel = 0;
let pelletIdleTimer = 0;

// Death animation
let deathAnimActive = false;
let deathAnimTimer = 0;
const DEATH_ANIM_DURATION = 90; // ~1.5s at 60fps

// Ghost eat multiplier chain
let eatMultiplier = 1;

// Floating score popups
let scorePopups = [];

// Movement and ghost pacing. Speeds are tiles per second; simulation runs at 60 fixed steps/sec.
const FULL_PLAYER_SPEED = 9.0;
const BASE_PLAYER_SPEED = FULL_PLAYER_SPEED * 0.8;
const MAX_PLAYER_SPEED = 9.6;
const BASE_GHOST_SPEED = FULL_PLAYER_SPEED * 0.75;
const MAX_GHOST_SPEED = 9.6;
const PRE_TURN_WINDOW = 0.28;
const DOT_PAUSE_FRAMES = 0;
const POWER_PELLET_PAUSE_FRAMES = 2;
const EATEN_SPEED_MULTIPLIER = 1.3;
const REVIVE_DELAY_FRAMES = Math.round(0.75 * SIM_FPS);
const EXIT_DELAY_FRAMES = Math.round(0.4 * SIM_FPS);
const MAX_RESPAWN_FRAMES = SIM_FPS * 8;
const DEBUG_GHOST_LABELS = false;
const TUNNEL_PENALTY = 6;
const PINKY_LOOKAHEAD_TILES = 4;
const INKY_LOOKAHEAD_TILES = 2;
const INKY_VECTOR_MULTIPLIER = 2.0;
const CLYDE_RETREAT_DISTANCE = 8;
const EXTRA_LIFE_SCORE = 10000;
const DIRECTION_PRIORITY = [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 }
];

const LEVEL_THEMES = [
    { wall: '#bc13fe', dot: '#ff007a', power: '#ffffff', glow: '#ff007a', floor: '#030006' },
    { wall: '#00f2ff', dot: '#ffdf37', power: '#ffffff', glow: '#00f2ff', floor: '#02070a' },
    { wall: '#ff3d00', dot: '#37ff6b', power: '#fff2a8', glow: '#ff8a00', floor: '#080200' },
    { wall: '#37ff6b', dot: '#f5f5ff', power: '#ffdf37', glow: '#37ff6b', floor: '#000804' }
];
const BONUS_TYPES = ['cigarette', 'beer', 'leaf', 'bag'];
const BONUS_SPAWN_COUNTS = [70, 170];
const BONUS_LIFETIME = 10 * SIM_FPS;
const BONUS_POINTS_BY_TYPE = { cigarette: 100, beer: 300, leaf: 500, bag: 700 };
let pelletsEaten = 0;
let pelletsEatenForRelease = 0;
let nextBonusIndex = 0;
let bonusItem = null;


// Player & Ghosts
let player;
let ghosts = [];
const headImg = new Image();
headImg.src = 'head-transparent.png';

const GHOST_STATE = {
    CHASE: 'CHASE',
    SCATTER: 'SCATTER',
    FRIGHTENED: 'FRIGHTENED',
    EATEN: 'EATEN',
    ENTERING_HOUSE: 'ENTERING_HOUSE',
    IN_HOUSE: 'IN_HOUSE',
    IN_HOUSE_REVIVING: 'IN_HOUSE_REVIVING',
    EXITING_HOUSE: 'EXITING_HOUSE'
};

let globalGhostState = GHOST_STATE.SCATTER;
let stateTimer = 0;
let frightenedTimer = 0;


// Configuration (recalculated on maze reset)
let MAP_WIDTH = MAZE_LAYOUT[0].length;
let MAP_HEIGHT = MAZE_LAYOUT.length;
let TILE_DIM;
let ghostHouse = {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    exit: { x: 0, y: 0 }
};

// Offscreen canvas for drawing the transparent head asset
const headCanvas = document.createElement('canvas');
const headCtx = headCanvas.getContext('2d');

// Static maze layer. Walls/background are cached; pellets/entities stay dynamic.
const mazeCanvas = document.createElement('canvas');
const mazeCtx = mazeCanvas.getContext('2d');
let mazeCacheDirty = true;

const HEAD_CROP = {
    x: 0.18,
    y: 0.05,
    width: 0.64,
    height: 0.68
};

const NORMAL_MUSIC_START_OFFSET = 3.5;

const gameAudio = {
    ctx: null,
    activeLoop: null,
    activeName: null,
    masterGain: null,
    step: 0,
    intervalId: null,
    normalTrack: null,
    powerTrack: null,
    normalHasStarted: false,
    normalTrackPrimed: false,

    ensure() {
        if (!this.normalTrack) {
            this.normalTrack = new Audio('audio/pacmansmusic.mp3');
            this.normalTrack.loop = true;
            this.normalTrack.volume = 0.35;
            this.normalTrack.preload = 'auto';
            this.normalTrack.addEventListener('loadedmetadata', () => this.primeNormalTrack(), { once: true });
            this.normalTrack.load();
        }

        if (!this.powerTrack) {
            this.powerTrack = new Audio('audio/du-hast.mp3');
            this.powerTrack.loop = true;
            this.powerTrack.volume = 0.48;
            this.powerTrack.preload = 'auto';
            this.powerTrack.load();
        }

        this.primeNormalTrack();

        if (this.ctx) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.08;
        this.masterGain.connect(this.ctx.destination);
    },

    primeNormalTrack() {
        if (!this.normalTrack || this.normalTrackPrimed) return;
        if (this.normalTrack.readyState < 1) return;
        try {
            this.normalTrack.currentTime = NORMAL_MUSIC_START_OFFSET;
            this.normalTrackPrimed = true;
        } catch (error) {
            console.warn('Unable to prime normal music intro skip', error);
        }
    },

    resume() {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    play(name) {
        this.resume();
        if (this.activeName === name) return;
        this.stop();
        this.activeName = name;

        if (name === 'normal') {
            if (!this.normalTrack) return;
            if (!this.normalHasStarted) {
                this.primeNormalTrack();
                this.normalHasStarted = true;
            }
            this.normalTrack.play().catch(() => {});
            return;
        }

        if (name === 'power') {
            if (!this.powerTrack) return;
            try {
                this.powerTrack.currentTime = 0;
            } catch (error) {
                console.warn('Unable to restart power music', error);
            }
            this.powerTrack.play().catch(() => {});
        }
    },

    stop(name = null) {
        if (name && this.activeName !== name) return;
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;
        this.activeLoop = null;

        if (!name || name === 'normal' || this.activeName === 'normal') {
            if (this.normalTrack) this.normalTrack.pause();
        }

        if (!name || name === 'power' || this.activeName === 'power') {
            if (this.powerTrack) this.powerTrack.pause();
        }

        this.activeName = null;
    },

    playStep() {
        if (!this.ctx || !this.activeLoop) return;
        const freq = this.activeLoop.notes[this.step % this.activeLoop.notes.length];
        this.step++;
        if (!freq) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = this.activeLoop.wave;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(this.activeLoop.gain, this.ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + this.activeLoop.duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + this.activeLoop.duration + 0.02);
    }
};

const NORMAL_MUSIC_PATTERN = {
    notes: [110, null, 146.83, null, 130.81, null, 98, null],
    interval: 220,
    duration: 0.16,
    gain: 0.11,
    wave: 'square'
};

const POWER_MUSIC_PATTERN = {
    notes: [220, 261.63, 293.66, 349.23, 293.66, 261.63, 220, 196],
    interval: 115,
    duration: 0.09,
    gain: 0.09,
    wave: 'sawtooth'
};

function startNormalMusic() {
    if (gameStarted && !gameOver && frightenedTimer <= 0) gameAudio.play('normal');
}

function startPowerMusic() {
    if (gameStarted && !gameOver) gameAudio.play('power');
}

function stopGameMusic() {
    gameAudio.stop();
}

// Resource Loading
async function loadResources() {
    await new Promise((resolve) => {
        if (headImg.complete) resolve();
        else headImg.onload = () => resolve();
    });
}

async function init() {
    await loadResources();
    gameAudio.ensure();
    resizeCanvas();
    resetGame();
}

function updateGhostHouseMetadata() {
    const spawns = [];
    let door = null;
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (MAZE_ORIGINAL[y][x] === 4) spawns.push({ x, y });
            if (MAZE_ORIGINAL[y][x] === 8) door = { x, y };
        }
    }

    if (spawns.length === 0) return;

    const xs = spawns.map(p => p.x);
    const ys = spawns.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = Math.round(xs.reduce((sum, x) => sum + x, 0) / xs.length);
    const exit = door || { x: centerX, y: Math.max(0, minY - 1) };

    ghostHouse = {
        minX: Math.max(0, minX - 1),
        maxX: Math.min(MAP_WIDTH - 1, maxX + 1),
        minY: door ? Math.min(door.y + 1, minY) : minY,
        maxY: Math.min(MAP_HEIGHT - 1, maxY + 1),
        exit
    };
}

function isInsideGhostHouse(x, y) {
    return x >= ghostHouse.minX && x <= ghostHouse.maxX &&
        y >= ghostHouse.minY && y <= ghostHouse.maxY;
}

function getHouseOutsideExit() {
    return { x: ghostHouse.exit.x, y: Math.max(0, ghostHouse.exit.y - 1) };
}

function isAtHouseOutsideExit(x, y) {
    const outsideExit = getHouseOutsideExit();
    return x === outsideExit.x && y === outsideExit.y;
}

function setGhostExitDirection(ghost) {
    if (ghost.gridX < ghostHouse.exit.x) {
        ghost.nextDir = { x: 1, y: 0 };
    } else if (ghost.gridX > ghostHouse.exit.x) {
        ghost.nextDir = { x: -1, y: 0 };
    } else {
        ghost.nextDir = { x: 0, y: -1 };
    }
}

function rawGridDistance(x, y, target) {
    return Math.hypot(x - target.x, y - target.y);
}

function isTunnelTile(x, y) {
    return !!(MAZE_LAYOUT[y] && MAZE_LAYOUT[y][x] === 6);
}

function getMazeTile(x, y) {
    return MAZE_LAYOUT[y] && MAZE_LAYOUT[y][x];
}

function isGhostHouseTile(tile) {
    return tile === 4 || tile === 7 || tile === 8;
}

function isGhostDoorTile(x, y) {
    return x === ghostHouse.exit.x && y === ghostHouse.exit.y;
}

function isNormalGhostWalkableTile(tile) {
    return tile !== undefined && tile !== 1 && !isGhostHouseTile(tile);
}

function directionCost(x, y, dir, target) {
    const nextX = x + dir.x;
    const nextY = y + dir.y;
    let cost = rawGridDistance(nextX, nextY, target);
    if (isTunnelTile(nextX, nextY) && !isTunnelTile(x, y)) cost += TUNNEL_PENALTY;
    return cost;
}

function getScatterTarget(personality) {
    switch (personality) {
        case 'blinky': return { x: MAP_WIDTH - 1, y: -3 };
        case 'pinky': return { x: 0, y: -3 };
        case 'inky': return { x: MAP_WIDTH - 1, y: MAP_HEIGHT + 3 };
        case 'clyde': return { x: 0, y: MAP_HEIGHT + 3 };
        default: return { x: 0, y: -3 };
    }
}

function isLivingGhostState(state) {
    return state === GHOST_STATE.CHASE || state === GHOST_STATE.SCATTER || state === GHOST_STATE.FRIGHTENED;
}

function isRespawnGhostState(state) {
    return state === GHOST_STATE.EATEN ||
        state === GHOST_STATE.ENTERING_HOUSE ||
        state === GHOST_STATE.IN_HOUSE_REVIVING ||
        state === GHOST_STATE.EXITING_HOUSE;
}

function requestGhostReverse(ghost) {
    if (isRespawnGhostState(ghost.state) || ghost.state === GHOST_STATE.IN_HOUSE) return;
    ghost.pendingReverse = true;
}

function setGlobalGhostState(nextState) {
    if (globalGhostState === nextState) return;
    globalGhostState = nextState;
    ghosts.forEach(g => {
        if (g.state === GHOST_STATE.CHASE || g.state === GHOST_STATE.SCATTER) {
            g.state = nextState;
            requestGhostReverse(g);
        }
    });
}

const LEVEL_ONE_MODE_SCHEDULE = [
    { state: GHOST_STATE.SCATTER, frames: 8 * SIM_FPS },
    { state: GHOST_STATE.CHASE, frames: 20 * SIM_FPS },
    { state: GHOST_STATE.SCATTER, frames: 7 * SIM_FPS },
    { state: GHOST_STATE.CHASE, frames: 20 * SIM_FPS },
    { state: GHOST_STATE.SCATTER, frames: 5 * SIM_FPS },
    { state: GHOST_STATE.CHASE, frames: 20 * SIM_FPS },
    { state: GHOST_STATE.SCATTER, frames: 5 * SIM_FPS },
    { state: GHOST_STATE.CHASE, frames: Infinity }
];

function getModeSchedule() {
    return LEVEL_ONE_MODE_SCHEDULE;
}

function getCurrentScheduledMode() {
    let elapsed = stateTimer;
    for (const slot of getModeSchedule()) {
        if (elapsed < slot.frames) return slot.state;
        elapsed -= slot.frames;
    }
    return GHOST_STATE.CHASE;
}

function getIdleReleaseSeconds(currentLevel) {
    if (currentLevel === 1) return 4.0;
    if (currentLevel <= 4) return 3.5;
    return 3.0;
}

function getIdleReleaseFrames(currentLevel) {
    return Math.round(getIdleReleaseSeconds(currentLevel) * SIM_FPS);
}

function getHouseReleaseThreshold(personality, currentLevel) {
    if (currentLevel === 1) {
        if (personality === 'blinky' || personality === 'pinky') return 0;
        if (personality === 'inky') return Math.min(30, Math.round(totalPelletsThisLevel * 0.12));
        if (personality === 'clyde') return Math.min(60, Math.round(totalPelletsThisLevel * 0.24));
    }

    if (currentLevel <= 4) {
        if (personality === 'blinky' || personality === 'pinky' || personality === 'inky') return 0;
        if (personality === 'clyde') return Math.min(50, Math.round(totalPelletsThisLevel * 0.18));
    }

    return 0;
}

function releaseGhostFromHouse(ghost, useExitDelay = true) {
    if (!ghost || (ghost.state !== GHOST_STATE.IN_HOUSE && ghost.state !== GHOST_STATE.IN_HOUSE_REVIVING)) return false;
    if (ghost.setState) ghost.setState(GHOST_STATE.EXITING_HOUSE);
    else ghost.state = GHOST_STATE.EXITING_HOUSE;
    ghost.pendingReverse = false;
    ghost.reviveTimer = 0;
    ghost.respawnStateTimer = 0;
    ghost.exitDelay = useExitDelay ? EXIT_DELAY_FRAMES : 0;
    ghost.moving = false;
    ghost.dir = { x: 0, y: 0 };
    ghost.targetX = ghost.gridX;
    ghost.targetY = ghost.gridY;
    ghost.target = getHouseOutsideExit();
    setGhostExitDirection(ghost);
    return true;
}

function forceGhostToExit(ghost) {
    const outsideExit = getHouseOutsideExit();
    resetEntityPosition(ghost, outsideExit.x, outsideExit.y);
    if (ghost.setState) ghost.setState(globalGhostState);
    else ghost.state = globalGhostState;
    ghost.speed = ghost.baseSpeed;
    ghost.pendingReverse = false;
    ghost.reviveTimer = 0;
    ghost.exitDelay = 0;
    ghost.respawnStateTimer = 0;
    ghost.dir = { x: 0, y: 0 };
    ghost.nextDir = { x: 0, y: 0 };
}

function releaseNextWaitingGhost() {
    const next = ghosts.find(g => g.state === GHOST_STATE.IN_HOUSE);
    if (next) releaseGhostFromHouse(next, false);
}

function updateHouseReleases() {
    if (!totalPelletsThisLevel) return;

    ghosts.forEach(g => {
        if (g.state !== GHOST_STATE.IN_HOUSE) return;
        if (pelletsEatenForRelease >= getHouseReleaseThreshold(g.personality, level)) {
            releaseGhostFromHouse(g, true);
        }
    });

    if (pelletsEatenForRelease > 0 && pelletIdleTimer >= getIdleReleaseFrames(level)) {
        if (ghosts.some(g => g.state === GHOST_STATE.IN_HOUSE)) {
            releaseNextWaitingGhost();
            pelletIdleTimer = 0;
        }
    }
}

function getCruiseElroyStage() {
    const blinky = ghosts.find(g => g.personality === 'blinky');
    if (!blinky || !isLivingGhostState(blinky.state)) return 0;
    if (dotsRemaining <= 10) return 2;
    if (dotsRemaining <= 20) return 1;
    return 0;
}

function getCruiseElroySpeedMultiplier() {
    const stage = getCruiseElroyStage();
    if (stage === 2) return 1.16;
    if (stage === 1) return 1.08;
    return 1;
}

function isCruiseElroy(ghost) {
    return ghost && ghost.personality === 'blinky' && getCruiseElroyStage() > 0;
}

function getLevelSpeedProfile(currentLevel) {
    if (currentLevel === 1) {
        return { player: FULL_PLAYER_SPEED * 0.8, ghost: FULL_PLAYER_SPEED * 0.75, frightenedGhost: FULL_PLAYER_SPEED * 0.5, tunnelGhost: FULL_PLAYER_SPEED * 0.4 };
    }
    if (currentLevel <= 4) {
        return { player: FULL_PLAYER_SPEED * 0.9, ghost: FULL_PLAYER_SPEED * 0.85, frightenedGhost: FULL_PLAYER_SPEED * 0.55, tunnelGhost: FULL_PLAYER_SPEED * 0.45 };
    }
    if (currentLevel <= 20) {
        return { player: FULL_PLAYER_SPEED, ghost: FULL_PLAYER_SPEED * 0.95, frightenedGhost: FULL_PLAYER_SPEED * 0.6, tunnelGhost: FULL_PLAYER_SPEED * 0.5 };
    }
    return { player: FULL_PLAYER_SPEED * 0.9, ghost: FULL_PLAYER_SPEED * 0.95, frightenedGhost: FULL_PLAYER_SPEED * 0.6, tunnelGhost: FULL_PLAYER_SPEED * 0.5 };
}


function getFrightenedDuration(currentLevel) {
    if (currentLevel === 1) return 360;
    if (currentLevel === 2) return 300;
    if (currentLevel === 3) return 240;
    if (currentLevel === 4) return 180;
    if (currentLevel <= 6) return 120;
    return 0;
}

function applyLevelPacing() {
    const speed = getLevelSpeedProfile(level);
    if (player) player.speed = Math.min(MAX_PLAYER_SPEED, speed.player);
    ghosts.forEach(g => { g.baseSpeed = Math.min(MAX_GHOST_SPEED, speed.ghost); });
}

function currentTheme() {
    return LEVEL_THEMES[(level - 1) % LEVEL_THEMES.length];
}

function findBonusSpawnPosition() {
    const candidates = [
        { x: Math.floor(MAP_WIDTH / 2), y: ghostHouse.maxY + 1 },
        { x: Math.floor(MAP_WIDTH / 2), y: ghostHouse.minY - 1 },
        { x: Math.floor(MAP_WIDTH / 2) - 5, y: ghostHouse.maxY + 1 },
        { x: Math.floor(MAP_WIDTH / 2) + 5, y: ghostHouse.maxY + 1 }
    ];
    return candidates.find(p => {
        const tile = MAZE_LAYOUT[p.y] && MAZE_LAYOUT[p.y][p.x];
        return tile === 0 || tile === 2;
    }) || { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) + 4 };
}

function maybeSpawnBonus() {
    if (bonusItem || nextBonusIndex >= BONUS_SPAWN_COUNTS.length) return;
    if (pelletsEaten < BONUS_SPAWN_COUNTS[nextBonusIndex]) return;

    const pos = findBonusSpawnPosition();
    const type = BONUS_TYPES[(level + nextBonusIndex - 1) % BONUS_TYPES.length];
    bonusItem = {
        x: pos.x,
        y: pos.y,
        type,
        points: BONUS_POINTS_BY_TYPE[type] || 500,
        life: BONUS_LIFETIME
    };
    nextBonusIndex++;
}

function resizeCanvas() {
    const parent = canvas.parentElement;
    const maxW = parent.clientWidth;
    const maxH = parent.clientHeight;
    if (maxW === 0 || maxH === 0) return;
    
    // Fit maze to container preserving aspect ratio
    const aspect = MAP_WIDTH / MAP_HEIGHT;
    let w, h;
    if (maxW / maxH > aspect) {
        h = maxH;
        w = h * aspect;
    } else {
        w = maxW;
        h = w / aspect;
    }
    
    canvas.width = w;
    canvas.height = h;
    TILE_DIM = w / MAP_WIDTH;
    
    mazeCacheDirty = true;

    if (gameStarted && !gameOver) {
        renderGame(1);
    }
}

window.addEventListener('resize', resizeCanvas);

class Entity {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.prevX = x;
        this.prevY = y;
        this.renderX = x;
        this.renderY = y;
        this.gridX = Math.round(x);
        this.gridY = Math.round(y);
        this.targetX = x;
        this.targetY = y;
        this.color = color;
        this.speed = 0.15;
        this.dir = { x: 0, y: 0 };
        this.nextDir = { x: 0, y: 0 };
        this.moving = false;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(
            this.renderX * TILE_DIM + TILE_DIM / 2,
            this.renderY * TILE_DIM + TILE_DIM / 2,
            TILE_DIM * 0.4,
            0, Math.PI * 2
        );
        ctx.fill();
    }

    update(dt = FIXED_DT) {
        this.prevX = this.x;
        this.prevY = this.y;

        if (!this.moving) {
            // Check if we can move in nextDir
            if (this.canMove(this.nextDir)) {
                this.dir = { ...this.nextDir };
                this.moving = true;
                this.targetX = this.gridX + this.dir.x;
                this.targetY = this.gridY + this.dir.y;
            } else if (this.canMove(this.dir)) {
                this.moving = true;
                this.targetX = this.gridX + this.dir.x;
                this.targetY = this.gridY + this.dir.y;
            }
        }

        if (this.moving) {
            const step = this.speed * dt;
            this.x += this.dir.x * step;
            this.y += this.dir.y * step;

            if (Math.abs(this.x - this.targetX) <= step && Math.abs(this.y - this.targetY) <= step) {
                this.x = this.targetX;
                this.y = this.targetY;
                this.gridX = Math.round(this.targetX);
                this.gridY = Math.round(this.targetY);
                this.moving = false;

                // Tunnel wrap-around
                if (this.gridX < 0) { this.x = this.gridX = MAP_WIDTH - 1; this.targetX = this.gridX; }
                if (this.gridX >= MAP_WIDTH) { this.x = this.gridX = 0; this.targetX = this.gridX; }

                this.onReachedGrid();
            }
        }
    }

    canMove(dir) {
        if (dir.x === 0 && dir.y === 0) return false;
        let nextX = this.gridX + dir.x;
        const nextY = this.gridY + dir.y;
        
        // Allow tunnel wrap
        if (nextY < 0 || nextY >= MAP_HEIGHT) return false;
        if (nextX < 0 || nextX >= MAP_WIDTH) {
            // Check if current tile is a tunnel
            const curTile = MAZE_LAYOUT[this.gridY][this.gridX];
            if (curTile === 6) return true;
            return false;
        }
        const tile = MAZE_LAYOUT[nextY][nextX];
        return tile !== 1;
    }

    onReachedGrid() {}
}

class Player extends Entity {
    constructor(x, y) {
        super(x, y, '#ff0');
        this.speed = BASE_PLAYER_SPEED;
        this.rotation = 0;
        this.pauseFrames = 0;
    }

    canMove(dir) {
        return this.canMoveFrom(this.gridX, this.gridY, dir);
    }

    canMoveFrom(gridX, gridY, dir) {
        if (dir.x === 0 && dir.y === 0) return false;
        let nextX = gridX + dir.x;
        const nextY = gridY + dir.y;

        if (nextY < 0 || nextY >= MAP_HEIGHT) return false;
        if (nextX < 0 || nextX >= MAP_WIDTH) {
            const curTile = MAZE_LAYOUT[gridY][gridX];
            return curTile === 6;
        }

        const tile = MAZE_LAYOUT[nextY][nextX];
        return tile !== 1 && tile !== 4 && tile !== 7 && tile !== 8;
    }

    update(dt = FIXED_DT) {
        if (this.pauseFrames > 0) {
            this.prevX = this.x;
            this.prevY = this.y;
            this.pauseFrames -= 1;
            return;
        }

        if (this.moving && (this.nextDir.x !== this.dir.x || this.nextDir.y !== this.dir.y)) {
            this.tryCornering();
        }

        super.update(dt);

        if (this.moving) {
            const rollSpeed = 0.2;
            if (this.dir.x > 0) this.rotation += rollSpeed;
            if (this.dir.x < 0) this.rotation -= rollSpeed;
            if (this.dir.y > 0) this.rotation += rollSpeed;
            if (this.dir.y < 0) this.rotation -= rollSpeed;
        }
    }

    tryCornering() {
        if (this.nextDir.x === 0 && this.nextDir.y === 0) return;
        if (this.nextDir.x === -this.dir.x && this.nextDir.y === -this.dir.y) return;

        const turnX = Math.round(this.targetX);
        const turnY = Math.round(this.targetY);
        if (!this.canMoveFrom(turnX, turnY, this.nextDir)) return;

        const offsetX = Math.abs(this.x - turnX);
        const offsetY = Math.abs(this.y - turnY);

        if (this.dir.x !== 0 && this.nextDir.y !== 0 && offsetX <= PRE_TURN_WINDOW) {
            this.x = turnX;
            this.y = turnY;
            this.gridX = turnX;
            this.gridY = turnY;
            this.onReachedGrid();
            this.dir = { ...this.nextDir };
            this.targetX = turnX;
            this.targetY = turnY + this.dir.y;
        } else if (this.dir.y !== 0 && this.nextDir.x !== 0 && offsetY <= PRE_TURN_WINDOW) {
            this.x = turnX;
            this.y = turnY;
            this.gridX = turnX;
            this.gridY = turnY;
            this.onReachedGrid();
            this.dir = { ...this.nextDir };
            this.targetX = turnX + this.dir.x;
            this.targetY = turnY;
        }
    }

    draw() {
        const drawX = this.renderX ?? this.x;
        const drawY = this.renderY ?? this.y;
        const size = TILE_DIM * 1.2;

        ctx.save();
        // Move to center for rotation
        ctx.translate(drawX * TILE_DIM + TILE_DIM/2, drawY * TILE_DIM + TILE_DIM/2);

        if (frightenedTimer > 0) {
            const pulse = 0.98 + Math.sin(Date.now() / 55) * 0.2;
            ctx.save();
            ctx.globalAlpha = 0.95;
            ctx.shadowBlur = TILE_DIM * 1.25;
            ctx.shadowColor = '#ff3d00';
            const flame = ctx.createRadialGradient(0, 0, size * 0.08, 0, 0, size * 1.08 * pulse);
            flame.addColorStop(0, 'rgba(255, 252, 124, 1)');
            flame.addColorStop(0.26, 'rgba(255, 160, 0, 0.95)');
            flame.addColorStop(0.55, 'rgba(255, 47, 0, 0.82)');
            flame.addColorStop(1, 'rgba(255, 0, 122, 0)');
            ctx.fillStyle = flame;
            ctx.beginPath();
            ctx.arc(0, 0, size * 1.08 * pulse, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 214, 0, 0.75)';
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i + Date.now() / 260;
                ctx.beginPath();
                ctx.ellipse(
                    Math.cos(angle) * size * 0.34,
                    Math.sin(angle) * size * 0.34,
                    size * 0.09,
                    size * 0.34,
                    angle,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }
            ctx.restore();
        }
        
        ctx.rotate(this.rotation);
        
        if (headImg.complete) {
            const srcX = headImg.naturalWidth * HEAD_CROP.x;
            const srcY = headImg.naturalHeight * HEAD_CROP.y;
            const srcW = headImg.naturalWidth * HEAD_CROP.width;
            const srcH = headImg.naturalHeight * HEAD_CROP.height;
            
            // Draw cropped transparent head onto offscreen canvas.
            const drawSize = Math.ceil(size);
            headCanvas.width = drawSize;
            headCanvas.height = drawSize;
            headCtx.clearRect(0, 0, drawSize, drawSize);
            headCtx.drawImage(headImg, srcX, srcY, srcW, srcH, 0, 0, drawSize, drawSize);
            
            // Blit the filtered result onto the main canvas
            ctx.drawImage(headCanvas, -size/2, -size/2, size, size);
        }
        
        ctx.restore();
    }

    onReachedGrid() {
        const tile = MAZE_LAYOUT[this.gridY][this.gridX];
        if (tile === 0 || tile === 3) {
            if (tile === 3) {
                addScore(50);
                eatMultiplier = 1; // Reset multiplier chain
                triggerFrightenedMode();
                this.pauseFrames = POWER_PELLET_PAUSE_FRAMES;
            } else {
                addScore(10);
                this.pauseFrames = DOT_PAUSE_FRAMES;
            }
            MAZE_LAYOUT[this.gridY][this.gridX] = 2;
            dotsRemaining--;
            pelletsEaten++;
            pelletsEatenForRelease++;
            pelletIdleTimer = 0;
            maybeSpawnBonus();
            updateHUD();
            if (dotsRemaining <= 0) advanceLevel();
        }

        if (bonusItem && this.gridX === bonusItem.x && this.gridY === bonusItem.y) {
            const points = bonusItem.points || 500;
            addScore(points);
            scorePopups.push({ x: bonusItem.x, y: bonusItem.y, text: '+' + points, life: 70 });
            bonusItem = null;
            updateHUD();
        }
    }
}

class Ghost extends Entity {
    constructor(x, y, color, personality) {
        super(x, y, color);
        this.personality = personality;
        this.baseSpeed = BASE_GHOST_SPEED;
        this.speed = this.baseSpeed;
        this.state = GHOST_STATE.IN_HOUSE;
        this.target = { x: 0, y: 0 };
        this.spawnPos = { x, y };
        this.pendingReverse = false;
        this.reviveTimer = 0;
        this.exitDelay = 0;
        this.respawnStateTimer = 0;
        this.prngSeed = (x * 73856093) ^ (y * 19349663) ^ personality.length;
        this.nextDir = { x: 0, y: -1 };
    }

    randomIndex(max) {
        this.prngSeed = (this.prngSeed * 1664525 + 1013904223) >>> 0;
        return this.prngSeed % max;
    }

    canEnterTile(x, y) {
        if (y < 0 || y >= MAP_HEIGHT) return false;
        if (x < 0 || x >= MAP_WIDTH) {
            const curTile = getMazeTile(this.gridX, this.gridY);
            return curTile === 6;
        }

        const tile = getMazeTile(x, y);
        if (tile === undefined || tile === 1) return false;

        if (this.state === GHOST_STATE.EATEN) {
            return isNormalGhostWalkableTile(tile) || isGhostDoorTile(x, y);
        }

        if (this.state === GHOST_STATE.ENTERING_HOUSE || this.state === GHOST_STATE.IN_HOUSE_REVIVING) {
            return isGhostHouseTile(tile);
        }

        if (this.state === GHOST_STATE.EXITING_HOUSE) {
            return tile !== 1;
        }

        if (this.state === GHOST_STATE.IN_HOUSE) {
            return isGhostHouseTile(tile);
        }

        return isNormalGhostWalkableTile(tile);
    }

    canMove(dir) {
        if (dir.x === 0 && dir.y === 0) return false;
        return this.canEnterTile(this.gridX + dir.x, this.gridY + dir.y);
    }


    draw() {
        const drawX = this.renderX ?? this.x;
        const drawY = this.renderY ?? this.y;
        const px = drawX * TILE_DIM + TILE_DIM * 0.04;
        const py = drawY * TILE_DIM + TILE_DIM * 0.02;
        const size = TILE_DIM * 0.92;
        const cx = px + size / 2;
        const vulnerable = this.state === GHOST_STATE.FRIGHTENED;
        const flash = vulnerable && frightenedTimer <= 2 * SIM_FPS && Math.floor(frightenedTimer / 10) % 2 === 0;
        const eyeShiftX = this.dir.x * TILE_DIM * 0.045;
        const eyeShiftY = this.dir.y * TILE_DIM * 0.045;

        ctx.save();

        if (this.state === GHOST_STATE.EATEN || this.state === GHOST_STATE.ENTERING_HOUSE) {
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 9;
            ctx.shadowColor = '#00f2ff';
            ctx.beginPath();
            ctx.arc(cx - size * 0.17, py + size * 0.42, size * 0.15, 0, Math.PI * 2);
            ctx.arc(cx + size * 0.17, py + size * 0.42, size * 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#00f2ff';
            ctx.beginPath();
            ctx.arc(cx - size * 0.17 + eyeShiftX, py + size * 0.42 + eyeShiftY, size * 0.07, 0, Math.PI * 2);
            ctx.arc(cx + size * 0.17 + eyeShiftX, py + size * 0.42 + eyeShiftY, size * 0.07, 0, Math.PI * 2);
            ctx.fill();
            if (DEBUG_GHOST_LABELS) {
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.max(8, TILE_DIM * 0.28)}px monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(this.state, cx, py - TILE_DIM * 0.18);
            }
            ctx.restore();
            return;
        }

        const torchX = px + size * 0.88;
        const torchTop = py + size * 0.34;
        const torchBottom = py + size * 0.8;

        ctx.lineCap = 'round';
        ctx.strokeStyle = vulnerable ? '#555' : '#8b4a19';
        ctx.lineWidth = Math.max(2, TILE_DIM * 0.11);
        ctx.shadowBlur = vulnerable ? 0 : 8;
        ctx.shadowColor = '#ff8a00';
        ctx.beginPath();
        ctx.moveTo(torchX, torchTop);
        ctx.lineTo(torchX + size * 0.14, torchBottom);
        ctx.stroke();

        if (!vulnerable) {
            const flamePulse = 0.95 + Math.sin(Date.now() / 80 + this.gridX) * 0.18;
            ctx.fillStyle = '#ff3d00';
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ff3d00';
            ctx.beginPath();
            ctx.ellipse(torchX - size * 0.02, torchTop - size * 0.13, size * 0.12, size * 0.22 * flamePulse, -0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffdf37';
            ctx.beginPath();
            ctx.ellipse(torchX - size * 0.02, torchTop - size * 0.13, size * 0.06, size * 0.13 * flamePulse, -0.15, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#101010';
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(torchX - size * 0.02, torchTop - size * 0.1, size * 0.08, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(160, 220, 255, 0.8)';
            ctx.lineWidth = Math.max(1, TILE_DIM * 0.04);
            ctx.beginPath();
            ctx.arc(torchX - size * 0.02, torchTop - size * 0.22, size * 0.11, Math.PI * 0.25, Math.PI * 1.25);
            ctx.stroke();
        }

        const bodyColor = flash ? '#f6f6f0' : vulnerable ? '#d7f3ff' : '#f6f6f0';
        const edgeColor = vulnerable ? '#00f2ff' : 'rgba(255, 255, 255, 0.95)';
        ctx.fillStyle = bodyColor;
        ctx.shadowBlur = vulnerable ? 8 : 6;
        ctx.shadowColor = vulnerable ? '#00f2ff' : 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(cx, py + size * 0.02);
        ctx.lineTo(px + size * 0.82, py + size * 0.88);
        ctx.lineTo(px + size * 0.62, py + size * 0.76);
        ctx.lineTo(cx, py + size * 0.96);
        ctx.lineTo(px + size * 0.38, py + size * 0.76);
        ctx.lineTo(px + size * 0.18, py + size * 0.88);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = Math.max(1, TILE_DIM * 0.07);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = vulnerable && !flash ? '#0059ff' : '#ff003c';
        ctx.fillRect(cx - size * 0.23 + eyeShiftX, py + size * 0.4 + eyeShiftY, size * 0.16, size * 0.045);
        ctx.fillRect(cx + size * 0.07 + eyeShiftX, py + size * 0.4 + eyeShiftY, size * 0.16, size * 0.045);

        ctx.strokeStyle = vulnerable && !flash ? '#0059ff' : '#111';
        ctx.lineWidth = Math.max(1, TILE_DIM * 0.055);
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.24, py + size * 0.62);
        ctx.lineTo(cx + size * 0.24, py + size * 0.62);
        ctx.stroke();

        if (DEBUG_GHOST_LABELS) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.max(8, TILE_DIM * 0.28)}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(this.state, cx, py - TILE_DIM * 0.18);
        }

        ctx.restore();
    }

    tickRespawnFailsafe() {
        if (!isRespawnGhostState(this.state)) {
            this.respawnStateTimer = 0;
            return false;
        }

        this.respawnStateTimer += 1;
        if (this.state !== GHOST_STATE.EATEN && this.respawnStateTimer > MAX_RESPAWN_FRAMES) {
            console.warn('Respawn pipeline exceeded failsafe; forcing exit', this.personality, this.state, this.gridX, this.gridY);
            forceGhostToExit(this);
            return true;
        }
        return false;
    }


    setState(nextState) {
        if (this.state === nextState) return;
        const oldState = this.state;
        this.state = nextState;
        this.respawnStateTimer = 0;
        console.log(`${this.personality}: ${oldState} -> ${nextState}`);
    }

    choosePathDirectionTo(target, allowReverse = true) {
        const start = { x: this.gridX, y: this.gridY };
        if (start.x === target.x && start.y === target.y) return { x: 0, y: 0 };

        const reverse = { x: -this.dir.x, y: -this.dir.y };
        let firstDirs = DIRECTION_PRIORITY.filter(d => this.canMove(d));
        if (!allowReverse && (this.dir.x !== 0 || this.dir.y !== 0)) {
            firstDirs = firstDirs.filter(d => d.x !== reverse.x || d.y !== reverse.y);
        }
        if (firstDirs.length === 0) firstDirs = DIRECTION_PRIORITY.filter(d => this.canMove(d));

        const visited = new Set([`${start.x},${start.y}`]);
        const queue = firstDirs.map(d => ({ x: start.x + d.x, y: start.y + d.y, first: d }));
        queue.forEach(n => visited.add(`${n.x},${n.y}`));

        while (queue.length) {
            const node = queue.shift();
            if (node.x === target.x && node.y === target.y) return node.first;

            for (const d of DIRECTION_PRIORITY) {
                const nx = node.x + d.x;
                const ny = node.y + d.y;
                const key = `${nx},${ny}`;
                if (visited.has(key)) continue;
                if (!this.canEnterTile(nx, ny)) continue;
                visited.add(key);
                queue.push({ x: nx, y: ny, first: node.first });
            }
        }

        console.warn('Ghost has no path to target', this.personality, this.state, this.gridX, this.gridY, target);
        return this.chooseBestDirectionTo(target, allowReverse);
    }

    chooseBestDirectionTo(target, allowReverse = true) {
        const reverse = { x: -this.dir.x, y: -this.dir.y };
        let validDirs = DIRECTION_PRIORITY.filter(d => this.canMove(d));

        if (!allowReverse && (this.dir.x !== 0 || this.dir.y !== 0)) {
            validDirs = validDirs.filter(d => d.x !== reverse.x || d.y !== reverse.y);
        }

        if (validDirs.length === 0) return { x: 0, y: 0 };

        let bestDir = validDirs[0];
        let minDist = Infinity;
        validDirs.forEach(d => {
            const dist = directionCost(this.gridX, this.gridY, d, target);
            if (dist < minDist - 0.001) {
                minDist = dist;
                bestDir = d;
            }
        });
        return bestDir;
    }

    update(dt = FIXED_DT) {
        if (this.tickRespawnFailsafe()) return;

        if (isLivingGhostState(this.state) && isInsideGhostHouse(this.gridX, this.gridY)) {
            this.setState(GHOST_STATE.EXITING_HOUSE);
            this.pendingReverse = false;
                this.moving = false;
            this.dir = { x: 0, y: 0 };
            setGhostExitDirection(this);
        }

        if (this.state === GHOST_STATE.IN_HOUSE) {
            this.prevX = this.x;
            this.prevY = this.y;
            return;
        }

        if (this.state === GHOST_STATE.IN_HOUSE_REVIVING) {
            this.prevX = this.x;
            this.prevY = this.y;
            this.reviveTimer -= 1;
            if (this.reviveTimer <= 0) releaseGhostFromHouse(this, true);
            return;
        }

        if (this.state === GHOST_STATE.EXITING_HOUSE && this.exitDelay > 0) {
            this.prevX = this.x;
            this.prevY = this.y;
            this.exitDelay -= 1;
            return;
        }

        const speedProfile = getLevelSpeedProfile(level);
        if (this.state === GHOST_STATE.FRIGHTENED) this.speed = speedProfile.frightenedGhost;
        else if (this.state === GHOST_STATE.EATEN || this.state === GHOST_STATE.ENTERING_HOUSE) this.speed = this.baseSpeed * EATEN_SPEED_MULTIPLIER;
        else if (isCruiseElroy(this)) this.speed = Math.min(MAX_GHOST_SPEED, this.baseSpeed * getCruiseElroySpeedMultiplier());
        else this.speed = this.baseSpeed;

        if (MAZE_LAYOUT[this.gridY] && MAZE_LAYOUT[this.gridY][this.gridX] === 6 && !isRespawnGhostState(this.state)) {
            this.speed = Math.min(this.speed, speedProfile.tunnelGhost);
        }

        super.update(dt);
    }

    onReachedGrid() {
        if (this.state === GHOST_STATE.EATEN) {
            if (this.gridX === ghostHouse.exit.x && this.gridY === ghostHouse.exit.y) {
                this.setState(GHOST_STATE.ENTERING_HOUSE);
                this.target = this.spawnPos;
            } else {
                this.target = ghostHouse.exit;
            }
            this.nextDir = this.choosePathDirectionTo(this.target, true);
            if (this.nextDir.x === 0 && this.nextDir.y === 0 && !isGhostDoorTile(this.gridX, this.gridY)) {
                console.warn('EATEN ghost has no path to door', this.personality, this.gridX, this.gridY);
            }
            return;
        }

        if (this.state === GHOST_STATE.ENTERING_HOUSE) {
            if (this.gridX === this.spawnPos.x && this.gridY === this.spawnPos.y) {
                this.setState(GHOST_STATE.IN_HOUSE_REVIVING);
                this.reviveTimer = REVIVE_DELAY_FRAMES;
                this.pendingReverse = false;
                this.moving = false;
                this.dir = { x: 0, y: 0 };
                this.nextDir = { x: 0, y: 0 };
                return;
            }
            this.target = this.spawnPos;
            this.nextDir = this.choosePathDirectionTo(this.target, true);
            return;
        }

        if (this.state === GHOST_STATE.IN_HOUSE_REVIVING) {
            this.nextDir = { x: 0, y: 0 };
            return;
        }

        if (this.state === GHOST_STATE.EXITING_HOUSE) {
            if (isAtHouseOutsideExit(this.gridX, this.gridY)) {
                this.setState(globalGhostState);
                this.pendingReverse = false;
                this.respawnStateTimer = 0;
            } else {
                this.target = getHouseOutsideExit();
                this.nextDir = this.choosePathDirectionTo(this.target, true);
                return;
            }
        }

        const dirs = DIRECTION_PRIORITY;
        const reverse = { x: -this.dir.x, y: -this.dir.y };
        let validDirs = dirs.filter(d => this.canMove(d));

        if (this.pendingReverse && this.canMove(reverse)) {
            this.nextDir = reverse;
            this.pendingReverse = false;
            return;
        }

        if (this.dir.x !== 0 || this.dir.y !== 0) {
            validDirs = validDirs.filter(d => d.x !== reverse.x || d.y !== reverse.y);
        }

        if (validDirs.length === 0) {
            validDirs = dirs.filter(d => this.canMove(d));
        }

        if (validDirs.length === 0) {
            this.nextDir = { x: 0, y: 0 };
            return;
        }

        if (this.state === GHOST_STATE.FRIGHTENED) {
            this.nextDir = validDirs[this.randomIndex(validDirs.length)];
            return;
        }

        this.updateTarget();
        this.nextDir = this.chooseBestDirectionTo(this.target, false);
    }

    updateTarget() {
        if (this.state === GHOST_STATE.EATEN) {
            this.target = ghostHouse.exit;
            return;
        }

        if (this.state === GHOST_STATE.ENTERING_HOUSE) {
            this.target = this.spawnPos;
            return;
        }

        if (this.state === GHOST_STATE.EXITING_HOUSE) {
            this.target = getHouseOutsideExit();
            return;
        }

        if ((globalGhostState === GHOST_STATE.SCATTER || this.state === GHOST_STATE.SCATTER) && !isCruiseElroy(this)) {
            this.target = getScatterTarget(this.personality);
            return;
        }

        const playerDir = (player.dir.x !== 0 || player.dir.y !== 0) ? player.dir : player.nextDir;

        switch(this.personality) {
            case 'blinky':
                this.target = { x: player.gridX, y: player.gridY };
                break;
            case 'pinky':
                this.target = {
                    x: player.gridX + playerDir.x * PINKY_LOOKAHEAD_TILES,
                    y: player.gridY + playerDir.y * PINKY_LOOKAHEAD_TILES
                };
                break;
            case 'inky': {
                const aheadX = player.gridX + playerDir.x * INKY_LOOKAHEAD_TILES;
                const aheadY = player.gridY + playerDir.y * INKY_LOOKAHEAD_TILES;
                const blinky = ghosts.find(g => g.personality === 'blinky') || { gridX: aheadX, gridY: aheadY };
                this.target = {
                    x: aheadX + (aheadX - blinky.gridX) * INKY_VECTOR_MULTIPLIER,
                    y: aheadY + (aheadY - blinky.gridY) * INKY_VECTOR_MULTIPLIER
                };
                break;
            }
            case 'clyde': {
                const dist = rawGridDistance(this.gridX, this.gridY, player);
                this.target = dist > CLYDE_RETREAT_DISTANCE
                    ? { x: player.gridX, y: player.gridY }
                    : getScatterTarget('clyde');
                break;
            }
        }
    }
}


function resetGame() {
    score = 0;
    lives = 3;
    extraLifeAwarded = false;
    level = 1;
    gameOver = false;
    dotsRemaining = 0;
    totalPelletsThisLevel = 0;
    pelletIdleTimer = 0;
    ghosts = [];
    globalGhostState = GHOST_STATE.SCATTER;
    stateTimer = 0;
    frightenedTimer = 0;
    startNormalMusic();
    deathAnimActive = false;
    deathAnimTimer = 0;
    eatMultiplier = 1;
    scorePopups = [];
    pelletsEaten = 0;
    pelletsEatenForRelease = 0;
    pelletIdleTimer = 0;
    nextBonusIndex = 0;
    bonusItem = null;
    // Reset maze
    resetMaze();
    mazeCacheDirty = true;
    pelletsEaten = 0;
    pelletsEatenForRelease = 0;
    nextBonusIndex = 0;
    bonusItem = null;
    MAP_WIDTH = MAZE_LAYOUT[0].length;
    MAP_HEIGHT = MAZE_LAYOUT.length;
    updateGhostHouseMetadata();
    
    const specs = [
        { personality: 'blinky', color: '#ff0000' },
        { personality: 'pinky', color: '#ff80bf' },
        { personality: 'inky', color: '#00ffff' },
        { personality: 'clyde', color: '#ff8000' }
    ];

    let ghostIdx = 0;

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = MAZE_LAYOUT[y][x];
            if (tile === 0 || tile === 3) dotsRemaining++;
            if (tile === 5) player = new Player(x, y);
            if (tile === 4) {
                const spec = specs[ghostIdx % specs.length];
                ghosts.push(new Ghost(x, y, spec.color, spec.personality));
                ghostIdx++;
            }
        }
    }
    totalPelletsThisLevel = dotsRemaining;
    resetPositions();
    applyLevelPacing();
    
    updateHUD();
    overlay.classList.add('hidden');
}

function addScore(points) {
    const previousScore = score;
    score += points;

    if (!extraLifeAwarded && previousScore < EXTRA_LIFE_SCORE && score >= EXTRA_LIFE_SCORE) {
        lives++;
        extraLifeAwarded = true;
        if (player) scorePopups.push({ x: player.x, y: player.y, text: '+1 LIFE', life: 90 });
    }
}

function updateHUD() {
    scoreElement.textContent = score.toString().padStart(4, '0');
    livesContainer.innerHTML = '';
    for (let i = 0; i < lives; i++) {
        const dot = document.createElement('div');
        dot.className = 'life-dot';
        livesContainer.appendChild(dot);
    }
    const levelEl = document.getElementById('level-value');
    if (levelEl) levelEl.textContent = level;
}

function buildMazeCache() {
    if (!TILE_DIM || canvas.width === 0 || canvas.height === 0) return;

    const theme = currentTheme();
    mazeCanvas.width = canvas.width;
    mazeCanvas.height = canvas.height;
    mazeCtx.clearRect(0, 0, mazeCanvas.width, mazeCanvas.height);
    mazeCtx.fillStyle = theme.floor;
    mazeCtx.fillRect(0, 0, mazeCanvas.width, mazeCanvas.height);

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = MAZE_LAYOUT[y][x];
            const px = x * TILE_DIM;
            const py = y * TILE_DIM;

            if (tile === 1) {
                mazeCtx.fillStyle = '#111';
                mazeCtx.fillRect(px + 1, py + 1, TILE_DIM - 2, TILE_DIM - 2);
                mazeCtx.strokeStyle = theme.wall;
                mazeCtx.lineWidth = 2;
                mazeCtx.shadowBlur = 5;
                mazeCtx.shadowColor = theme.wall;
                mazeCtx.strokeRect(px + 4, py + 4, TILE_DIM - 8, TILE_DIM - 8);
                mazeCtx.shadowBlur = 0;
            } else if (tile === 8) {
                mazeCtx.strokeStyle = '#ff9cff';
                mazeCtx.lineWidth = Math.max(2, TILE_DIM * 0.12);
                mazeCtx.shadowBlur = 8;
                mazeCtx.shadowColor = '#ff9cff';
                mazeCtx.beginPath();
                mazeCtx.moveTo(px + TILE_DIM * 0.15, py + TILE_DIM * 0.5);
                mazeCtx.lineTo(px + TILE_DIM * 0.85, py + TILE_DIM * 0.5);
                mazeCtx.stroke();
                mazeCtx.shadowBlur = 0;
            }
        }
    }

    mazeCacheDirty = false;
}

function drawPellets() {
    const theme = currentTheme();

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = MAZE_LAYOUT[y][x];
            const px = x * TILE_DIM;
            const py = y * TILE_DIM;

            if (tile === 0) {
                ctx.fillStyle = theme.dot;
                ctx.beginPath();
                ctx.arc(px + TILE_DIM/2, py + TILE_DIM/2, 2.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (tile === 3) {
                ctx.fillStyle = theme.power;
                ctx.shadowBlur = 6;
                ctx.shadowColor = theme.power;
                ctx.beginPath();
                ctx.arc(px + TILE_DIM/2, py + TILE_DIM/2, TILE_DIM * 0.25, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }
}

function drawMaze() {
    if (mazeCacheDirty || mazeCanvas.width !== canvas.width || mazeCanvas.height !== canvas.height) {
        buildMazeCache();
    }
    ctx.drawImage(mazeCanvas, 0, 0);
    drawPellets();
}


function drawPixelBlock(x, y, w, h, color, unit) {
    ctx.fillStyle = color;
    ctx.fillRect(x * unit, y * unit, w * unit, h * unit);
}

function updateBonusItem() {
    if (!bonusItem) return;
    bonusItem.life -= 1;
    if (bonusItem.life <= 0) bonusItem = null;
}

function drawBonusCollectible() {
    if (!bonusItem) return;

    const px = bonusItem.x * TILE_DIM + TILE_DIM / 2;
    const py = bonusItem.y * TILE_DIM + TILE_DIM / 2;
    const scale = 1.05 + Math.sin(Date.now() / 140) * 0.04;
    const unit = (TILE_DIM * 0.09) * scale;

    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = Math.min(1, bonusItem.life / 45);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(-6 * unit, -6 * unit, 12 * unit, 12 * unit);
    ctx.shadowBlur = 6;

    switch (bonusItem.type) {
        case 'beer':
            ctx.shadowColor = '#ffb000';
            drawPixelBlock(-3, -4, 5, 1, '#ffffff', unit);
            drawPixelBlock(-4, -3, 7, 1, '#ffffff', unit);
            drawPixelBlock(-4, -2, 6, 7, '#111111', unit);
            drawPixelBlock(-3, -2, 4, 6, '#ffb000', unit);
            drawPixelBlock(-2, -2, 1, 6, '#ffd75a', unit);
            drawPixelBlock(2, -1, 2, 1, '#ffffff', unit);
            drawPixelBlock(3, 0, 1, 3, '#ffffff', unit);
            drawPixelBlock(2, 3, 2, 1, '#ffffff', unit);
            drawPixelBlock(-4, 5, 7, 1, '#ffffff', unit);
            break;
        case 'leaf':
            ctx.shadowColor = '#37ff6b';
            drawPixelBlock(-1, -5, 2, 10, '#0b3d16', unit);
            drawPixelBlock(-1, -6, 2, 3, '#37ff6b', unit);
            drawPixelBlock(-4, -4, 3, 3, '#37ff6b', unit);
            drawPixelBlock(1, -4, 3, 3, '#37ff6b', unit);
            drawPixelBlock(-5, -1, 4, 3, '#37ff6b', unit);
            drawPixelBlock(1, -1, 4, 3, '#37ff6b', unit);
            drawPixelBlock(-3, 2, 2, 3, '#37ff6b', unit);
            drawPixelBlock(1, 2, 2, 3, '#37ff6b', unit);
            drawPixelBlock(-1, 4, 2, 2, '#37ff6b', unit);
            break;
        case 'bag':
            ctx.shadowColor = '#f5f5ff';
            drawPixelBlock(-3, -5, 6, 1, '#00f2ff', unit);
            drawPixelBlock(-4, -4, 8, 2, '#f5f5ff', unit);
            drawPixelBlock(-5, -2, 10, 5, '#111111', unit);
            drawPixelBlock(-4, -2, 8, 4, '#f5f5ff', unit);
            drawPixelBlock(-3, 2, 6, 2, '#dff8ff', unit);
            drawPixelBlock(-2, 0, 4, 1, '#ff007a', unit);
            drawPixelBlock(-1, 2, 2, 1, '#00f2ff', unit);
            break;
        default:
            ctx.shadowColor = '#ffffff';
            drawPixelBlock(-5, 0, 9, 2, '#111111', unit);
            drawPixelBlock(-4, -1, 7, 2, '#ffffff', unit);
            drawPixelBlock(3, -1, 2, 2, '#ff8a00', unit);
            drawPixelBlock(5, -2, 1, 1, '#ff3d00', unit);
            drawPixelBlock(6, -4, 1, 1, 'rgba(255,255,255,0.75)', unit);
            drawPixelBlock(5, -5, 1, 1, 'rgba(255,255,255,0.5)', unit);
            drawPixelBlock(6, -6, 1, 1, 'rgba(255,255,255,0.35)', unit);
            break;
    }

    ctx.restore();
}


function checkCollisions() {
    ghosts.forEach(ghost => {
        const dx = player.x - ghost.x;
        const dy = player.y - ghost.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 0.6) {
            if (ghost.state === GHOST_STATE.FRIGHTENED) {
                ghost.setState(GHOST_STATE.EATEN);
                ghost.pendingReverse = false;
                ghost.reviveTimer = 0;
                ghost.exitDelay = 0;
                ghost.respawnStateTimer = 0;
                ghost.target = ghostHouse.exit;
                ghost.nextDir = ghost.choosePathDirectionTo(ghostHouse.exit, true);
                if (!ghost.moving && (ghost.nextDir.x !== 0 || ghost.nextDir.y !== 0)) {
                    ghost.dir = { ...ghost.nextDir };
                    ghost.targetX = ghost.gridX + ghost.dir.x;
                    ghost.targetY = ghost.gridY + ghost.dir.y;
                    ghost.moving = true;
                }
                const pts = 200 * eatMultiplier;
                addScore(pts);
                eatMultiplier *= 2; // 200 → 400 → 800 → 1600
                // Floating score popup
                scorePopups.push({ x: ghost.x, y: ghost.y, text: '+' + pts, life: 60 });
                updateHUD();
            } else if (ghost.state === GHOST_STATE.CHASE || ghost.state === GHOST_STATE.SCATTER) {
                handleLifeLost();
            }
        }
    });
}

function triggerFrightenedMode() {
    frightenedTimer = getFrightenedDuration(level);
    eatMultiplier = 1;
    if (frightenedTimer > 0) startPowerMusic();
    ghosts.forEach(g => {
        if (frightenedTimer <= 0) return;
        if ((g.state === GHOST_STATE.CHASE || g.state === GHOST_STATE.SCATTER) && !isInsideGhostHouse(g.gridX, g.gridY)) {
            g.setState(GHOST_STATE.FRIGHTENED);
            requestGhostReverse(g);
        }
    });
}

function handleLifeLost() {
    lives--;
    updateHUD();
    if (lives <= 0) {
        endGame('GAME OVER', 'The ghosts caught you!');
    } else {
        // Start death animation
        deathAnimActive = true;
        deathAnimTimer = DEATH_ANIM_DURATION;
    }
}

function resetEntityPosition(entity, x, y) {
    entity.x = entity.prevX = entity.renderX = entity.gridX = entity.targetX = x;
    entity.y = entity.prevY = entity.renderY = entity.gridY = entity.targetY = y;
    entity.moving = false;
}

function resetGhostForRound(ghost, x, y, state = GHOST_STATE.IN_HOUSE) {
    resetEntityPosition(ghost, x, y);
    ghost.dir = { x: 0, y: 0 };
    ghost.nextDir = { x: 0, y: 0 };
    if (ghost.setState) ghost.setState(state);
    else ghost.state = state;
    ghost.pendingReverse = false;
    ghost.reviveTimer = 0;
    ghost.exitDelay = 0;
    ghost.respawnStateTimer = 0;
    ghost.target = { x, y };
    ghost.speed = ghost.baseSpeed;
}

function resetPositions() {
    // Player and ghost round reset. This does not restore pellets or level progress.
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (MAZE_ORIGINAL[y][x] === 5) {
                resetEntityPosition(player, x, y);
                player.dir = { x: 0, y: 0 };
                player.nextDir = { x: 0, y: 0 };
                player.rotation = 0;
                player.pauseFrames = 0;
            }
        }
    }

    const spawnTiles = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (MAZE_ORIGINAL[y][x] === 4) spawnTiles.push({ x, y });
        }
    }

    const outsideExit = getHouseOutsideExit();
    ghosts.forEach((ghost, i) => {
        const spawn = spawnTiles[i] || ghost.spawnPos || outsideExit;
        if (ghost.personality === 'blinky') {
            resetGhostForRound(ghost, outsideExit.x, outsideExit.y, GHOST_STATE.SCATTER);
            ghost.target = getScatterTarget('blinky');
            ghost.nextDir = { x: -1, y: 0 };
        } else {
            resetGhostForRound(ghost, spawn.x, spawn.y, GHOST_STATE.IN_HOUSE);
        }
    });

    pelletsEatenForRelease = 0;
    pelletIdleTimer = 0;
    frightenedTimer = 0;
    eatMultiplier = 1;
    startNormalMusic();
    globalGhostState = GHOST_STATE.SCATTER;
    stateTimer = 0;
}


function advanceLevel() {
    level++;
    resetMaze();
    mazeCacheDirty = true;
    pelletsEaten = 0;
    pelletsEatenForRelease = 0;
    nextBonusIndex = 0;
    bonusItem = null;
    MAP_WIDTH = MAZE_LAYOUT[0].length;
    MAP_HEIGHT = MAZE_LAYOUT.length;
    updateGhostHouseMetadata();
    
    // Recount dots
    dotsRemaining = 0;
    for (let y = 0; y < MAP_HEIGHT; y++)
        for (let x = 0; x < MAP_WIDTH; x++)
            if (MAZE_LAYOUT[y][x] === 0 || MAZE_LAYOUT[y][x] === 3) dotsRemaining++;
    totalPelletsThisLevel = dotsRemaining;
    
    resetPositions();
    applyLevelPacing();
    globalGhostState = GHOST_STATE.SCATTER;
    stateTimer = 0;
    frightenedTimer = 0;
    
    // Show level overlay briefly
    overlayTitle.textContent = 'LEVEL ' + level;
    overlayMsg.textContent = 'Get ready...';
    overlay.classList.remove('hidden');
    const levelEl = document.getElementById('level-value');
    if (levelEl) levelEl.textContent = level;
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        updateHUD();
    }, 2000);
}

function endGame(title, msg) {
    gameOver = true;
    gameStarted = false;
    stopGameMusic();
    lastFrameTime = 0;
    accumulator = 0;
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlay.classList.remove('hidden');
    cancelAnimationFrame(animationId);
}

function updateScorePopups() {
    scorePopups.forEach(p => { p.life -= 1; });
    scorePopups = scorePopups.filter(p => p.life > 0);
}

function drawScorePopups() {
    scorePopups.forEach(p => {
        const alpha = p.life / 60;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffff00';
        ctx.font = `bold ${TILE_DIM * 0.6}px Outfit`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#ffff00';
        ctx.fillText(p.text, p.x * TILE_DIM + TILE_DIM/2, p.y * TILE_DIM - (60 - p.life) * 0.5);
        ctx.restore();
    });
}

function drawDeathAnimation() {
    const progress = 1 - (deathAnimTimer / DEATH_ANIM_DURATION);
    const drawX = player.renderX ?? player.x;
    const drawY = player.renderY ?? player.y;
    const px = drawX * TILE_DIM + TILE_DIM / 2;
    const py = drawY * TILE_DIM + TILE_DIM / 2;
    const size = TILE_DIM * 1.2 * (1 - progress);
    
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(progress * Math.PI * 4); // Spin
    ctx.globalAlpha = 1 - progress;
    
    if (headImg.complete) {
        const srcX = headImg.naturalWidth * HEAD_CROP.x;
        const srcY = headImg.naturalHeight * HEAD_CROP.y;
        const srcW = headImg.naturalWidth * HEAD_CROP.width;
        const srcH = headImg.naturalHeight * HEAD_CROP.height;
        const drawSize = Math.ceil(size);
        if (drawSize > 0) {
            headCanvas.width = drawSize;
            headCanvas.height = drawSize;
            headCtx.clearRect(0, 0, drawSize, drawSize);
            headCtx.drawImage(headImg, srcX, srcY, srcW, srcH, 0, 0, drawSize, drawSize);
            ctx.drawImage(headCanvas, -size/2, -size/2, size, size);
        }
    }
    ctx.restore();
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function prepareEntityRender(entity, alpha) {
    if (!entity) return;
    const wrapJump = Math.abs(entity.x - entity.prevX) > 2 || Math.abs(entity.y - entity.prevY) > 2;
    entity.renderX = wrapJump ? entity.x : lerp(entity.prevX, entity.x, alpha);
    entity.renderY = wrapJump ? entity.y : lerp(entity.prevY, entity.y, alpha);
}

function prepareRenderPositions(alpha) {
    prepareEntityRender(player, alpha);
    ghosts.forEach(g => prepareEntityRender(g, alpha));
}

function updateSimulation() {
    frameScale = 1;

    if (deathAnimActive) {
        deathAnimTimer -= 1;
        updateBonusItem();
        updateScorePopups();
        if (deathAnimTimer <= 0) {
            deathAnimActive = false;
            resetPositions();
        }
        return;
    }

    pelletIdleTimer += 1;

    if (frightenedTimer > 0) {
        frightenedTimer -= 1;
        if (frightenedTimer <= 0) {
            frightenedTimer = 0;
            ghosts.forEach(g => {
                if (g.state === GHOST_STATE.FRIGHTENED) g.setState(globalGhostState);
            });
            eatMultiplier = 1;
            startNormalMusic();
        }
    } else {
        stateTimer += 1;
        setGlobalGhostState(getCurrentScheduledMode());
    }

    updateHouseReleases();
    updateBonusItem();
    player.update(FIXED_DT);
    ghosts.forEach(ghost => ghost.update(FIXED_DT));
    updateScorePopups();
    checkCollisions();
}

function renderGame(alpha = 1) {
    prepareRenderPositions(alpha);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMaze();
    drawBonusCollectible();

    if (deathAnimActive) {
        ghosts.forEach(g => g.draw());
        drawDeathAnimation();
        drawScorePopups();
        return;
    }

    player.draw();
    ghosts.forEach(ghost => ghost.draw());
    drawScorePopups();
}

function gameLoop(timestamp = performance.now()) {
    if (!gameStarted || gameOver) return;

    if (!lastFrameTime) lastFrameTime = timestamp;
    let delta = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;
    delta = Math.min(delta, MAX_FRAME_TIME);
    accumulator += delta;

    let updates = 0;
    while (accumulator >= FIXED_DT && updates < MAX_UPDATES_PER_FRAME) {
        updateSimulation();
        accumulator -= FIXED_DT;
        updates++;
    }

    if (updates === MAX_UPDATES_PER_FRAME) {
        accumulator = 0;
    }

    renderGame(accumulator / FIXED_DT);
    animationId = requestAnimationFrame(gameLoop);
}


// Input Handling
function queuePlayerDirection(dir) {
    if (!player) return;
    player.nextDir = dir;
}

window.addEventListener('keydown', e => {
    switch(e.key.toLowerCase()) {
        case 'arrowup': case 'w': queuePlayerDirection({ x: 0, y: -1 }); break;
        case 'arrowdown': case 's': queuePlayerDirection({ x: 0, y: 1 }); break;
        case 'arrowleft': case 'a': queuePlayerDirection({ x: -1, y: 0 }); break;
        case 'arrowright': case 'd': queuePlayerDirection({ x: 1, y: 0 }); break;
    }
});

let touchStartX = 0;
let touchStartY = 0;
let touchActive = false;
const SWIPE_THRESHOLD = 24;

function handleSwipeDirection(deltaX, deltaY) {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_THRESHOLD) return false;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        queuePlayerDirection({ x: deltaX > 0 ? 1 : -1, y: 0 });
    } else {
        queuePlayerDirection({ x: 0, y: deltaY > 0 ? 1 : -1 });
    }
    return true;
}

function readTouchPoint(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

canvas.addEventListener('touchstart', e => {
    const point = readTouchPoint(e);
    if (!point) return;
    touchStartX = point.x;
    touchStartY = point.y;
    touchActive = true;
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    if (!touchActive) return;
    const point = readTouchPoint(e);
    if (!point) return;
    if (handleSwipeDirection(point.x - touchStartX, point.y - touchStartY)) {
        touchStartX = point.x;
        touchStartY = point.y;
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', e => {
    if (!touchActive) return;
    const point = readTouchPoint(e);
    if (point) handleSwipeDirection(point.x - touchStartX, point.y - touchStartY);
    touchActive = false;
    e.preventDefault();
}, { passive: false });

startBtn.addEventListener('click', () => {
    gameAudio.play('normal');

    const introChar = document.getElementById('intro-character');
    const glassPanel = startScreen.querySelector('.glass');
    gameContainer.classList.remove('title-screen-active');
    gameContainer.classList.add('hud-transitioning');
    gameFrame.classList.remove('start-frame');
    gameFrame.classList.add('frame-opening');
    
    // Trigger shrink animation on the character
    introChar.classList.add('shrinking');
    
    // Fade out the glass panel
    glassPanel.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    glassPanel.style.opacity = '0';
    glassPanel.style.transform = 'scale(0.95)';
    
    // After animation completes, start the game
    setTimeout(() => {
        startScreen.classList.add('hidden');
        gameFrame.classList.remove('frame-opening');
        gameFrame.classList.add('gameplay-frame');
        gameContainer.classList.remove('hud-transitioning');
        resizeCanvas();
        gameStarted = true;
        lastFrameTime = 0;
        accumulator = 0;
        startNormalMusic();
        gameLoop();
    }, 950);
});

restartBtn.addEventListener('click', () => {
    // Reload maze dots (copy from initial layout if needed, for simplicity we just reload)
    location.reload(); 
});

init();
