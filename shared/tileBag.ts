import type { Tile } from "./types";

const DISTRIBUTION: Record<string, number> = {
  A: 9,
  B: 2,
  C: 2,
  D: 4,
  E: 12,
  F: 2,
  G: 3,
  H: 2,
  I: 9,
  J: 1,
  K: 1,
  L: 4,
  M: 2,
  N: 6,
  O: 8,
  P: 2,
  Q: 1,
  R: 6,
  S: 4,
  T: 6,
  U: 4,
  V: 2,
  W: 2,
  X: 1,
  Y: 2,
  Z: 1
};

export function createTileBag(): Tile[] {
  const tiles: Tile[] = [];
  let counter = 0;
  Object.entries(DISTRIBUTION).forEach(([letter, count]) => {
    for (let i = 0; i < count; i += 1) {
      tiles.push({ id: `${letter}-${counter++}`, letter });
    }
  });

  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles;
}
