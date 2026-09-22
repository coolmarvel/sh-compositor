/**
 * PNG 인코더/디코더 (순수 TS, 압축은 fflate) — 프로젝트 저장이 캔버스 없이도 돌고 테스트되도록.
 * 인코딩: 8비트 RGBA, 줄마다 필터 0/1/2/4 중 절댓값 합이 가장 작은 것(libpng 휴리스틱).
 * 디코딩: 8비트 그레이·RGB·팔레트·그레이+알파·RGBA, 필터 0~4, 인터레이스 없음 (Compositor·브라우저가 쓰는 형식).
 */
import { zlibSync, unzlibSync } from 'fflate'
import { checkLimits } from './limits'

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

let table: Uint32Array | null = null
function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array, dpi?: number): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)]
  const types = [0, 1, 2, 4]
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const prev = y ? row - stride : -1
    let best = 0
    let bestSum = Infinity
    for (let k = 0; k < 4; k++) {
      const out = cand[k]
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i]
        const a = i >= 4 ? rgba[row + i - 4] : 0
        const b = prev >= 0 ? rgba[prev + i] : 0
        const c = i >= 4 && prev >= 0 ? rgba[prev + i - 4] : 0
        const v = types[k] === 0 ? x : types[k] === 1 ? x - a : types[k] === 2 ? x - b : x - paeth(a, b, c)
        out[i] = v & 255
        sum += (v & 255) < 128 ? v & 255 : 256 - (v & 255)
        if (sum >= bestSum) break
      }
      if (sum < bestSum) {
        bestSum = sum
        best = k
      }
    }
    // 선택된 필터로 다시 (break 로 중간에 끊겼을 수 있음)
    const k = best
    const o = y * (stride + 1)
    raw[o] = types[k]
    for (let i = 0; i < stride; i++) {
      const x = rgba[row + i]
      const a = i >= 4 ? rgba[row + i - 4] : 0
      const b = prev >= 0 ? rgba[prev + i] : 0
      const c = i >= 4 && prev >= 0 ? rgba[prev + i - 4] : 0
      raw[o + 1 + i] = (types[k] === 0 ? x : types[k] === 1 ? x - a : types[k] === 2 ? x - b : x - paeth(a, b, c)) & 255
    }
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [Uint8Array.from(SIG), chunk('IHDR', ihdr)]
  if (dpi && dpi > 0) {
    const p = new Uint8Array(9)
    const pv = new DataView(p.buffer)
    const ppm = Math.round(dpi / 0.0254)
    pv.setUint32(0, ppm)
    pv.setUint32(4, ppm)
    p[8] = 1
    parts.push(chunk('pHYs', p))
  }
  parts.push(chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)))
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && SIG.every((v, i) => b[i] === v)
}

export function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8ClampedArray; dpi: number | null } {
  if (!isPng(bytes)) throw new Error('PNG 가 아닙니다.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 8
  let width = 0
  let height = 0
  let depth = 0
  let ctype = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  let dpi: number | null = null
  const idat: Uint8Array[] = []
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p)
    if (p + 12 + len > bytes.length) throw new Error('PNG 청크가 잘렸습니다.')
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const data = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('PNG 헤더 크기가 잘못되었습니다.')
      width = dv.getUint32(p + 8)
      height = dv.getUint32(p + 12)
      depth = data[8]
      ctype = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'pHYs' && data[8] === 1) dpi = Math.round(new DataView(data.buffer, data.byteOffset).getUint32(0) * 0.0254)
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const limit = checkLimits(width, height)
  if (limit) throw new Error(limit)
  if (![0, 2, 3, 4, 6].includes(ctype) || (ctype === 3 && !palette)) throw new Error('PNG 색상 형식이 잘못되었습니다.')
  if (depth !== 8 || interlace) throw new Error('8비트·비인터레이스 PNG 만 읽습니다.')
  const channels = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : 1
  let total = 0
  for (const c of idat) total += c.length
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of idat) {
    joined.set(c, at)
    at += c.length
  }
  const raw = unzlibSync(joined)
  const stride = width * channels
  if (raw.length !== height * (stride + 1)) throw new Error('PNG 픽셀 데이터 크기가 다릅니다.')
  const cur = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    const f = raw[o]
    if (f > 4) throw new Error('PNG 필터가 잘못되었습니다.')
    for (let i = 0; i < stride; i++) {
      const x = raw[o + 1 + i]
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255
    }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4
      const s = x * channels
      if (ctype === 6) {
        out[d] = cur[s]
        out[d + 1] = cur[s + 1]
        out[d + 2] = cur[s + 2]
        out[d + 3] = cur[s + 3]
      } else if (ctype === 2) {
        out[d] = cur[s]
        out[d + 1] = cur[s + 1]
        out[d + 2] = cur[s + 2]
        out[d + 3] = 255
      } else if (ctype === 4) {
        out[d] = out[d + 1] = out[d + 2] = cur[s]
        out[d + 3] = cur[s + 1]
      } else if (ctype === 0) {
        out[d] = out[d + 1] = out[d + 2] = cur[s]
        out[d + 3] = 255
      } else {
        const idx = cur[s]
        out[d] = palette![idx * 3]
        out[d + 1] = palette![idx * 3 + 1]
        out[d + 2] = palette![idx * 3 + 2]
        out[d + 3] = trns && idx < trns.length ? trns[idx] : 255
      }
    }
    prev.set(cur)
  }
  return { width, height, data: out, dpi }
}
