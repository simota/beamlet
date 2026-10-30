declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export function createRoot(container: Element | DocumentFragment): {
    render(children: ReactNode): void;
    unmount(): void;
  };
}

declare module 'react-dom' {
  export function flushSync<R>(fn: () => R): R;
}

declare module '../node_modules/remotion/dist/esm/index.mjs' {
  export const Easing: typeof import('remotion').Easing;
  export const interpolate: typeof import('remotion').interpolate;
  export const spring: typeof import('remotion').spring;
}
