import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Slider from '@mui/material/Slider'
import { BarInput } from '../bar'
import { ui } from '../../theme'

const { color, chrome, space, font } = ui

/**
 * 대화상자 공용 틀 — 클래식: 그라데이션 제목 띠 + 본문 + 오른쪽 정렬 버튼 줄(회색 바탕).
 * Enter = 확인, Esc = 취소 (Compositor 시트의 keyboardShortcut(.defaultAction/.cancelAction) 과 같은 약속).
 * 제목 띠를 끌면 창을 옮긴다 (sh-web-editor 대화상자 — 미리보기를 가리지 않게 비켜 둘 수 있다).
 */
export function ClassicDialog({
  open,
  title,
  onClose,
  onEnter,
  actions,
  children,
  width = 440
}: {
  open: boolean
  title: string
  onClose: () => void
  onEnter?: () => void
  actions: React.ReactNode
  children: React.ReactNode
  width?: number
}): JSX.Element {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  useEffect(() => {
    if (open) setPos({ x: 0, y: 0 })
  }, [open])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{ sx: { width, transform: `translate(${pos.x}px, ${pos.y}px)` } }}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName
        if (e.key === 'Enter' && onEnter && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
          e.preventDefault()
          onEnter()
        }
      }}
    >
      <DialogTitle
        onPointerDown={(e) => {
          drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setPos({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        {title}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: `${space.base}px`, pt: `${space.lg}px !important` }}>{children}</DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  )
}

/** 그룹 박스 — 1px 테두리 위에 제목을 얹는 WPF GroupBox 모양 (remote-assist group-box) */
export function GroupBox({ title, children, sx }: { title: string; children: React.ReactNode; sx?: object }): JSX.Element {
  return (
    <Box
      component="fieldset"
      sx={{ m: 0, border: `1px solid ${chrome.frame}`, px: `${space.base}px`, pt: `${space.xs}px`, pb: `${space.base}px`, display: 'flex', flexDirection: 'column', gap: `${space.md}px`, ...sx }}
    >
      <Box component="legend" sx={{ px: `${space.sm}px`, fontWeight: font.bold, fontSize: font.md }}>
        {title}
      </Box>
      {children}
    </Box>
  )
}

/** 라벨(고정 폭) + 컨트롤 한 줄 */
export function Row({ label, children, labelWidth = 72 }: { label: string; children: React.ReactNode; labelWidth?: number }): JSX.Element {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.base}px` }}>
      <Box component="label" sx={{ width: labelWidth, flexShrink: 0, color: color.textSecondary }}>
        {label}
      </Box>
      {children}
    </Box>
  )
}

/** 체크박스 — 클래식 13px 네모 */
export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): JSX.Element {
  return (
    <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: `${space.sm}px`, color: disabled ? color.textDisabled : color.text }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 13, height: 13, margin: 0, accentColor: color.accent }} />
      {label}
    </Box>
  )
}

/** 슬라이더 + 숫자 칸 한 줄 (보정 대화상자) */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = '',
  labelWidth = 72
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  unit?: string
  labelWidth?: number
}): JSX.Element {
  return (
    <Row label={label} labelWidth={labelWidth}>
      <Slider value={value} min={min} max={max} step={step} onChange={(_, v) => onChange(v as number)} aria-label={label} sx={{ flex: 1 }} />
      <BarInput
        type="number"
        value={String(value)}
        width={56}
        ariaLabel={`${label} 값`}
        onChange={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
      />
      <Box component="span" sx={{ width: 20, color: color.textSecondary, fontSize: font.xs }}>
        {unit}
      </Box>
    </Row>
  )
}

/** 안내/결과 문장 (ok=false 면 경고 색) */
export function Note({ ok = true, children }: { ok?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <Box
      className="tnum"
      sx={{
        fontSize: font.md,
        px: `${space.md}px`,
        py: `${space.sm}px`,
        border: `1px solid ${ok ? color.border : color.danger}`,
        bgcolor: ok ? color.sunken : color.dangerSubtle,
        color: ok ? color.text : color.danger
      }}
    >
      {children}
    </Box>
  )
}
