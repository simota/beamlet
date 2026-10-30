import React from 'react';
import { COLORS, FONTS } from '../theme';

export const LaptopFrame: React.FC<{
  width: number;
  height: number;
  label?: string;
  accent?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, label = 'RX // 01  RECEIVER (PC / PWA)', accent = COLORS.cyan, children, style }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...style }}>
      {label && (
        <div
          style={{
            alignSelf: 'flex-start',
            marginBottom: 10,
            padding: '4px 12px',
            fontFamily: FONTS.mono,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.16em',
            color: accent,
            background: 'rgba(8, 16, 28, 0.9)',
            border: `1px solid ${accent}88`,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          width,
          height,
          borderRadius: 16,
          padding: 12,
          background: 'linear-gradient(160deg, #1b2838 0%, #0a1019 60%, #142230 100%)',
          border: `1.5px solid rgba(138, 164, 180, 0.35)`,
          boxShadow: `0 28px 70px rgba(0, 0, 0, 0.72), 0 0 36px ${accent}22`,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Webcam lens indicator */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            height: 12,
            marginBottom: 4,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#223344', border: '1px solid #446688' }} />
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: COLORS.ok,
              boxShadow: `0 0 8px ${COLORS.ok}`,
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            borderRadius: 8,
            overflow: 'hidden',
            background: COLORS.bg,
            position: 'relative',
            border: '1px solid #132230',
          }}
        >
          {children}
        </div>
      </div>
      {/* Laptop aluminum base lip */}
      <div
        style={{
          width: width * 1.1,
          height: 12,
          background: 'linear-gradient(90deg, #141e2b, #2b3f54 50%, #141e2b)',
          borderRadius: '0 0 12px 12px',
          borderTop: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 14px 30px rgba(0,0,0,0.65)',
        }}
      />
    </div>
  );
};

export const PhoneFrame: React.FC<{
  width: number;
  height: number;
  label?: string;
  accent?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, label = 'TX // 02  SENDER (PHONE / PWA)', accent = COLORS.magenta, children, style }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...style }}>
      {label && (
        <div
          style={{
            marginBottom: 10,
            padding: '4px 12px',
            fontFamily: FONTS.mono,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.16em',
            color: accent,
            background: 'rgba(8, 16, 28, 0.9)',
            border: `1px solid ${accent}88`,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          width,
          height,
          borderRadius: 34,
          padding: 10,
          background: 'linear-gradient(155deg, #223042 0%, #090e17 55%, #1c2838 100%)',
          border: `1.5px solid rgba(215, 247, 255, 0.28)`,
          boxShadow: `0 28px 64px rgba(0, 0, 0, 0.75), 0 0 34px ${accent}28`,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: 1,
            borderRadius: 25,
            overflow: 'hidden',
            background: COLORS.bg,
            position: 'relative',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
