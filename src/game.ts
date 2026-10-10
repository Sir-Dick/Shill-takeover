import type { GameAssets } from "./assets";
import {
  advanceSurvivalTime,
  bibiCaught,
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
  bibiInitialSpeed: 52,
  bibiAcceleration: 18,
  maxDeltaSeconds: 0.04,
} as const;

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
    this.velocityY = 0;
    this.holding = false;
    this.worldTime = 0;
    this.scroll = 0;
    this.obstacleTimer = 1.15;
    this.footTimer = 0.9;
    this.chaseBannerTimer = 0;
    this.playerY = this.height * SETTINGS.playerYFraction;
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
    this.playerHeight = Math.max(86, Math.min(138, this.height * 0.19));
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
      }
    }
    this.feet = this.feet.filter((foot) => !foot.collected && foot.x > -40);

    if (this.bibi) {
      this.bibi.age += delta;
      this.bibi.x += (SETTINGS.bibiInitialSpeed + this.bibi.age * SETTINGS.bibiAcceleration) * delta;
      if (bibiCaught(this.bibiRect(), player)) {
        this.finishRun();
        return;
      }
    }

    this.notifyHud(feetChanged || beforeFeet !== this.stats.feet);
  }

  private beginChase(): void {
    const size = this.playerHeight * 1.08;
    const aspect = this.imageAspect(this.assets.bibi, 0.68);
    const width = size * aspect;
    this.bibi = {
      x: Math.max(-width * 0.8, this.playerX - width - this.width * 0.22),
      y: Math.max(10, this.playerY - size * 0.07),
      width,
      height: size,
      age: 0,
    };
    this.chaseBannerTimer = 3.2;
    this.notifyHud();
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
    const height = Math.max(82, Math.min(130, this.height * 0.212));
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
    const size = Math.max(30, Math.min(48, this.height * 0.075));
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

  private bibiRect(): Rect {
    if (!this.bibi) return { x: -10000, y: -10000, width: 0, height: 0 };
    return { x: this.bibi.x + this.bibi.width * 0.2, y: this.bibi.y + this.bibi.height * 0.1, width: this.bibi.width * 0.6, height: this.bibi.height * 0.8 };
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
    this.drawGroundLine();
  }

  private drawBackground(): void {
    const ctx = this.context;
    const background = this.assets.background;
    if (background) {
      drawCover(ctx, background, -6, 0, this.width + 12, this.height);
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
    for (const foot of this.feet) drawFootShape(this.context, foot.x, foot.y, foot.size, foot.phase);
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

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number): void {
  const source = image as HTMLImageElement | HTMLCanvasElement;
  const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
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

function drawFootShape(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, phase: number): void {
  const bob = Math.sin(phase) * 5;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.font = `${Math.round(size * 1.55)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🦶", 0, 0);
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