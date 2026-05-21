const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.getElementById("score"),
  meat: document.getElementById("meat"),
  life: document.getElementById("life"),
  stageNo: document.getElementById("stageNo"),
  audioBtn: document.getElementById("audioBtn"),
  fullBtn: document.getElementById("fullBtn"),
  menu: document.getElementById("menu"),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn"),
};

const W = canvas.width;
const H = canvas.height;
const groundY = 436;
const gravity = 0.78;
const keys = new Set();
const touch = new Set();
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

let lastTime = 0;
let runId = 0;
let shake = 0;
let game;

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function vibrate(pattern) {
  if (isCoarsePointer && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function setViewportHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}

function canFullscreen() {
  return document.fullscreenEnabled && document.documentElement.requestFullscreen;
}

function tryFullscreen() {
  if (!canFullscreen() || document.fullscreenElement) return;
  document.documentElement.requestFullscreen().catch(() => {});
}

function toggleFullscreen() {
  if (!canFullscreen()) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    tryFullscreen();
  }
}

const audio = (() => {
  let ctx;
  let master;
  let musicGain;
  let sfxGain;
  let musicTimer;
  let step = 0;
  let muted = false;
  const melody = [196, 247, 294, 247, 220, 262, 330, 262, 196, 247, 349, 330, 294, 247, 220, 196];
  const bass = [98, 98, 110, 110, 87, 87, 98, 98];

  function ensure() {
    if (ctx) return ctx;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    master.gain.value = muted ? 0 : 0.82;
    musicGain.gain.value = 0.18;
    sfxGain.gain.value = 0.42;
    musicGain.connect(master);
    sfxGain.connect(master);
    master.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    const audioCtx = ensure();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, duration, type = "square", gain = 0.18, target = musicGain, delay = 0) {
    const audioCtx = ensure();
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(target);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  function noise(duration, gain = 0.12) {
    const audioCtx = ensure();
    if (!audioCtx || muted) return;
    const length = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const amp = audioCtx.createGain();
    filter.type = "bandpass";
    filter.frequency.value = 820;
    filter.Q.value = 1.8;
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(amp);
    amp.connect(sfxGain);
    src.start();
  }

  function tickMusic() {
    if (!ctx || muted) return;
    const note = melody[step % melody.length];
    const bassNote = bass[Math.floor(step / 2) % bass.length];
    tone(note, 0.13, step % 4 === 0 ? "triangle" : "square", 0.08, musicGain);
    if (step % 2 === 0) tone(bassNote, 0.2, "triangle", 0.055, musicGain);
    if (step % 8 === 4) tone(note * 1.5, 0.08, "triangle", 0.045, musicGain, 0.08);
    step += 1;
  }

  return {
    startMusic() {
      resume();
      if (musicTimer || muted) return;
      tickMusic();
      musicTimer = window.setInterval(tickMusic, 210);
    },
    stopMusic() {
      if (!musicTimer) return;
      window.clearInterval(musicTimer);
      musicTimer = null;
      step = 0;
    },
    setPaused(paused) {
      if (!musicGain) return;
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setTargetAtTime(paused ? 0.055 : 0.18, ctx.currentTime, 0.04);
    },
    swing() {
      resume();
      vibrate(18);
      noise(0.16, 0.18);
      tone(142, 0.1, "sawtooth", 0.12, sfxGain);
    },
    hit() {
      vibrate([20, 25, 18]);
      noise(0.08, 0.22);
      tone(78, 0.11, "triangle", 0.18, sfxGain);
    },
    pickup(kind) {
      vibrate(kind === "gem" ? [10, 20, 10] : 10);
      const start = kind === "gem" ? 520 : 392;
      tone(start, 0.08, "triangle", 0.14, sfxGain);
      tone(start * 1.5, 0.1, "triangle", 0.11, sfxGain, 0.075);
    },
    hurt() {
      vibrate([35, 35, 35]);
      noise(0.2, 0.2);
      tone(132, 0.16, "sawtooth", 0.16, sfxGain);
      tone(88, 0.18, "sawtooth", 0.12, sfxGain, 0.08);
    },
    stage() {
      tone(330, 0.12, "triangle", 0.14, sfxGain);
      tone(440, 0.14, "triangle", 0.13, sfxGain, 0.11);
      tone(660, 0.22, "triangle", 0.12, sfxGain, 0.22);
    },
    toggle() {
      ensure();
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.82;
      if (muted) this.stopMusic();
      else if (game?.running && !game.over) this.startMusic();
      return muted;
    },
    get muted() {
      return muted;
    },
  };
})();

function createGame() {
  return {
    running: false,
    paused: false,
    over: false,
    time: 0,
    distance: 0,
    score: 0,
    meat: 0,
    life: 3,
    stage: 1,
    speed: 3.25,
    spawnTimer: 0,
    itemTimer: 40,
    message: "READY",
    messageTimer: 0,
    clouds: Array.from({ length: 8 }, (_, i) => ({
      x: i * 160 + rand(-20, 35),
      y: rand(42, 164),
      s: rand(0.65, 1.25),
    })),
    hills: Array.from({ length: 7 }, (_, i) => ({
      x: i * 180,
      h: rand(80, 170),
      c: i % 2 ? "#314f46" : "#405b47",
    })),
    platforms: [
      { x: 260, y: 338, w: 160, h: 18 },
      { x: 640, y: 292, w: 132, h: 18 },
      { x: 1020, y: 350, w: 170, h: 18 },
    ],
    objects: [],
    items: [],
    particles: [],
    player: {
      x: 120,
      y: groundY - 64,
      w: 42,
      h: 64,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: true,
      invuln: 0,
      attack: 0,
      stride: 0,
    },
  };
}

function resetGame() {
  game = createGame();
  updateHud();
  ui.menu.classList.remove("is-hidden");
  ui.menu.querySelector("h1").textContent = "Stone Sprint";
  ui.menu.querySelector("p").textContent = "고인돌 느낌의 선사 시대 점프 액션";
  ui.startBtn.textContent = "Start";
  draw();
}

function startGame() {
  if (game.over) {
    game = createGame();
  }
  if (isCoarsePointer) tryFullscreen();
  game.running = true;
  game.paused = false;
  game.over = false;
  game.message = "RUN";
  game.messageTimer = 75;
  ui.menu.classList.add("is-hidden");
  audio.startMusic();
  lastTime = performance.now();
  runId += 1;
  requestAnimationFrame((time) => loop(time, runId));
}

function gameOver() {
  game.running = false;
  game.over = true;
  audio.stopMusic();
  ui.menu.classList.remove("is-hidden");
  ui.menu.querySelector("h1").textContent = "Game Over";
  ui.menu.querySelector("p").textContent = `Score ${Math.floor(game.score)}`;
  ui.startBtn.textContent = "Again";
}

function levelUp() {
  game.stage += 1;
  game.speed += 0.32;
  game.message = `STAGE ${game.stage}`;
  game.messageTimer = 105;
  audio.stage();
  for (let i = 0; i < 16; i += 1) {
    game.particles.push({
      x: rand(260, 700),
      y: rand(145, 310),
      vx: rand(-2.4, 2.4),
      vy: rand(-3, -0.8),
      life: rand(34, 64),
      color: i % 2 ? "#f3bf68" : "#dd8756",
    });
  }
}

function updateHud() {
  ui.score.textContent = Math.floor(game.score);
  ui.meat.textContent = game.meat;
  ui.life.textContent = game.life;
  ui.stageNo.textContent = game.stage;
}

function isDown(...names) {
  return names.some((name) => keys.has(name) || touch.has(name));
}

function spawnObstacle() {
  const roll = Math.random();
  const baseX = W + 40;
  if (roll < 0.36) {
    game.objects.push({
      type: "rock",
      x: baseX,
      y: groundY - 38,
      w: 44,
      h: 38,
      hp: 1,
      rot: 0,
      vx: -game.speed - rand(0.2, 1.3),
    });
  } else if (roll < 0.7) {
    game.objects.push({
      type: "dino",
      x: baseX,
      y: groundY - 58,
      w: 76,
      h: 58,
      hp: 2,
      bite: rand(0, 10),
      vx: -game.speed - rand(0.4, 1.1),
    });
  } else {
    game.objects.push({
      type: "pit",
      x: baseX,
      y: groundY + 2,
      w: rand(76, 128),
      h: 42,
      hp: 99,
      vx: -game.speed,
    });
  }
}

function spawnItem() {
  const platform = Math.random() < 0.42 ? game.platforms[Math.floor(Math.random() * game.platforms.length)] : null;
  const y = platform ? platform.y - 34 : rand(250, groundY - 56);
  game.items.push({
    type: Math.random() < 0.76 ? "meat" : "gem",
    x: W + 30,
    y,
    w: 30,
    h: 30,
    bob: rand(0, Math.PI * 2),
  });
}

function update(dt) {
  if (!game.running || game.paused) return;

  const p = game.player;
  const seconds = dt / 16.67;
  game.time += seconds;
  game.distance += game.speed * seconds;
  game.score += 0.12 * game.speed * seconds;
  game.spawnTimer -= seconds;
  game.itemTimer -= seconds;
  game.messageTimer = Math.max(0, game.messageTimer - seconds);
  shake = Math.max(0, shake - seconds);

  if (Math.floor(game.distance / 1250) + 1 > game.stage) {
    levelUp();
  }

  p.vx = 0;
  if (isDown("ArrowLeft", "KeyA", "left")) {
    p.vx = -4.2;
    p.facing = -1;
  }
  if (isDown("ArrowRight", "KeyD", "right")) {
    p.vx = 4.2;
    p.facing = 1;
  }
  if (isDown("Space", "ArrowUp", "KeyW", "jump") && p.grounded) {
    p.vy = -15.4;
    p.grounded = false;
  }
  if (isDown("KeyJ", "KeyK", "attack") && p.attack <= 0) {
    p.attack = 18;
    audio.swing();
  }

  p.x = clamp(p.x + p.vx * seconds, 28, W - 180);
  p.vy += gravity * seconds;
  p.y += p.vy * seconds;
  p.grounded = false;

  if (p.y + p.h >= groundY) {
    p.y = groundY - p.h;
    p.vy = 0;
    p.grounded = true;
  }

  for (const platform of game.platforms) {
    platform.x -= game.speed * seconds;
    if (platform.x + platform.w < -40) {
      platform.x = W + rand(130, 360);
      platform.y = rand(282, 360);
      platform.w = rand(120, 190);
    }
    const fromAbove = p.y + p.h - p.vy * seconds <= platform.y + 8;
    if (fromAbove && p.vy >= 0 && overlaps(p, platform)) {
      p.y = platform.y - p.h;
      p.vy = 0;
      p.grounded = true;
    }
  }

  if (p.attack > 0) p.attack -= seconds;
  if (p.invuln > 0) p.invuln -= seconds;
  p.stride += Math.abs(p.vx) * 0.08 + (p.grounded ? 0.08 : 0.02);

  if (game.spawnTimer <= 0) {
    spawnObstacle();
    game.spawnTimer = rand(56, 96) / (1 + game.stage * 0.06);
  }
  if (game.itemTimer <= 0) {
    spawnItem();
    game.itemTimer = rand(42, 78);
  }

  const attackBox = {
    x: p.facing > 0 ? p.x + p.w - 2 : p.x - 44,
    y: p.y + 17,
    w: 48,
    h: 26,
  };

  for (const obj of game.objects) {
    obj.x += obj.vx * seconds;
    if (obj.type === "rock") obj.rot += 0.16 * seconds;
    if (obj.type === "dino") obj.bite += 0.15 * seconds;

    if (p.attack > 7 && obj.type !== "pit" && overlaps(attackBox, obj)) {
      obj.hp -= 1;
      p.attack = 7;
      game.score += obj.type === "dino" ? 75 : 35;
      shake = 5;
      audio.hit();
      burst(obj.x + obj.w / 2, obj.y + obj.h / 2, obj.type === "dino" ? "#7cb972" : "#b4a48a");
    }

    const hitbox = obj.type === "pit"
      ? { x: obj.x + 10, y: obj.y, w: obj.w - 20, h: obj.h }
      : obj;

    if (obj.hp > 0 && overlaps(p, hitbox) && p.invuln <= 0) {
      hurtPlayer(obj.type === "pit" ? 2 : 1);
      if (obj.type !== "pit") obj.hp = 0;
    }
  }
  game.objects = game.objects.filter((obj) => obj.x + obj.w > -80 && obj.hp > 0);

  for (const item of game.items) {
    item.x -= game.speed * seconds;
    item.bob += 0.08 * seconds;
    const pickBox = { x: item.x, y: item.y + Math.sin(item.bob) * 8, w: item.w, h: item.h };
    if (overlaps(p, pickBox)) {
      item.picked = true;
      audio.pickup(item.type);
      if (item.type === "meat") {
        game.meat += 1;
        game.score += 50;
        if (game.meat % 8 === 0 && game.life < 5) game.life += 1;
      } else {
        game.score += 150;
      }
      burst(item.x + 15, item.y + 15, item.type === "meat" ? "#dd8756" : "#77c7c1");
    }
  }
  game.items = game.items.filter((item) => !item.picked && item.x > -60);

  for (const c of game.clouds) {
    c.x -= game.speed * 0.08 * c.s * seconds;
    if (c.x < -130) {
      c.x = W + rand(20, 140);
      c.y = rand(42, 164);
    }
  }
  for (const h of game.hills) {
    h.x -= game.speed * 0.22 * seconds;
    if (h.x < -220) h.x = W + rand(0, 120);
  }

  for (const particle of game.particles) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vy += 0.14 * seconds;
    particle.life -= seconds;
  }
  game.particles = game.particles.filter((particle) => particle.life > 0);

  updateHud();
}

function hurtPlayer(amount) {
  const p = game.player;
  game.life -= amount;
  p.invuln = 95;
  p.vy = -10;
  p.grounded = false;
  shake = 13;
  audio.hurt();
  game.message = "OUCH";
  game.messageTimer = 60;
  burst(p.x + p.w / 2, p.y + p.h / 2, "#e7594f");
  if (game.life <= 0) {
    game.life = 0;
    updateHud();
    gameOver();
  }
}

function burst(x, y, color) {
  for (let i = 0; i < 10; i += 1) {
    game.particles.push({
      x,
      y,
      vx: rand(-3.4, 3.4),
      vy: rand(-3.8, 1.8),
      life: rand(18, 38),
      color,
    });
  }
}

function draw() {
  const dx = shake ? rand(-shake, shake) : 0;
  const dy = shake ? rand(-shake, shake) : 0;
  ctx.save();
  ctx.translate(dx, dy);
  drawSky();
  drawWorld();
  drawItems();
  drawObjects();
  drawPlayer();
  drawParticles();
  drawOverlayText();
  ctx.restore();
}

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#14313d");
  sky.addColorStop(0.46, "#355543");
  sky.addColorStop(1, "#1d2018");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#f3bf68";
  ctx.beginPath();
  ctx.arc(810, 96, 54, 0, Math.PI * 2);
  ctx.fill();

  for (const c of game.clouds) {
    ctx.fillStyle = "rgba(247, 236, 212, 0.48)";
    pixelCloud(c.x, c.y, c.s);
  }

  for (const h of game.hills) {
    ctx.fillStyle = h.c;
    ctx.beginPath();
    ctx.moveTo(h.x - 80, groundY);
    ctx.lineTo(h.x + 70, groundY - h.h);
    ctx.lineTo(h.x + 230, groundY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWorld() {
  ctx.fillStyle = "#243826";
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.fillStyle = "#775840";
  ctx.fillRect(0, groundY + 16, W, H - groundY);
  ctx.fillStyle = "#3e2e25";
  for (let x = -40 + ((game.distance * 0.7) % 48); x < W; x += 48) {
    ctx.fillRect(x, groundY + 16, 32, 7);
    ctx.fillRect(x + 10, groundY + 58, 22, 6);
  }

  for (let x = -80 + ((game.distance * 0.52) % 110); x < W + 90; x += 110) {
    ctx.fillStyle = "#436b3a";
    ctx.fillRect(x, groundY - 18, 10, 18);
    ctx.fillRect(x + 7, groundY - 28, 8, 28);
    ctx.fillStyle = "#628b52";
    ctx.fillRect(x - 8, groundY - 25, 28, 7);
  }

  for (const platform of game.platforms) {
    ctx.fillStyle = "#5b4436";
    roundedRect(platform.x, platform.y, platform.w, platform.h, 5);
    ctx.fill();
    ctx.fillStyle = "#7b6049";
    ctx.fillRect(platform.x + 8, platform.y + 4, platform.w - 16, 4);
  }
}

function drawItems() {
  for (const item of game.items) {
    const y = item.y + Math.sin(item.bob) * 8;
    if (item.type === "meat") {
      ctx.fillStyle = "#f2d2a0";
      ctx.fillRect(item.x + 17, y + 9, 12, 8);
      ctx.fillStyle = "#c5513d";
      roundedRect(item.x + 3, y + 5, 21, 17, 7);
      ctx.fill();
      ctx.fillStyle = "#f3a35f";
      ctx.fillRect(item.x + 10, y + 9, 6, 4);
    } else {
      ctx.fillStyle = "#77c7c1";
      ctx.beginPath();
      ctx.moveTo(item.x + 15, y + 1);
      ctx.lineTo(item.x + 29, y + 14);
      ctx.lineTo(item.x + 15, y + 29);
      ctx.lineTo(item.x + 1, y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#d1fff6";
      ctx.fillRect(item.x + 13, y + 6, 5, 8);
    }
  }
}

function drawObjects() {
  for (const obj of game.objects) {
    if (obj.type === "rock") drawRock(obj);
    if (obj.type === "dino") drawDino(obj);
    if (obj.type === "pit") drawPit(obj);
  }
}

function drawRock(obj) {
  ctx.save();
  ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
  ctx.rotate(obj.rot);
  ctx.fillStyle = "#8b8170";
  ctx.fillRect(-20, -17, 40, 34);
  ctx.fillStyle = "#b4a48a";
  ctx.fillRect(-11, -12, 15, 8);
  ctx.fillStyle = "#635d51";
  ctx.fillRect(4, 5, 11, 7);
  ctx.restore();
}

function drawDino(obj) {
  const leg = Math.sin(obj.bite) * 5;
  ctx.fillStyle = "#4d8e60";
  roundedRect(obj.x + 10, obj.y + 16, 48, 30, 10);
  ctx.fill();
  ctx.fillStyle = "#67af72";
  roundedRect(obj.x + 47, obj.y + 3, 30, 25, 8);
  ctx.fill();
  ctx.fillStyle = "#1b211b";
  ctx.fillRect(obj.x + 66, obj.y + 11, 5, 5);
  ctx.fillStyle = "#e9dec6";
  ctx.fillRect(obj.x + 67, obj.y + 23, 8, 4);
  ctx.fillStyle = "#3f744f";
  ctx.fillRect(obj.x + 3, obj.y + 28, 14, 8);
  ctx.fillRect(obj.x + 22, obj.y + 43 + leg, 10, 15);
  ctx.fillRect(obj.x + 47, obj.y + 43 - leg, 10, 15);
}

function drawPit(obj) {
  ctx.fillStyle = "#11110f";
  roundedRect(obj.x, obj.y - 2, obj.w, 30, 8);
  ctx.fill();
  ctx.fillStyle = "#2b211c";
  ctx.fillRect(obj.x + 10, obj.y + 12, obj.w - 20, 18);
  ctx.fillStyle = "#d5c7a8";
  for (let x = obj.x + 14; x < obj.x + obj.w - 12; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, obj.y + 2);
    ctx.lineTo(x + 8, obj.y + 26);
    ctx.lineTo(x + 16, obj.y + 2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPlayer() {
  const p = game.player;
  if (p.invuln > 0 && Math.floor(p.invuln / 6) % 2 === 0) return;

  const leg = Math.sin(p.stride) * (p.grounded ? 6 : 2);
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y);
  ctx.scale(p.facing, 1);

  ctx.fillStyle = "#3b2920";
  ctx.fillRect(-13, 32, 11, 30 + leg);
  ctx.fillRect(6, 32, 11, 30 - leg);
  ctx.fillStyle = "#c78958";
  roundedRect(-18, 12, 36, 34, 8);
  ctx.fill();
  ctx.fillStyle = "#6b4a31";
  ctx.fillRect(-16, 24, 32, 9);
  ctx.fillStyle = "#d9a06f";
  roundedRect(-15, -7, 30, 25, 8);
  ctx.fill();
  ctx.fillStyle = "#2d211a";
  ctx.fillRect(-16, -10, 28, 9);
  ctx.fillRect(-21, -4, 10, 6);
  ctx.fillStyle = "#121512";
  ctx.fillRect(6, 2, 4, 4);
  ctx.fillStyle = "#f4ead5";
  ctx.fillRect(12, 9, 5, 3);

  ctx.fillStyle = "#c78958";
  ctx.fillRect(12, 18, 20, 8);
  if (p.attack > 0) {
    ctx.rotate(-0.45);
    ctx.fillStyle = "#76513a";
    roundedRect(26, 1, 54, 10, 5);
    ctx.fill();
    ctx.fillStyle = "#a77b58";
    ctx.fillRect(58, -2, 18, 16);
  } else {
    ctx.fillStyle = "#76513a";
    roundedRect(24, 21, 36, 8, 4);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  for (const particle of game.particles) {
    ctx.globalAlpha = clamp(particle.life / 30, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, 5, 5);
  }
  ctx.globalAlpha = 1;
}

function drawOverlayText() {
  if (game.paused) {
    centerText("PAUSED", H / 2, 54, "#ffe4a8");
    return;
  }
  if (game.messageTimer > 0) {
    centerText(game.message, 178, 42, "#ffe4a8");
  }
}

function centerText(text, y, size, color) {
  ctx.save();
  ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fillStyle = color;
  ctx.strokeText(text, W / 2, y);
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function pixelCloud(x, y, s) {
  const blocks = [
    [0, 14, 44, 18],
    [26, 4, 44, 26],
    [62, 15, 48, 17],
    [88, 23, 34, 13],
  ];
  for (const [bx, by, bw, bh] of blocks) {
    roundedRect(x + bx * s, y + by * s, bw * s, bh * s, 7 * s);
    ctx.fill();
  }
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loop(now, id) {
  if (id !== runId) return;
  const dt = Math.min(34, now - lastTime);
  lastTime = now;
  update(dt);
  draw();
  if (game.running) requestAnimationFrame((time) => loop(time, id));
}

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.code === "KeyP" && game.running) {
    game.paused = !game.paused;
    audio.setPaused(game.paused);
    draw();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

document.querySelectorAll("[data-touch]").forEach((button) => {
  const name = button.dataset.touch;
  const capture = (event) => {
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Some mobile browsers report a pointer that is already captured.
    }
  };
  const releaseCapture = (event) => {
    try {
      button.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be released after cancel/lostcapture events.
    }
  };
  const press = (event) => {
    event.preventDefault();
    capture(event);
    button.classList.add("is-pressed");
    touch.add(name);
    if (!game.running && name === "jump") startGame();
  };
  const release = (event) => {
    event.preventDefault();
    releaseCapture(event);
    button.classList.remove("is-pressed");
    touch.delete(name);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("lostpointercapture", release);
});

ui.startBtn.addEventListener("click", startGame);
ui.restartBtn.addEventListener("click", () => {
  game = createGame();
  startGame();
});

ui.audioBtn.addEventListener("click", () => {
  const muted = audio.toggle();
  ui.audioBtn.classList.toggle("is-muted", muted);
  ui.audioBtn.textContent = muted ? "×" : "♪";
  ui.audioBtn.setAttribute("aria-label", muted ? "sound off" : "sound on");
  ui.audioBtn.title = muted ? "sound off" : "sound on";
});

ui.fullBtn.addEventListener("click", toggleFullscreen);

document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  ui.fullBtn.classList.toggle("is-muted", !active);
  ui.fullBtn.textContent = active ? "EXIT" : "FS";
  ui.fullBtn.setAttribute("aria-label", active ? "exit fullscreen" : "fullscreen");
  ui.fullBtn.title = active ? "exit fullscreen" : "fullscreen";
});

window.addEventListener("resize", setViewportHeight);
window.addEventListener("orientationchange", setViewportHeight);
window.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game?.running && !game.paused) {
    game.paused = true;
    audio.setPaused(true);
    draw();
  }
});

setViewportHeight();
resetGame();
