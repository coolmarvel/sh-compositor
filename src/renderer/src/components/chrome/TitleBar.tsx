import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import { ui } from '../../theme'
import appIconUrl from '../../assets/app-icon.png'

const { color, chrome, size, space, font, surface } = ui

/** 창 버튼 글리프 — 클래식 1px 선 아이콘 (폰트 아이콘보다 또렷) */
function Glyph({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }): JSX.Element {
  const common = { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1, shapeRendering: 'crispEdges' as const }
  if (kind === 'min')
    return (
      <svg {...common}>
        <path d="M0 5.5h10" />
      </svg>
    )
  if (kind === 'max')
    return (
      <svg {...common}>
        <rect x="0.5" y="0.5" width="9" height="9" />
      </svg>
    )
  if (kind === 'restore')
    return (
      <svg {...common}>
        <rect x="0.5" y="2.5" width="7" height="7" />
        <path d="M2.5 2.5V0.5h7v7h-2" />
      </svg>
    )
  return (
    <svg {...common} shapeRendering="geometricPrecision">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  )
}

/**
 * 앱이 그리는 타이틀바 (프레임 없는 창) — sh-messenger title-bar 문법.
 * canvas→sunken 세로 그라데이션 띠 + 1px 진한 선, 창 버튼은 40px 폭. 더블클릭 = 최대화/복원.
 */
export default function TitleBar({ title = 'SH Compositor', subtitle }: { title?: string; subtitle?: string }): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    window.api.win
      ?.isMaximized()
      .then(setMaximized)
      .catch(() => {})
    window.api.win?.onMaximized(setMaximized)
  }, [])

  const ctl = (kind: 'min' | 'max' | 'close', onClick: () => void, label: string): JSX.Element => (
    <ButtonBase
      onClick={onClick}
      aria-label={label}
      title={label}
      sx={{
        width: 40,
        height: '100%',
        color: color.textSecondary,
        '&:hover': kind === 'close' ? { bgcolor: color.danger, color: color.textOnAccent } : { bgcolor: chrome.toolbarLight, color: color.text },
        '&:active': kind === 'close' ? { bgcolor: color.accentPressed } : { background: surface.pressed },
        '&.Mui-focusVisible': { outline: `1px dotted ${color.text}`, outlineOffset: '-3px' }
      }}
    >
      <Glyph kind={kind === 'max' ? (maximized ? 'restore' : 'max') : kind} />
    </ButtonBase>
  )

  return (
    <Box
      onDoubleClick={() => void window.api.win?.toggleMaximize().then(setMaximized)}
      sx={{
        height: size.titleBar,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        background: surface.chrome,
        borderBottom: `1px solid ${chrome.frame}`,
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      }}
    >
      <Box component="img" src={appIconUrl} alt="" sx={{ width: size.icon, height: size.icon, mx: `${space.base}px` }} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: `${space.base}px`, overflow: 'hidden' }}>
        <Box component="span" sx={{ fontSize: font.md, fontWeight: font.bold, whiteSpace: 'nowrap', color: color.text }}>
          {title}
        </Box>
        {subtitle && (
          <Box component="span" sx={{ fontSize: font.md, color: color.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            — {subtitle}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' }} onDoubleClick={(e) => e.stopPropagation()}>
        {ctl('min', () => void window.api.win?.minimize(), '최소화')}
        {ctl('max', () => void window.api.win?.toggleMaximize().then(setMaximized), maximized ? '이전 크기로' : '최대화')}
        {ctl('close', () => void window.api.win?.close(), '닫기')}
      </Box>
    </Box>
  )
}
