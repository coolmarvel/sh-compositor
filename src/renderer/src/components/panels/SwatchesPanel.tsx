import { useState } from 'react'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import ButtonBase from '@mui/material/ButtonBase'
import AddRounded from '@mui/icons-material/AddRounded'
import { editor, useEditor } from '../../editor/store'
import { ui } from '../../theme'

const { color, space, font } = ui

type RGB = [number, number, number]
const KEY = 'sc.swatches'
const hex = (c: RGB): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** 기본 견본 — 흑백 단계 + 색상환 12색 × 밝기 3단계 (포토샵 기본 견본과 비슷한 구성) */
const BASE: string[] = (() => {
  const out = ['#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff']
  const hsl = (h: number, s: number, l: number): string => {
    const k = (n: number): number => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return hex([Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)])
  }
  for (const l of [0.35, 0.5, 0.72]) for (let h = 0; h < 360; h += 30) out.push(hsl(h, 0.85, l))
  return out
})()

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)) : []
  } catch {
    return []
  }
}

/**
 * 견본 — 클릭 = 전경색, Alt+클릭 = 배경색. + 로 지금 전경색을 내 견본에 더하고, 내 견본은 오른쪽 클릭으로 지운다.
 * 최근에 고른 색도 함께 보인다 (색 선택 대화상자 기록).
 */
export default function SwatchesPanel(): JSX.Element {
  const fg = useEditor((s) => s.fg)
  const [mine, setMine] = useState<string[]>(load)
  const save = (list: string[]): void => {
    setMine(list)
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 96)))
    } catch {
      /* 무시 */
    }
  }
  let recent: string[] = []
  try {
    recent = JSON.parse(localStorage.getItem('sc.recentColors') ?? '[]')
  } catch {
    recent = []
  }
  const chip = (c: string, removable: boolean): JSX.Element => (
    <Tooltip key={c + removable} title={`${c} (클릭: 전경색, Alt+클릭: 배경색${removable ? ', 오른쪽 클릭: 지우기' : ''})`}>
      <ButtonBase
        aria-label={`견본 ${c}`}
        onClick={(e) => editor.set(e.altKey ? { bg: fromHex(c) } : { fg: fromHex(c) })}
        onContextMenu={(e) => {
          e.preventDefault()
          if (removable) save(mine.filter((x) => x !== c))
        }}
        sx={{ width: 16, height: 16, bgcolor: c, border: `1px solid ${color.borderStrong}`, '&:hover': { outline: `1px solid ${color.hoverEdge}` } }}
      />
    </Tooltip>
  )
  const section = (title: string, children: JSX.Element[]): JSX.Element => (
    <Box sx={{ mb: `${space.base}px` }}>
      <Box sx={{ fontSize: font.xs, color: color.textSecondary, mb: '3px' }}>{title}</Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>{children}</Box>
    </Box>
  )
  return (
    <Box sx={{ p: `${space.sm}px ${space.base}px`, overflowY: 'auto', height: '100%', bgcolor: color.canvas }} aria-label="견본">
      {section('내 견본', [
        ...mine.map((c) => chip(c, true)),
        <Tooltip key="add" title="지금 전경색을 내 견본에 더하기">
          <ButtonBase
            aria-label="견본 더하기"
            onClick={() => !mine.includes(hex(fg)) && save([...mine, hex(fg)])}
            sx={{ width: 16, height: 16, border: `1px dashed ${color.borderStrong}`, '& svg': { fontSize: 13 } }}
          >
            <AddRounded />
          </ButtonBase>
        </Tooltip>
      ])}
      {recent.length > 0 &&
        section(
          '최근 색',
          recent.slice(0, 16).map((c) => chip(c, false))
        )}
      {section(
        '기본',
        BASE.map((c) => chip(c, false))
      )}
    </Box>
  )
}
