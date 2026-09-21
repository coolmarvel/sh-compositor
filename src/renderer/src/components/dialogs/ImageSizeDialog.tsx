import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { SIZE_UNITS, SizeUnit, ImageSizeState, initialState, toDisplay, roundDisplay, setDimension, setDpi, setResample, validate, resultPixels, DEFAULT_DPI } from '@core/index'
import { BarInput, selectSx } from '../bar'
import { ClassicDialog, GroupBox, Row, Check, Note } from './parts'
import { ui } from '../../theme'

const { color, font } = ui

export interface ImageSizeResult {
  /** 출력 픽셀 (null = 원본 유지 — 리샘플 끔) */
  width: number | null
  height: number | null
  dpi: number
}

/**
 * 이미지 크기 대화상자 — Compositor `ImageSizeSheet` 이식.
 * 계산은 전부 core/imagesize.ts(테스트됨). 여기는 입력 칸과 문장만.
 */
export default function ImageSizeDialog({
  open,
  source,
  initialDpi,
  onClose,
  onApply
}: {
  open: boolean
  /** 기준 이미지(선택 파일)의 원본 픽셀 크기 */
  source: { width: number; height: number } | null
  initialDpi: number | null
  onClose: () => void
  onApply: (r: ImageSizeResult) => void
}): JSX.Element {
  const src = source ?? { width: 1, height: 1 }
  const [st, setSt] = useState<ImageSizeState>(() => initialState(src, initialDpi ?? DEFAULT_DPI))
  // 입력 중인 문자열 (숫자로 확정되기 전 "12." 같은 중간 상태를 지우지 않게)
  const [draft, setDraft] = useState<{ width?: string; height?: string; dpi?: string }>({})

  useEffect(() => {
    if (open && source) {
      setSt(initialState(source, initialDpi ?? DEFAULT_DPI))
      setDraft({})
    }
  }, [open, source?.width, source?.height]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = validate(st)
  const shown = (which: 'width' | 'height'): string =>
    draft[which] ?? String(roundDisplay(toDisplay(which === 'width' ? st.width : st.height, which === 'width' ? src.width : src.height, st.unit, st.dpi), st.unit))
  const units = SIZE_UNITS.filter((u) => st.resample || (u.key !== 'px' && u.key !== 'percent'))

  const apply = (): void => {
    if (!v.ok) return
    const px = resultPixels(st)
    const unchanged = px.width === src.width && px.height === src.height
    onApply({
      width: st.resample && !unchanged ? px.width : null,
      height: st.resample && !unchanged ? px.height : null,
      dpi: st.dpi
    })
  }

  return (
    <ClassicDialog
      open={open}
      title="이미지 크기"
      onClose={onClose}
      onEnter={apply}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={apply} disabled={!v.ok}>
            확인
          </Button>
        </>
      }
    >
      <Box className="tnum" sx={{ color: color.textSecondary }}>
        현재: {src.width.toLocaleString()} × {src.height.toLocaleString()} 픽셀
      </Box>

      <GroupBox title="크기">
        <Row label="단위">
          <Select
            value={st.unit}
            onChange={(e) => {
              setDraft({})
              setSt({ ...st, unit: e.target.value as SizeUnit })
            }}
            sx={{ ...selectSx, width: 120 }}
            SelectDisplayProps={{ 'aria-label': '단위' } as React.HTMLAttributes<HTMLDivElement>}
          >
            {units.map((u) => (
              <MenuItem key={u.key} value={u.key}>
                {u.label}
              </MenuItem>
            ))}
          </Select>
        </Row>
        {(['width', 'height'] as const).map((k) => (
          <Row key={k} label={k === 'width' ? '폭' : '높이'}>
            <BarInput
              type="number"
              width={120}
              value={shown(k)}
              ariaLabel={k === 'width' ? '폭' : '높이'}
              onChange={(text) => {
                setDraft({ ...draft, [k]: text })
                const n = Number(text)
                if (text !== '' && Number.isFinite(n) && n > 0) setSt(setDimension(st, k, n, src))
              }}
            />
            <Box component="span" sx={{ color: color.textSecondary }}>
              {SIZE_UNITS.find((u) => u.key === st.unit)?.label}
            </Box>
          </Row>
        ))}
        <Check label="비율 유지" checked={st.lock} disabled={!st.resample} onChange={(lock) => setSt({ ...st, lock })} />
      </GroupBox>

      <GroupBox title="해상도">
        <Row label="해상도">
          <BarInput
            type="number"
            width={120}
            value={draft.dpi ?? String(Math.round(st.dpi * 1000) / 1000)}
            ariaLabel="해상도"
            onChange={(text) => {
              setDraft({ ...draft, dpi: text })
              const n = Number(text)
              if (text !== '' && Number.isFinite(n) && n > 0) setSt(setDpi(st, n))
            }}
          />
          <Box component="span" sx={{ color: color.textSecondary }}>
            픽셀/인치
          </Box>
        </Row>
        <Check
          label="리샘플 (픽셀 수 바꾸기)"
          checked={st.resample}
          onChange={(on) => {
            setDraft({})
            setSt(setResample(st, on, src))
          }}
        />
        <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>
          {st.resample
            ? '모든 레이어를 비율대로 늘이거나 줄입니다 (비파괴 — 레이어 원본 픽셀은 보존, 크게 줄일 때 2배씩 단계 축소로 선명하게).'
            : '인쇄 크기와 해상도만 바뀌고 픽셀은 그대로입니다. 내보내는 PNG·JPEG 의 DPI 에 반영됩니다.'}
        </Box>
      </GroupBox>

      <Note ok={v.ok}>{v.message}</Note>
    </ClassicDialog>
  )
}
