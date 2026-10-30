import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { LaptopFrame, PhoneFrame } from '../components/DeviceMockups';
import { BracketPanel, CipherBackground, HudChrome, SceneTransitionShell } from '../components/HudStage';
import { COLORS, FINGERPRINT, FONTS, SCENES } from '../theme';

export const Scene3Handshake: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Audio events in Scene 3 (starts at 8.00s = global 480):
  // 8.00s (f=0): Stage sub hit
  // 9.50s - 9.61s (f=90..97): QR Scan pluck -> sweep active across f=60..122 so 9.8s (f=108) visibly shows scan + waiting state!
  // 11.00s - 11.08s (f=180..185): Dual-screen 667855 verification chime!
  const laptopEnter = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 150 } });
  const phoneEnter = spring({ frame: frame - 22, fps, config: { damping: 18, stiffness: 150 } });

  const scanBeam = interpolate(frame, [60, 122], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const qrScanned = frame >= 120;
  const modePicked = spring({ frame: frame - 120, fps, config: { damping: 17, stiffness: 175 } });
  const fpMatch = spring({ frame: frame - 178, fps, config: { damping: 15, stiffness: 180 } });

  return (
    <AbsoluteFill>
      <CipherBackground backdropOpacity={0.12} backdropFocusX="50%" magentaGlow={0.1} cyanGlow={0.12} />
      <HudChrome sectionCode="02 // KEY EXCHANGE" sectionLabel="使い捨て公開鍵 QR と 6桁の確認番号" globalStartFrame={SCENES.handshake.start} />

      <SceneTransitionShell>
        <AbsoluteFill style={{ padding: '84px 84px 52px', display: 'flex', flexDirection: 'column' }}>
          {/* Header Copy */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 15, color: COLORS.magenta, letterSpacing: '0.2em', marginBottom: 6 }}>
                STEP 01 // 受信PCの公開鍵QRを、送信スマホでスキャン ──▶
              </div>
              <h2 style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 46, fontWeight: 800, color: COLORS.white }}>
                1回限りの鍵QRを読み取り、<span style={{ color: COLORS.cyan }}>6桁の一致</span>を確認。
              </h2>
            </div>

            <BracketPanel
              accent={fpMatch > 0.1 ? COLORS.ok : COLORS.cyan}
              glow={fpMatch > 0.1}
              style={{
                padding: '10px 22px',
                opacity: interpolate(frame, [95, 124], [0, 1], { extrapolateRight: 'clamp' }),
                transform: `scale(${0.95 + 0.05 * fpMatch})`,
              }}
            >
              <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, letterSpacing: '0.18em' }}>
                VISUAL FINGERPRINT CHECK
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 3 }}>
                <span style={{ fontFamily: FONTS.sans, fontSize: 16, color: COLORS.text }}>確認番号</span>
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 30,
                    fontWeight: 800,
                    letterSpacing: '0.24em',
                    color: COLORS.white,
                    textShadow: `0 0 16px ${fpMatch > 0.2 ? COLORS.ok : COLORS.cyan}`,
                  }}
                >
                  {FINGERPRINT}
                </span>
                {fpMatch > 0.2 && (
                  <span style={{ fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, color: COLORS.ok }}>
                    ✓ 一致確認
                  </span>
                )}
              </div>
            </BracketPanel>
          </div>

          {/* Dual Device Stage + Center Handshake Step Conduit (Left = Laptop RX, Right = Phone TX) */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 22 }}>
            {/* Left: Laptop Receiver */}
            <div
              style={{
                opacity: laptopEnter,
                transform: `translateX(${(1 - laptopEnter) * -36}px)`,
              }}
            >
              <LaptopFrame width={860} height={560} label="RX // 01  受信側（PC：公開鍵QRを表示）" accent={COLORS.cyan}>
                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: COLORS.bg }}>
                  <Img
                    src={staticFile('assets/ui/receive-key.png')}
                    style={{
                      width: '108%',
                      height: '126%',
                      objectFit: 'cover',
                      objectPosition: 'center 2%',
                      transform: 'translate(-3.5%, 10px)',
                    }}
                  />
                  {/* Magenta laser scan sweep across QR at f=60..122 (visible at 9.8s = f=108!) */}
                  {frame >= 60 && frame <= 122 && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 112,
                        width: 315,
                        top: 152 + scanBeam * 282,
                        height: 4,
                        background: COLORS.magenta,
                        boxShadow: `0 0 24px ${COLORS.magenta}, 0 0 8px #fff`,
                      }}
                    />
                  )}
                  {/* Sub-pixel exact green verification ring around Laptop's 667855 box! */}
                  {fpMatch > 0.15 && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 484,
                        top: 226,
                        width: 190,
                        height: 45,
                        border: `2.5px solid ${COLORS.ok}`,
                        boxShadow: `0 0 20px ${COLORS.ok}, inset 0 0 12px rgba(93,255,154,0.28)`,
                        borderRadius: 3,
                        opacity: fpMatch,
                        transform: `scale(${1.06 - 0.06 * fpMatch})`,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </div>
              </LaptopFrame>
            </div>

            {/* Center: Symmetrically Spaced 3-Step Handshake Conduit */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, zIndex: 20, padding: '0 8px' }}>
              <BracketPanel
                accent={COLORS.cyan}
                glow={frame >= 56 && frame < 122}
                style={{
                  padding: '14px 18px',
                  opacity: interpolate(frame, [38, 60], [0.25, 1], { extrapolateRight: 'clamp' }),
                }}
              >
                <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.cyan, letterSpacing: '0.15em' }}>
                  01 // PUBLIC KEY + CAPS
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 18, fontWeight: 700, color: COLORS.white, marginTop: 4 }}>
                  公開鍵QRをスマホで読取 ──▶
                </div>
              </BracketPanel>

              <BracketPanel
                accent={COLORS.magenta}
                glow={modePicked > 0.2 && fpMatch < 0.2}
                style={{
                  padding: '14px 18px',
                  opacity: 0.2 + 0.8 * modePicked,
                  transform: `translateY(${(1 - modePicked) * 12}px)`,
                }}
              >
                <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.magenta, letterSpacing: '0.15em' }}>
                  02 // AUTO MODE + PRIVACY
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 17, fontWeight: 700, color: COLORS.white, marginTop: 4 }}>
                  「小画面・15fps」自動選択
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                  写真は位置情報EXIFを自動削除
                </div>
              </BracketPanel>

              <BracketPanel
                accent={COLORS.ok}
                glow={fpMatch > 0.2}
                style={{
                  padding: '14px 18px',
                  opacity: 0.2 + 0.8 * fpMatch,
                  transform: `translateY(${(1 - fpMatch) * 12}px)`,
                }}
              >
                <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.ok, letterSpacing: '0.15em' }}>
                  03 // 6-DIGIT VERIFIED
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 22, fontWeight: 800, color: COLORS.ok, marginTop: 4, letterSpacing: '0.12em' }}>
                  {FINGERPRINT} === {FINGERPRINT}
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 14, color: COLORS.text, marginTop: 2 }}>
                  両画面の一致でなりすまし防止
                </div>
              </BracketPanel>
            </div>

            {/* Right: Smartphone Sender */}
            <div
              style={{
                opacity: phoneEnter,
                transform: `translateX(${(1 - phoneEnter) * 36}px)`,
                position: 'relative',
              }}
            >
              <PhoneFrame width={332} height={684} label="TX // 02  送信側（スマホ：QRを読取）" accent={COLORS.magenta}>
                <div style={{ position: 'relative', width: '100%', height: '100%', background: COLORS.bg }}>
                  <Img
                    src={staticFile('assets/ui/send-ready-mobile.png')}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      background: COLORS.bg,
                    }}
                  />

                  {/* Before QR scan completes (f < 120), mask Step 2 & Step 3 so 667855 only appears AFTER scanning! */}
                  {!qrScanned && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 8,
                        right: 8,
                        top: '50.2%',
                        bottom: 8,
                        background: 'rgba(6, 10, 18, 0.96)',
                        borderTop: `1px solid ${COLORS.cyan}66`,
                        padding: '16px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ border: `1px solid ${COLORS.cyan}`, padding: '14px 12px', background: '#081322', boxShadow: '0 0 16px rgba(62,242,255,0.18)' }}>
                        <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.cyan, fontWeight: 700 }}>
                          // 2. 受信側の QR コードを読む
                        </div>
                        <div style={{ fontFamily: FONTS.sans, fontSize: 13, color: COLORS.white, marginTop: 10, fontWeight: 700 }}>
                          ● 背面カメラで公開鍵QRをスキャン中…
                        </div>
                      </div>
                      <div style={{ border: `1px solid ${COLORS.line}`, padding: '14px 12px', opacity: 0.45 }}>
                        <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>
                          // 3. 確認して送信（QR読み取り待ち）
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tightly fitted green verification highlight on Phone's 667855 at f>=178! */}
                  {fpMatch > 0.15 && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 84,
                        top: 524,
                        width: 152,
                        height: 36,
                        border: `2.5px solid ${COLORS.ok}`,
                        boxShadow: `0 0 16px ${COLORS.ok}, inset 0 0 10px rgba(93,255,154,0.25)`,
                        borderRadius: 3,
                        opacity: fpMatch,
                        transform: `scale(${1.06 - 0.06 * fpMatch})`,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </div>
              </PhoneFrame>
            </div>
          </div>
        </AbsoluteFill>
      </SceneTransitionShell>
    </AbsoluteFill>
  );
};
