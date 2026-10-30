import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BosStreamCanvas } from '../components/BosStreamCanvas';
import { CipherBackground, HudChrome, SceneTransitionShell, ViewfinderBrackets } from '../components/HudStage';
import { COLORS, FONTS, SCENES } from '../theme';

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Audio hits: 0.00s (f=0) sub+laser, 0.35s (f=21) click, 1.60s (f=96) glass pluck!
  const line1Spring = spring({ frame, fps, config: { damping: 18, stiffness: 225, mass: 0.68 } });
  const line2Spring = spring({ frame: frame - 16, fps, config: { damping: 16, stiffness: 205, mass: 0.72 } });
  const subSpring = spring({ frame: frame - 42, fps, config: { damping: 19, stiffness: 170, mass: 0.78 } });
  const pillsSpring = spring({ frame: frame - 88, fps, config: { damping: 18, stiffness: 165 } });
  const calloutSpring = spring({ frame: frame - 26, fps, config: { damping: 18, stiffness: 175 } });

  const matrixScale = interpolate(frame, [0, 36, 210], [1.05, 1.0, 1.022], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const beamProgress = interpolate(frame, [0, 18], [0.32, 1], {
    easing: Easing.out(Easing.exp),
    extrapolateRight: 'clamp',
  });
  // Dissolve incoming laser beam cleanly by ~0.87s (f=52) so 2.4s has zero residual line!
  const beamOpacity = interpolate(frame, [0, 10, 32, 52], [0.95, 1, 0.65, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <CipherBackground backdropOpacity={0.26} backdropYOffset={-18} backdropFocusX="76%" magentaGlow={0.12} cyanGlow={0.14} />
      <HudChrome sectionCode="00 // HOOK" sectionLabel="光学エアギャップ転送" globalStartFrame={SCENES.hook.start} />

      <SceneTransitionShell enterFromFrame0>
        <AbsoluteFill
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '74px 88px 54px',
          }}
        >
          {/* Left: Ultra-High-Contrast Kinetic Japanese Hero Copy */}
          <div style={{ width: 870, zIndex: 10 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                padding: '7px 16px',
                marginBottom: 26,
                border: `1px solid ${COLORS.cyan}aa`,
                background: 'rgba(6, 14, 24, 0.94)',
                boxShadow: '0 0 20px rgba(62, 242, 255, 0.16)',
                fontFamily: FONTS.mono,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '0.2em',
                color: COLORS.cyan,
              }}
            >
              <span>SCREEN</span>
              <span style={{ color: COLORS.magenta }}>━━━▶</span>
              <span>CAMERA</span>
            </div>

            <h1
              style={{
                margin: 0,
                fontFamily: FONTS.sans,
                fontWeight: 800,
                fontSize: 80,
                lineHeight: 1.17,
                letterSpacing: '-0.02em',
                color: COLORS.white,
              }}
            >
              <span
                style={{
                  display: 'block',
                  opacity: 0.45 + 0.55 * line1Spring,
                  transform: `translateY(${(1 - line1Spring) * 16}px)`,
                }}
              >
                Wi-Fiも、クラウドも、
              </span>
              <span
                style={{
                  display: 'block',
                  color: COLORS.cyan,
                  textShadow: '0 0 34px rgba(62, 242, 255, 0.48)',
                  opacity: line2Spring,
                  transform: `translateY(${(1 - line2Spring) * 20}px)`,
                }}
              >
                いらない。
              </span>
            </h1>

            <div
              style={{
                marginTop: 28,
                opacity: subSpring,
                transform: `translateY(${(1 - subSpring) * 18}px)`,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: FONTS.sans,
                  fontWeight: 700,
                  fontSize: 40,
                  lineHeight: 1.38,
                  color: COLORS.text,
                }}
              >
                光だけで、暗号化ファイルを届ける。
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 14,
                marginTop: 28,
                opacity: pillsSpring,
                transform: `translateY(${(1 - pillsSpring) * 16}px)`,
              }}
            >
              {[
                { label: '通信量 0 バイト', col: COLORS.ok },
                { label: '使い捨て鍵で暗号化・改ざん検証', col: COLORS.cyan },
                { label: 'ブラウザ / オフラインPWA', col: COLORS.magenta },
              ].map((pill) => (
                <div
                  key={pill.label}
                  style={{
                    padding: '9px 16px',
                    background: 'rgba(6, 12, 22, 0.94)',
                    border: `1px solid ${pill.col}88`,
                    fontFamily: FONTS.sans,
                    fontSize: 16,
                    fontWeight: 700,
                    color: COLORS.white,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: pill.col, boxShadow: `0 0 8px ${pill.col}` }} />
                  {pill.label}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Razor-Sharp Pixel-Exact Live BOS1 Matrix with Clean Outer Callouts */}
          <div
            style={{
              position: 'relative',
              width: 800,
              height: 540,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {beamOpacity > 0.01 && (
              <div
                style={{
                  position: 'absolute',
                  left: -110,
                  top: '50%',
                  width: 510 * beamProgress,
                  height: 5,
                  transform: 'translateY(-50%)',
                  background: `linear-gradient(90deg, transparent 0%, ${COLORS.magenta} 40%, ${COLORS.cyan} 100%)`,
                  boxShadow: `0 0 22px ${COLORS.cyan}, 0 0 32px ${COLORS.magenta}`,
                  zIndex: 6,
                  opacity: beamOpacity,
                }}
              />
            )}

            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `scale(${matrixScale})`,
              }}
            >
              <BosStreamCanvas
                mode="standard"
                width={672}
                height={390}
                fpsRate={15}
                borderGlow="rgba(62, 242, 255, 0.52)"
              />

              <div style={{ position: 'absolute', inset: -34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ViewfinderBrackets width={740} height={458} color={COLORS.cyan} cornerSize={42} thickness={4} showReticle />
              </div>

              {/* Clean Outer Micro-HUD Callout Badges (Zero overlap with white BOS1 plate!) */}
              <div
                style={{
                  position: 'absolute',
                  top: -40,
                  left: 14,
                  right: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  opacity: calloutSpring,
                  transform: `translateY(${(1 - calloutSpring) * 8}px)`,
                }}
              >
                <span
                  style={{
                    padding: '4px 10px',
                    background: 'rgba(5, 9, 18, 0.94)',
                    border: `1px solid ${COLORS.cyan}88`,
                    fontFamily: FONTS.mono,
                    fontSize: 12,
                    fontWeight: 700,
                    color: COLORS.cyan,
                    letterSpacing: '0.12em',
                  }}
                >
                  BOS1 // 4色光学セル + 上下色補正帯
                </span>
                <span
                  style={{
                    padding: '4px 10px',
                    background: 'rgba(5, 9, 18, 0.94)',
                    border: `1px solid ${COLORS.magenta}88`,
                    fontFamily: FONTS.mono,
                    fontSize: 12,
                    fontWeight: 700,
                    color: COLORS.magenta,
                    letterSpacing: '0.12em',
                  }}
                >
                  RaptorQ 噴水符号（片方向）
                </span>
              </div>

              <div
                style={{
                  position: 'absolute',
                  bottom: -38,
                  right: 14,
                  fontFamily: FONTS.mono,
                  fontSize: 14,
                  fontWeight: 700,
                  color: COLORS.ok,
                  letterSpacing: '0.12em',
                  background: 'rgba(5, 9, 18, 0.94)',
                  padding: '3px 10px',
                  border: `1px solid rgba(93, 255, 154, 0.45)`,
                }}
              >
                ● LIVE BOS1 MATRIX // 192×108 · 2bpc · 15 FPS
              </div>
            </div>
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
