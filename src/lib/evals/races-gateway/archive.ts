import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import type { ContextManifestV3 } from '../../types/agent-run'
import type { RacesGatewayTranscriptArchiveV1 } from './types'

export interface RacesGatewayTranscriptV1 {
  version: 1
  manifest: ContextManifestV3
  artifactBodies: Record<string, string>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export async function createRacesGatewayTranscriptArchiveV1(input: {
  manifest: ContextManifestV3
  artifactBodies: Record<string, string>
}): Promise<RacesGatewayTranscriptArchiveV1> {
  const transcript: RacesGatewayTranscriptV1 = {
    version: 1,
    manifest: input.manifest,
    artifactBodies: input.artifactBodies,
  }
  const raw = canonicalStringify(transcript)
  const compressed = await gzip(raw)
  return {
    version: 1,
    encoding: 'gzip-base64',
    transcriptHash: await hashCanonicalValue(transcript),
    uncompressedBytes: new TextEncoder().encode(raw).byteLength,
    compressedBytes: compressed.byteLength,
    body: bytesToBase64(compressed),
  }
}

export async function readRacesGatewayTranscriptArchiveV1(
  archive: RacesGatewayTranscriptArchiveV1,
): Promise<RacesGatewayTranscriptV1> {
  if (archive.version !== 1 || archive.encoding !== 'gzip-base64'
    || !/^[a-f0-9]{64}$/.test(archive.transcriptHash)
    || !Number.isSafeInteger(archive.uncompressedBytes) || archive.uncompressedBytes < 1
    || !Number.isSafeInteger(archive.compressedBytes) || archive.compressedBytes < 1) {
    throw new Error('RACE-6 transcript archive 合同无效')
  }
  const compressed = base64ToBytes(archive.body)
  if (compressed.byteLength !== archive.compressedBytes) throw new Error('RACE-6 transcript 压缩长度不一致')
  const raw = await gunzip(compressed)
  if (new TextEncoder().encode(raw).byteLength !== archive.uncompressedBytes) {
    throw new Error('RACE-6 transcript 原文长度不一致')
  }
  const value = JSON.parse(raw) as RacesGatewayTranscriptV1
  if (value.version !== 1 || !value.manifest || !value.artifactBodies
    || await hashCanonicalValue(value) !== archive.transcriptHash) {
    throw new Error('RACE-6 transcript archive 验签失败')
  }
  return value
}
