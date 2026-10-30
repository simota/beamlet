import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BracketPanel, CipherBackground, HudChrome, SceneTransitionShell } from '../components/HudStage';
import { COLORS, FONTS, SCENES } from '../theme';

const PillarGlyph: React.FC<{ kind: 0 | 1 | 2; color: string }> = ({ kind, color }) => {
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" fill="none" style={{ filter: `drop-shadow(0 0 10px ${color}66)` }}>
      {kind === 0 && (
        <>
          <rect x="4" y="4" width="34" height="34" stroke={color} strokeWidth="2" strokeDasharray="6 4" />
          <path d="M21 10L31 15V22C31 28.2 26.7 32.8 21 34.5C15.3 32.8 11 28.2 11 22V15L21 10Z" stroke={color} strokeWidth="2.2" fill={`${color}18`} />
          <path d="M17 21.5L20 24.5L26 18.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="square" />
        </>
      )}
      {kind === 1 && (
        <>
          <rect x="9" y="19" width="24" height="17" stroke={color} strokeWidth="2.2" fill={`${color}18`} />
          <path d="M14 19V14C14 10.1 17.1 7 21 7C24.9 7 28 10.1 28 14V19" stroke={color} strokeWidth="2.2" />
          <circle cx="21" cy="27" r="3" fill="#ffffff" />
        </>
      )}
      {kind === 2 && (
        <>
          <rect x="11" y="11" width="20" height="20" stroke={color} strokeWidth="2.2" fill={`${color}18`} />
          <rect x="16" y="16" width="10" height="10" fill={color} />
          <path d="M16 5V11M26 5V11M16 31V37M26 31V37M5 16H11M5 26H11M31 16H37M31 26H37" stroke="#ffffff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
};

// Left-to-right order matches the headline:
// Left ("録画されても読めない。" -> 01 END-TO-END AEAD, magenta)
// Center ("圏外でも止まらない。" -> 02 ZERO NETWORK, cyan)
// Right (03 PURE RUST + WASM, green)
const PILLARS = [
  {
    delay: 32, // locks right onto 29.10s audio vault lock (f=36)
    kind: 1 as const,
    code: '01 // END-TO-END AEAD',
    title: '画面を録画されても復号不能',
    metric: 'X25519 + ChaCha20-Poly1305',
    lines: [
      '使い捨て鍵交換で復号できるのは1台だけ。',
      'ファイル名・目録まで認証付き暗号化し、',
      '共有用画像の位置情報EXIFも削除します。',
    ],
    accent: COLORS.magenta,
  },
  {
    delay: 104, // locks right onto 30.30s audio vault lock (f=108)
    kind: 0 as const,
    code: '02 // ZERO NETWORK',
    title: '圏外でも動くオフラインPWA',
    metric: "Service Worker + CSP 'self'",
    lines: [
      '一度開けばページとWASMを自動キャッシュ。',
      '機内モードでも地下でも、',
      'ネットワーク接続ゼロで動作します。',
    ],
    accent: COLORS.cyan,
  },
  {
    delay: 176, // locks right onto 31.50s audio vault lock (f=180)
    kind: 2 as const,
    code: '03 // PURE RUST + WASM',
    title: '単一WASMコアの高速処理',
    metric: 'beamlet-stream (Zero JS Deps)',
    lines: [
      'Rust製の純粋な演算コアを',
      'Web Worker 上で並列駆動。',
      'UIを止めずにリアルタイム追跡・復号。',
    ],
    accent: COLORS.ok,
  },
];

export const Scene6Security: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headSpring = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 165 } });

  return (
    <AbsoluteFill>
      <CipherBackground backdropOpacity={0} magentaGlow={0.13} cyanGlow={0.13} />
      <HudChrome sectionCode="05 // ZERO-TRUST ARCHITECTURE" sectionLabel="暗号学的安全性とオフライン完結" globalStartFrame={SCENES.security.start} />

      <SceneTransitionShell>
        <AbsoluteFill
          style={{
            padding: '92px 92px 64px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              marginBottom: 46,
              opacity: headSpring,
              transform: `translateY(${(1 - headSpring) * 22}px)`,
            }}
          >
            <div style={{ fontFamily: FONTS.mono, fontSize: 15, color: COLORS.magenta, letterSpacing: '0.22em', marginBottom: 10 }}>
              BUILT FOR PRIVACY & RESTRICTED ENVIRONMENTS
            </div>
            <h2 style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 56, fontWeight: 800, color: COLORS.white }}>
              <span style={{ color: COLORS.magenta }}>録画</span>されても読めない。<span style={{ color: COLORS.cyan }}>圏外</span>でも止まらない。
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
            {PILLARS.map((p) => {
              const s = spring({ frame: frame - p.delay, fps, config: { damping: 17, stiffness: 175 } });
              return (
                <BracketPanel
                  key={p.code}
                  accent={p.accent}
                  glow={s > 0.6}
                  style={{
                    padding: '30px 30px',
                    opacity: s,
                    transform: `translateY(${(1 - s) * 32}px)`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 375,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 700, color: p.accent, letterSpacing: '0.18em' }}>
                        {p.code}
                      </div>
                      <PillarGlyph kind={p.kind} color={p.accent} />
                    </div>
                    <h3 style={{ margin: '0 0 14px', fontFamily: FONTS.sans, fontSize: 30, fontWeight: 800, color: COLORS.white, lineHeight: 1.3 }}>
                      {p.title}
                    </h3>
                    <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 18, lineHeight: 1.72, color: COLORS.muted }}>
                      {p.lines.map((ln, idx) => (
                        <React.Fragment key={idx}>
                          {ln}
                          {idx < p.lines.length - 1 && <br />}
                        </React.Fragment>
                      ))}
                    </p>
                  </div>

                  <div
                    style={{
                      marginTop: 24,
                      padding: '10px 14px',
                      background: 'rgba(5, 8, 15, 0.92)',
                      border: `1px solid ${p.accent}66`,
                      fontFamily: FONTS.mono,
                      fontSize: 15,
                      fontWeight: 700,
                      color: COLORS.text,
                    }}
                  >
                    {p.metric}
                  </div>
                </BracketPanel>
              );
            })}
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
