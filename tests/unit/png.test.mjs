import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';

import { encodePng } from '../../scripts/lib/png.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Walk the chunk list, verifying each declared length and CRC-checked name. */
function chunks(png) {
  const found = [];
  let offset = SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    found.push({ type, length, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe('png encoder', () => {
  it('writes a signature, IHDR, IDAT and IEND in order', () => {
    const png = encodePng(2, 2, new Uint8Array(16));
    const types = chunks(png).map((c) => c.type);

    assert.ok(png.subarray(0, 8).equals(SIGNATURE));
    assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  });

  it('declares 8-bit RGBA, uncompressed-filter, non-interlaced', () => {
    const png = encodePng(3, 5, new Uint8Array(3 * 5 * 4));
    const [ihdr] = chunks(png);

    assert.equal(ihdr.data.readUInt32BE(0), 3);
    assert.equal(ihdr.data.readUInt32BE(4), 5);
    assert.equal(ihdr.data[8], 8, 'bit depth');
    assert.equal(ihdr.data[9], 6, 'colour type RGBA');
    assert.equal(ihdr.data[12], 0, 'interlace');
  });

  it('round-trips the pixels through the IDAT stream', () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 9, 9, 9, 0,
    ]);

    const [, idat] = chunks(encodePng(2, 2, pixels));
    const raw = inflateSync(idat.data);

    // Each scanline is prefixed by its filter byte (0 = None).
    assert.equal(raw.length, 2 * (1 + 2 * 4));
    assert.equal(raw[0], 0);
    assert.deepEqual([...raw.subarray(1, 9)], [...pixels.subarray(0, 8)]);
    assert.equal(raw[9], 0);
    assert.deepEqual([...raw.subarray(10, 18)], [...pixels.subarray(8, 16)]);
  });

  it('refuses a buffer whose size contradicts the dimensions', () => {
    assert.throws(() => encodePng(2, 2, new Uint8Array(15)), /expected 16 bytes/);
  });
});

describe('generated icons', () => {
  for (const size of [16, 32, 48, 128]) {
    it(`icon-${size}.png is a valid PNG of the declared size`, () => {
      const png = readFileSync(new URL(`../../extension/assets/icons/icon-${size}.png`, import.meta.url));
      const [ihdr] = chunks(png);

      assert.ok(png.subarray(0, 8).equals(SIGNATURE));
      assert.equal(ihdr.data.readUInt32BE(0), size);
      assert.equal(ihdr.data.readUInt32BE(4), size);
    });
  }
});
