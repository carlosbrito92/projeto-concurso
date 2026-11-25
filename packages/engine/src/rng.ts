/** Aleatoriedade determinística. Mesma semente, mesmo resultado, em servidor e cliente. */

export type Rng = () => number;

/** mulberry32: gerador de 32 bits pequeno e rápido (algoritmo público). Devolve números em [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Converte semente textual ou numérica em inteiro de 32 bits (FNV-1a). */
export function hashSemente(semente: string | number): number {
  const s = String(semente);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function criarRng(semente: string | number): Rng {
  return mulberry32(hashSemente(semente));
}

/** Fisher–Yates. Não altera a entrada. */
export function embaralhar<T>(lista: readonly T[], rng: Rng): T[] {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}
