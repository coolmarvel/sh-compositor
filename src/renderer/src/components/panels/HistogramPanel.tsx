import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { useDoc } from '../../editor/store'
import { docThumbnail } from '../../editor/commands'
import { histogram, type Histogram } from '@core/index'
import { selectSx } from '../bar'
import { ui } from '../../theme'

const { color, space, font } = ui

type Ch = 'rgb' | 'lum' | 'r' | 'g' | 'b'
const CH: { key: Ch; label: string }[] = [
  { key: 'rgb', label: '색상 (RGB 겹쳐)' },
  { key: 'lum', label: '밝기' },
  { key: 'r', label: '빨강' },
  { key: 'g', label: '초록' },
  { key: 'b', label: '파랑' }
]

/** 통계 (평균·표준편차·중간값) — 0~255 칸 수 배열에서 */
function stats(bins: Uint32Array): { mean: number; sd: number; median: number; n: number } {
  let n = 0
  let sum = 0
  for (let i = 0; i < 256; i++) {
    n += bins[i]
    sum += i * bins[i]
  }
  const mean = n ? sum / n : 0
  let v = 0
  let acc = 0
  let median = -1
  for (let i = 0; i < 256; i++) {
    v += bins[i] * (i - mean) ** 2
    acc += bins[i]
    if (median < 0 && acc >= n / 2) median = i
  }
  return { mean, sd: n ? Math.sqrt(v / n) : 0, median: Math.max(0, median), n }
}

/**
 * 히스토그램 패널 (포토샵 Histogram) — 보이는 그림의 밝기·색 분포와 통계. 문서가 바뀌면 잠시 뒤 다시 센다
 * (GPU 합성 축소본 512px 기준이라 가볍다 — 수치는 근삿값).
 */
export default function HistogramPanel(): JSX.Element {
  const doc = useDoc()
  const [ch, setCh] = useState<Ch>('rgb')
  const [h, setH] = useState<Histogram | null>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!doc) return setH(null)
    let tries = 0
    let t: ReturnType<typeof setTimeout>
    const load = (): void => {
      const im = docThumbnail(512)
      if (im) setH(histogram(im.data))
      else if (++tries < 20) t = setTimeout(load, 300)
    }
    t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [doc])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = color.canvas
    g.fillRect(0, 0, W, H)
    if (!h) return
    const draw = (bins: Uint32Array, fill: string): void => {
      // 한두 칸의 큰 봉우리가 나머지를 눌러 버리지 않게 95퍼센타일×4 로 자른다 (보정 대화상자와 같은 규칙)
      const inner = Array.from(bins.slice(1, 255))
        .filter((v) => v > 0)
        .sort((a, b) => a - b)
      const top = Math.max(1, Math.min(Math.max(...bins), (inner[Math.floor((inner.length - 1) * 0.95)] ?? 1) * 4))
      // 칸마다 막대 — 선으로 이으면 0·255 한 칸에만 몰린 그림(단색)이 폭 0 으로 안 보인다
      g.fillStyle = fill
      const bw = W / 256
      for (let i = 0; i < 256; i++) {
        const bh = Math.min(1, bins[i] / top) * (H - 4)
        if (bh > 0) g.fillRect(i * bw, H - bh, Math.max(1, bw), bh)
      }
    }
    g.globalCompositeOperation = ch === 'rgb' ? 'multiply' : 'source-over'
    if (ch === 'rgb') {
      draw(h.r, 'rgba(230,60,60,0.55)')
      draw(h.g, 'rgba(60,190,80,0.55)')
      draw(h.b, 'rgba(60,110,230,0.55)')
    } else draw(ch === 'lum' ? h.lum : h[ch], ch === 'lum' ? '#5c6370' : ch === 'r' ? '#e03c3c' : ch === 'g' ? '#2fb344' : '#3c6ee6')
    g.globalCompositeOperation = 'source-over'
  }, [h, ch])
  const st = h ? stats(ch === 'rgb' || ch === 'lum' ? h.lum : h[ch]) : null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: `${space.sm}px`, gap: `${space.sm}px` }} aria-label="히스토그램">
      <Select
        value={ch}
        onChange={(e) => setCh(e.target.value as Ch)}
        sx={{ ...selectSx, width: 150 }}
        SelectDisplayProps={{ 'aria-label': '히스토그램 채널' } as React.HTMLAttributes<HTMLDivElement>}
      >
        {CH.map((c) => (
          <MenuItem key={c.key} value={c.key}>
            {c.label}
          </MenuItem>
        ))}
      </Select>
      <Box component="canvas" ref={ref} data-testid="histogram" sx={{ flex: 1, minHeight: 60, width: '100%', border: `1px solid ${color.borderStrong}` }} />
      <Box className="tnum" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', columnGap: '8px', fontSize: font.xs, color: color.textSecondary }}>
        <span>평균</span>
        <b>{st ? st.mean.toFixed(1) : '·'}</b>
        <span>중간값</span>
        <b>{st ? st.median : '·'}</b>
        <span>표준편차</span>
        <b>{st ? st.sd.toFixed(1) : '·'}</b>
        <span>표본</span>
        <b>{st ? st.n.toLocaleString() : '·'}</b>
      </Box>
    </Box>
  )
}
