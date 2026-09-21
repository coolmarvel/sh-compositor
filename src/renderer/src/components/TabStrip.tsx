import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { editor, useEditor } from '../editor/store'
import { requestCloseTab } from '../editor/actions'
import { ui } from '../theme'

const { color, chrome, space, font, surface } = ui

/** 문서 탭 — Compositor `ProjectWorkspace` 탭. 가운데 클릭 = 닫기, ● = 저장 안 함 */
export default function TabStrip(): JSX.Element | null {
  const tabs = useEditor((s) => s.tabs)
  const active = useEditor((s) => s.activeTabId)
  if (tabs.length === 0) return null
  return (
    <Box
      role="tablist"
      aria-label="문서"
      sx={{
        height: 24,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-end',
        gap: '2px',
        px: `${space.sm}px`,
        background: surface.toolbar,
        borderBottom: `1px solid ${chrome.frame}`,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none'
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active
        const dirty = editor.isDirty(t)
        return (
          <Box
            key={t.id}
            role="tab"
            aria-selected={on}
            title={t.path ?? t.name}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                requestCloseTab(t.id)
              }
            }}
            onClick={() => editor.switchTab(t.id)}
            sx={{
              height: on ? 22 : 20,
              display: 'flex',
              alignItems: 'center',
              gap: `${space.sm}px`,
              pl: `${space.base}px`,
              pr: '2px',
              maxWidth: 220,
              flexShrink: 0,
              cursor: 'default',
              border: `1px solid ${chrome.frame}`,
              borderBottom: 'none',
              mb: on ? '-1px' : 0,
              background: on ? color.canvas : surface.toolbar,
              fontWeight: on ? font.bold : font.regular
            }}
          >
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </Box>
            {dirty && (
              <Box component="span" aria-label="저장 안 함" sx={{ color: color.accent, fontSize: 10 }}>
                ●
              </Box>
            )}
            <ButtonBase
              aria-label={`${t.name} 닫기`}
              onClick={(e) => {
                e.stopPropagation()
                requestCloseTab(t.id)
              }}
              sx={{ width: 16, height: 16, '& svg': { fontSize: 13, color: color.textSecondary }, '&:hover': { bgcolor: color.hover, outline: `1px solid ${color.hoverEdge}` } }}
            >
              <CloseRounded />
            </ButtonBase>
          </Box>
        )
      })}
    </Box>
  )
}
