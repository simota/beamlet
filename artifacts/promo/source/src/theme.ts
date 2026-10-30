export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_FRAMES = 2280; // 38.0s @ 60fps

export const COLORS = {
  bg: '#05070d',
  bgDeep: '#03050a',
  panel: 'rgba(12, 20, 32, 0.82)',
  panelSolid: '#09111c',
  line: '#1d3a4a',
  text: '#d7f7ff',
  white: '#ffffff',
  muted: '#8aa4b4',
  cyan: '#3ef2ff',
  magenta: '#ff3ec8',
  ok: '#5dff9a',
  warn: '#ffb13e',
  err: '#ff4d6d',
} as const;

export const FONTS = {
  sans: '"Hiragino Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  mono: '"SF Mono", Menlo, Monaco, Consolas, ui-monospace, monospace',
} as const;

export const SCENES = {
  hook: { start: 0, duration: 210 },          // 0.0s - 3.5s
  problem: { start: 210, duration: 270 },     // 3.5s - 8.0s
  handshake: { start: 480, duration: 360 },   // 8.0s - 14.0s
  transfer: { start: 840, duration: 450 },    // 14.0s - 21.5s
  arch: { start: 1290, duration: 420 },       // 21.5s - 28.5s
  security: { start: 1710, duration: 300 },   // 28.5s - 33.5s
  climax: { start: 2010, duration: 270 },     // 33.5s - 38.0s
} as const;

export const FINGERPRINT = '667855';
