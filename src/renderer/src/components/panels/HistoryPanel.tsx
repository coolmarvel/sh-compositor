import Box from '@mui/material/Box'
import { editor, useEditor } from '../../editor/store'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

/** 작업 내역 — 과거 칸을 누르면 그 시점까지 실행취소, 미래 칸은 다시 실행 (Photoshop History 패널) */
export default function HistoryPanel(): JSX.Element {
  const h = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.history ?? null)
  const rows = h ? [...h.past.map((p) => p.label), h.label, ...h.future.map((f) => f.label)] : []
  const cur = h ? h.past.length : -1
  const jump = (i: number): void => {
    for (let k = cur; k > i; k--) editor.undo()
    for (let k = cur; k < i; k++) editor.redo()
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }} aria-label="작업 내역">
      <Box
        sx={{
          height: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          px: `${space.md}px`,
          fontWeight: font.bold,
          background: surface.toolbar,
          borderBottom: `1px solid ${chrome.frame}`,
          borderTop: `1px solid ${chrome.frame}`
        }}
      >
        작업 내역
      </Box>
      <Box role="listbox" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', bgcolor: color.canvas }}>
        {rows.map((label, i) => (
          <Box
            key={i}
            role="option"
            aria-selected={i === cur}
            onClick={() => jump(i)}
            sx={{
              height: 20,
              display: 'flex',
              alignItems: 'center',
              px: `${space.md}px`,
              cursor: 'default',
              bgcolor: i === cur ? color.accentSubtle : 'transparent',
              color: i > cur ? color.textDisabled : color.text,
              fontWeight: i === cur ? font.bold : font.regular,
              '&:hover': { bgcolor: i === cur ? color.accentSubtle : color.hover }
            }}
          >
            {label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
