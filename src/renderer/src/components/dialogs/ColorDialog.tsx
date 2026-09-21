import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { BarInput } from '../bar'
import { ClassicDialog, Row } from './parts'
import { ui } from '../../theme'

const { color, space, font } = ui

type RGB = [number, number, number]

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [(h * 60 + 360) % 360, max ? d / max : 0, max]
}
function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return [f(5), f(3), f(1)]
}
const toHex = (c: RGB): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

const RECENT_KEY = 'sc.recentColors'
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** 끌기 영역 공용 — 포인터를 0~1 좌표로 */
function usePad(onPos: (x: number, y: number) => void): Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp'> {
  const on = useRef(false)
  const pos = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    onPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }
  return {
    onPointerDown: (e) => {
      on.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      pos(e)
    },
    onPointerMove: (e) => on.current && pos(e),
    onPointerUp: () => {
      on.current = false
    }
  }
}

/** 색 선택 — 채도/명도 사각형 + 색조 막대 + RGB/HEX + 최근 색 (Compositor ColorPicker 의 클래식판) */
export default function ColorDialog({ title, value, onClose, onApply }: { title: string; value: RGB; onClose: () => void; onApply: (c: RGB) => void }): JSX.Element {
  const [hsv, setHsv] = useState(() => rgbToHsv(value))
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2])
  const recent = loadRecent()
  const sv = usePad((x, y) => setHsv([hsv[0], x, 1 - y]))
  const hue = usePad((_, y) => setHsv([y * 359.9, hsv[1], hsv[2]]))
  const apply = (): void => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([toHex(rgb), ...recent.filter((c) => c !== toHex(rgb))].slice(0, 16)))
    } catch {
      /* 무시 */
    }
    onApply(rgb)
  }
  const setRgb = (c: RGB): void => setHsv(rgbToHsv(c))
  return (
    <ClassicDialog
      open
      title={title}
      onClose={onClose}
      onEnter={apply}
      width={440}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={apply}>
            확인
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', gap: `${space.base}px` }}>
        <Box
          aria-label="채도·명도"
          {...sv}
          sx={{
            position: 'relative',
            width: 220,
            height: 220,
            flexShrink: 0,
            cursor: 'crosshair',
            touchAction: 'none',
            border: `1px solid ${color.borderStrong}`,
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))`
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              left: `${hsv[1] * 100}%`,
              top: `${(1 - hsv[2]) * 100}%`,
              width: 10,
              height: 10,
              ml: '-5px',
              mt: '-5px',
              borderRadius: '50%',
              border: '1px solid #fff',
              boxShadow: '0 0 0 1px #000',
              pointerEvents: 'none'
            }}
          />
        </Box>
        <Box
          aria-label="색조"
          {...hue}
          sx={{
            position: 'relative',
            width: 18,
            height: 220,
            flexShrink: 0,
            cursor: 'ns-resize',
            touchAction: 'none',
            border: `1px solid ${color.borderStrong}`,
            background: 'linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
          }}
        >
          <Box sx={{ position: 'absolute', left: -3, right: -3, top: `${(hsv[0] / 360) * 100}%`, height: 3, mt: '-1px', border: '1px solid #000', bgcolor: '#fff', pointerEvents: 'none' }} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${space.sm}px`, flex: 1 }}>
          <Box sx={{ display: 'flex', border: `1px solid ${color.borderStrong}`, height: 44 }}>
            <Box title="새 색" sx={{ flex: 1, bgcolor: toHex(rgb) }} />
            <Box title="현재 색 (클릭 = 되돌리기)" onClick={() => setRgb(value)} sx={{ flex: 1, bgcolor: toHex(value), cursor: 'pointer' }} />
          </Box>
          {(['R', 'G', 'B'] as const).map((k, i) => (
            <Row key={k} label={k} labelWidth={14}>
              <BarInput
                type="number"
                width={60}
                value={String(rgb[i])}
                ariaLabel={k}
                onChange={(v) => {
                  const n = Math.max(0, Math.min(255, Math.round(Number(v))))
                  if (!Number.isFinite(n)) return
                  const c = [...rgb] as RGB
                  c[i] = n
                  setRgb(c)
                }}
              />
            </Row>
          ))}
          <Row label="#" labelWidth={14}>
            <BarInput
              value={hexDraft ?? toHex(rgb).slice(1)}
              width={80}
              ariaLabel="16진수"
              onChange={(v) => {
                setHexDraft(v)
                if (/^[0-9a-f]{6}$/i.test(v)) {
                  setRgb([parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)])
                  setHexDraft(null)
                }
              }}
            />
          </Row>
        </Box>
      </Box>
      {recent.length > 0 && (
        <Box>
          <Box sx={{ fontSize: font.xs, color: color.textSecondary, mb: '3px' }}>최근 색</Box>
          <Box sx={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {recent.map((c) => (
              <Box
                key={c}
                role="button"
                aria-label={c}
                title={c}
                onClick={() => setRgb([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)])}
                sx={{ width: 18, height: 18, bgcolor: c, border: `1px solid ${color.borderStrong}`, cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Box>
      )}
    </ClassicDialog>
  )
}
