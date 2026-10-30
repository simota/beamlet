import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BosStreamCanvas } from '../components/BosStreamCanvas';
import { LaptopFrame, PhoneFrame } from '../components/DeviceMockups';
import { CipherBackground, HudChrome, SceneTransitionShell, ViewfinderBrackets } from '../components/HudStage';
import { COLORS, FINGERPRINT, FONTS, SCENES } from '../theme';

export const Scene4Transfer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 14.0s - 21.5s (450 frames):
  // Spatial Continuity (180-degree rule): Left = Laptop Receiver (RX // 01), Right = Phone Sender (TX // 02) — identical to Scene 3!
  // Now the optical BOS1 stream travels RIGHT-TO-LEFT (◀━━) from Phone screen into Laptop camera!
  const isComplete = frame >= 336;
  const pct = isComplete
    ? 100
    : Math.min(99, Math.floor(interpolate(frame, [18, 334], [6, 99], { easing: Easing.inOut(Easing.quad), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));

  const previewVisible = frame >= 114;
  const previewSpring = spring({ frame: frame - 114, fps, config: { damping: 18, stiffness: 175 } });
  const doneSpring = spring({ frame: frame - 336, fps, config: { damping: 15, stiffness: 180 } });

  const handheldSway = isComplete ? 0 : Math.sin(frame * 0.09) * 1.0;
  const laptopZoom = isComplete ? 1 + 0.015 * doneSpring : 1;

  return (
    <AbsoluteFill>
      <CipherBackground backdropOpacity={0.12} backdropFocusX="42%" magentaGlow={0.1} cyanGlow={0.14} />
      <HudChrome sectionCode="03 // OPTICAL STREAM" sectionLabel="かざすだけで、先行プレビューから順に届く" globalStartFrame={SCENES.transfer.start} />

      <SceneTransitionShell>
        <AbsoluteFill style={{ padding: '84px 82px 52px', display: 'flex', flexDirection: 'column' }}>
          {/* Headline */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 15, color: isComplete ? COLORS.ok : COLORS.cyan, letterSpacing: '0.18em', marginBottom: 6 }}>
                {isComplete
                  ? 'STEP 02 COMPLETE // 改ざん検証まで完了 ✓'
                  : '◀━━ STEP 02 // 今度は送信スマホの画面を、受信PCのカメラへかざす'}
              </div>
              <h2 style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 46, fontWeight: 800, color: COLORS.white }}>
                {isComplete ? (
                  <>
                    検証まで完了。<span style={{ color: COLORS.ok }}>その場でファイルを保存。</span>
                  </>
                ) : (
                  <>
                    画面をかざすだけ。<span style={{ color: COLORS.cyan }}>プレビューから先に届く。</span>
                  </>
                )}
              </h2>
            </div>

            <div
              style={{
                padding: '10px 20px',
                background: isComplete ? 'rgba(93, 255, 154, 0.14)' : 'rgba(62, 242, 255, 0.09)',
                border: `1px solid ${isComplete ? COLORS.ok : COLORS.cyan}`,
                fontFamily: FONTS.sans,
                fontSize: 17,
                fontWeight: 700,
                color: isComplete ? COLORS.ok : COLORS.cyan,
                boxShadow: isComplete ? `0 0 22px rgba(93, 255, 154, 0.25)` : undefined,
              }}
            >
              {isComplete ? '✓ すべて受信しました（309.0 KB）' : `先行プレビュー表示済 ・ RaptorQ 復元中 // ${pct}%`}
            </div>
          </div>

          {/* Main Stage: Left Laptop Receiver (RX // 01) ◀━━ Photonic Rays ◀━━ Right Phone Sender (TX // 02) */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
            {/* Left: Laptop Receiver Live Interactive-Faithful Beamlet HUD */}
            <LaptopFrame
              width={960}
              height={616}
              label="RX // 01  受信側（PC：Web Worker リアルタイム追跡・復号）"
              accent={isComplete ? COLORS.ok : COLORS.cyan}
              style={{
                transform: `scale(${laptopZoom})`,
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '20px 30px',
                  background: COLORS.bg,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: isComplete ? `inset 0 0 36px rgba(93, 255, 154, 0.18)` : undefined,
                }}
              >
                {/* Top Webcam Viewfinder: Distinct smartphone chassis silhouette + green quad tracking lock! */}
                <div
                  style={{
                    position: 'relative',
                    height: 224,
                    background: 'radial-gradient(ellipse at 50% 50%, #111e32 0%, #050811 76%)',
                    border: `1.5px solid ${isComplete ? COLORS.ok : COLORS.line}`,
                    boxShadow: isComplete ? `0 0 24px rgba(93, 255, 154, 0.32)` : undefined,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {/* Visible smartphone chassis silhouette inside camera feed */}
                  <div
                    style={{
                      position: 'relative',
                      padding: '13px 8px 15px',
                      borderRadius: 15,
                      background: 'linear-gradient(160deg, #253549 0%, #0e1622 100%)',
                      border: '1.5px solid rgba(215, 247, 255, 0.38)',
                      transform: `rotate(${handheldSway}deg)`,
                      boxShadow: '0 10px 32px rgba(0,0,0,0.75), 0 0 24px rgba(62,242,255,0.18)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    {/* Phone earpiece bar */}
                    <div style={{ width: 22, height: 3, borderRadius: 2, background: 'rgba(215,247,255,0.35)', marginBottom: 5 }} />
                    <div style={{ position: 'relative' }}>
                      <BosStreamCanvas
                        mode="compact-rot"
                        width={108}
                        height={176}
                        fpsRate={15}
                        borderGlow="rgba(93,255,154,0.35)"
                      />
                      {/* Authentic receive.js green quad tracking overlay */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: -2,
                          border: `2px solid ${COLORS.ok}`,
                          boxShadow: `0 0 14px ${COLORS.ok}88`,
                          pointerEvents: 'none',
                        }}
                      >
                        {[
                          { top: -4, left: -4 },
                          { top: -4, right: -4 },
                          { bottom: -4, left: -4 },
                          { bottom: -4, right: -4 },
                        ].map((pos, idx) => (
                          <div
                            key={idx}
                            style={{
                              position: 'absolute',
                              width: 7,
                              height: 7,
                              background: COLORS.ok,
                              boxShadow: `0 0 8px ${COLORS.ok}`,
                              ...pos,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Left & Right Camera Telemetry Overlays */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 24,
                      top: 20,
                      fontFamily: FONTS.mono,
                      fontSize: 12,
                      color: COLORS.ok,
                      letterSpacing: '0.12em',
                      lineHeight: 1.7,
                    }}
                  >
                    <div>● CAM FEED // 1080p</div>
                    <div style={{ color: COLORS.muted }}>90° PORTRAIT DETECTED</div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      right: 24,
                      bottom: 18,
                      fontFamily: FONTS.mono,
                      fontSize: 12,
                      color: COLORS.cyan,
                      letterSpacing: '0.12em',
                      textAlign: 'right',
                      lineHeight: 1.7,
                    }}
                  >
                    <div style={{ color: COLORS.ok }}>QUAD TRACKING LOCK ✓</div>
                    <div style={{ color: COLORS.muted }}>{isComplete ? '9/9 TILES VERIFIED' : '8/9 TILES · 11 ms'}</div>
                  </div>

                  <div style={{ position: 'absolute', inset: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ViewfinderBrackets width={856} height={196} color={COLORS.ok} cornerSize={24} thickness={3} showReticle={false} />
                  </div>
                </div>

                {/* Fingerprint + Live Telemetry Status (Accurate 29.8 fps camera decode rate per receive.js!) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 15, color: COLORS.muted }}>確認番号</span>
                    <span
                      style={{
                        padding: '4px 12px',
                        border: `1px solid ${COLORS.cyan}`,
                        background: '#071019',
                        fontFamily: FONTS.mono,
                        fontSize: 20,
                        fontWeight: 700,
                        letterSpacing: '0.24em',
                        color: COLORS.white,
                      }}
                    >
                      {FINGERPRINT}
                    </span>
                  </div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 15, color: isComplete ? COLORS.ok : COLORS.text }}>
                    <span style={{ color: COLORS.ok }}>&gt; </span>
                    {isComplete
                      ? 'すべて受信しました。保存リンクから各ファイルを保存してください。'
                      : `受信中 — 8/9 タイル、解析 11 ms（追跡）、29.8 fps`}
                  </div>
                </div>

                {/* Authentic File Progress Cards (#files .file) with Plain-Japanese Explanation */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      fontFamily: FONTS.mono,
                      fontSize: 15,
                      border: `1px solid ${COLORS.line}`,
                      borderLeft: `4px solid ${frame > 75 ? COLORS.ok : COLORS.cyan}`,
                      background: frame > 75 ? 'rgba(93, 255, 154, 0.09)' : 'rgba(62, 242, 255, 0.12)',
                      color: frame > 75 ? COLORS.cyan : COLORS.text,
                      fontWeight: frame > 75 ? 700 : 500,
                    }}
                  >
                    {frame > 75 ? '✓ deploy-keys.json（4.8 KB） を保存' : `deploy-keys.json（4.8 KB） — ${Math.min(99, frame * 2)}%`}
                  </div>

                  <div
                    style={{
                      padding: '12px 16px',
                      fontFamily: FONTS.mono,
                      fontSize: 16,
                      border: `1px solid ${isComplete ? COLORS.ok : COLORS.line}`,
                      borderLeft: `4px solid ${isComplete ? COLORS.ok : COLORS.cyan}`,
                      background: isComplete
                        ? 'rgba(93, 255, 154, 0.11)'
                        : `linear-gradient(90deg, rgba(62, 242, 255, 0.18) ${pct}%, rgba(5, 10, 18, 0.75) ${pct}%)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 20,
                    }}
                  >
                    <div>
                      <div style={{ color: isComplete ? COLORS.cyan : COLORS.white, fontWeight: 700, marginBottom: 6 }}>
                        {isComplete
                          ? '✓ fuji-dusk.webp（304.2 KB） を保存'
                          : `fuji-dusk.webp（304.2 KB） — ${pct}%`}
                      </div>
                      <div style={{ fontFamily: FONTS.sans, fontSize: 14, color: isComplete ? COLORS.ok : COLORS.muted }}>
                        {isComplete
                          ? '認証付き暗号（ChaCha20-Poly1305）検証 OK ・ 改ざんゼロ'
                          : previewVisible
                            ? '本体が届く前に、縮小プレビューを先行表示中…'
                            : 'ファイル一覧と縮小プレビューを受信しています…'}
                      </div>
                    </div>

                    {previewVisible && (
                      <div
                        style={{
                          position: 'relative',
                          width: 248,
                          height: 138,
                          overflow: 'hidden',
                          border: `1.5px solid ${isComplete ? COLORS.ok : COLORS.cyan}`,
                          boxShadow: isComplete ? `0 0 20px rgba(93,255,154,0.35)` : undefined,
                          transform: `scale(${0.9 + 0.1 * previewSpring})`,
                          opacity: previewSpring,
                          flexShrink: 0,
                        }}
                      >
                        <Img
                          src={staticFile('assets/sample-photo.jpg')}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: isComplete ? 1 : 0.76,
                          }}
                        />
                        {!isComplete && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(5, 7, 13, 0.65) 2px 4px)',
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </LaptopFrame>

            {/* Center: Photonic Data Packets Streaming RIGHT-TO-LEFT (◀━━) from Phone Screen into Laptop Camera! */}
            <div style={{ flex: 1, height: 320, position: 'relative', margin: '0 18px', overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: '40px 0',
                  background: isComplete
                    ? 'linear-gradient(270deg, rgba(93,255,154,0.20), rgba(93,255,154,0.05))'
                    : 'linear-gradient(270deg, rgba(255,62,200,0.25), rgba(62,242,255,0.22), rgba(93,255,154,0.16))',
                  clipPath: 'polygon(0% 34%, 100% 12%, 100% 88%, 0% 66%)',
                }}
              />
              {!isComplete &&
                [0, 1, 2, 3, 4, 5].map((lane) => {
                  const p = ((frame * 0.042 + lane * 0.17) % 1);
                  const y = 72 + lane * 32;
                  const colors = [COLORS.cyan, COLORS.magenta, COLORS.white, COLORS.ok];
                  const col = colors[lane % colors.length];
                  return (
                    <div
                      key={lane}
                      style={{
                        position: 'absolute',
                        left: `${(1 - p) * 90}%`,
                        top: y,
                        width: 38,
                        height: 6,
                        borderRadius: 3,
                        background: col,
                        boxShadow: `0 0 14px ${col}`,
                        opacity: Math.sin(p * Math.PI),
                      }}
                    />
                  );
                })}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: FONTS.mono,
                  fontSize: 13,
                  fontWeight: 700,
                  color: COLORS.cyan,
                  whiteSpace: 'nowrap',
                }}
              >
                ◀━━ 光ストリーム（片方向）
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 18,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: FONTS.mono,
                  fontSize: 13,
                  color: isComplete ? COLORS.ok : COLORS.muted,
                  whiteSpace: 'nowrap',
                  background: 'rgba(5, 7, 13, 0.92)',
                  padding: '4px 12px',
                  border: `1px solid ${isComplete ? COLORS.ok + '88' : COLORS.line}`,
                }}
              >
                {isComplete ? '✓ RaptorQ 復号完了 ・ 欠損ゼロ' : '追跡デコード 約 11 ms / フレーム'}
              </div>
            </div>

            {/* Right: Smartphone in Full-Screen #stage — Unidirectional Air-Gap Truthfulness (Interior NEVER mutates!) */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <PhoneFrame
                width={332}
                height={656}
                label="TX // 02  送信側（縦画面90°回転描画）"
                accent={COLORS.magenta}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 8px 26px',
                    position: 'relative',
                  }}
                >
                  <BosStreamCanvas
                    mode="compact-rot"
                    width={292}
                    height={496}
                    fpsRate={15}
                    borderGlow="transparent"
                    style={{ boxShadow: 'none' }}
                  />
                  {/* Exact unchanged #hint from web/send.html, lifted safely clear of rounded bezel corners! */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 18,
                      left: 16,
                      right: 16,
                      textAlign: 'center',
                      fontFamily: FONTS.sans,
                      fontSize: 10,
                      color: '#555555',
                    }}
                  >
                    受信側に「すべて受信しました」と出たらタップして終了
                  </div>
                </div>
              </PhoneFrame>

              {/* External HUD note outside bezel upon completion — preserving 100% air-gap protocol fidelity! */}
              {isComplete && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -34,
                    padding: '4px 12px',
                    background: 'rgba(6, 12, 22, 0.95)',
                    border: `1px solid ${COLORS.ok}88`,
                    fontFamily: FONTS.sans,
                    fontSize: 12,
                    fontWeight: 700,
                    color: COLORS.ok,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ▲ PCの完了表示を見てタップで終了（逆方向通信ゼロ）
                </div>
              )}
            </div>
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
