import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Tooltip from '@mui/material/Tooltip'
import HighlightAltRounded from '@mui/icons-material/HighlightAltRounded'
import FormatColorFillRounded from '@mui/icons-material/FormatColorFillRounded'
import BrushRounded from '@mui/icons-material/BrushRounded'
import CropSquareRounded from '@mui/icons-material/CropSquareRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import { editor, useEditor, useDoc } from '../../editor/store'
import * as A from '../../editor/actions'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

/** 패스 패널 — 펜 도구로 그린 패스 목록. 선택으로·채우기·붓으로 선·벡터 마스크·삭제 (포토샵 패스 패널의 핵심만) */
export default function PathsPanel(): JSX.Element {
  const doc = useDoc()
  const activeId = useEditor((s) => s.activePathId)
  const paths = doc?.paths ?? []
  const active = paths.find((p) => p.id === activeId) ?? null
  const btn = (icon: JSX.Element, tooltip: string, onClick: () => void, disabled = !active): JSX.Element => (
    <Tooltip title={tooltip} key={tooltip}>
      <span>
        <ButtonBase
          aria-label={tooltip}
          disabled={disabled}
          onClick={onClick}
          sx={{ width: 24, height: 22, color: disabled ? color.textDisabled : color.text, '& svg': { fontSize: 16 }, '&:hover': { outline: `1px solid ${color.hoverEdge}` } }}
        >
          {icon}
        </ButtonBase>
      </span>
    </Tooltip>
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }} aria-label="패스">
      <Box role="listbox" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', bgcolor: color.canvas }}>
        {paths.map((p) => {
          const on = p.id === activeId
          const n = p.subpaths.reduce((a, s) => a + s.anchors.length, 0)
          return (
            <Box
              key={p.id}
              role="option"
              aria-selected={on}
              onClick={() => editor.set({ activePathId: on ? null : p.id })}
              onDoubleClick={() => {
                const name = prompt('패스 이름', p.name)
                if (name && doc) editor.commit({ ...doc, paths: paths.map((x) => (x.id === p.id ? { ...x, name } : x)) }, '패스 이름')
              }}
              sx={{
                height: 22,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                px: `${space.md}px`,
                cursor: 'default',
                bgcolor: on ? color.accentSubtle : 'transparent',
                fontWeight: on ? font.bold : font.regular,
                '&:hover': { bgcolor: on ? color.accentSubtle : color.hover }
              }}
            >
              <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </Box>
              <Box component="span" sx={{ fontSize: font.xs, color: color.textSecondary }}>
                앵커 {n} · 서브패스 {p.subpaths.length}
                {p.subpaths.some((s) => !s.closed) ? ' (열림)' : ''}
              </Box>
            </Box>
          )
        })}
        {!paths.length && (
          <Box sx={{ p: `${space.md}px`, fontSize: font.xs, color: color.textSecondary, lineHeight: 1.7 }}>펜 도구(P)로 클릭해 앵커를 찍고 첫 앵커를 다시 누르면 닫힙니다. 끌면 곡선이 됩니다.</Box>
        )}
      </Box>
      <Box sx={{ height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px', px: `${space.sm}px`, background: surface.toolbar, borderTop: `1px solid ${chrome.frame}` }}>
        {btn(
          <AddRounded />,
          '새 패스 (펜 도구로)',
          () => {
            editor.set({ activePathId: null })
            editor.setTool('pen')
          },
          !doc
        )}
        <Box sx={{ flex: 1 }} />
        {btn(<HighlightAltRounded />, '패스를 선택으로 (Shift: 더하기, Alt: 빼기)', () => active && A.pathToSelection(active.id, 'replace'))}
        {btn(<FormatColorFillRounded />, '패스 안을 전경색으로 채우기', () => active && A.fillPath(active.id))}
        {btn(<BrushRounded />, '패스를 따라 붓으로 선 그리기', () => active && A.strokePath(active.id))}
        {btn(<CropSquareRounded />, '활성 레이어의 벡터 마스크로', () => active && A.setVectorMask(active.id))}
        {btn(<DeleteOutlineRounded />, '패스 삭제', () => active && A.deletePath(active.id))}
      </Box>
    </Box>
  )
}
