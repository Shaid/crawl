/**
 * Okumura-style LZHUF (LZSS + adaptive Huffman) decoder, as used by the BT3 `maps.hi` / `maps.lo`
 * records (`[u32 size][stream]`, docs/bardstale-picture-format.md §8): ring buffer N=4096 initialised
 * with spaces, F=60, THRESHOLD=2, 314 symbols, MSB-first bit reader. Written from the published
 * algorithm description, independently of the picture codec in `tools/shared/bardstale-codecs.ts`.
 */
const N = 4096;
const F = 60;
const THRESHOLD = 2;
const N_CHAR = 256 - THRESHOLD + F; // 314
const T = N_CHAR * 2 - 1; // 627
const R = T - 1; // 626
const MAX_FREQ = 0x8000;

// Position prefix code: 64 codes (c = 0..63) over the first 8 bits, lengths 3..8.
const D_CODE = new Uint8Array(256);
const D_LEN = new Uint8Array(256);
(() => {
  let idx = 0;
  let c = 0;
  for (const [len, codes] of [[3, 1], [4, 3], [5, 8], [6, 12], [7, 24], [8, 16]] as const) {
    for (let k = 0; k < codes; k++, c++)
      for (let e = 0; e < 1 << (8 - len); e++) {
        D_CODE[idx] = c;
        D_LEN[idx] = len;
        idx++;
      }
  }
})();

export function lzhufDecode(src: Uint8Array, start: number, outSize: number): { data: Uint8Array; consumed: number } {
  const freq = new Uint16Array(T + 1);
  const prnt = new Uint16Array(T + N_CHAR);
  const son = new Uint16Array(T);
  let pos = start;
  let bitBuf = 0;
  let bitLen = 0;
  const getBit = (): number => {
    while (bitLen <= 8) {
      bitBuf |= (pos < src.length ? src[pos]! : 0) << (8 - bitLen);
      pos++;
      bitLen += 8;
    }
    const b = (bitBuf >> 15) & 1;
    bitBuf = (bitBuf << 1) & 0xffff;
    bitLen--;
    return b;
  };
  const getByte = (): number => {
    while (bitLen <= 8) {
      bitBuf |= (pos < src.length ? src[pos]! : 0) << (8 - bitLen);
      pos++;
      bitLen += 8;
    }
    const b = (bitBuf >> 8) & 0xff;
    bitBuf = (bitBuf << 8) & 0xffff;
    bitLen -= 8;
    return b;
  };

  for (let i = 0; i < N_CHAR; i++) {
    freq[i] = 1;
    son[i] = i + T;
    prnt[i + T] = i;
  }
  for (let i = 0, j = N_CHAR; j <= R; i += 2, j++) {
    freq[j] = freq[i]! + freq[i + 1]!;
    son[j] = i;
    prnt[i] = prnt[i + 1] = j;
  }
  freq[T] = 0xffff;
  prnt[R] = 0;

  const reconst = () => {
    let j = 0;
    for (let i = 0; i < T; i++)
      if (son[i]! >= T) {
        freq[j] = (freq[i]! + 1) >> 1;
        son[j] = son[i]!;
        j++;
      }
    for (let i = 0, jj = N_CHAR; jj < T; i += 2, jj++) {
      const f = (freq[jj] = freq[i]! + freq[i + 1]!);
      let k = jj - 1;
      while (f < freq[k]!) k--;
      k++;
      for (let m = jj; m > k; m--) {
        freq[m] = freq[m - 1]!;
        son[m] = son[m - 1]!;
      }
      freq[k] = f;
      son[k] = i;
    }
    for (let i = 0; i < T; i++) {
      const k = son[i]!;
      if (k >= T) prnt[k] = i;
      else prnt[k] = prnt[k + 1] = i;
    }
  };
  const update = (c0: number) => {
    if (freq[R] === MAX_FREQ) reconst();
    let c = prnt[c0 + T]!;
    do {
      const k = ++freq[c]!;
      let l = c + 1;
      if (k > freq[l]!) {
        while (k > freq[++l]!);
        l--;
        freq[c] = freq[l]!;
        freq[l] = k;
        const i = son[c]!;
        prnt[i] = l;
        if (i < T) prnt[i + 1] = l;
        const j = son[l]!;
        son[l] = i;
        prnt[j] = c;
        if (j < T) prnt[j + 1] = c;
        son[c] = j;
        c = l;
      }
      c = prnt[c]!;
    } while (c !== 0);
  };
  const decodeChar = (): number => {
    let c = son[R]!;
    while (c < T) c = son[c + getBit()]!;
    c -= T;
    update(c);
    return c;
  };
  const decodePosition = (): number => {
    let i = getByte();
    const c = D_CODE[i]! << 6;
    let j = D_LEN[i]! - 2;
    while (j-- > 0) i = (i << 1) | getBit();
    return c | (i & 0x3f);
  };

  const text = new Uint8Array(N).fill(0x20);
  let r = N - F;
  const out = new Uint8Array(outSize);
  let count = 0;
  while (count < outSize) {
    const c = decodeChar();
    if (c < 256) {
      out[count++] = c;
      text[r++] = c;
      r &= N - 1;
    } else {
      const i = (r - decodePosition() - 1) & (N - 1);
      const j = c - 255 + THRESHOLD;
      for (let k = 0; k < j && count < outSize; k++) {
        const ch = text[(i + k) & (N - 1)]!;
        out[count++] = ch;
        text[r++] = ch;
        r &= N - 1;
      }
    }
  }
  return { data: out, consumed: pos - start };
}
