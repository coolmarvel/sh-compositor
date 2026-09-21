import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import { ui } from '../../theme'

const { color, chrome, size, space, font, surface } = ui

/** 클래식 탭 — 활성 = 흰 면 + 테두리(아래선 없음), 비활성 = 툴바 면 (remote-assist monitor-tab) */
export function ClassicTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (t: T) => void; tabs: { key: T; label: string }[] }): JSX.Element {
  return (
    <Box role="tablist" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', borderBottom: `1px solid ${chrome.frame}`, mb: `-${space.xs}px` }}>
      {tabs.map((t) => (
        <ButtonBase
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          sx={{
            height: value === t.key ? size.ctlMd : size.ctlSm,
            px: `${space.base + 2}px`,
            fontSize: font.md,
            border: `1px solid ${chrome.frame}`,
            borderBottom: value === t.key ? `1px solid ${color.canvas}` : `1px solid ${chrome.frame}`,
            mb: '-1px',
            background: value === t.key ? color.canvas : surface.toolbar,
            fontWeight: value === t.key ? font.bold : font.regular
          }}
        >
          {t.label}
        </ButtonBase>
      ))}
    </Box>
  )
}
