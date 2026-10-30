import React from 'react';
import { Composition } from 'remotion';
import { BeamletPromo } from './BeamletPromo';
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BeamletPromo"
        component={BeamletPromo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
