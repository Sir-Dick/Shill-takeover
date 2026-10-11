import "./styles.css";
import { assetFilesForUi, assetUrl, loadGameAssets } from "./assets";
import { connectPlayerProfile, fetchLeaderboard, retryPendingUploads } from "./firebase";
import { ShillGame, type HudData } from "./game";
import { buildLeaderboardRows, emptyLeaderboardMessage, type LeaderboardCategory } from "./leaderboard-model";
import { nextGameOverScreen, type Screen } from "./mechanics";
import { loadPlayerProfile, normalizeNickname, savePlayerProfile, type PlayerProfile } from "./profile";
import { migrateLocalScoresForFreshLeaderboard, queuePendingUpload } from "./score-store";

migrateLocalScoresForFreshLeaderboard(localStorage);

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const startScreen = document.querySelector<HTMLElement>("#start-screen")!;
const pauseScreen = document.querySelector<HTMLElement>("#pause-screen")!;
const gameOverScreen = document.querySelector<HTMLElement>("#game-over-screen")!;
const resultsScreen = document.querySelector<HTMLElement>("#results-screen")!;
const nicknameScreen = document.querySelector<HTMLElement>("#nickname-screen")!;
const leaderboardScreen = document.querySelector<HTMLElement>("#leaderboard-screen")!;
const chaseWarning = document.querySelector<HTMLElement>("#chase-warning")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-button")!;
const playAgainButton = document.querySelector<HTMLButtonElement>("#play-again-button")!;
const homeButton = document.querySelector<HTMLButtonElement>("#home-button")!;
const muteButton = document.querySelector<HTMLButtonElement>("#mute-button")!;
const changeNicknameButton = document.querySelector<HTMLButtonElement>("#change-nickname-button")!;
const leaderboardButton = document.querySelector<HTMLButtonElement>("#leaderboard-button")!;
const nicknameForm = document.querySelector<HTMLFormElement>("#nickname-form")!;
const nicknameInput = document.querySelector<HTMLInputElement>("#nickname-input")!;
const nicknameError = document.querySelector<HTMLElement>("#nickname-error")!;
const cancelNicknameButton = document.querySelector<HTMLButtonElement>("#cancel-nickname-button")!;
const currentNickname = document.querySelector<HTMLElement>("#current-nickname")!;
const leaderboardList = document.querySelector<HTMLOListElement>("#leaderboard-list")!;
const leaderboardStatus = document.querySelector<HTMLElement>("#leaderboard-status")!;
const leaderboardRetryButton = document.querySelector<HTMLButtonElement>("#leaderboard-retry-button")!;
const leaderboardBackButton = document.querySelector<HTMLButtonElement>("#leaderboard-back-button")!;
const feetLeaderboardButton = document.querySelector<HTMLButtonElement>("#leaderboard-feet-button")!;
const survivalLeaderboardButton = document.querySelector<HTMLButtonElement>("#leaderboard-survival-button")!;
const gameScreens = [startScreen, pauseScreen, gameOverScreen, resultsScreen, nicknameScreen, leaderboardScreen];

document.querySelector<HTMLImageElement>("#start-art")!.src = assetUrl(assetFilesForUi.player);
document.querySelector<HTMLImageElement>("#game-over-art")!.src = assetUrl(assetFilesForUi.gameOver);
document.querySelector<HTMLImageElement>("#results-art")!.src = assetUrl(assetFilesForUi.fellas);

let game: ShillGame | null = null;
let currentScreen: Screen = "start";
let liftKeyDown = false;
let gameOverTapLockUntil = 0;
let soundEnabled = true;
let audioContext: AudioContext | null = null;
let playerProfile: PlayerProfile | null = loadPlayerProfile(localStorage);
let leaderboardCategory: LeaderboardCategory = "feet";
let leaderboardRequest = 0;

function updateProfileDisplay(profile: PlayerProfile | null): void {
  playerProfile = profile;
  currentNickname.textContent = profile?.nickname ?? "";
}

updateProfileDisplay(playerProfile);
nicknameScreen.hidden = Boolean(playerProfile);
startScreen.hidden = !playerProfile;

function fitScreenCards(): void {
  for (const screen of gameScreens) {
    const card = screen.firstElementChild as HTMLElement | null;
    if (!card || screen.hidden) continue;
    card.style.transform = "";
    const style = getComputedStyle(screen);
    const availableWidth = screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = screen.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(1, availableWidth / card.offsetWidth, availableHeight / card.offsetHeight);
    if (scale < 1) card.style.transform = `scale(${scale})`;
  }
}

function showScreen(screen: Screen, lockedUntil = 0): void {
  currentScreen = screen;
  gameOverTapLockUntil = screen === "game-over" ? Math.max(performance.now() + 380, lockedUntil) : 0;
  startScreen.hidden = screen !== "start";
  pauseScreen.hidden = screen !== "paused";
  gameOverScreen.hidden = screen !== "game-over";
  resultsScreen.hidden = screen !== "results";
  nicknameScreen.hidden = true;
  leaderboardScreen.hidden = true;
  fitScreenCards();
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
    document.querySelector<HTMLElement>("#final-best-feet")!.textContent = String(data.bestFeet);
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

function openNicknameSetup(message = "", value = playerProfile?.nickname ?? ""): void {
  nicknameError.textContent = message;
  nicknameInput.value = value;
  cancelNicknameButton.hidden = !playerProfile;
  nicknameScreen.hidden = false;
  leaderboardScreen.hidden = true;
  startScreen.hidden = true;
  if (playerProfile) nicknameInput.focus();
}

nicknameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nickname = normalizeNickname(nicknameInput.value);
  if (!nickname) {
    nicknameError.textContent = "Use 2–16 letters, numbers, spaces, underscores, or hyphens.";
    return;
  }
  const previousProfile = playerProfile;
  const profile = savePlayerProfile(localStorage, nickname, playerProfile);
  if (!profile) {
    nicknameError.textContent = "This browser could not save your nickname. Check its storage settings and try again.";
    return;
  }
  updateProfileDisplay(profile);
  const result = await connectPlayerProfile(profile);
  const connected = result.profile;
  if (connected && playerProfile?.localId === connected.localId) updateProfileDisplay(connected);
  if (isNicknameConflict(result)) {
    if (previousProfile && connected) {
      const restored = savePlayerProfile(localStorage, previousProfile.nickname, connected);
      if (restored) updateProfileDisplay(restored);
      queuePendingUpload(localStorage, { nickname: previousProfile.nickname });
    }
    nicknameScreen.hidden = false;
    startScreen.hidden = true;
    nicknameInput.value = nickname;
    nicknameError.textContent = "That nickname is already in use. Choose another.";
    return;
  }
  nicknameScreen.hidden = true;
  startScreen.hidden = false;
});

changeNicknameButton.addEventListener("click", () => openNicknameSetup());
cancelNicknameButton.addEventListener("click", () => {
  nicknameScreen.hidden = true;
  startScreen.hidden = false;
});

async function loadLeaderboard(): Promise<void> {
  const request = ++leaderboardRequest;
  leaderboardList.replaceChildren();
  leaderboardStatus.hidden = false;
  leaderboardRetryButton.hidden = true;
  leaderboardStatus.textContent = "Loading leaderboard…";
  feetLeaderboardButton.setAttribute("aria-pressed", String(leaderboardCategory === "feet"));
  survivalLeaderboardButton.setAttribute("aria-pressed", String(leaderboardCategory === "survival"));
  if (!navigator.onLine) {
    leaderboardStatus.textContent = "You are offline. Your local scores are safe; reconnect to load the leaderboard.";
    leaderboardRetryButton.hidden = false;
    return;
  }
  try {
    const entries = await fetchLeaderboard(leaderboardCategory);
    if (request !== leaderboardRequest) return;
    const rows = buildLeaderboardRows(entries, leaderboardCategory);
    if (!rows.length) {
      leaderboardStatus.textContent = emptyLeaderboardMessage(leaderboardCategory);
      return;
    }
    leaderboardStatus.hidden = true;
    for (const row of rows) {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      const nickname = document.createElement("span");
      const score = document.createElement("strong");
      rank.textContent = String(row.rank);
      nickname.textContent = row.nickname;
      score.textContent = row.score;
      item.append(rank, nickname, score);
      leaderboardList.append(item);
    }
  } catch {
    if (request !== leaderboardRequest) return;
    leaderboardStatus.textContent = navigator.onLine
      ? "The leaderboard could not be loaded. Try again."
      : "You are offline. Your local scores are safe; reconnect to load the leaderboard.";
    leaderboardRetryButton.hidden = false;
  }
}

function openLeaderboard(): void {
  startScreen.hidden = true;
  nicknameScreen.hidden = true;
  leaderboardScreen.hidden = false;
  void loadLeaderboard();
}

leaderboardButton.addEventListener("click", openLeaderboard);
leaderboardBackButton.addEventListener("click", () => {
  leaderboardScreen.hidden = true;
  startScreen.hidden = false;
});
feetLeaderboardButton.addEventListener("click", () => {
  leaderboardCategory = "feet";
  void loadLeaderboard();
});
survivalLeaderboardButton.addEventListener("click", () => {
  leaderboardCategory = "survival";
  void loadLeaderboard();
});
leaderboardRetryButton.addEventListener("click", () => void loadLeaderboard());

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
homeButton.addEventListener("click", () => game?.returnHome());
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
    if (event.target === homeButton) return;
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

void connectPlayerProfile(playerProfile).then((result) => {
  const profile = result.profile;
  if (profile && (!playerProfile || playerProfile.localId === profile.localId)) updateProfileDisplay(profile);
  if (isNicknameConflict(result) && profile) openNicknameSetup("That nickname is already in use. Choose another.", profile.nickname);
});

function isNicknameConflict(result: Awaited<ReturnType<typeof connectPlayerProfile>>): boolean {
  return !result.ok && result.phase === "write" &&
    typeof result.error === "object" && result.error !== null &&
    "code" in result.error && result.error.code === "nickname/already-exists";
}

window.addEventListener("online", () => {
  void retryPendingUploads(playerProfile);
  if (!leaderboardScreen.hidden) void loadLeaderboard();
});

for (const screen of gameScreens) {
  screen.addEventListener("dragstart", (event) => event.preventDefault());
}

// iOS Safari ignores user-scalable=no, so block page pan/zoom/selection gestures directly.
document.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
for (const type of ["gesturestart", "gesturechange", "contextmenu", "selectstart", "dblclick"]) {
  document.addEventListener(type, (event) => event.preventDefault());
}
window.addEventListener("blur", () => {
  liftKeyDown = false;
  game?.setLift(false);
});

const fitObserver = new ResizeObserver(fitScreenCards);
for (const screen of gameScreens) {
  fitObserver.observe(screen);
  if (screen.firstElementChild) fitObserver.observe(screen.firstElementChild);
}
window.addEventListener("orientationchange", fitScreenCards);
void document.fonts?.ready.then(fitScreenCards);