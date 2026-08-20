import { encodeVectors, normaliseUpstreamEmbedding, packVectors, unpackVectors } from '../../src/lib/vectors';

// float32 cannot represent most decimals exactly, so round-trip comparisons go through Math.fround
// rather than expecting the original float64 literal back.
const asFloat32 = (values: number[]) => values.map((value) => Math.fround(value));

const sample = [
  [0.1, -0.2, 0.3],
  [1, 0, -1]
];

describe('packVectors / unpackVectors', () => {
  it('round-trips a batch of vectors through float32', () => {
    const packed = packVectors(sample);
    expect(unpackVectors(packed, 3)).toEqual(sample.map((vector) => asFloat32(vector)));
  });

  it('packs the batch as one contiguous buffer of 4-byte floats', () => {
    expect(packVectors(sample).byteLength).toBe(2 * 3 * 4);
  });

  it('round-trips a single vector', () => {
    const packed = packVectors([[0.5, 0.25]]);
    expect(unpackVectors(packed, 2)).toEqual([[0.5, 0.25]]);
  });

  it('round-trips a realistic 2560-dimension vector without losing entries', () => {
    const vector = Array.from({ length: 2560 }, (_, index) => index / 2560);
    const unpacked = unpackVectors(packVectors([vector]), 2560);
    expect(unpacked).toHaveLength(1);
    expect(unpacked[0]).toHaveLength(2560);
    expect(unpacked[0]).toEqual(asFloat32(vector));
  });

  it('slices a multi-vector buffer back into the right rows', () => {
    const first = Array.from({ length: 8 }, (_, index) => index);
    const second = Array.from({ length: 8 }, (_, index) => index + 100);
    expect(unpackVectors(packVectors([first, second]), 8)).toEqual([first, second]);
  });

  it('returns an empty list for zero dimensions rather than dividing by zero', () => {
    expect(unpackVectors(packVectors([]), 0)).toEqual([]);
  });

  it('reads correctly from a buffer whose byteOffset is not 4-byte aligned', () => {
    const packed = packVectors([[0.5, 0.25]]);
    // Buffer.subarray keeps the parent ArrayBuffer, so this view starts on an odd byte — exactly the
    // shape a pooled Buffer coming back from SQLite can have.
    const padded = Buffer.concat([Buffer.alloc(1), packed]);
    expect(unpackVectors(padded.subarray(1), 2)).toEqual([[0.5, 0.25]]);
  });
});

describe('encodeVectors', () => {
  it('returns number arrays for the float format', () => {
    expect(encodeVectors(packVectors(sample), 3, 'float')).toEqual(sample.map((vector) => asFloat32(vector)));
  });

  it('returns one base64 string per vector, not one for the whole batch', () => {
    const encoded = encodeVectors(packVectors(sample), 3, 'base64');
    expect(encoded).toHaveLength(2);
    for (const entry of encoded) expect(typeof entry).toBe('string');
  });

  it('base64 output decodes back to the same numbers as float output', () => {
    const packed = packVectors(sample);
    const asBase64 = encodeVectors(packed, 3, 'base64') as string[];
    const decoded = asBase64.map((entry) => normaliseUpstreamEmbedding(entry));
    expect(decoded).toEqual(encodeVectors(packed, 3, 'float'));
  });

  it('returns an empty list for zero dimensions in either format', () => {
    expect(encodeVectors(Buffer.alloc(0), 0, 'base64')).toEqual([]);
    expect(encodeVectors(Buffer.alloc(0), 0, 'float')).toEqual([]);
  });
});

describe('normaliseUpstreamEmbedding', () => {
  it('passes a plain number array through untouched', () => {
    expect(normaliseUpstreamEmbedding([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('decodes a base64 float32 string, for backends that honour encoding_format', () => {
    const floats = new Float32Array([0.5, -0.25, 2]);
    const encoded = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');
    expect(normaliseUpstreamEmbedding(encoded)).toEqual([0.5, -0.25, 2]);
  });

  it('decodes an empty base64 string to an empty vector', () => {
    expect(normaliseUpstreamEmbedding('')).toEqual([]);
  });
});
