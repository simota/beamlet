import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { OpticalCutFlash } from './components/HudStage';
import { Scene1Hook } from './scenes/Scene1Hook';
import { Scene2Problem } from './scenes/Scene2Problem';
import { Scene3Handshake } from './scenes/Scene3Handshake';
import { Scene4Transfer } from './scenes/Scene4Transfer';
import { Scene5Architecture } from './scenes/Scene5Architecture';
import { Scene6Security } from './scenes/Scene6Security';
import { Scene7ClimaxCta } from './scenes/Scene7ClimaxCta';
import { COLORS, SCENES } from './theme';

export const BeamletPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <Audio src={staticFile('assets/soundtrack.wav')} volume={1} />

      <Sequence from={SCENES.hook.start} durationInFrames={SCENES.hook.duration}>
        <Scene1Hook />
      </Sequence>

      <Sequence from={SCENES.problem.start} durationInFrames={SCENES.problem.duration}>
        <Scene2Problem />
      </Sequence>

      <Sequence from={SCENES.handshake.start} durationInFrames={SCENES.handshake.duration}>
        <Scene3Handshake />
      </Sequence>

      <Sequence from={SCENES.transfer.start} durationInFrames={SCENES.transfer.duration}>
        <Scene4Transfer />
      </Sequence>

      <Sequence from={SCENES.arch.start} durationInFrames={SCENES.arch.duration}>
        <Scene5Architecture />
      </Sequence>

      <Sequence from={SCENES.security.start} durationInFrames={SCENES.security.duration}>
        <Scene6Security />
      </Sequence>

      <Sequence from={SCENES.climax.start} durationInFrames={SCENES.climax.duration}>
        <Scene7ClimaxCta />
      </Sequence>

      <OpticalCutFlash
        triggers={[
          { frame: 0, tone: 'cyan' },
          { frame: SCENES.problem.start, tone: 'crimson' },
          { frame: SCENES.problem.start + 126, tone: 'cyan' },
          { frame: SCENES.handshake.start, tone: 'cyan' },
          { frame: SCENES.transfer.start, tone: 'cyan' },
          { frame: SCENES.transfer.start + 336, tone: 'cyan' },
          { frame: SCENES.arch.start, tone: 'cyan' },
          { frame: SCENES.security.start, tone: 'cyan' },
          { frame: SCENES.climax.start, tone: 'cyan' },
        ]}
      />
    </AbsoluteFill>
  );
};
