import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Popover from '@mui/material/Popover'
import Slider from '@mui/material/Slider'
import ButtonBase from '@mui/material/ButtonBase'
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded'
import { ui } from '../theme'

/**
 * 툴바·옵션 바 공용 부품 — 클래식 문법(v1.4.0~, sh-messenger·remote-assist 계열).
 * 직각 · 1px 테두리 · 24px 컨트롤 · 12px 라벨 · 베벨 면. 그룹은 "라벨: 컨트롤" 텍스트 문법,
 * 그룹 사이는 음각 세로 구분선. 색·크기는 전부 tokens.ts.
 */
const { color, chrome, size, space, font, surface } = ui

/** 통일된 컨트롤 높이 */
export const CTL_H = size.ctlMd

export const selectSx = {
  height: CTL_H,
  fontSize: font.md,
  bgcolor: color.input,
  '& .MuiSelect-select': { py: 0, pl: `${space.sm}px`, pr: '20px !important', display: 'flex', alignItems: 'center' }
} as const

/** 베벨 면 박스 버튼 공통 (팔레트·슬라이더 팝오버 트리거) */
export const bevelSx = {
  height: CTL_H,
  px: `${space.md}px`,
  border: `1px solid ${color.buttonBorder}`,
  background: surface.bevel,
  color: color.text,
  fontSize: font.md,
  display: 'flex',
  alignItems: 'center',
  gap: `${space.xs}px`,
  '&:hover': { background: surface.bevelHover, borderColor: color.hoverEdge },
  '&:active': { background: surface.bevelPressed },
  '&.Mui-focusVisible': { outline: `1px dotted ${color.text}`, outlineOffset: '-3px' },
  '&.Mui-disabled': { color: color.textDisabled, borderColor: color.border, background: color.sunken }
} as const

/** 켜진(눌린) 상태 — DEXT5 pressed 면 + edge 테두리 (sh-web-editor: 굵게 켜짐·열린 드롭다운) */
const pressedSx = {
  background: surface.pressed,
  borderColor: chrome.toolbarEdge,
  color: color.text,
  boxShadow: `inset 1px 1px 0 ${chrome.pressed}`,
  '&:hover': { background: surface.pressed, borderColor: color.hoverEdge }
} as const

/** 그룹: "라벨" + 컨트롤 (라벨에 툴팁). 클래식은 아이콘보다 글자 라벨 */
export function Group({ label, tooltip, children }: { label?: string; tooltip?: string; children: React.ReactNode }): JSX.Element {
  const lab = label ? (
    <Box component="span" sx={{ fontSize: font.md, color: color.textSecondary, whiteSpace: 'nowrap', mr: `${space.xs}px` }}>
      {label}
    </Box>
  ) : null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px`, flexShrink: 0 }}>
      {lab && (tooltip ? <Tooltip title={tooltip}>{lab}</Tooltip> : lab)}
      {children}
    </Box>
  )
}

/** 음각 세로 구분선 (진한 선 + 흰 선) */
export function GDivider(): JSX.Element {
  return <Box aria-hidden sx={{ width: '2px', height: 18, flexShrink: 0, mx: `${space.xs}px`, borderLeft: `1px solid ${chrome.separator}`, borderRight: `1px solid ${color.canvas}` }} />
}

/** 바 안에서 쓰는 소형 인풋 (텍스트/숫자) */
export function BarInput({
  value,
  onChange,
  placeholder,
  width = 120,
  type = 'text',
  ariaLabel,
  onCommit
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
  type?: 'text' | 'number'
  ariaLabel?: string
  /** Enter 로 확정 */
  onCommit?: () => void
}): JSX.Element {
  return (
    <Box
      component="input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') onCommit?.()
      }}
      className="tnum"
      sx={{
        height: CTL_H,
        width,
        px: `${space.sm}px`,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: 0,
        bgcolor: color.input,
        color: color.text,
        fontSize: font.md,
        fontFamily: 'inherit',
        outline: 'none',
        '&:focus': { borderColor: color.accent },
        '&::placeholder': { color: color.textMuted },
        // 숫자 인풋 스피너 숨김 (좁은 바 안에서 자리만 차지)
        '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': { WebkitAppearance: 'none', m: 0 }
      }}
    />
  )
}

/** 무채색 + 원색 기본 팔레트 (클래식 그림판식 정사각 칸) */
const PALETTE: string[][] = [
  ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4'],
  ['#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7']
]

function Swatch({ c, selected, onClick }: { c: string; selected: boolean; onClick: () => void }): JSX.Element {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={c}
      sx={{
        width: 18,
        height: 18,
        bgcolor: c,
        border: `1px solid ${color.borderStrong}`,
        outline: selected ? `2px solid ${color.accent}` : 'none',
        outlineOffset: 1
      }}
    />
  )
}

/** [라벨] + 색 칸 버튼(▾) → 팔레트 팝오버 */
export function PaletteControl({ value, onChange, title, label }: { value: string; onChange: (c: string) => void; title: string; label?: string }): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const customRef = useRef<HTMLInputElement>(null)
  return (
    <Group label={label} tooltip={title}>
      <Tooltip title={title}>
        <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} sx={bevelSx}>
          <Box sx={{ width: 14, height: 14, bgcolor: value, border: `1px solid ${color.borderStrong}` }} />
          <ArrowDropDownRounded sx={{ fontSize: size.icon, color: color.textSecondary }} />
        </ButtonBase>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: `${space.base}px`, display: 'flex', flexDirection: 'column', gap: `${space.sm}px` }}>
          {PALETTE.map((row, ri) => (
            <Box key={ri} sx={{ display: 'flex', gap: `${space.xs}px` }}>
              {row.map((c) => (
                <Swatch key={c} c={c} selected={value.toLowerCase() === c.toLowerCase()} onClick={() => onChange(c)} />
              ))}
            </Box>
          ))}
          <ButtonBase onClick={() => customRef.current?.click()} sx={{ ...bevelSx, justifyContent: 'center', position: 'relative', mt: `${space.xs}px` }}>
            다른 색…
            <input ref={customRef} type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          </ButtonBase>
        </Box>
      </Popover>
    </Group>
  )
}

/** 켜기/끄기 토글 버튼 — 켜지면 오목하게 눌린 면 (워터마크·흑백·자르기 등 공용) */
export function ToggleChip({ icon, label, tooltip, on, onClick, disabled }: { icon?: JSX.Element; label: string; tooltip: string; on: boolean; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <Tooltip title={tooltip}>
      <span>
        <ButtonBase
          onClick={onClick}
          disabled={disabled}
          aria-pressed={on}
          sx={{ ...bevelSx, px: `${space.base}px`, gap: `${space.sm}px`, flexShrink: 0, '& svg': { fontSize: size.icon }, ...(on ? pressedSx : null) }}
        >
          {icon}
          <Box component="span" sx={{ fontWeight: font.semibold, whiteSpace: 'nowrap' }}>
            {label}
          </Box>
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

/** 정사각 아이콘 토글 (반전 등) */
export function IconToggle({ icon, tooltip, on, onClick }: { icon: JSX.Element; tooltip: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <Tooltip title={tooltip}>
      <ButtonBase
        onClick={onClick}
        aria-pressed={on}
        aria-label={tooltip}
        sx={{ ...bevelSx, width: CTL_H, px: 0, justifyContent: 'center', '& svg': { fontSize: size.icon }, ...(on ? pressedSx : null) }}
      >
        {icon}
      </ButtonBase>
    </Tooltip>
  )
}

/** 정사각 아이콘 버튼 (베벨 면) */
export function IconBevel({ icon, tooltip, onClick, disabled }: { icon: JSX.Element; tooltip: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <Tooltip title={tooltip}>
      <span>
        <ButtonBase onClick={onClick} disabled={disabled} aria-label={tooltip} sx={{ ...bevelSx, width: CTL_H, px: 0, justifyContent: 'center', '& svg': { fontSize: size.icon } }}>
          {icon}
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

/** [라벨] + 값 버튼(▾) → 슬라이더 팝오버 (품질·크기·진하기 등 공용) */
export function SliderControl({
  label,
  tooltip,
  value,
  min,
  max,
  step = 1,
  format,
  onChange
}: {
  label?: string
  tooltip: string
  value: number
  min: number
  max: number
  step?: number
  format: (v: number) => string
  onChange: (v: number) => void
}): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <Group label={label} tooltip={tooltip}>
      <Tooltip title={tooltip}>
        <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} sx={{ ...bevelSx, minWidth: 54, justifyContent: 'space-between' }}>
          <Box component="span" className="tnum" sx={{ whiteSpace: 'nowrap' }}>
            {format(value)}
          </Box>
          <ArrowDropDownRounded sx={{ fontSize: size.icon, color: color.textSecondary }} />
        </ButtonBase>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ px: `${space.lg}px`, py: `${space.sm}px`, width: 220, display: 'flex', alignItems: 'center', gap: `${space.lg}px` }}>
          <Slider min={min} max={max} step={step} value={value} onChange={(_, v) => onChange(v as number)} aria-label={tooltip} />
          <Box component="span" className="tnum" sx={{ width: 40, textAlign: 'right', fontSize: font.md, whiteSpace: 'nowrap' }}>
            {format(value)}
          </Box>
        </Box>
      </Popover>
    </Group>
  )
}

/** 툴바 버튼 — 테두리 없는 평면, 호버에 1px accent 테두리 + 흰 면 (sh-web-editor 도구 버튼 문법) */
export function ToolButton({
  icon,
  label,
  tooltip,
  onClick,
  disabled,
  active
}: {
  icon: JSX.Element
  label?: string
  tooltip: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}): JSX.Element {
  return (
    <Tooltip title={tooltip}>
      <span>
        <ButtonBase
          onClick={onClick}
          disabled={disabled}
          aria-label={label ? undefined : tooltip}
          aria-pressed={active}
          sx={{
            height: CTL_H,
            px: label ? `${space.md}px` : 0,
            minWidth: CTL_H,
            gap: `${space.sm}px`,
            border: '1px solid transparent',
            color: color.text,
            fontSize: font.md,
            flexShrink: 0,
            '& svg': { fontSize: size.icon, color: color.textSecondary },
            '&:hover': { bgcolor: color.canvas, borderColor: color.hoverEdge },
            '&:active': { background: surface.pressed, borderColor: chrome.toolbarEdge },
            '&.Mui-focusVisible': { outline: `1px dotted ${color.text}`, outlineOffset: '-3px' },
            '&.Mui-disabled': { color: color.textDisabled, '& svg': { color: color.textDisabled } },
            ...(active ? { ...pressedSx, '& svg': { color: color.accentPressed } } : null)
          }}
        >
          {icon}
          {label && (
            <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
              {label}
            </Box>
          )}
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

/** 옵션 바 안내 문구 */
export function Hint({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Box component="span" sx={{ fontSize: font.md, color: color.textSecondary, px: `${space.sm}px`, whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  )
}
