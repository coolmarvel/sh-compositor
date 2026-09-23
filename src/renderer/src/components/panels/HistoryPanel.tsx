import { useEffect, useMemo, useRef } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Tooltip from '@mui/material/Tooltip'
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { editor, useEditor } from '../../editor/store'
import { historyBytes } from '@core/index'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

/**
 * 작업 내역 — 과거 칸을 누르면 그 시점까지 실행취소, 미래 칸은 다시 실행 (Photoshop History 패널).
 * 위에는 스냅샷: 이름 붙여 남긴 지점 (실행취소 한도를 넘어도 남고, 누르면 그 상태로 돌아간다).
 */
export default function HistoryPanel(): JSX.Element {
  const tab = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const limit = useEditor((s) => s.settings.historyLimit)
  const h = tab?.history ?? null
  const rows = h ? [...h.past.map((p) => p.label), h.label, ...h.future.map((f) => f.label)] : []
  const cur = h ? h.past.length : -1
  // 공유 비트맵은 한 번만 센 픽셀 메모리 (한도는 환경 설정)
  const mb = useMemo(() => (h ? Math.round(historyBytes(h) / (1024 * 1024)) : 0), [h])
  const jump = (i: number): void => {
    for (let k = cur; k > i; k--) editor.undo()
    for (let k = cur; k < i; k++) editor.redo()
  }
  // 새 칸이 생기면 아래로 따라간다
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [cur, rows.length])
  const row = (key: string | number, label: string, on: boolean, dim: boolean, onClick: () => void, extra?: JSX.Element): JSX.Element => (
    <Box
      key={key}
      role="option"
      aria-selected={on}
      onClick={onClick}
      sx={{
        height: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        px: `${space.md}px`,
        cursor: 'default',
        bgcolor: on ? color.accentSubtle : 'transparent',
        color: dim ? color.textDisabled : color.text,
        fontWeight: on ? font.bold : font.regular,
        '&:hover': { bgcolor: on ? color.accentSubtle : color.hover },
        '&:hover .snap-x': { visibility: 'visible' }
      }}
    >
      <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
      {extra}
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }} aria-label="작업 내역">
      {tab && tab.snapshots.length > 0 && (
        <Box aria-label="스냅샷" sx={{ maxHeight: 84, overflowY: 'auto', flexShrink: 0, borderBottom: `1px solid ${color.border}`, bgcolor: color.sunken }}>
          {tab.snapshots.map((s) =>
            row(
              s.id,
              s.name,
              h?.present === s.doc,
              false,
              () => editor.restoreSnapshot(s.id),
              <ButtonBase
                className="snap-x"
                aria-label={`${s.name} 지우기`}
                onClick={(e) => {
                  e.stopPropagation()
                  editor.removeSnapshot(s.id)
                }}
                sx={{ visibility: 'hidden', '& svg': { fontSize: 13, color: color.textSecondary } }}
              >
                <CloseRounded />
              </ButtonBase>
            )
          )}
        </Box>
      )}
      <Box ref={listRef} role="listbox" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', bgcolor: color.canvas }}>
        {rows.map((label, i) => row(i, label, i === cur, i > cur, () => jump(i)))}
      </Box>
      <Box sx={{ height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', px: `${space.sm}px`, background: surface.toolbar, borderTop: `1px solid ${chrome.frame}` }}>
        <Box component="span" sx={{ flex: 1, fontSize: font.xs, color: color.textSecondary }}>
          {h ? `${rows.length}칸 · 최대 ${limit}칸 · 약 ${mb}MB` : ''}
        </Box>
        <Tooltip title="스냅샷 만들기 (지금 상태를 이름 붙여 남깁니다)">
          <span>
            <ButtonBase
              aria-label="스냅샷 만들기"
              disabled={!tab}
              onClick={() => editor.addSnapshot()}
              sx={{ width: 22, height: 20, '& svg': { fontSize: 16 }, '&:hover': { outline: `1px solid ${color.hoverEdge}` } }}
            >
              <PhotoCameraOutlined />
            </ButtonBase>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}
