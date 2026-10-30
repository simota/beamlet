import { existsSync } from 'node:fs';
import path from 'node:path';
import { Config } from '@remotion/cli/config';

if (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
  Config.setBrowserExecutable(path.resolve(process.cwd(), 'scripts/chrome-wrapper.sh'));
}
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(96);
Config.setConcurrency(4);
