import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import { ui } from '../../theme'
import signUrl from '../../assets/sign.png'

const { color, chrome, size, space, font, surface } = ui

export interface StatusBarProps {
  /** 왼쪽 문장 (진행 중이면 진행 문구) */
  message: string
  /** 진행률 — undefined = 진행 없음, null = 불확정 */
  progress?: number | null
  /** 오른쪽 계측 칸들 (예: "파일 3개", "1920×1080 → 1280×720", "100%") */
  panes: React.ReactNode[]
}

/** 오목한 칸 — 클래식 상태 줄 패널 */
function Pane({ children, grow }: { children: React.ReactNode; grow?: boolean }): JSX.Element {
  return (
    <Box
      className="tnum"
      sx={{
        height: 16,
        px: `${space.md}px`,
        display: 'flex',
        alignItems: 'center',
        gap: `${space.md}px`,
        flex: grow ? 1 : 'none',
        minWidth: 0,
        borderTop: `1px solid ${chrome.statusTop}`,
        borderLeft: `1px solid ${chrome.statusTop}`,
        borderRight: `1px solid ${color.canvas}`,
        borderBottom: `1px solid ${color.canvas}`,
        fontSize: font.xs,
        color: color.textSecondary,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {children}
    </Box>
  )
}

/** 하단 상태 줄 (22px) — 진행률·크기·배율을 여기서 본다 (remote-assist status-bar 문법) */
export default function StatusBar({ message, progress, panes }: StatusBarProps): JSX.Element {
  const busy = progress !== undefined
  return (
    <Box
      sx={{
        height: size.statusBar,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: `${space.xs}px`,
        px: `${space.xs}px`,
        background: surface.status,
        borderTop: `1px solid ${chrome.frame}`
      }}
    >
      <Pane grow>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', color: busy ? color.text : undefined }}>
          {message}
        </Box>
        {busy && <LinearProgress variant={progress != null ? 'determinate' : 'indeterminate'} value={progress ?? 0} sx={{ width: 160, height: 10, flexShrink: 0, ml: 'auto' }} />}
      </Pane>
      {panes.map((p, i) => (
        <Pane key={i}>{p}</Pane>
      ))}
      <Pane>
        제작 이성현 © 2026
        <Box component="img" src={signUrl} alt="이성현 서명" sx={{ height: 12, opacity: 0.8 }} />
      </Pane>
    </Box>
  )
}
