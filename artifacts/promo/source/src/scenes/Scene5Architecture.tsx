import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BracketPanel, CipherBackground, HudChrome, SceneTransitionShell } from '../components/HudStage';
import { COLORS, FONTS, SCENES } from '../theme';

const CALLOUTS = [
  {
    frameAt: 38, // locks right onto 22.20s audio click (f=42)
    tag: 'LAYER 01 // COLOR + CALIBRATION',
    title: '4色・8色変調とパレット自動色補正',
    desc: '上下のパレット帯と最小二乗補正で、画面の色温度変化やボケにも追従。',
    accent: COLORS.cyan,
  },
  {
    frameAt: 164, // locks right onto 24.30s audio click (f=168)
    tag: 'LAYER 02 // ROLLING-SHUTTER PROOF',
    title: 'フレームが途中でちぎれても拾う横帯タイル',
    desc: 'Reed-Solomon + CRC32 の横帯タイル構造。上下に別フレームが混ざっても両方を復号。',
    accent: COLORS.magenta,
  },
  {
    frameAt: 290, // locks right onto 26.40s audio click (f=294)
    tag: 'LAYER 03 // RAPTORQ + FALLBACK MIX',
    title: 'RaptorQ 噴水符号 × 安定フレーム自動混合',
    desc: '取りこぼしも途中参加も補完。スマホ→PC 300KB画像を約38秒で転送し、白黒カメラでも完走。',
    accent: COLORS.ok,
  },
];

export const Scene5Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isLayer1 = frame < 168;
  const isLayer2 = frame >= 168 && frame < 294;
  const isLayer3 = frame >= 294;

  // Layer 1 alternates between 4-color (standard) and 8-color (fast) to demonstrate multi-bit color density!
  const isEightColor = isLayer1 && Math.floor(frame / 48) % 2 === 1;
  // Layer 3 mixes authentic 1-bit B&W `stable` frames during f=332..376 to demonstrate automatic fallback mixing!
  const isBwFallbackRun = isLayer3 && frame >= 332 && frame < 376;

  let bosImageSrc = 'assets/bos/bos-standard-00.png';
  if (isLayer1) {
    const idx = String(Math.floor(frame / 4) % 6).padStart(2, '0');
    bosImageSrc = isEightColor ? `assets/bos/bos-fast-${idx}.png` : `assets/bos/bos-standard-${idx}.png`;
  } else if (isLayer2) {
    bosImageSrc = 'assets/bos/bos-standard-torn.png';
  } else {
    if (isBwFallbackRun) {
      const idx = String(Math.floor((frame - 332) / 4) % 4).padStart(2, '0');
      bosImageSrc = `assets/bos/bos-stable-${idx}.png`;
    } else {
      const idx = String(Math.floor(frame / 4) % 12).padStart(2, '0');
      bosImageSrc = `assets/bos/bos-compact-${idx}.png`;
    }
  }

  const tearLineOpacity = interpolate(frame, [168, 184, 276, 294], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const activeAccent = isLayer2 ? COLORS.magenta : isLayer3 ? COLORS.ok : COLORS.cyan;

  return (
    <AbsoluteFill>
      <CipherBackground backdropOpacity={0} magentaGlow={0.1} cyanGlow={0.14} />
      <HudChrome sectionCode="04 // BOS1 ENGINE" sectionLabel="QRコードの限界を超える独自光学プロトコル" globalStartFrame={SCENES.arch.start} />

      <SceneTransitionShell>
        <AbsoluteFill style={{ padding: '86px 92px 54px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 15, color: COLORS.cyan, letterSpacing: '0.2em', marginBottom: 6 }}>
              WHY NOT PLAIN QR? // BEAMLET OPTICAL STREAM v1
            </div>
            <h2 style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 48, fontWeight: 800, color: COLORS.white }}>
              揺れても、欠けても、ちぎれても。<span style={{ color: COLORS.cyan }}>止まらない光学設計。</span>
            </h2>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48 }}>
            {/* Left: Annotated BOS1 Frame Anatomy — ALL text badges sit in outer top/bottom rails so 780x452 BOS1 plate stays 100% uncovered! */}
            <div style={{ position: 'relative', width: 820, height: 556, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: 780,
                  height: 452,
                  background: '#ffffff',
                  boxShadow: `0 0 0 2px ${activeAccent}, 0 24px 64px rgba(0,0,0,0.72), 0 0 36px ${activeAccent}38`,
                }}
              >
                <Img
                  src={staticFile(bosImageSrc)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                />

                {/* Layer 1: Non-occluding translucent palette highlights between the 7x7 corners + external HUD rails */}
                {frame >= 24 && isLayer1 && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: 78,
                        right: 78,
                        top: 12,
                        height: 20,
                        border: `2px solid ${COLORS.cyan}`,
                        background: 'rgba(62, 242, 255, 0.14)',
                        boxShadow: `0 0 14px ${COLORS.cyan}`,
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: 78,
                        right: 78,
                        bottom: 12,
                        height: 20,
                        border: `2px solid ${COLORS.cyan}`,
                        background: 'rgba(62, 242, 255, 0.14)',
                        boxShadow: `0 0 14px ${COLORS.cyan}`,
                        pointerEvents: 'none',
                      }}
                    />

                    {/* Leader tick from top rail to top palette strip */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 164,
                        top: -12,
                        width: 1.5,
                        height: 24,
                        background: COLORS.cyan,
                      }}
                    />
                    {/* Leader tick from bottom rail to bottom-right 7x7 orientation marker */}
                    <div
                      style={{
                        position: 'absolute',
                        right: 34,
                        bottom: -12,
                        width: 1.5,
                        height: 24,
                        background: COLORS.cyan,
                      }}
                    />

                    {/* External Top Rail (y = -44.. -8): ZERO overlap with white BOS1 plate! */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: -44,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 8, 16, 0.94)',
                          border: `1px solid ${COLORS.cyan}`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: COLORS.cyan,
                        }}
                      >
                        ▼ PALETTE STRIP // 上下パレット色基準帯
                      </div>
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 8, 16, 0.94)',
                          border: `1px solid ${isEightColor ? COLORS.magenta : COLORS.ok}`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isEightColor ? COLORS.magenta : COLORS.ok,
                        }}
                      >
                        {isEightColor ? '● 3-bit 8色変調 (高速モード)' : '● 2-bit 4色変調 (標準モード)'}
                      </div>
                    </div>

                    {/* External Bottom Rail (y = +8.. +44): ZERO overlap with white BOS1 plate! */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -44,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 8, 16, 0.94)',
                          border: `1px solid ${COLORS.cyan}88`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: COLORS.muted,
                        }}
                      >
                        ▲ 最小二乗カラー補正
                      </div>
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 8, 16, 0.94)',
                          border: `1px solid ${COLORS.cyan}`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: COLORS.white,
                        }}
                      >
                        3隅 7×7 ファインダー + 右下 7×7 方向マーカー + 5×5 補正格子 ↗
                      </div>
                    </div>
                  </>
                )}

                {/* Layer 2: Rolling-Shutter Tear Line + Horizontal Tile Hairlines, with all text labels in external top/bottom rails */}
                {tearLineOpacity > 0.01 && (
                  <>
                    {[1, 2, 3, 4, 5, 6, 7].map((row) => (
                      <div
                        key={row}
                        style={{
                          position: 'absolute',
                          left: 16,
                          right: 16,
                          top: `${row * 12.5}%`,
                          height: 1,
                          background: 'rgba(62, 242, 255, 0.34)',
                          opacity: tearLineOpacity * 0.72,
                        }}
                      />
                    ))}
                    <div
                      style={{
                        position: 'absolute',
                        left: -20,
                        right: -20,
                        top: '54%',
                        height: 4,
                        background: COLORS.magenta,
                        boxShadow: `0 0 20px ${COLORS.magenta}, 0 0 6px #fff`,
                        opacity: tearLineOpacity,
                      }}
                    />

                    {/* External Top Rail: Tear explanation + Upper Frame N salvage */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: -44,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: tearLineOpacity,
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(24, 6, 18, 0.95)',
                          border: `1px solid ${COLORS.magenta}`,
                          color: COLORS.magenta,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ROLLING SHUTTER TEAR // 中央 54% でフレーム境界断裂
                      </div>
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 9, 16, 0.95)',
                          border: `1.5px solid ${COLORS.ok}`,
                          color: COLORS.ok,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ▼ 上半分 FRAME N 横帯タイル ✓ RS復号・救出
                      </div>
                    </div>

                    {/* External Bottom Rail: Lower Frame N+1 salvage */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -44,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: tearLineOpacity,
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 9, 16, 0.95)',
                          border: `1px solid ${COLORS.cyan}88`,
                          color: COLORS.muted,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        CRC32 + Reed-Solomon タイル単位検証
                      </div>
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 9, 16, 0.95)',
                          border: `1.5px solid ${COLORS.ok}`,
                          color: COLORS.ok,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ▲ 下半分 FRAME N+1 横帯タイル ✓ RS復号・救出
                      </div>
                    </div>
                  </>
                )}

                {/* Layer 3: RaptorQ Fountain Stream + Live 1-bit B&W Fallback Mix Indicator in External Rails */}
                {isLayer3 && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: -44,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(5, 8, 16, 0.95)',
                          border: `1px solid ${COLORS.ok}`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: COLORS.ok,
                        }}
                      >
                        FOUNTAIN CODES // 欠落・途中参加も自動補完
                      </div>
                      <div
                        style={{
                          padding: '4px 14px',
                          background: 'rgba(5, 8, 16, 0.95)',
                          border: `1.5px solid ${isBwFallbackRun ? COLORS.white : COLORS.cyan}`,
                          fontFamily: FONTS.mono,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isBwFallbackRun ? COLORS.white : COLORS.cyan,
                        }}
                      >
                        {isBwFallbackRun
                          ? '◐ 1-bit 白黒「安定」フレーム自動混合 (カメラ救済)'
                          : '● 2-bit カラーフレーム高速送出 (15 fps)'}
                      </div>
                    </div>

                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -44,
                        padding: '5px 14px',
                        background: 'rgba(5, 7, 13, 0.95)',
                        border: `1px solid ${COLORS.ok}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontFamily: FONTS.mono,
                        fontSize: 12,
                        color: COLORS.text,
                      }}
                    >
                      <span>MODES: 安定 · 小画面 · 標準 · 高速 · 最速</span>
                      <span style={{ color: COLORS.ok, fontWeight: 700 }}>RaptorQ 噴水符号 ・ 最大 100 MB 対応</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: 3 Architectural Callout Cards */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {CALLOUTS.map((c, idx) => {
                const s = spring({ frame: frame - c.frameAt, fps, config: { damping: 18, stiffness: 175 } });
                const isActive =
                  (idx === 0 && isLayer1 && frame >= 24) ||
                  (idx === 1 && isLayer2) ||
                  (idx === 2 && isLayer3);
                return (
                  <BracketPanel
                    key={c.tag}
                    accent={c.accent}
                    glow={isActive}
                    style={{
                      padding: '20px 24px',
                      opacity: interpolate(s, [0, 1], [0.16, 1]),
                      transform: `translateX(${(1 - s) * 32}px)`,
                    }}
                  >
                    <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: c.accent, letterSpacing: '0.16em', marginBottom: 6 }}>
                      {c.tag}
                    </div>
                    <div style={{ fontFamily: FONTS.sans, fontSize: 25, fontWeight: 800, color: COLORS.white, marginBottom: 6 }}>
                      {c.title}
                    </div>
                    <div style={{ fontFamily: FONTS.sans, fontSize: 16, lineHeight: 1.5, color: COLORS.muted }}>
                      {c.desc}
                    </div>
                  </BracketPanel>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
