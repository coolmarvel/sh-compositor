import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { checkLimits } from '@core/index'
import { BarInput, selectSx } from '../bar'
import { ClassicDialog, GroupBox, Row, Note } from './parts'
import { ui } from '../../theme'

const { color, space } = ui

/** 자주 쓰는 크기 (Compositor NewCanvasSheet 프리셋 + 한국 사용처) */
const PRESETS: { label: string; w: number; h: number; dpi?: number }[] = [
  { label: 'FHD 1920×1080', w: 1920, h: 1080 },
  { label: '4K 3840×2160', w: 3840, h: 2160 },
  { label: '정사각 1080×1080 (인스타그램)', w: 1080, h: 1080 },
  { label: '세로 1080×1350 (인스타그램)', w: 1080, h: 1350 },
  { label: '유튜브 썸네일 1280×720', w: 1280, h: 720 },
  { label: 'A4 300dpi 2480×3508', w: 2480, h: 3508, dpi: 300 },
  { label: '웹 배너 1200×628', w: 1200, h: 628 },
  { label: '아이콘 512×512', w: 512, h: 512 }
]

export interface NewCanvasResult {
  width: number
  height: number
  dpi: number
  background: 'white' | 'black' | 'transparent' | 'bg'
}

let last: NewCanvasResult = { width: 1920, height: 1080, dpi: 72, background: 'white' }

/** 새로 만들기 — Compositor `NewCanvasSheet`. 마지막 값을 기억한다 */
export default function NewCanvasDialog({
  onClose,
  onCreate,
  clipboardSize
}: {
  onClose: () => void
  onCreate: (r: NewCanvasResult) => void
  clipboardSize?: { width: number; height: number } | null
}): JSX.Element {
  const [r, setR] = useState<NewCanvasResult>(last)
  const limit = checkLimits(r.width, r.height)
  const create = (): void => {
    if (limit || r.width < 1 || r.height < 1) return
    last = r
    onCreate(r)
  }
  return (
    <ClassicDialog
      open
      title="새로 만들기"
      onClose={onClose}
      onEnter={create}
      width={400}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={create} disabled={!!limit}>
            만들기
          </Button>
        </>
      }
    >
      <Row label="사전 설정">
        <Select
          value=""
          displayEmpty
          renderValue={() => '고르세요…'}
          onChange={(e) => {
            const p = PRESETS[Number(e.target.value)]
            if (p) setR({ ...r, width: p.w, height: p.h, dpi: p.dpi ?? 72 })
          }}
          sx={{ ...selectSx, flex: 1 }}
          SelectDisplayProps={{ 'aria-label': '사전 설정' } as React.HTMLAttributes<HTMLDivElement>}
        >
          {PRESETS.map((p, i) => (
            <MenuItem key={p.label} value={i}>
              {p.label}
            </MenuItem>
          ))}
        </Select>
      </Row>
      {clipboardSize && (
        <Button variant="outlined" onClick={() => setR({ ...r, width: clipboardSize.width, height: clipboardSize.height })} sx={{ alignSelf: 'flex-start' }}>
          클립보드 크기 ({clipboardSize.width}×{clipboardSize.height})
        </Button>
      )}
      <GroupBox title="크기">
        {(['width', 'height'] as const).map((k) => (
          <Row key={k} label={k === 'width' ? '폭' : '높이'}>
            <BarInput
              type="number"
              width={100}
              value={String(r[k])}
              ariaLabel={k === 'width' ? '새 문서 폭' : '새 문서 높이'}
              onChange={(v) => {
                const n = Math.round(Number(v))
                if (Number.isFinite(n) && n > 0) setR({ ...r, [k]: n })
              }}
            />
            <Box component="span" sx={{ color: color.textSecondary }}>
              픽셀
            </Box>
          </Row>
        ))}
        <Row label="해상도">
          <BarInput type="number" width={100} value={String(r.dpi)} ariaLabel="새 문서 해상도" onChange={(v) => Number(v) > 0 && setR({ ...r, dpi: Number(v) })} />
          <Box component="span" sx={{ color: color.textSecondary }}>
            픽셀/인치
          </Box>
        </Row>
      </GroupBox>
      <GroupBox title="배경">
        <Box sx={{ display: 'flex', gap: `${space.lg}px`, flexWrap: 'wrap' }}>
          {(
            [
              ['white', '흰색'],
              ['black', '검정'],
              ['bg', '배경색'],
              ['transparent', '투명']
            ] as const
          ).map(([k, label]) => (
            <Box key={k} component="label" sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px` }}>
              <input type="radio" name="new-bg" checked={r.background === k} onChange={() => setR({ ...r, background: k })} style={{ margin: 0, accentColor: color.accent }} />
              {label}
            </Box>
          ))}
        </Box>
      </GroupBox>
      <Note ok={!limit}>{limit ?? `${r.width.toLocaleString()} × ${r.height.toLocaleString()} 픽셀 · ${((r.width / r.dpi) * 2.54).toFixed(1)} × ${((r.height / r.dpi) * 2.54).toFixed(1)} cm`}</Note>
    </ClassicDialog>
  )
}
