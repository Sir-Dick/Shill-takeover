export type AssetName = "background" | "player" | "floater" | "bibi" | "gameOver" | "fellas";

const assetFiles: Record<AssetName, string> = {
  background: "background/IMG_4390.JPG",
  bibi: "bibi/IMG_4406.jpg",
  floater: "Floater/IMG_4381.jpg",
  gameOver: "game-over/IMG_4379.jpg",
  fellas: "gameover-fellas/IMG_4408.jpg",
  player: "main-character/IMG_4410.jpg",
};

export type GameAssets = Record<AssetName, HTMLCanvasElement | HTMLImageElement | null>;

export function assetUrl(file: string, baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}images-for-shill/${file}`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function isBlackPhotoMatte(r: number, g: number, b: number): boolean {
  const minimum = Math.min(r, g, b);
  const maximum = Math.max(r, g, b);
  return minimum >= 12 && maximum <= 30 && maximum - minimum <= 8;
}

interface KeepRegion { left: number; right: number; top: number; bottom: number }

function makePortraitCutout(image: HTMLImageElement, frameBounds: { left: number; right: number }, keep?: KeepRegion): HTMLCanvasElement | HTMLImageElement {
  const sourceX = Math.round(image.naturalWidth * frameBounds.left);
  const sourceWidth = Math.round(image.naturalWidth * (frameBounds.right - frameBounds.left));
  const scale = Math.min(1, 680 / Math.max(sourceWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return image;
  context.drawImage(image, sourceX, 0, sourceWidth, image.naturalHeight, 0, 0, canvas.width, canvas.height);

  try {
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let start = 0;
    let end = 0;

    const addIfMatte = (pixel: number) => {
      if (pixel < 0 || pixel >= width * height || visited[pixel]) return;
      // Black clothing matches the black photo panel, so it must not be erased.
      if (keep && pixel % width >= keep.left * width && pixel % width <= keep.right * width && pixel >= keep.top * height * width) return;
      const offset = pixel * 4;
      if (!isBlackPhotoMatte(data[offset], data[offset + 1], data[offset + 2])) return;
      visited[pixel] = 1;
      queue[end++] = pixel;
    };

    for (let x = 0; x < width; x += 1) {
      addIfMatte(x);
      addIfMatte((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      addIfMatte(y * width);
      addIfMatte(y * width + width - 1);
    }
    while (start < end) {
      const pixel = queue[start++];
      const x = pixel % width;
      if (x > 0) addIfMatte(pixel - 1);
      if (x + 1 < width) addIfMatte(pixel + 1);
      if (pixel >= width) addIfMatte(pixel - width);
      if (pixel + width < width * height) addIfMatte(pixel + width);
    }

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      if (visited[pixel]) data[offset + 3] = 0;
      if (keep && pixel >= keep.bottom * height * width) data[offset + 3] = 0;
      if (data[offset + 3] > 12) {
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX - minX < width * 0.12 || maxY - minY < height * 0.15) return image;
    context.putImageData(pixels, 0, 0);

    const cropped = document.createElement("canvas");
    cropped.width = maxX - minX + 1;
    cropped.height = maxY - minY + 1;
    cropped.getContext("2d")?.drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return cropped;
  } catch {
    return image;
  }
}

export async function loadGameAssets(): Promise<GameAssets> {
  const entries = await Promise.all(
    Object.entries(assetFiles).map(async ([name, file]) => [name as AssetName, await loadImage(assetUrl(file))] as const),
  );
  const assets = Object.fromEntries(entries) as GameAssets;
  const blackPanelBounds = {
    player: { left: 0.06, right: 0.9 },
    floater: { left: 0.04, right: 0.895 },
    bibi: { left: 0.035, right: 0.9 },
  } as const;
  for (const name of ["player", "floater", "bibi"] as const) {
    const image = assets[name];
    const keepPants = name === "player" ? { left: 0.235, right: 0.845, top: 0.78, bottom: 0.94 } : undefined;
    // Nothing is protected for Bibi; this only trims the white photo border at the bottom.
    const trimOnly = name === "bibi" ? { left: 2, right: 2, top: 2, bottom: 0.94 } : undefined;
    if (image instanceof HTMLImageElement) assets[name] = makePortraitCutout(image, blackPanelBounds[name], keepPants ?? trimOnly);
  }
  return assets;
}

export function imageSource(url: string): string {
  return url;
}

export const assetFilesForUi = assetFiles;