import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONTS, TOTAL_FRAMES } from '../theme';

export const CipherBackground: React.FC<{
  backdropOpacity?: number;
  backdropYOffset?: number;
  backdropFocusX?: string;
  magentaGlow?: number;
  cyanGlow?: number;
  gridScale?: number;
}> = ({
  backdropOpacity = 0.16,
  backdropYOffset = 0,
  backdropFocusX = '72%',
  magentaGlow = 0.1,
  cyanGlow = 0.09,
  gridScale = 40,
}) => {
  const frame = useCurrentFrame();
  const driftX = (frame * 0.25) % gridScale;
  const driftY = (frame * 0.15) % gridScale;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, overflow: 'hidden' }}>
      {backdropOpacity > 0 && (
        <Img
          src={staticFile('assets/optical-backdrop.jpg')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `translateY(${backdropYOffset}px)`,
            opacity: backdropOpacity,
            filter: 'contrast(1.48) saturate(1.2) brightness(0.66)',
            mixBlendMode: 'screen',
            WebkitMaskImage: `radial-gradient(ellipse 42% 44% at ${backdropFocusX} 50%, rgba(0,0,0,0.9) 8%, transparent 74%)`,
            maskImage: `radial-gradient(ellipse 42% 44% at ${backdropFocusX} 50%, rgba(0,0,0,0.9) 8%, transparent 74%)`,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: -gridScale,
          transform: `translate3d(${-driftX}px, ${-driftY}px, 0)`,
          backgroundImage: `
            linear-gradient(rgba(62, 242, 255, 0.048) 1px, transparent 1px),
            linear-gradient(90deg, rgba(62, 242, 255, 0.048) 1px, transparent 1px)
          `,
          backgroundSize: `${gridScale}px ${gridScale}px`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 3px),
            radial-gradient(ellipse at 50% -14%, rgba(255, 62, 200, ${magentaGlow}), transparent 58%),
            radial-gradient(ellipse at 50% 114%, rgba(62, 242, 255, ${cyanGlow}), transparent 58%)
          `,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 50%, transparent 56%, rgba(2, 4, 9, 0.76) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

export const SceneTransitionShell: React.FC<{
  children: React.ReactNode;
  enterFromFrame0?: boolean;
}> = ({ children, enterFromFrame0 = false }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const enterP = enterFromFrame0
    ? 1
    : interpolate(frame, [0, 10], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' });
  const exitP = interpolate(frame, [durationInFrames - 7, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.quad),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = (enterFromFrame0 ? 1 : 0.99 + 0.01 * enterP) + 0.008 * exitP;
  const opacity =
    (enterFromFrame0 ? 1 : interpolate(frame, [0, 6], [0.82, 1], { extrapolateRight: 'clamp' })) *
    (1 - exitP * 0.16);

  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

export const HudChrome: React.FC<{
  sectionCode: string;
  sectionLabel: string;
  globalStartFrame?: number;
  opacity?: number;
}> = ({ sectionCode, sectionLabel, globalStartFrame = 0, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, (globalStartFrame + frame) / (TOTAL_FRAMES - 1));

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, opacity }}>
      <div
        style={{
          position: 'absolute',
          top: 34,
          left: 64,
          right: 64,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: FONTS.mono,
          fontSize: 15,
          letterSpacing: '0.2em',
          color: COLORS.muted,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Img
            src={staticFile('assets/icon-source.png')}
            style={{ width: 24, height: 24, border: `1px solid rgba(62,242,255,0.4)` }}
          />
          <span style={{ color: COLORS.text, fontWeight: 700 }}>BEAMLET</span>
          <span style={{ color: COLORS.line }}>|</span>
          <span style={{ color: COLORS.magenta }}>{sectionCode}</span>
          <span style={{ fontFamily: FONTS.sans, letterSpacing: '0.04em', color: COLORS.muted }}>
            {sectionLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span>BOS1 // OPTICAL STREAM</span>
          <span
            style={{
              padding: '3px 10px',
              border: `1px solid rgba(93, 255, 154, 0.45)`,
              color: COLORS.ok,
              background: 'rgba(93, 255, 154, 0.08)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            NET: 0.0 KB/s (AIR-GAPPED)
          </span>
        </div>
      </div>

      {/* Bottom global timeline progress hairline */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 64,
          right: 64,
          height: 2,
          background: 'rgba(29, 58, 74, 0.55)',
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${COLORS.magenta}, ${COLORS.cyan})`,
            boxShadow: `0 0 10px ${COLORS.cyan}`,
          }}
        />
      </div>
    </div>
  );
};

export const BracketPanel: React.FC<{
  children: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
  glow?: boolean;
}> = ({ children, accent = COLORS.cyan, style, glow = false }) => {
  return (
    <div
      style={{
        position: 'relative',
        background: COLORS.panel,
        border: `1px solid ${glow ? accent : COLORS.line}`,
        boxShadow: glow ? `0 0 26px ${accent}33, inset 0 0 24px ${accent}14` : '0 16px 48px rgba(0,0,0,0.48)',
        padding: '24px 28px',
        backdropFilter: 'blur(8px)',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -2,
          left: -2,
          width: 18,
          height: 18,
          borderTop: `3px solid ${accent}`,
          borderLeft: `3px solid ${accent}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: 18,
          height: 18,
          borderBottom: `3px solid ${accent}`,
          borderRight: `3px solid ${accent}`,
        }}
      />
      {children}
    </div>
  );
};

export const ViewfinderBrackets: React.FC<{
  width: number;
  height: number;
  color?: string;
  cornerSize?: number;
  thickness?: number;
  showReticle?: boolean;
}> = ({
  width,
  height,
  color = COLORS.cyan,
  cornerSize = 36,
  thickness = 4,
  showReticle = true,
}) => {
  const corners: React.CSSProperties[] = [
    { top: 0, left: 0, borderTop: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` },
    { top: 0, right: 0, borderTop: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` },
    { bottom: 0, left: 0, borderBottom: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` },
    { bottom: 0, right: 0, borderBottom: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` },
  ];
  return (
    <div style={{ position: 'relative', width, height, pointerEvents: 'none' }}>
      {corners.map((c, idx) => (
        <div
          key={idx}
          style={{
            position: 'absolute',
            width: cornerSize,
            height: cornerSize,
            filter: `drop-shadow(0 0 10px ${color}99)`,
            ...c,
          }}
        />
      ))}
      {showReticle && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 28,
            height: 28,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `1.5px solid ${color}`,
            opacity: 0.75,
            boxShadow: `0 0 12px ${color}88`,
          }}
        />
      )}
    </div>
  );
};

export const OpticalCutFlash: React.FC<{
  triggers: Array<{ frame: number; tone?: 'cyan' | 'crimson' }>;
}> = ({ triggers }) => {
  const frame = useCurrentFrame();
  let flash = 0;
  let activeTone: 'cyan' | 'crimson' = 'cyan';
  for (const t of triggers) {
    const dist = frame - t.frame;
    if (dist >= -2 && dist <= 7) {
      const peak = t.tone === 'crimson' ? 0.16 : 0.2;
      const v = dist < 0
        ? interpolate(dist, [-2, 0], [0, peak])
        : interpolate(dist, [0, 7], [peak, 0]);
      if (v > flash) {
        flash = v;
        activeTone = t.tone ?? 'cyan';
      }
    }
  }
  if (flash <= 0.005) return null;
  const bg =
    activeTone === 'crimson'
      ? `radial-gradient(ellipse at 50% 50%, rgba(255, 77, 109, ${flash}), rgba(255, 62, 200, ${flash * 0.4}) 60%, transparent 100%)`
      : `radial-gradient(ellipse at 50% 50%, rgba(215, 247, 255, ${flash}), rgba(62, 242, 255, ${flash * 0.4}) 60%, transparent 100%)`;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: 90,
        background: bg,
        mixBlendMode: 'screen',
      }}
    />
  );
};
