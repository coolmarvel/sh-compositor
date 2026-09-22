import { useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

/** 패널 묶음 — 위에 탭(포토샵 패널 그룹처럼), 아래에 고른 패널. 고른 탭은 기억한다 */
export default function PanelTabs({ id, tabs }: { id: string; tabs: { key: string; label: string; render: () => JSX.Element }[] }): JSX.Element {
  const storeKey = `sc.panel.${id}`
  const [cur, setCur] = useState<string>(() => {
    try {
      const v = localStorage.getItem(storeKey)
      return tabs.some((t) => t.key === v) ? v! : tabs[0].key
    } catch {
      return tabs[0].key
    }
  })
  const pick = (k: string): void => {
    setCur(k)
    try {
      localStorage.setItem(storeKey, k)
    } catch {
      /* 무시 */
    }
  }
  const active = tabs.find((t) => t.key === cur) ?? tabs[0]
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        role="tablist"
        sx={{
          height: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          px: '2px',
          // 패널이 좁으면 탭 줄을 가로로 밀어 본다 (탭 글자가 잘리거나 줄바꿈되지 않게)
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          background: surface.toolbar,
          borderTop: `1px solid ${chrome.frame}`,
          borderBottom: `1px solid ${chrome.frame}`
        }}
      >
        {tabs.map((t) => (
          <ButtonBase
            key={t.key}
            role="tab"
            aria-selected={t.key === active.key}
            onClick={() => pick(t.key)}
            sx={{
              height: t.key === active.key ? 21 : 19,
              px: `${space.md}px`,
              flexShrink: 0,
              mb: t.key === active.key ? '-1px' : 0,
              fontSize: font.md,
              fontWeight: t.key === active.key ? font.bold : font.regular,
              border: `1px solid ${chrome.frame}`,
              borderBottom: t.key === active.key ? `1px solid ${color.canvas}` : `1px solid ${chrome.frame}`,
              background: t.key === active.key ? color.canvas : 'transparent',
              whiteSpace: 'nowrap'
            }}
          >
            {t.label}
          </ButtonBase>
        ))}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, bgcolor: color.canvas }}>{active.render()}</Box>
    </Box>
  )
}
