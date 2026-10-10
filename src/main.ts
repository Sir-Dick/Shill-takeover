import "./styles.css";
import { assetFilesForUi, assetUrl, loadGameAssets } from "./assets";
import { ShillGame, type HudData } from "./game";
import { nextGameOverScreen, type Screen } from "./mechanics";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const startScreen = document.querySelector<HTMLElement>("#start-screen")!;
const pauseScreen = document.querySelector<HTMLElement>("#pause-screen")!;
const gameOverScreen = document.querySelector<HTMLElement>("#game-over-screen")!;
const resultsScreen = document.querySelector<HTMLElement>("#results-screen")!;
const chaseWarning = document.querySelector<HTMLElement>("#chase-warning")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-button")!;
const playAgainButton = document.querySelector<HTMLButtonElement>("#play-again-button")!;
const muteButton = document.querySelector<HTMLButtonElement>("#mute-button")!;
const gameScreens = [startScreen, pauseScreen, gameOverScreen, resultsScreen];

document.querySelector<HTMLImageElement>("#start-art")!.src = assetUrl(assetFilesForUi.player);
document.querySelector<HTMLImageElement>("#game-over-art")!.src = assetUrl(assetFilesForUi.gameOver);
document.querySelector<HTMLImageElement>("#results-art")!.src = assetUrl(assetFilesForUi.fellas);

let game: ShillGame | null = null;
let currentScreen: Screen = "start";
let liftKeyDown = false;
let gameOverTapLockUntil = 0;
let soundEnabled = true;
let audioContext: AudioContext | null = null;

function showScreen(screen: Screen, lockedUntil = 0): void {
  currentScreen = screen;
  gameOverTapLockUntil = screen === "game-over" ? Math.max(performance.now() + 380, lockedUntil) : 0;
  startScreen.hidden = screen !== "start";
  pauseScreen.hidden = screen !== "paused";
  gameOverScreen.hidden = screen !== "game-over";
  resultsScreen.hidden = screen !== "results";
  canvas.setAttribute("aria-label", screen === "running"
    ? "Game in progress. Hold or tap to float upward, release to drift down."
    : "Shill TakeOver game scene.");
}

function updateHud(data: HudData, warningVisible: boolean): void {
  document.querySelector<HTMLElement>("#time-value")!.textContent = `${data.time.toFixed(1)}s`;
  document.querySelector<HTMLElement>("#best-value")!.textContent = `${data.best.toFixed(1)}s`;
  document.querySelector<HTMLElement>("#feet-value")!.textContent = String(data.feet);
  chaseWarning.hidden = !warningVisible;
  if (warningVisible) chaseWarning.classList.add("active");
  else chaseWarning.classList.remove("active");
  if (currentScreen === "results") {
    document.querySelector<HTMLElement>("#final-time")!.textContent = `${data.time.toFixed(1)}s`;
    document.querySelector<HTMLElement>("#final-best")!.textContent = `${data.best.toFixed(1)}s`;
    document.querySelector<HTMLElement>("#final-feet")!.textContent = String(data.feet);
  }
}

function playUiTone(frequency: number, duration: number): void {
  if (!soundEnabled) return;
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === "suspended") void audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.45, now + duration * 0.6);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.01);
}

const assetsPromise = loadGameAssets();
void assetsPromise.then((assets) => {
  game = new ShillGame(canvas, assets, showScreen, updateHud);
});

function startNewRun(): void {
  game?.startRun();
  playUiTone(460, 0.11);
}

startButton.addEventListener("click", startNewRun);
resumeButton.addEventListener("click", () => game?.resume());
playAgainButton.addEventListener("click", startNewRun);
gameOverScreen.addEventListener("click", () => {
  if (performance.now() < gameOverTapLockUntil) return;
  if (nextGameOverScreen(currentScreen) === "results") game?.continueToResults();
});

canvas.addEventListener("pointerdown", (event) => {
  if (currentScreen !== "running") return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  game?.setLift(true);
  playUiTone(330, 0.07);
});
const releaseLift = (): void => game?.setLift(false);
canvas.addEventListener("pointerup", releaseLift);
canvas.addEventListener("pointercancel", releaseLift);
canvas.addEventListener("lostpointercapture", releaseLift);

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.code !== "ArrowUp") return;
  if (currentScreen === "game-over" && performance.now() >= gameOverTapLockUntil) {
    event.preventDefault();
    game?.continueToResults();
    return;
  }
  if (currentScreen === "results") {
    event.preventDefault();
    startNewRun();
    return;
  }
  if (currentScreen !== "running") return;
  event.preventDefault();
  if (!liftKeyDown) game?.setLift(true);
  liftKeyDown = true;
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" && event.code !== "ArrowUp") return;
  liftKeyDown = false;
  game?.setLift(false);
});

muteButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  muteButton.textContent = soundEnabled ? "♪" : "×";
  muteButton.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Turn sound on");
  muteButton.title = soundEnabled ? "Mute sound" : "Turn sound on";
  if (soundEnabled) playUiTone(540, 0.08);
});

document.addEventListener("visibilitychange", () => {
  liftKeyDown = false;
  game?.setLift(false);
  if (document.hidden) game?.pause();
  else if (currentScreen === "paused") game?.resume();
});

window.addEventListener("pagehide", () => {
  game?.destroy();
  if (audioContext) void audioContext.close();
});

void assetsPromise.then((assets) => {
  const missing = Object.entries(assets).filter(([, image]) => image === null).map(([name]) => name);
  if (missing.length) console.warn(`Some artwork did not load: ${missing.join(", ")}`);
});

for (const screen of gameScreens) {
  screen.addEventListener("dragstart", (event) => event.preventDefault());
}

// iOS Safari ignores user-scalable=no, so block page pan/zoom/selection gestures directly.
document.addEventListener("touchmove", (event) => {
  if (!(event.target as Element).closest(".screen")) event.preventDefault();
}, { passive: false });
for (const type of ["gesturestart", "gesturechange", "contextmenu", "selectstart", "dblclick"]) {
  document.addEventListener(type, (event) => event.preventDefault());
}
window.addEventListener("blur", () => {
  liftKeyDown = false;
  game?.setLift(false);
});