/**
 * Čistý offline generátor vektorového QR kódu (ISO/IEC 18004, Byte Mode, ECC Level M)
 * Vrací ostrý vektorový <svg> s jedinou <path> (bez rastru, bez závislostí).
 * Podporuje verze 1 až 10 (až 213 UTF-8 bajtů při korekci M — více než dost pro URL e-etikety).
 */
(function (global) {
  'use strict';

  // Tabulka parametrů pro ECC Level M (verze 1..10): [celkemDatovychKodu, eccNaBlok, pocetBlokuSk1, dataSk1, pocetBlokuSk2, dataSk2]
  const ECC_M_TABLE = {
    1:  [16,  10, 1, 16, 0, 0],
    2:  [28,  16, 1, 28, 0, 0],
    3:  [44,  26, 1, 44, 0, 0],
    4:  [64,  18, 2, 32, 0, 0],
    5:  [86,  24, 2, 43, 0, 0],
    6:  [108, 16, 4, 27, 0, 0],
    7:  [124, 18, 4, 31, 0, 0],
    8:  [154, 22, 2, 38, 2, 39],
    9:  [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44]
  };

  // Souřadnice zarovnávacích vzorů (Alignment Patterns) pro verze 1..10
  const ALIGN_POS = {
    1:  [],
    2:  [6, 18],
    3:  [6, 22],
    4:  [6, 26],
    5:  [6, 30],
    6:  [6, 34],
    7:  [6, 22, 38],
    8:  [6, 24, 42],
    9:  [6, 26, 46],
    10: [6, 28, 50]
  };

  // GF(256) log / exp tabulky pro polynom 0x11D
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsCompute(data, eccCount) {
    const gen = rsGeneratorPoly(eccCount);
    const res = new Uint8Array(eccCount);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.copyWithin(0, 1);
      res[eccCount - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < eccCount; j++) {
          res[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function selectVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const cap = ECC_M_TABLE[v][0];
      const countBits = v <= 9 ? 8 : 16;
      const neededBytes = Math.ceil((4 + countBits + byteLen * 8) / 8);
      if (neededBytes <= cap) return v;
    }
    throw new Error('URL je příliš dlouhé pro QR verzi 1-10.');
  }

  function buildCodewords(bytes, version) {
    const [totalData, eccPerBlock, b1, d1, b2, d2] = ECC_M_TABLE[version];
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    // Byte mode indicator (0100) + length + payload
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);

    // Terminator + byte alignment
    const maxBits = totalData * 8;
    const term = Math.min(4, maxBits - bits.length);
    pushBits(0, term);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      dataCodewords.push(v);
    }

    const padBytes = [0xec, 0x11];
    let pIdx = 0;
    while (dataCodewords.length < totalData) {
      dataCodewords.push(padBytes[pIdx++ % 2]);
    }

    // Rozdělení do bloků + Reed-Solomon ECC
    const blocks = [];
    const eccBlocks = [];
    let offset = 0;
    for (let i = 0; i < b1; i++) {
      const blk = dataCodewords.slice(offset, offset + d1);
      offset += d1;
      blocks.push(blk);
      eccBlocks.push(rsCompute(blk, eccPerBlock));
    }
    for (let i = 0; i < b2; i++) {
      const blk = dataCodewords.slice(offset, offset + d2);
      offset += d2;
      blocks.push(blk);
      eccBlocks.push(rsCompute(blk, eccPerBlock));
    }

    // Prokládání (Interleaving)
    const interleaved = [];
    const maxD = Math.max(d1, d2);
    for (let i = 0; i < maxD; i++) {
      for (const blk of blocks) {
        if (i < blk.length) interleaved.push(blk[i]);
      }
    }
    for (let i = 0; i < eccPerBlock; i++) {
      for (const eblk of eccBlocks) interleaved.push(eblk[i]);
    }
    return interleaved;
  }

  function makeMatrix(version, codewords) {
    const size = version * 4 + 17;
    const mat = Array.from({ length: size }, () => new Int8Array(size)); // 0=empty, 1=dark, -1=light
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setMod = (r, c, dark, func) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      mat[r][c] = dark ? 1 : -1;
      if (func) isFunc[r][c] = 1;
    };

    const drawFinder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = r0 + dr, c = c0 + dc;
          if (r < 0 || c < 0 || r >= size || c >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const dark = inOuter && (
            dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
          );
          setMod(r, c, dark, true);
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setMod(6, i, i % 2 === 0, true);
      setMod(i, 6, i % 2 === 0, true);
    }

    // Alignment patterns
    const pos = ALIGN_POS[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const r0 = pos[i], c0 = pos[j];
        if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === size - 7) || (r0 === size - 7 && c0 === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setMod(r0 + dr, c0 + dc, dark, true);
          }
        }
      }
    }

    // Dark module + rezervace pro format info
    setMod(size - 8, 8, true, true);
    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        isFunc[8][i] = 1;
        isFunc[i][8] = 1;
      }
    }
    for (let i = 0; i < 8; i++) {
      isFunc[8][size - 1 - i] = 1;
      isFunc[size - 1 - i][8] = 1;
    }

    // Version info pro verze >= 7
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
      const vBits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((vBits >> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = size - 11 + (i % 3);
        setMod(a, b, bit, true);
        setMod(b, a, bit, true);
      }
    }

    // Umístění datových bitů (zig-zag)
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let dark = false;
            if (bitIdx < totalBits) {
              dark = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
              bitIdx++;
            }
            mat[r][c] = dark ? 1 : -1;
          }
        }
      }
    }

    // Výběr nejlepší masky (0..7)
    const maskFns = [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    function applyFormat(grid, maskId) {
      // ECC Level M = 00
      const data = (0b00 << 3) | maskId;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;

      const getBit = (i) => ((bits >> i) & 1) === 1 ? 1 : -1;
      for (let i = 0; i <= 5; i++) grid[8][i] = getBit(14 - i);
      grid[8][7] = getBit(8);
      grid[8][8] = getBit(7);
      grid[7][8] = getBit(6);
      for (let i = 0; i <= 5; i++) grid[5 - i][8] = getBit(5 - i);

      for (let i = 0; i <= 7; i++) grid[8][size - 1 - i] = getBit(i);
      for (let i = 0; i <= 6; i++) grid[size - 7 + i][8] = getBit(14 - i);
    }

    function penalty(grid) {
      let score = 0;
      for (let r = 0; r < size; r++) {
        let run = 1;
        for (let c = 1; c < size; c++) {
          if (grid[r][c] === grid[r][c - 1]) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
      for (let c = 0; c < size; c++) {
        let run = 1;
        for (let r = 1; r < size; r++) {
          if (grid[r][c] === grid[r - 1][c]) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
      for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
          const v = grid[r][c];
          if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
        }
      }
      return score;
    }

    let bestGrid = null;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const g = mat.map((row) => new Int8Array(row));
      const fn = maskFns[m];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!isFunc[r][c] && fn(r, c)) g[r][c] = -g[r][c];
        }
      }
      applyFormat(g, m);
      const sc = penalty(g);
      if (sc < bestScore) {
        bestScore = sc;
        bestGrid = g;
      }
    }
    return bestGrid;
  }

  /**
   * Vygeneruje čistý vektorový SVG řetězec pro zadanou URL.
   * @param {string} text - URL adresa e-etikety
   * @param {number} quietZone - tichá zóna v modulech (výchozí 2 pro kompaktní etiketu, min. 2–4)
   * @returns {string} SVG markup
   */
  function generateQrSvg(text, quietZone) {
    const qz = typeof quietZone === 'number' ? quietZone : 2;
    const bytes = utf8Bytes(String(text || ''));
    const version = selectVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    const grid = makeMatrix(version, codewords);
    const n = grid.length;
    const total = n + qz * 2;

    // Sloučení horizontálních úseků do jediné čisté SVG cesty (<path>) pro minimální velikost PDF
    const parts = [];
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (grid[r][c] === 1) {
          const start = c;
          while (c < n && grid[r][c] === 1) c++;
          const w = c - start;
          parts.push(`M${start + qz},${r + qz}h${w}v1h-${w}z`);
        } else {
          c++;
        }
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="QR kód e-etikety">` +
      `<rect width="${total}" height="${total}" fill="#FFFFFF"/>` +
      `<path d="${parts.join('')}" fill="#000000"/>` +
      `</svg>`
    );
  }

  global.SalajkaQR = { generateQrSvg };
})(typeof window !== 'undefined' ? window : globalThis);
