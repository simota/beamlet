import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BosStreamCanvas } from '../components/BosStreamCanvas';
import { BracketPanel, CipherBackground, HudChrome, SceneTransitionShell, ViewfinderBrackets } from '../components/HudStage';
import { COLORS, FONTS, SCENES } from '../theme';

const BarrierGlyph: React.FC<{ idx: number }> = ({ idx }) => {
  const c = COLORS.err;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style={{ opacity: 0.9, flexShrink: 0 }}>
      {idx === 0 && (
        <>
          <path d="M6 13C12.2 7.5 21.8 7.5 28 13" stroke={c} strokeWidth="2" />
          <path d="M10.5 18C14.2 14.6 19.8 14.6 23.5 18" stroke={c} strokeWidth="2" />
          <circle cx="17" cy="23.5" r="2" fill={c} />
          <line x1="6" y1="6" x2="28" y2="28" stroke="#ffffff" strokeWidth="2" />
        </>
      )}
      {idx === 1 && (
        <>
          <rect x="4" y="9" width="10" height="16" stroke={c} strokeWidth="2" />
          <rect x="20" y="9" width="10" height="16" stroke={c} strokeWidth="2" />
          <line x1="17" y1="6" x2="17" y2="28" stroke="#ffffff" strokeWidth="2" strokeDasharray="3 3" />
        </>
      )}
      {idx === 2 && (
        <>
          <path d="M9 24H25C27.8 24 30 21.8 30 19C30 16.4 28.1 14.3 25.6 14C24.8 10.6 21.7 8 18 8C13.9 8 10.5 11.1 10.1 15.1C7.8 15.6 6 17.6 6 20C6 22.2 7.3 24 9 24Z" stroke={c} strokeWidth="2" />
          <path d="M17 14V19M17 21.5V22" stroke="#ffffff" strokeWidth="2.2" />
        </>
      )}
      {idx === 3 && (
        <>
          <rect x="11" y="7" width="12" height="10" stroke={c} strokeWidth="2" />
          <rect x="8" y="17" width="18" height="11" stroke={c} strokeWidth="2" />
          <line x1="6" y1="6" x2="28" y2="28" stroke="#ffffff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
};

const BARRIERS = [
  { code: 'ERR_NET_BLOCKED', title: '社内網・機密環境のWi-Fi制限', sub: 'エアギャップ環境では通信自体が禁止' },
  { code: 'ERR_OS_MISMATCH', title: 'OSの壁でAirDropが使えない', sub: 'iPhone ↔ Windows / Android ↔ Mac' },
  { code: 'ERR_CLOUD_LEAK', title: 'クラウド経由の情報漏えい懸念', sub: '鍵やログを外部サーバーに預けたくない' },
  { code: 'ERR_USB_POLICY', title: 'USBメモリ禁止・ペアリング不可', sub: '物理ポート制限やBluetoothの混線' },
];

export const Scene2Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Audio barrier clicks at 3.75s (f=15), 4.05s (f=33), 4.35s (f=51), 4.65s (f=69)
  // Audio optical breakthrough laser sweep at 5.60s (f=126)!
  const breakProgress = spring({
    frame: frame - 124,
    fps,
    config: { damping: 16, stiffness: 160, mass: 0.78 },
  });

  const wallOpacity = interpolate(breakProgress, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' });
  const wallScale = interpolate(breakProgress, [0, 0.58], [1, 0.92], { extrapolateRight: 'clamp' });
  const bridgeWidthPct = interpolate(frame, [126, 154], [0, 100], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <CipherBackground
        backdropOpacity={0}
        magentaGlow={0.11}
        cyanGlow={0.09 + breakProgress * 0.12}
      />
      <HudChrome sectionCode="01 // PROBLEM → SOLUTION" sectionLabel="目の前にある端末へ、なぜ送れないのか" globalStartFrame={SCENES.problem.start} />

      <SceneTransitionShell>
        <AbsoluteFill
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '116px 104px 44px',
          }}
        >
          {/* Top Headline Swap */}
          <div style={{ textAlign: 'center', marginBottom: 42, position: 'relative', height: 118, width: '100%' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: interpolate(breakProgress, [0, 0.38], [1, 0], { extrapolateRight: 'clamp' }),
                transform: `translateY(${interpolate(breakProgress, [0, 0.42], [0, -24])}px)`,
              }}
            >
              <div style={{ fontFamily: FONTS.mono, fontSize: 16, color: COLORS.err, letterSpacing: '0.2em', marginBottom: 10 }}>
                // TRANSFER BLOCKED BY INFRASTRUCTURE
              </div>
              <h2 style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 54, fontWeight: 800, color: COLORS.white }}>
                すぐ目の前の端末なのに、ファイルを渡せない。
              </h2>
            </div>

            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: breakProgress,
                transform: `translateY(${(1 - breakProgress) * 26}px)`,
              }}
            >
              <div style={{ fontFamily: FONTS.mono, fontSize: 16, color: COLORS.cyan, letterSpacing: '0.22em', marginBottom: 10 }}>
                // AIR-GAPPED OPTICAL CHANNEL
              </div>
              {/* Color-meaning alignment: 画面 = magenta (Sender TX below), カメラ = cyan (Receiver RX below)! */}
              <h2
                style={{
                  margin: 0,
                  fontFamily: FONTS.sans,
                  fontSize: 60,
                  fontWeight: 800,
                  color: COLORS.white,
                  textShadow: '0 0 28px rgba(62, 242, 255, 0.35)',
                }}
              >
                必要なのは、<span style={{ color: COLORS.magenta }}>画面</span>と<span style={{ color: COLORS.cyan }}>カメラ</span>だけ。
              </h2>
            </div>
          </div>

          {/* Stage Area */}
          <div style={{ position: 'relative', width: 1540, height: 430 }}>
            {/* Phase A: 4 Friction Barriers with Line-Art Icons locked to 15, 33, 51, 69 */}
            {wallOpacity > 0.005 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 24,
                  opacity: wallOpacity,
                  transform: `scale(${wallScale})`,
                  filter: `blur(${(1 - wallOpacity) * 8}px)`,
                }}
              >
                {BARRIERS.map((b, i) => {
                  const appear = spring({ frame: frame - (12 + i * 18), fps, config: { damping: 18, stiffness: 215 } });
                  return (
                    <BracketPanel
                      key={b.code}
                      accent={COLORS.err}
                      style={{
                        opacity: appear,
                        transform: `translateY(${(1 - appear) * 18}px)`,
                        padding: '24px 30px',
                        background: 'rgba(22, 9, 16, 0.9)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.err, letterSpacing: '0.16em' }}>
                          ✕ {b.code}
                        </div>
                        <BarrierGlyph idx={i} />
                      </div>
                      <div style={{ fontFamily: FONTS.sans, fontSize: 28, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>
                        {b.title}
                      </div>
                      <div style={{ fontFamily: FONTS.sans, fontSize: 18, color: COLORS.muted }}>
                        {b.sub}
                      </div>
                    </BracketPanel>
                  );
                })}
              </div>
            )}

            {/* Phase B: Self-Explanatory Optical Bridge (Encrypted BOS1 ──▶ Photons ──▶ Decoded File!) */}
            {breakProgress > 0.02 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 16px',
                  opacity: interpolate(breakProgress, [0.15, 0.82], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                  transform: `scale(${0.94 + 0.06 * breakProgress})`,
                }}
              >
                {/* Sender Card with Mini Live BOS1 */}
                <BracketPanel accent={COLORS.magenta} glow style={{ width: 462, padding: '26px 28px', background: '#070e1a' }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 700, color: COLORS.magenta, letterSpacing: '0.2em' }}>
                    TX // SENDER SCREEN
                  </div>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 34, fontWeight: 800, color: COLORS.white, margin: '8px 0 14px' }}>
                    画面で光らせる
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <BosStreamCanvas mode="compact" width={154} height={90} fpsRate={15} />
                    <div style={{ fontFamily: FONTS.sans, fontSize: 16, lineHeight: 1.6, color: COLORS.muted }}>
                      ファイルを認証付き暗号化し
                      <br />
                      カラー2Dフレームを連続表示
                    </div>
                  </div>
                </BracketPanel>

                {/* Animated Photonic Bridge with Directional Arrowhead ▶ */}
                <div style={{ flex: 1, position: 'relative', height: 150, display: 'flex', alignItems: 'center', margin: '0 18px' }}>
                  <div
                    style={{
                      width: `${bridgeWidthPct}%`,
                      height: 8,
                      background: `linear-gradient(90deg, ${COLORS.magenta}, ${COLORS.cyan}, ${COLORS.ok})`,
                      boxShadow: `0 0 28px ${COLORS.cyan}, 0 0 42px ${COLORS.magenta}`,
                      borderRadius: 4,
                    }}
                  />
                  {bridgeWidthPct > 92 && (
                    <div
                      style={{
                        position: 'absolute',
                        right: -4,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: COLORS.cyan,
                        fontSize: 24,
                        lineHeight: 1,
                        textShadow: `0 0 16px ${COLORS.cyan}`,
                      }}
                    >
                      ▶
                    </div>
                  )}
                  {frame >= 140 &&
                    [0, 1, 2, 3].map((idx) => {
                      const p = ((frame - 140) * 0.036 + idx * 0.25) % 1;
                      const cols = [COLORS.magenta, COLORS.cyan, COLORS.white, COLORS.ok];
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'absolute',
                            left: `${p * 90}%`,
                            top: '50%',
                            width: 34,
                            height: 10,
                            borderRadius: 5,
                            transform: 'translateY(-50%)',
                            background: cols[idx],
                            boxShadow: `0 0 16px ${cols[idx]}`,
                            opacity: Math.sin(p * Math.PI),
                          }}
                        />
                      );
                    })}
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 6,
                      transform: 'translateX(-50%)',
                      padding: '8px 20px',
                      background: '#06111e',
                      border: `1px solid ${COLORS.cyan}`,
                      fontFamily: FONTS.sans,
                      fontSize: 18,
                      fontWeight: 700,
                      color: COLORS.cyan,
                      whiteSpace: 'nowrap',
                      boxShadow: `0 0 22px rgba(62,242,255,0.32)`,
                    }}
                  >
                    ネットワーク 0 B ・ ペアリング不要 ・ OS不問
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: 10,
                      transform: 'translateX(-50%)',
                      fontFamily: FONTS.mono,
                      fontSize: 14,
                      fontWeight: 700,
                      color: COLORS.ok,
                      letterSpacing: '0.14em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    PHOTONS ONLY // E2E ENCRYPTED ━━▶
                  </div>
                </div>

                {/* Receiver Card with Reconstructed File Thumbnail (Exact 2-line balanced copy, zero orphan characters!) */}
                <BracketPanel accent={COLORS.cyan} glow style={{ width: 462, padding: '26px 28px', background: '#070e1a' }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 700, color: COLORS.cyan, letterSpacing: '0.2em' }}>
                    RX // RECEIVER CAMERA
                  </div>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 34, fontWeight: 800, color: COLORS.white, margin: '8px 0 14px' }}>
                    カメラで受け取る
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <div
                      style={{
                        position: 'relative',
                        width: 154,
                        height: 90,
                        background: '#040810',
                        overflow: 'hidden',
                        border: `1px solid ${COLORS.ok}88`,
                        flexShrink: 0,
                      }}
                    >
                      <Img
                        src={staticFile('assets/sample-photo.jpg')}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          opacity: interpolate(frame, [145, 175], [0.25, 0.95], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                        }}
                      />
                      <div style={{ position: 'absolute', inset: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ViewfinderBrackets width={140} height={76} color={COLORS.ok} cornerSize={14} thickness={2.5} showReticle={false} />
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          right: 6,
                          bottom: 5,
                          padding: '1px 6px',
                          background: 'rgba(5, 9, 16, 0.9)',
                          border: `1px solid ${COLORS.ok}`,
                          fontFamily: FONTS.mono,
                          fontSize: 10,
                          fontWeight: 700,
                          color: COLORS.ok,
                        }}
                      >
                        ✓ 復号OK
                      </div>
                    </div>
                    <div style={{ fontFamily: FONTS.sans, fontSize: 16, lineHeight: 1.6, color: COLORS.muted, whiteSpace: 'nowrap' }}>
                      自動追跡・復号・改ざん検証
                      <br />
                      その場でファイルを保存
                    </div>
                  </div>
                </BracketPanel>
              </div>
            )}
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
