// Type-only, so nothing at runtime here depends on the db layer.
import type { EncodingFormat } from '@db/schema';

const BYTES_PER_FLOAT = 4;

// Buffer instances come from a shared pool, so their byteOffset is not guaranteed to be 4-byte
// aligned — which a Float32Array view requires. Copy only when it actually is misaligned.
const asFloat32 = (buffer: Buffer): Float32Array => {
  const aligned = buffer.byteOffset % BYTES_PER_FLOAT === 0 ? buffer : new Uint8Array(buffer);
  return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / BYTES_PER_FLOAT));
};

// One contiguous little-endian float32 buffer holding every vector back to back. Storing float32 is
// not a lossy shortcut: embedding backends emit float32 and pgvector's `vector` type is float32, so
// the float64 a JSON array carries was only ever padding.
export const packVectors = (vectors: number[][]): Buffer => {
  const dimensions = vectors[0]?.length ?? 0;
  const floats = new Float32Array(vectors.length * dimensions);
  for (const [index, vector] of vectors.entries()) floats.set(vector, index * dimensions);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
};

export const unpackVectors = (buffer: Buffer, dimensions: number): number[][] => {
  if (dimensions <= 0) return [];
  const floats = asFloat32(buffer);
  const count = Math.floor(floats.length / dimensions);
  return Array.from({ length: count }, (_, index) => [
    ...floats.subarray(index * dimensions, (index + 1) * dimensions)
  ]);
};

// base64 emits one string per vector rather than one for the whole batch, so callers can still
// address individual results by index.
export const encodeVectors = (buffer: Buffer, dimensions: number, format: EncodingFormat): number[][] | string[] => {
  if (format === 'float') return unpackVectors(buffer, dimensions);
  const stride = dimensions * BYTES_PER_FLOAT;
  if (stride <= 0) return [];
  const count = Math.floor(buffer.byteLength / stride);
  return Array.from({ length: count }, (_, index) =>
    buffer.subarray(index * stride, (index + 1) * stride).toString('base64')
  );
};

// Whether a backend honours `encoding_format: "base64"` varies by llama.cpp build, so accept either
// shape back. Requesting base64 upstream is an internal optimisation, never a client-visible contract.
export const normaliseUpstreamEmbedding = (value: number[] | string): number[] => {
  if (typeof value !== 'string') return value;
  const floats = asFloat32(Buffer.from(value, 'base64'));
  return [...floats];
};
