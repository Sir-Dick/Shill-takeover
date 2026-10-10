import type { GameAssets } from "./assets";
import {
  advanceSurvivalTime,
  BIBI_CHASE_FEET,
  collectFoot,
  createRunStats,
  intersects,
  savePersonalBest,
  type Rect,
  type RunStats,
  type Screen,
} from "./mechanics";

const BEST_KEY = "shill-takeover-best";
const SETTINGS = {
  gravity: 1160,
  liftAcceleration: 2200,
  tapImpulse: 190,
  maxRiseSpeed: 420,
  obstacleBaseSpeed: 205,
  obstacleSpeedGain: 4.4,
  obstacleGapStart: 1.72,
  obstacleGapMin: 1.12,
  playerYFraction: 0.43,
  hitboxInset: 0.23,
  bibiCatchUpRate: 2.6,
  bibiFollowRate: 3.2,
  bibiGap: 14,
  bubbleSeconds: 1.8,
  maxDeltaSeconds: 0.04,
} as const;

const BIBI_LINES = ["Those are my feet!", "Get back here!", "I'm coming for you!"] as const;

export interface HudData {
  time: number;
  best: number;
  feet: number;
  bibiTriggered: boolean;
}

interface Floater {
  x: number;
  y: number;
  width: number;
  height: number;
  wobble: number;
  passed: boolean;
}

interface FootPickup {
  x: number;
  y: number;
  size: number;
  phase: number;
  collected: boolean;
}

interface Chaser {
  x: number;
  y: number;
  width: number;
  height: number;
  age: number;
}

interface Bubble {
  text: string;
  age: number;
}

export class ShillGame {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private stats: RunStats = createRunStats();
  private screen: Screen = "start";
  private width = 1;
  private height = 1;
  private dpr = 1;
  private groundY = 1;
  private playerX = 1;
  private playerY = 1;
  private playerWidth = 72;
  private playerHeight = 96;
  private velocityY = 0;
  private holding = false;
  private floaters: Floater[] = [];
  private feet: FootPickup[] = [];
  private bibi: Chaser | null = null;
  private bubble: Bubble | null = null;
  private lastLine = -1;
  private obstacleTimer = 1.2;
  private footTimer = 1.15;
  private chaseBannerTimer = 0;
  private worldTime = 0;
  private scroll = 0;
  private previousFrame: number | null = null;
  private best = 0;
  private frameHandle = 0;
  private hiddenBeforePause: Screen = "running";
  private gameOverUnlockedAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: GameAssets,
    private readonly onScreen: (screen: Screen, lockedUntil?: number) => void,
    private readonly onHud: (data: HudData, warningVisible: boolean) => void,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    this.context = context;
    this.best = this.readBest();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.notifyHud();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  }

  get currentScreen(): Screen {
    return this.screen;
  }

  get snapshot(): Readonly<RunStats> {
    return this.stats;
  }

  startRun(): void {
    this.stats = createRunStats();
    this.floaters = [];
    this.feet = [];
    this.bibi = null;
    this.bubble = null;
    this.velocityY = 0;
    this.holding = false;
    this.worldTime = 0;
    this.scroll = 0;
    this.obstacleTimer = 1.15;
    this.footTimer = 0.9;
    this.chaseBannerTimer = 0;
    this.playerY = this.height * SETTINGS.playerYFraction;
    if (new URLSearchParams(window.location.search).has("demo")) {
      this.stats = { ...this.stats, feet: BIBI_CHASE_FEET, bibiTriggered: true };
      this.beginChase();
    }
    this.screen = "running";
    this.previousFrame = null;
    this.notifyHud();
    this.onScreen(this.screen);
  }

  setLift(active: boolean): void {
    if (this.screen !== "running") return;
    if (active && !this.holding) this.velocityY = Math.max(-SETTINGS.maxRiseSpeed, this.velocityY - SETTINGS.tapImpulse);
    this.holding = active;
  }

  continueToResults(): void {
    if (this.screen !== "game-over" || performance.now() < this.gameOverUnlockedAt) return;
    this.screen = "results";
    this.onScreen(this.screen);
    this.notifyHud();
  }

  pause(): void {
    if (this.screen !== "running") return;
    this.hiddenBeforePause = this.screen;
    this.holding = false;
    this.screen = "paused";
    this.onScreen(this.screen);
  }

  resume(): void {
    if (this.screen !== "paused") return;
    this.screen = this.hiddenBeforePause;
    this.previousFrame = null;
    this.onScreen(this.screen);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    window.cancelAnimationFrame(this.frameHandle);
  }

  private readBest(): number {
    try {
      return Number.parseFloat(localStorage.getItem(BEST_KEY) ?? "0") || 0;
    } catch {
      return 0;
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.groundY = this.height * 0.88;
    this.playerHeight = Math.max(64, Math.min(138, this.height * 0.19));
    this.playerWidth = this.playerHeight * 0.74;
    this.playerX = this.width * 0.24;
    if (this.screen !== "running" || this.playerY + this.playerHeight > this.groundY) {
      this.playerY = Math.min(this.playerY || this.height * 0.43, this.groundY - this.playerHeight);
    }
  }

  private readonly frame = (time: number): void => {
    if (this.previousFrame === null) this.previousFrame = time;
    const elapsedDelta = Math.max(0, (time - this.previousFrame) / 1000);
    const delta = Math.min(elapsedDelta, SETTINGS.maxDeltaSeconds);
    this.previousFrame = time;
    if (this.screen === "running") this.update(delta, elapsedDelta);
    this.draw();
    this.frameHandle = window.requestAnimationFrame(this.frame);
  };

  private update(delta: number, elapsedDelta: number): void {
    const beforeFeet = this.stats.feet;
    this.stats.elapsedSeconds = advanceSurvivalTime(this.stats.elapsedSeconds, elapsedDelta, true);
    this.worldTime += delta;
    const speed = SETTINGS.obstacleBaseSpeed + this.stats.elapsedSeconds * SETTINGS.obstacleSpeedGain;
    this.scroll = (this.scroll + speed * delta) % 1800;
    this.chaseBannerTimer = Math.max(0, this.chaseBannerTimer - delta);

    this.velocityY += (SETTINGS.gravity - (this.holding ? SETTINGS.liftAcceleration : 0)) * delta;
    this.velocityY = Math.max(-SETTINGS.maxRiseSpeed, Math.min(SETTINGS.maxRiseSpeed, this.velocityY));
    this.playerY += this.velocityY * delta;

    this.obstacleTimer -= delta;
    if (this.obstacleTimer <= 0) {
      this.spawnFloater();
      this.obstacleTimer = Math.max(SETTINGS.obstacleGapMin, SETTINGS.obstacleGapStart - this.stats.elapsedSeconds * 0.008) + Math.random() * 0.34;
    }
    this.footTimer -= delta;
    if (this.footTimer <= 0) {
      this.spawnFoot();
      this.footTimer = 1.15 + Math.random() * 1.1;
    }

    const player = this.playerRect();
    if (this.playerY < 0 || this.playerY + this.playerHeight > this.groundY) {
      this.finishRun();
      return;
    }

    const floaterRect: Rect[] = [];
    for (const floater of this.floaters) {
      floater.x -= speed * delta;
      floater.y += Math.sin(this.worldTime * 2.1 + floater.wobble) * 6 * delta;
      const collision = this.floaterRect(floater);
      floaterRect.push(collision);
      if (intersects(player, collision)) {
        this.finishRun();
        return;
      }
      if (!floater.passed && floater.x + floater.width < this.playerX) {
        floater.passed = true;
      }
    }
    this.floaters = this.floaters.filter((floater) => floater.x + floater.width > -30);

    let feetChanged = false;
    for (const foot of this.feet) {
      foot.x -= speed * delta;
      foot.phase += delta * 4;
      if (!foot.collected && intersects(player, this.footRect(foot))) {
        foot.collected = true;
        const result = collectFoot(this.stats);
        this.stats = result.stats;
        feetChanged = true;
        if (result.chaseStarted) this.beginChase();
        if (this.bibi) this.sayLine();
      }
    }
    this.feet = this.feet.filter((foot) => !foot.collected && foot.x > -40);

    if (this.bibi) {
      const bibi = this.bibi;
      bibi.age += delta;
      const targetX = Math.max(-bibi.width * 0.3, this.playerX - bibi.width - SETTINGS.bibiGap);
      const targetY = this.playerY + (this.playerHeight - bibi.height) / 2 + Math.sin(bibi.age * 5) * 4;
      bibi.x += (targetX - bibi.x) * (1 - Math.exp(-SETTINGS.bibiCatchUpRate * delta));
      bibi.y += (targetY - bibi.y) * (1 - Math.exp(-SETTINGS.bibiFollowRate * delta));
    }
    if (this.bubble) {
      this.bubble.age += delta;
      if (this.bubble.age >= SETTINGS.bubbleSeconds) this.bubble = null;
    }

    this.notifyHud(feetChanged || beforeFeet !== this.stats.feet);
  }

  private beginChase(): void {
    const size = this.playerHeight * 1.08;
    const aspect = this.imageAspect(this.assets.bibi, 0.68);
    const width = size * aspect;
    this.bibi = {
      x: -width * 1.2,
      y: this.playerY + (this.playerHeight - size) / 2,
      width,
      height: size,
      age: 0,
    };
    this.chaseBannerTimer = 3.2;
    this.notifyHud();
  }

  private sayLine(): void {
    let index = Math.floor(Math.random() * BIBI_LINES.length);
    if (index === this.lastLine) index = (index + 1) % BIBI_LINES.length;
    this.lastLine = index;
    this.bubble = { text: BIBI_LINES[index], age: 0 };
  }

  private finishRun(): void {
    if (this.screen !== "running") return;
    this.holding = false;
    this.best = savePersonalBest(localStorage, BEST_KEY, this.stats.elapsedSeconds);
    this.screen = "game-over";
    this.gameOverUnlockedAt = performance.now() + 450;
    this.notifyHud();
    this.onScreen(this.screen, this.gameOverUnlockedAt);
  }

  private spawnFloater(): void {
    const height = Math.max(62, Math.min(130, this.height * 0.212));
    const width = height * this.imageAspect(this.assets.floater, 0.66);
    const minimumY = 24;
    const maximumY = Math.max(minimumY, this.groundY - height - 20);
    this.floaters.push({
      x: this.width + 35,
      y: minimumY + Math.random() * (maximumY - minimumY),
      width,
      height,
      wobble: Math.random() * Math.PI * 2,
      passed: false,
    });
  }

  private spawnFoot(): void {
    const size = Math.max(38, Math.min(54, this.height * 0.085));
    const minimumY = this.height * 0.2;
    const maximumY = Math.max(minimumY, this.groundY - size - 15);
    this.feet.push({
      x: this.width + 20,
      y: minimumY + Math.random() * (maximumY - minimumY),
      size,
      phase: Math.random() * 4,
      collected: false,
    });
  }

  private playerRect(): Rect {
    return {
      x: this.playerX + this.playerWidth * SETTINGS.hitboxInset,
      y: this.playerY + this.playerHeight * SETTINGS.hitboxInset,
      width: this.playerWidth * (1 - SETTINGS.hitboxInset * 2),
      height: this.playerHeight * (1 - SETTINGS.hitboxInset * 2),
    };
  }

  private floaterRect(floater: Floater): Rect {
    return { x: floater.x + floater.width * 0.2, y: floater.y + floater.height * 0.16, width: floater.width * 0.6, height: floater.height * 0.7 };
  }

  private footRect(foot: FootPickup): Rect {
    return { x: foot.x - foot.size * 0.38, y: foot.y - foot.size * 0.35, width: foot.size * 0.76, height: foot.size * 0.72 };
  }

  private imageAspect(image: CanvasImageSource | null, fallback: number): number {
    if (!image) return fallback;
    const candidate = image as HTMLImageElement | HTMLCanvasElement;
    const width = candidate instanceof HTMLImageElement ? candidate.naturalWidth : candidate.width;
    const height = candidate instanceof HTMLImageElement ? candidate.naturalHeight : candidate.height;
    return width > 0 && height > 0 ? width / height : fallback;
  }

  private notifyHud(_changed = false): void {
    this.onHud({
      time: this.stats.elapsedSeconds,
      best: this.best,
      feet: this.stats.feet,
      bibiTriggered: this.stats.bibiTriggered,
    }, this.chaseBannerTimer > 0);
  }

  private draw(): void {
    this.drawBackground();
    this.drawFeet();
    this.drawFloaters();
    this.drawBibi();
    this.drawPlayer();
    this.drawBubble();
    this.drawGroundLine();
  }

  private drawBackground(): void {
    const ctx = this.context;
    const background = this.assets.background;
    if (background) {
      drawCover(ctx, background, -6, 0, this.width + 12, this.height, { top: 0.1, right: 0.12 });
      ctx.fillStyle = "rgba(28, 45, 56, 0.23)";
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, this.height);
      sky.addColorStop(0, "#63b4c0");
      sky.addColorStop(1, "#f0ba73");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, this.width, this.height);
      drawCloud(ctx, this.width * 0.6 - (this.scroll * 0.1) % (this.width + 120), this.height * 0.2, 1);
      drawCloud(ctx, this.width * 0.18 - (this.scroll * 0.06) % (this.width + 100), this.height * 0.34, 0.72);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, this.height);
    shade.addColorStop(0, "rgba(15, 30, 38, 0.02)");
    shade.addColorStop(1, "rgba(15, 30, 38, 0.34)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawFeet(): void {
    for (const foot of this.feet) drawFootShape(this.context, foot.x, foot.y, foot.size, foot.phase, this.assets.foot);
  }

  private drawFloaters(): void {
    for (const floater of this.floaters) {
      const bob = Math.sin(this.worldTime * 2 + floater.wobble) * 6;
      drawPortrait(this.context, this.assets.floater, floater.x, floater.y + bob, floater.width, floater.height, "floaterFallback");
    }
  }

  private drawBibi(): void {
    if (!this.bibi) return;
    const pulse = 1 + Math.sin(this.bibi.age * 9) * 0.025;
    const width = this.bibi.width * pulse;
    const height = this.bibi.height * pulse;
    drawPortrait(this.context, this.assets.bibi, this.bibi.x, this.bibi.y, width, height, "bibiFallback");
  }

  private drawBubble(): void {
    if (!this.bibi || !this.bubble) return;
    const ctx = this.context;
    const { text, age } = this.bubble;
    const pop = Math.min(1, age / 0.18);
    const fade = Math.min(1, (SETTINGS.bubbleSeconds - age) / 0.3);
    const fontSize = Math.max(15, Math.min(24, this.playerHeight * 0.2));
    ctx.save();
    ctx.font = `900 ${fontSize}px "Barlow Condensed", Impact, sans-serif`;
    const bubbleWidth = ctx.measureText(text).width + 26;
    const bubbleHeight = fontSize + 20;
    const x = Math.max(8, Math.min(this.width - bubbleWidth - 8, this.bibi.x + this.bibi.width * 0.5 - bubbleWidth * 0.3));
    const above = this.bibi.y - bubbleHeight - 14 >= 70;
    const y = above ? this.bibi.y - bubbleHeight - 14 : this.bibi.y + this.bibi.height + 14;
    const tailX = Math.max(x + 16, Math.min(x + bubbleWidth - 16, this.bibi.x + this.bibi.width * 0.5));
    const tailBaseY = above ? y + bubbleHeight : y;
    const tailTipY = above ? tailBaseY + 12 : tailBaseY - 12;
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(x + bubbleWidth / 2, above ? y + bubbleHeight : y);
    ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
    ctx.translate(-(x + bubbleWidth / 2), -(above ? y + bubbleHeight : y));
    ctx.fillStyle = "#fff8e8";
    ctx.strokeStyle = "#18232b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, bubbleWidth, bubbleHeight, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tailX - 8, tailBaseY);
    ctx.lineTo(tailX, tailTipY);
    ctx.lineTo(tailX + 8, tailBaseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(tailX - 6, above ? tailBaseY - 3 : tailBaseY - 1, 12, 4);
    ctx.fillStyle = "#18232b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + bubbleWidth / 2, y + bubbleHeight / 2 + 1);
    ctx.restore();
  }

  private drawPlayer(): void {
    if (this.screen === "running" && Math.floor(this.worldTime * 13) % 2 === 0 && this.best > 0 && this.playerY < 0) return;
    drawPortrait(this.context, this.assets.player, this.playerX, this.playerY, this.playerWidth, this.playerHeight, "playerFallback");
  }

  private drawGroundLine(): void {
    const ctx = this.context;
    const y = this.groundY;
    ctx.fillStyle = "rgba(24, 33, 42, 0.55)";
    ctx.fillRect(0, y, this.width, this.height - y);
    ctx.strokeStyle = "#f6d274";
    ctx.lineWidth = 3;
    ctx.setLineDash([24, 22]);
    ctx.lineDashOffset = -this.scroll % 46;
    ctx.beginPath();
    ctx.moveTo(0, y + (this.height - y) * 0.52);
    ctx.lineTo(this.width, y + (this.height - y) * 0.52);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  crop: { top: number; right: number },
): void {
  const source = image as HTMLImageElement | HTMLCanvasElement;
  const imageWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const imageHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!imageWidth || !imageHeight) return;
  const sourceX = 0;
  const sourceY = imageHeight * crop.top;
  const sourceWidth = imageWidth * (1 - crop.right);
  const sourceHeight = imageHeight - sourceY;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawPortrait(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null, x: number, y: number, width: number, height: number, fallback: "playerFallback" | "floaterFallback" | "bibiFallback"): void {
  if (image) {
    drawContain(ctx, image, x, y, width, height);
    return;
  }
  drawFallback(ctx, x, y, width, height, fallback);
}

function drawContain(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number): void {
  const source = image as HTMLImageElement | HTMLCanvasElement;
  const imageWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const imageHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!imageWidth || !imageHeight) return;
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawFootShape(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, phase: number, image: CanvasImageSource | null): void {
  const bob = Math.sin(phase) * 5;
  if (image) {
    const drawSize = size * 1.6;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(Math.sin(phase * 0.8) * 0.12);
    ctx.drawImage(image, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    ctx.restore();
    return;
  }
  const k = size * 0.62;
  // [centerX, centerY, radiusX, radiusY] in foot units: sole, arch, heel, then five toes.
  const parts: [number, number, number, number][] = [
    [0, -0.2, 0.5, 0.6],
    [0.12, 0.12, 0.3, 0.36],
    [0.05, 0.47, 0.32, 0.42],
    [-0.3, -0.8, 0.19, 0.19],
    [-0.06, -0.86, 0.13, 0.13],
    [0.14, -0.8, 0.12, 0.12],
    [0.3, -0.7, 0.11, 0.11],
    [0.41, -0.56, 0.1, 0.1],
  ];
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(-0.3 + Math.sin(phase * 0.8) * 0.12);
  // Outline pass first so overlapping parts merge into one silhouette.
  ctx.fillStyle = "#3a2417";
  for (const [cx, cy, rx, ry] of parts) {
    ctx.beginPath();
    ctx.ellipse(cx * k, cy * k, rx * k + 3, ry * k + 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f4c796";
  for (const [cx, cy, rx, ry] of parts) {
    ctx.beginPath();
    ctx.ellipse(cx * k, cy * k, rx * k, ry * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.ellipse(-0.12 * k, -0.35 * k, 0.16 * k, 0.3 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFallback(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, kind: "playerFallback" | "floaterFallback" | "bibiFallback"): void {
  ctx.save();
  ctx.fillStyle = kind === "playerFallback" ? "#e9bf8a" : kind === "bibiFallback" ? "#222c38" : "#d0b784";
  ctx.strokeStyle = "#17232c";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x + width / 2, y + height * 0.35, width * 0.28, height * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(x + width * 0.25, y + height * 0.54, width * 0.5, height * 0.4);
  ctx.restore();
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(248, 246, 230, 0.72)";
  ctx.beginPath();
  ctx.ellipse(24, 20, 25, 15, 0, 0, Math.PI * 2);
  ctx.ellipse(49, 15, 21, 19, 0, 0, Math.PI * 2);
  ctx.ellipse(70, 21, 25, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}