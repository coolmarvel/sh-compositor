/**
 * 결과 파일에 인쇄 해상도(DPI)를 새겨 넣는다 (순수 TS — 바이트만 다룬다).
 *
 * 왜: "이미지 크기" 대화상자가 인치/센티미터 단위를 쓰려면(Compositor `ImageSizeSheet`),
 * 저장된 파일이 자기 해상도를 알고 있어야 워드·인디자인·인쇄에서 같은 크기로 앉는다.
 * canvas 의 `toBlob` 은 DPI 를 넣어 주지 않으므로 인코딩 뒤에 직접 꽂는다.
 *
 * - PNG: `pHYs` 청크 (픽셀/미터). 이미 있으면 갈아 끼운다.
 * - JPEG: APP0 `JFIF` 세그먼트의 밀도 필드. 없으면 SOI 뒤에 만들어 넣는다.
 * - 그 밖(WebP·BMP·ICO·SVG): 표준 자리가 없어 원본 그대로 돌려준다.
 */

/** DPI 를 담을 수 있는지 판단할 출력 형식 */
export type RasterKind = 'png' | 'jpeg' | 'webp' | 'bmp' | string

/** 인치당 픽셀 → 미터당 픽셀 */
export function dpiToPpm(dpi: number): number {
  return Math.max(1, Math.round(dpi / 0.0254))
}

/** 포맷에 맞게 DPI 를 새겨 넣은 새 바이트 (담을 수 없으면 입력 그대로) */
export function embedDpi(bytes: Uint8Array, kind: RasterKind, dpi: number): Uint8Array {
  if (!Number.isFinite(dpi) || dpi <= 0) return bytes
  if (kind === 'png') return embedPngDpi(bytes, dpi)
  if (kind === 'jpeg') return embedJpegDpi(bytes, dpi)
  return bytes
}

// ── PNG ───────────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && PNG_SIG.every((v, i) => b[i] === v)
}

/** pHYs 청크를 첫 IDAT 앞에 넣는다 (기존 pHYs 는 제거) */
export function embedPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(bytes)) return bytes
  const ppm = dpiToPpm(dpi)
  const chunk = makePngChunk(
    'pHYs',
    (() => {
      const d = new Uint8Array(9)
      writeU32(d, 0, ppm)
      writeU32(d, 4, ppm)
      d[8] = 1 // 단위 = 미터
      return d
    })()
  )

  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let p = 8
  let inserted = false
  while (p + 8 <= bytes.length) {
    const len = readU32(bytes, p)
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const end = p + 12 + len
    if (end > bytes.length) break
    if (type === 'pHYs') {
      p = end // 기존 해상도 청크는 버린다
      continue
    }
    if (!inserted && (type === 'IDAT' || type === 'IEND')) {
      parts.push(chunk)
      inserted = true
    }
    parts.push(bytes.subarray(p, end))
    p = end
  }
  if (!inserted) parts.push(chunk)
  return concat(parts)
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

let crcTable: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── JPEG ──────────────────────────────────────────────────────────────────

/** JFIF APP0 의 밀도 필드를 dpi 로 (없으면 SOI 뒤에 JFIF 세그먼트를 새로 넣는다) */
export function embedJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const d = Math.max(1, Math.min(65535, Math.round(dpi)))
  // SOI 바로 뒤가 APP0/JFIF 인지
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes.length > 18) {
    // 세그먼트: [2,3]=FFE0 [4,5]=길이 [6..10]='JFIF\0' [11,12]=버전 [13]=단위 [14,15]=Xdensity [16,17]=Ydensity
    const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00
    if (isJfif) {
      const out = bytes.slice()
      out[2 + 4 + 7] = 1 // 단위 = 인치
      writeU16(out, 2 + 4 + 8, d)
      writeU16(out, 2 + 4 + 10, d)
      return out
    }
  }
  const app0 = new Uint8Array(18)
  app0[0] = 0xff
  app0[1] = 0xe0
  writeU16(app0, 2, 16) // 세그먼트 길이 (길이 필드 포함)
  app0.set([0x4a, 0x46, 0x49, 0x46, 0x00], 4) // 'JFIF\0'
  app0[9] = 1 // 버전 1.1
  app0[10] = 1
  app0[11] = 1 // 단위 = 인치
  writeU16(app0, 12, d)
  writeU16(app0, 14, d)
  app0[16] = 0 // 썸네일 없음
  app0[17] = 0
  return concat([bytes.subarray(0, 2), app0, bytes.subarray(2)])
}

// ── 읽기 (원본 파일의 DPI 를 대화상자 기본값으로) ─────────────────────────

/** 파일 바이트에서 DPI 를 읽는다 (없으면 null) */
export function readDpi(bytes: Uint8Array): number | null {
  if (isPng(bytes)) {
    let p = 8
    while (p + 8 <= bytes.length) {
      const len = readU32(bytes, p)
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
      if (type === 'pHYs' && len >= 9) {
        const ppm = readU32(bytes, p + 8)
        const unit = bytes[p + 16]
        if (unit === 1 && ppm > 0) return Math.round(ppm * 0.0254)
        return null
      }
      if (type === 'IDAT') return null
      p += 12 + len
    }
    return null
  }
  if (bytes.length > 18 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0) {
    const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00
    if (!isJfif) return null
    const unit = bytes[2 + 4 + 7]
    const x = readU16(bytes, 2 + 4 + 8)
    if (x <= 0) return null
    if (unit === 1) return x
    if (unit === 2) return Math.round(x * 2.54) // 센티미터당 → 인치당
    return null
  }
  return null
}

// ── 바이트 유틸 ───────────────────────────────────────────────────────────

function readU32(b: Uint8Array, p: number): number {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
}
function writeU32(b: Uint8Array, p: number, v: number): void {
  b[p] = (v >>> 24) & 255
  b[p + 1] = (v >>> 16) & 255
  b[p + 2] = (v >>> 8) & 255
  b[p + 3] = v & 255
}
function readU16(b: Uint8Array, p: number): number {
  return (b[p] << 8) | b[p + 1]
}
function writeU16(b: Uint8Array, p: number, v: number): void {
  b[p] = (v >>> 8) & 255
  b[p + 1] = v & 255
}
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
