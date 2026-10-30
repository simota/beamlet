import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';

export const BosStreamCanvas: React.FC<{
  mode?: 'stable' | 'compact' | 'compact-rot' | 'standard' | 'fast';
  width: number;
  height: number;
  fpsRate?: 15 | 30;
  borderGlow?: string;
  style?: React.CSSProperties;
}> = ({
  mode = 'standard',
  width,
  height,
  fpsRate = 15,
  borderGlow = 'rgba(62, 242, 255, 0.4)',
  style,
}) => {
  const frame = useCurrentFrame();
  const stepDiv = fpsRate === 30 ? 2 : 4; // 60fps / 4 = exact 15fps!
  const count = mode === 'stable' ? 4 : mode === 'fast' ? 6 : 12;
  const idx = Math.floor(frame / stepDiv) % count;
  const padded = String(idx).padStart(2, '0');
  const src = staticFile(`assets/bos/bos-${mode}-${padded}.png`);

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 0 1px rgba(62,242,255,0.65), 0 0 36px ${borderGlow}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
    </div>
  );
};
