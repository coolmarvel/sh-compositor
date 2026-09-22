import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Tooltip from '@mui/material/Tooltip'
import OpenWithRounded from '@mui/icons-material/OpenWithRounded'
import HighlightAltRounded from '@mui/icons-material/HighlightAltRounded'
import GestureRounded from '@mui/icons-material/GestureRounded'
import AutoFixNormalRounded from '@mui/icons-material/AutoFixNormalRounded'
import CropRounded from '@mui/icons-material/CropRounded'
import CenterFocusStrongOutlined from '@mui/icons-material/CenterFocusStrongOutlined'
import BrushRounded from '@mui/icons-material/BrushRounded'
import AutoFixOffRounded from '@mui/icons-material/AutoFixOffRounded'
import HealingRounded from '@mui/icons-material/HealingRounded'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import WaterDropOutlined from '@mui/icons-material/WaterDropOutlined'
import GradientRounded from '@mui/icons-material/GradientRounded'
import CategoryOutlined from '@mui/icons-material/CategoryOutlined'
import TitleRounded from '@mui/icons-material/TitleRounded'
import ColorizeRounded from '@mui/icons-material/ColorizeRounded'
import PanToolOutlined from '@mui/icons-material/PanToolOutlined'
import ZoomInRounded from '@mui/icons-material/ZoomInRounded'
import SwapVertRounded from '@mui/icons-material/SwapVertRounded'
import { editor, useEditor, type Tool } from '../editor/store'
import { TOOLS } from '../tools'
import { ui } from '../theme'

const { color, chrome, space, surface } = ui

const ICONS: Record<string, JSX.Element> = {
  move: <OpenWithRounded />,
  marquee: <HighlightAltRounded />,
  lasso: <GestureRounded />,
  wand: <AutoFixNormalRounded />,
  objectSelect: <CenterFocusStrongOutlined />,
  crop: <CropRounded />,
  brush: <BrushRounded />,
  spotHealing: <HealingRounded />,
  cloneStamp: <ContentCopyRounded />,
  blur: <WaterDropOutlined />,
  gradient: <GradientRounded />,
  shape: <CategoryOutlined />,
  type: <TitleRounded />,
  eyedropper: <ColorizeRounded />,
  hand: <PanToolOutlined />,
  zoom: <ZoomInRounded />
}

/** 도구 사이의 구분 (Compositor 도구 레일의 묶음: 이동·선택 / 자르기 / 칠하기·리터칭 / 그리기 / 보기) */
const GROUP_BREAK = new Set<Tool>(['crop', 'brush', 'gradient', 'eyedropper'])

/**
 * 왼쪽 도구 레일 — Compositor `toolRail`. 아이콘 하나씩, 툴팁에 이름·단축키.
 * 아래에 전경/배경색 칸 (클릭 = 색 선택, ⇅ = 바꾸기, 작은 칸 = 기본 흑백).
 */
export default function ToolRail(): JSX.Element {
  const tool = useEditor((s) => s.tool)
  const brushMode = useEditor((s) => s.settings.brushMode)
  const fg = useEditor((s) => s.fg)
  const bg = useEditor((s) => s.bg)
  const rgb = (c: number[]): string => `rgb(${c.join(',')})`
  return (
    <Box
      role="toolbar"
      aria-label="도구"
      sx={{
        width: 36,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: `${space.sm}px`,
        gap: '1px',
        background: surface.toolbar,
        borderRight: `1px solid ${chrome.frame}`,
        overflowY: 'auto'
      }}
    >
      {TOOLS.map((t) => (
        <Box key={t.key} sx={{ display: 'contents' }}>
          {GROUP_BREAK.has(t.key) && <Box aria-hidden sx={{ width: 22, my: '3px', borderTop: `1px solid ${chrome.separator}`, borderBottom: `1px solid ${color.canvas}` }} />}
          <Tooltip
            placement="right"
            title={
              <Box sx={{ maxWidth: 240 }}>
                <b>
                  {t.key === 'brush' && brushMode === 'erase' ? '지우개' : t.label} ({t.shortcut})
                </b>
                <Box sx={{ mt: '2px', wordBreak: 'keep-all' }}>{t.desc}</Box>
              </Box>
            }
          >
            <ButtonBase
              aria-label={t.label}
              aria-pressed={tool === t.key}
              data-tool={t.key}
              onClick={() => editor.setTool(t.key)}
              sx={{
                width: 28,
                height: 26,
                border: '1px solid transparent',
                color: color.text,
                '& svg': { fontSize: 17 },
                '&:hover': { bgcolor: color.canvas, borderColor: color.hoverEdge },
                ...(tool === t.key ? { background: surface.pressed, borderColor: chrome.toolbarEdge, boxShadow: `inset 1px 1px 0 ${chrome.pressed}` } : null)
              }}
            >
              {t.key === 'brush' && brushMode === 'erase' ? <AutoFixOffRounded /> : ICONS[t.key]}
            </ButtonBase>
          </Tooltip>
        </Box>
      ))}
      <Box sx={{ flex: 1 }} />
      {/* 전경/배경색 */}
      <Box sx={{ position: 'relative', width: 30, height: 34, mt: `${space.base}px` }}>
        <Tooltip title="배경색 (누르면 색을 고릅니다)" placement="right">
          <ButtonBase
            aria-label="배경색"
            onClick={() => editor.set({ dialog: { kind: 'color', which: 'bg' } })}
            sx={{ position: 'absolute', right: 0, bottom: 4, width: 18, height: 18, bgcolor: rgb(bg), border: `1px solid ${color.text}`, outline: `1px solid ${color.canvas}` }}
          />
        </Tooltip>
        <Tooltip title="전경색 (누르면 색을 고릅니다)" placement="right">
          <ButtonBase
            aria-label="전경색"
            onClick={() => editor.set({ dialog: { kind: 'color', which: 'fg' } })}
            sx={{ position: 'absolute', left: 0, top: 0, width: 18, height: 18, bgcolor: rgb(fg), border: `1px solid ${color.text}`, outline: `1px solid ${color.canvas}` }}
          />
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', gap: '2px', mb: `${space.sm}px` }}>
        <Tooltip title="전경/배경 바꾸기 (X)" placement="right">
          <ButtonBase aria-label="색 바꾸기" onClick={() => editor.set({ fg: bg, bg: fg })} sx={{ width: 14, height: 14, '& svg': { fontSize: 13 } }}>
            <SwapVertRounded />
          </ButtonBase>
        </Tooltip>
        <Tooltip title="기본 흑백 (D)" placement="right">
          <ButtonBase aria-label="기본 색" onClick={() => editor.set({ fg: [0, 0, 0], bg: [255, 255, 255] })} sx={{ width: 14, height: 14, position: 'relative' }}>
            <Box sx={{ position: 'absolute', left: 1, top: 1, width: 7, height: 7, bgcolor: '#000' }} />
            <Box sx={{ position: 'absolute', right: 1, bottom: 1, width: 7, height: 7, bgcolor: '#fff', border: '1px solid #000' }} />
          </ButtonBase>
        </Tooltip>
      </Box>
    </Box>
  )
}
