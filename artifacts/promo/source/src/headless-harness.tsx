import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BeamletPromo } from './BeamletPromo';
import { FrameProvider } from './remotion-pipe-runtime';
import { HEIGHT, WIDTH } from './theme';

declare global {
  interface Window {
    __setFrame: (f: number) => void;
    __preloadAssets: (urls: string[]) => Promise<void>;
  }
}

const el = document.getElementById('root')!;
const root = createRoot(el);

const renderAt = (f: number) => {
  flushSync(() => {
    root.render(
      <div style={{ position: 'relative', width: WIDTH, height: HEIGHT, overflow: 'hidden', background: '#05070d' }}>
        <FrameProvider frame={f}>
          <BeamletPromo />
        </FrameProvider>
      </div>,
    );
  });
};

window.__setFrame = renderAt;

window.__preloadAssets = async (urls: string[]) => {
  await Promise.all(
    urls.map(
      (u) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.decoding = 'sync';
          img.onload = () => {
            img.decode().then(() => resolve()).catch(() => resolve());
          };
          img.onerror = () => reject(new Error(`Failed to preload ${u}`));
          img.src = u;
        }),
    ),
  );
};

renderAt(0);
