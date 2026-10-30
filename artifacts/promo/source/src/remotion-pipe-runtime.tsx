import React, { createContext, useContext } from 'react';
import type { Easing as EasingType, interpolate as InterpolateType, spring as SpringType } from 'remotion';
// @ts-expect-error ESM math bundle lacks sibling .d.mts; typed via remotion above
import { Easing as _Easing, interpolate as _interpolate, spring as _spring } from '../node_modules/remotion/dist/esm/index.mjs';
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './theme';

export const Easing: typeof EasingType = _Easing;
export const interpolate: typeof InterpolateType = _interpolate;
export const spring: typeof SpringType = _spring;

interface TimelineCtx {
  frame: number;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}

const FrameContext = createContext<TimelineCtx>({
  frame: 0,
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  durationInFrames: TOTAL_FRAMES,
});

export const FrameProvider: React.FC<{ frame: number; children: React.ReactNode }> = ({ frame, children }) => (
  <FrameContext.Provider value={{ frame, fps: FPS, width: WIDTH, height: HEIGHT, durationInFrames: TOTAL_FRAMES }}>
    {children}
  </FrameContext.Provider>
);

export const useCurrentFrame = (): number => useContext(FrameContext).frame;
export const useVideoConfig = () => {
  const ctx = useContext(FrameContext);
  return {
    fps: ctx.fps,
    width: ctx.width,
    height: ctx.height,
    durationInFrames: ctx.durationInFrames,
    id: 'BeamletPromo',
    defaultProps: {},
    props: {},
    defaultCodec: 'h264',
  };
};

export const AbsoluteFill: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  children: React.ReactNode;
}> = ({ from = 0, durationInFrames = Infinity, children }) => {
  const parent = useContext(FrameContext);
  const rel = parent.frame - from;
  if (rel < 0 || rel >= durationInFrames) return null;
  return (
    <FrameContext.Provider value={{ ...parent, frame: rel, durationInFrames }}>
      <AbsoluteFill>{children}</AbsoluteFill>
    </FrameContext.Provider>
  );
};

export const staticFile = (relPath: string): string => {
  const clean = relPath.replace(/^\/+/, '');
  return `http://localhost:9876/${clean}`;
};

export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = (props) => <img {...props} decoding="sync" />;

export const Audio: React.FC<{ src: string; volume?: number }> = () => null;

export const Composition: React.FC<Record<string, unknown>> = () => null;
export const registerRoot = (_comp: unknown): void => {};
