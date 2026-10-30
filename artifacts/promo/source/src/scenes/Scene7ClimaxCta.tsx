import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BracketPanel, CipherBackground, HudChrome } from '../components/HudStage';
import { COLORS, FONTS, SCENES } from '../theme';

export const Scene7ClimaxCta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Audio: 33.50s (f=0) laser sweep, 33.88s (f=23) sub hit + major9 chord chime, 36.30s..38.00s fadeout
  const beamArrive = interpolate(frame, [0, 22], [0, 1], { easing: Easing.out(Easing.exp), extrapolateRight: 'clamp' });
  const iconOpacity = interpolate(frame, [0, 16], [0.55, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' });
  const logoSpring = spring({ frame: frame - 14, fps, config: { damping: 16, stiffness: 180 } });
  const ctaSpring = spring({ frame: frame - 42, fps, config: { damping: 18, stiffness: 165 } });

  const cameraDrift = interpolate(frame, [0, 270], [0.988, 1.018], {
    easing: Easing.out(Easing.quad),
    extrapolateRight: 'clamp',
  });

  // Transient chromatic flash strictly on the 33.88s chord impact (f=14..32), settling to 0.0px so BEAMLET is razor-sharp!
  const chromaSpread = interpolate(frame, [14, 21, 32], [0, 4.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Gentle dusk settle over the final second (f=210..270 = 37.0s..38.0s) matching the audio master fadeout
  const duskSettle = interpolate(frame, [210, 270], [1, 0.48], {
    easing: Easing.inOut(Easing.quad),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* Pure symmetrical precision-optical obsidian stage */}
      <CipherBackground backdropOpacity={0} magentaGlow={0.18 * duskSettle} cyanGlow={0.2 * duskSettle} />
      <HudChrome
        sectionCode="06 // GET STARTED"
        sectionLabel="ブラウザで今すぐ起動 ・ インストール可能なオフラインPWA"
        globalStartFrame={SCENES.climax.start}
        opacity={duskSettle}
      />

      {/* Soft diffused radial halo behind the brand lockup (no hard 1px line slicing through BEAMLET glyphs!) */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '34%',
          width: 720,
          height: 200,
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(62, 242, 255, 0.20) 0%, rgba(255, 62, 200, 0.10) 45%, transparent 75%)',
          filter: 'blur(18px)',
          opacity: logoSpring * duskSettle,
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '64px 120px 44px',
          transform: `scale(${cameraDrift})`,
        }}
      >
        {/* Official Beamlet Brand Mark — visible from f=0 so the incoming laser beam locks onto a physical target */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <div
            style={{
              position: 'absolute',
              right: '50%',
              top: '50%',
              width: 960 * beamArrive,
              height: 5,
              transform: 'translateY(-50%)',
              background: `linear-gradient(90deg, transparent 0%, ${COLORS.magenta} 45%, ${COLORS.cyan} 100%)`,
              boxShadow: `0 0 24px ${COLORS.cyan}, 0 0 36px ${COLORS.magenta}`,
              opacity: interpolate(frame, [0, 18, 52, 92], [0.88, 1, 0.65, 0], { extrapolateRight: 'clamp' }),
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              transform: `scale(${0.86 + 0.14 * logoSpring})`,
              opacity: iconOpacity,
              boxShadow: `0 0 ${44 * duskSettle}px rgba(62, 242, 255, 0.45)`,
              border: `1.5px solid rgba(62, 242, 255, 0.72)`,
              background: COLORS.bg,
              zIndex: 2,
            }}
          >
            <Img src={staticFile('assets/icon-source.png')} style={{ width: 114, height: 114, display: 'block' }} />
          </div>
        </div>

        {/* Crystalline BEAMLET Logotype — 0px chromatic offset once settled */}
        <div style={{ position: 'relative', opacity: logoSpring }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.sans,
              fontWeight: 800,
              fontSize: 94,
              letterSpacing: '0.3em',
              paddingLeft: '0.3em',
              color: '#f6fdff',
              textShadow:
                chromaSpread > 0.05
                  ? `${-chromaSpread}px 0 0 rgba(255, 62, 200, 0.75), ${chromaSpread}px 0 0 rgba(62, 242, 255, 0.8), 0 0 28px rgba(62, 242, 255, 0.55)`
                  : `0 0 ${26 * duskSettle}px rgba(62, 242, 255, 0.48)`,
            }}
          >
            BEAMLET
          </h1>
        </div>

        <p
          style={{
            margin: '14px 0 34px',
            fontFamily: FONTS.sans,
            fontSize: 31,
            fontWeight: 700,
            color: COLORS.white,
            opacity: logoSpring,
            letterSpacing: '0.02em',
          }}
        >
          画面とカメラだけで、暗号化したファイルを受け渡す。
        </p>

        {/* Authentic RX // 01 & TX // 02 CTA Tiles */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 28,
            width: 1020,
            opacity: ctaSpring * (0.86 + 0.14 * duskSettle),
            transform: `translateY(${(1 - ctaSpring) * 24}px)`,
          }}
        >
          <BracketPanel accent={COLORS.cyan} glow style={{ padding: '24px 30px', background: 'rgba(8, 16, 28, 0.94)' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, letterSpacing: '0.2em', color: COLORS.magenta }}>
              RX // 01  receive.html
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 34, fontWeight: 700, color: COLORS.cyan, margin: '8px 0 6px' }}>
              受信する →
            </div>
            <div style={{ fontFamily: FONTS.sans, fontSize: 17, color: COLORS.muted }}>
              先に受信側で開き、公開鍵QRを表示
            </div>
          </BracketPanel>

          <BracketPanel accent={COLORS.magenta} glow style={{ padding: '24px 30px', background: 'rgba(8, 16, 28, 0.94)' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, letterSpacing: '0.2em', color: COLORS.magenta }}>
              TX // 02  send.html
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 34, fontWeight: 700, color: COLORS.cyan, margin: '8px 0 6px' }}>
              送信する →
            </div>
            <div style={{ fontFamily: FONTS.sans, fontSize: 17, color: COLORS.muted }}>
              QRを読んで、光で暗号化ストリーム送信
            </div>
          </BracketPanel>
        </div>

        <div
          style={{
            marginTop: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '12px 28px',
            border: `1px solid ${COLORS.cyan}77`,
            background: 'rgba(6, 12, 22, 0.95)',
            fontFamily: FONTS.mono,
            fontSize: 16,
            color: COLORS.text,
            opacity: ctaSpring * (0.82 + 0.18 * duskSettle),
            boxShadow: `0 0 ${24 * duskSettle}px rgba(62, 242, 255, 0.18)`,
          }}
        >
          <span
            style={{
              color: COLORS.ok,
              fontWeight: 700,
              opacity: 0.78 + 0.22 * Math.sin(frame * 0.12),
            }}
          >
            ● INSTALLABLE OFFLINE PWA
          </span>
          <span style={{ color: COLORS.line }}>|</span>
          <span style={{ fontFamily: FONTS.sans, fontWeight: 600 }}>
            ブラウザで開くだけ ・ ネットワーク不要 ・ Rust + WebAssembly
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
