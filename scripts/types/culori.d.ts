// culori ships runtime ESM without bundled type declarations under this resolution; we only use a
// tiny, stable surface (converters + CIEDE2000) in build/test tooling, so a permissive shim is enough.
declare module 'culori' {
  export type Color = { mode: string; [channel: string]: number | string | undefined };
  export function converter(mode: string): (color: string | Color) => Color;
  export function differenceCiede2000(): (a: Color, b: Color) => number;
}
