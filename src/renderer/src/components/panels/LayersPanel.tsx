import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Menu from '@mui/material/Menu'
import Divider from '@mui/material/Divider'
import Tooltip from '@mui/material/Tooltip'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import ArrowRightRounded from '@mui/icons-material/ArrowRightRounded'
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import TitleRounded from '@mui/icons-material/TitleRounded'
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded'
import AddBoxOutlined from '@mui/icons-material/AddBoxOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderOutlined'
import ContrastRounded from '@mui/icons-material/ContrastRounded'
import CropSquareRounded from '@mui/icons-material/CropSquareRounded'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import GridOnRounded from '@mui/icons-material/GridOnRounded'
import BrushRounded from '@mui/icons-material/BrushRounded'
import OpenWithRounded from '@mui/icons-material/OpenWithRounded'
import LockRounded from '@mui/icons-material/LockRounded'
import CategoryOutlined from '@mui/icons-material/CategoryOutlined'
import { editor, useEditor, useDoc } from '../../editor/store'
import * as A from '../../editor/actions'
import { displayOrder, getLayer, updateLayer, setActive, moveLayerTo, setBlend, hasEffects, isEffectivelyVisible, BLEND_MODES, ADJUSTMENT_KINDS, type Layer } from '@core/index'
import { thumbUrl } from './thumb'
import { selectSx, IconToggle } from '../bar'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

const ROW_H = 38

function PanelTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Box sx={{ height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', px: `${space.md}px`, fontWeight: font.bold, background: surface.toolbar, borderBottom: `1px solid ${chrome.frame}` }}>
      {children}
    </Box>
  )
}

function FootButton({ icon, tooltip, onClick, disabled }: { icon: JSX.Element; tooltip: string; onClick: (e: React.MouseEvent<HTMLElement>) => void; disabled?: boolean }): JSX.Element {
  return (
    <Tooltip title={tooltip}>
      <span>
        <ButtonBase
          aria-label={tooltip}
          disabled={disabled}
          onClick={onClick}
          sx={{
            width: 24,
            height: 22,
            border: '1px solid transparent',
            color: color.text,
            '& svg': { fontSize: 16 },
            '&:hover': { bgcolor: color.canvas, borderColor: color.hoverEdge },
            '&.Mui-disabled': { color: color.textDisabled }
          }}
        >
          {icon}
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

/** 체커 배경 위 썸네일 칸 */
function Thumb({ url, active, onClick, label, icon }: { url?: string; active: boolean; onClick: (e: React.MouseEvent) => void; label: string; icon?: JSX.Element }): JSX.Element {
  return (
    <Box
      role="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        width: 30,
        height: 30,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${active ? color.accent : color.borderStrong}`,
        outline: active ? `1px solid ${color.accent}` : 'none',
        backgroundColor: '#fff',
        backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0,4px 4px',
        overflow: 'hidden',
        boxSizing: 'border-box',
        // 세로로 긴 이미지가 행 밖으로 넘치지 않게 칸 안에 가둔다 (2026-09-21 피드백)
        '& img': { width: '100%', height: '100%', minWidth: 0, minHeight: 0, objectFit: 'contain', display: 'block' },
        '& svg': { fontSize: 18, color: color.textSecondary }
      }}
    >
      {url ? <img src={url} alt="" draggable={false} /> : icon}
    </Box>
  )
}

/**
 * 레이어 패널 — Compositor `LayersPanel`: 위 = 앞. 눈·썸네일·마스크 썸네일·이름, 혼합 모드·불투명도,
 * 끌어서 순서/폴더 넣기, Ctrl/Shift 다중 선택, 더블클릭 이름 바꾸기, 썸네일 Ctrl+클릭 = 픽셀 선택, 오른쪽 클릭 메뉴.
 */
export default function LayersPanel(): JSX.Element {
  const doc = useDoc()
  const selectedIds = useEditor((s) => s.selectedIds)
  const maskEditing = useEditor((s) => s.maskEditing)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; where: 'above' | 'below' | 'inside' } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [adjMenu, setAdjMenu] = useState<HTMLElement | null>(null)
  const dragId = useRef<string | null>(null)
  const anchorId = useRef<string | null>(null)

  const active = doc ? getLayer(doc, doc.activeId) : null
  const rows = doc ? displayOrder(doc) : []

  const pick = (l: Layer, e: React.MouseEvent): void => {
    if (!doc) return
    let sel = [l.id]
    if (e.ctrlKey || e.metaKey) sel = selectedIds.includes(l.id) ? selectedIds.filter((x) => x !== l.id) : [...selectedIds, l.id]
    else if (e.shiftKey && anchorId.current) {
      const ids = rows.map((r) => r.layer.id)
      const a = ids.indexOf(anchorId.current)
      const b = ids.indexOf(l.id)
      if (a >= 0 && b >= 0) sel = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
    }
    if (!e.shiftKey) anchorId.current = l.id
    if (sel.length === 0) sel = [l.id]
    const activeId = sel.includes(l.id) ? l.id : sel[sel.length - 1]
    if (doc.activeId !== activeId) editor.quiet(setActive(doc, activeId))
    editor.set({ selectedIds: sel })
  }

  const commitRename = (id: string, name: string): void => {
    setRenaming(null)
    const l = doc && getLayer(doc, id)
    if (doc && l && name.trim() && name !== l.name) editor.commit(updateLayer(doc, id, { name: name.trim() }), '이름 바꾸기')
  }

  const onDragOver = (e: React.DragEvent, l: Layer): void => {
    if (!dragId.current) return
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const where = l.kind === 'group' && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'above' : 'below'
    if (drop?.id !== l.id || drop.where !== where) setDrop({ id: l.id, where })
  }
  const onDrop = (): void => {
    if (doc && dragId.current && drop) {
      let d = doc
      // 여러 개를 골랐으면 같이 옮긴다 (패널 순서 유지)
      const ids = selectedIds.includes(dragId.current) ? rows.map((r) => r.layer.id).filter((id) => selectedIds.includes(id)) : [dragId.current]
      const list = drop.where === 'below' ? [...ids].reverse() : ids
      for (const id of list) if (id !== drop.id) d = moveLayerTo(d, id, drop.id, drop.where)
      editor.commit(d, '레이어 순서')
    }
    dragId.current = null
    setDrop(null)
  }

  const opacity = active ? Math.round(active.opacity * 100) : 100

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} aria-label="레이어 패널">
      <PanelTitle>레이어</PanelTitle>
      {/* 혼합 모드 · 불투명도 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px`, px: `${space.sm}px`, py: `${space.sm}px`, borderBottom: `1px solid ${color.border}` }}>
        <Select
          value={active?.blend ?? 'normal'}
          disabled={!active || active.kind === 'adjustment'}
          onChange={(e) => doc && active && editor.commit(setBlend(doc, active.id, e.target.value as Layer['blend']), '혼합 모드')}
          sx={{ ...selectSx, flex: 1, minWidth: 0 }}
          SelectDisplayProps={{ 'aria-label': '혼합 모드' } as React.HTMLAttributes<HTMLDivElement>}
        >
          {BLEND_MODES.flatMap((m, i) => [
            ...(i > 0 && BLEND_MODES[i - 1].group !== m.group ? [<Divider key={`d${i}`} />] : []),
            <MenuItem key={m.key} value={m.key}>
              {m.label}
            </MenuItem>
          ])}
        </Select>
        <Box component="span" sx={{ color: color.textSecondary }}>
          불투명도
        </Box>
        <Box
          component="input"
          type="number"
          aria-label="불투명도"
          min={0}
          max={100}
          disabled={!active}
          key={`${active?.id}:${opacity}`}
          defaultValue={opacity}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value)))
            if (doc && active && Number.isFinite(v) && v !== opacity) editor.commit(updateLayer(doc, active.id, { opacity: v / 100 }), '불투명도')
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()}
          sx={{ width: 44, height: 22, border: `1px solid ${color.borderStrong}`, px: '3px', font: 'inherit' }}
        />
        <Box component="span">%</Box>
      </Box>
      <Box
        component="input"
        type="range"
        aria-label="불투명도 슬라이더"
        min={0}
        max={100}
        disabled={!active}
        value={opacity}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => doc && active && editor.commitGesture(updateLayer(doc, active.id, { opacity: Number(e.target.value) / 100 }), '불투명도')}
        onPointerUp={() => editor.endGesture()}
        sx={{ mx: `${space.sm}px`, my: '2px', accentColor: color.accent }}
      />
      {/* 잠그기 (포토샵과 같은 순서: 투명 픽셀 · 픽셀 · 위치 · 모두) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', px: `${space.sm}px`, pb: '3px' }}>
        <Box component="span" sx={{ color: color.textSecondary, mr: '4px' }}>
          잠그기
        </Box>
        {(
          [
            ['alpha', <GridOnRounded key="a" />, '투명 픽셀 잠그기 (있는 픽셀에만 칠해집니다)'],
            ['pixels', <BrushRounded key="p" />, '픽셀 잠그기 (칠하기·지우기 금지)'],
            ['position', <OpenWithRounded key="m" />, '위치 잠그기 (이동·변형 금지)']
          ] as const
        ).map(([k, icon, tip]) => (
          <IconToggle
            key={k}
            icon={icon}
            tooltip={tip}
            on={!!active?.lock?.[k]}
            onClick={() => doc && active && editor.commit(updateLayer(doc, active.id, { lock: { ...active.lock, [k]: !active.lock?.[k] } }), '레이어 잠금')}
          />
        ))}
        <IconToggle
          icon={<LockRounded />}
          tooltip="모두 잠그기"
          on={!!active?.lock?.alpha && !!active.lock.pixels && !!active.lock.position}
          onClick={() => {
            if (!doc || !active) return
            const all = !!active.lock?.alpha && !!active.lock.pixels && !!active.lock.position
            editor.commit(updateLayer(doc, active.id, { lock: all ? {} : { alpha: true, pixels: true, position: true } }), '레이어 잠금')
          }}
        />
      </Box>
      {/* 목록 */}
      <Box
        role="listbox"
        aria-label="레이어 목록"
        aria-multiselectable
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', bgcolor: color.canvas, borderTop: `1px solid ${color.border}` }}
        onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
      >
        {rows.map(({ layer: l, depth }) => {
          const sel = selectedIds.includes(l.id)
          const isActive = doc?.activeId === l.id
          const dim = doc ? !isEffectivelyVisible(doc, l.id) : false
          const d = drop?.id === l.id ? drop.where : null
          return (
            <Box
              key={l.id}
              role="option"
              aria-selected={sel}
              data-layer={l.name}
              draggable={renaming !== l.id}
              onDragStart={(e) => {
                dragId.current = l.id
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                dragId.current = null
                setDrop(null)
              }}
              onDragOver={(e) => onDragOver(e, l)}
              onDrop={onDrop}
              onClick={(e) => pick(l, e)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (!sel) pick(l, e)
                setCtxMenu({ x: e.clientX, y: e.clientY })
              }}
              sx={{
                height: ROW_H,
                display: 'flex',
                alignItems: 'center',
                gap: `${space.sm}px`,
                pl: `${4 + depth * 14}px`,
                pr: `${space.sm}px`,
                borderBottom: `1px solid ${color.border}`,
                bgcolor: sel ? (isActive ? color.accentSubtle : color.hover) : 'transparent',
                boxShadow: d === 'above' ? `inset 0 2px 0 ${color.accent}` : d === 'below' ? `inset 0 -2px 0 ${color.accent}` : d === 'inside' ? `inset 0 0 0 2px ${color.accent}` : 'none',
                cursor: 'default',
                userSelect: 'none',
                opacity: dim ? 0.55 : 1
              }}
            >
              <ButtonBase
                aria-label={l.visible ? `${l.name} 숨기기` : `${l.name} 보이기`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!doc) return
                  // Alt+클릭 = 이 레이어만 보기 (Photoshop)
                  if (e.altKey) {
                    const only = !doc.layers.every((x) => x.id === l.id || x.parentId !== null || !x.visible)
                    editor.commit({ ...doc, layers: doc.layers.map((x) => (x.parentId !== null ? x : { ...x, visible: only ? x.id === l.id : true })) }, '이 레이어만 보기')
                  } else editor.commit(updateLayer(doc, l.id, { visible: !l.visible }), l.visible ? '레이어 숨기기' : '레이어 보이기')
                }}
                sx={{ width: 20, height: 20, flexShrink: 0, '& svg': { fontSize: 15, color: l.visible ? color.text : color.textDisabled } }}
              >
                {l.visible ? <VisibilityOutlined /> : <VisibilityOffOutlined />}
              </ButtonBase>
              {l.kind === 'group' ? (
                <ButtonBase
                  aria-label={l.collapsed ? '펼치기' : '접기'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (doc) editor.quiet(updateLayer(doc, l.id, { collapsed: !l.collapsed }))
                  }}
                  sx={{ width: 14, flexShrink: 0, '& svg': { fontSize: 18 } }}
                >
                  {l.collapsed ? <ArrowRightRounded /> : <ArrowDropDownRounded />}
                </ButtonBase>
              ) : l.clip ? (
                <SubdirectoryArrowRightRounded aria-label="클리핑" sx={{ fontSize: 14, color: color.textSecondary, flexShrink: 0 }} />
              ) : null}
              <Thumb
                label={`${l.name} 썸네일`}
                active={isActive && !maskEditing && l.kind !== 'group'}
                url={l.bitmap ? thumbUrl(l.bitmap) : undefined}
                icon={l.kind === 'group' ? <FolderOutlined /> : l.kind === 'adjustment' ? <TuneRounded /> : undefined}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation()
                    A.selectLayerPixels(l.id)
                  } else if (isActive) editor.set({ maskEditing: false })
                }}
              />
              {l.mask && (
                <Thumb
                  label={`${l.name} 마스크`}
                  active={isActive && maskEditing}
                  url={thumbUrl(l.mask.bitmap, 64, true)}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!doc) return
                    // Shift+클릭 = 마스크 켜기/끄기
                    if (e.shiftKey) return editor.commit(updateLayer(doc, l.id, { mask: { ...l.mask!, enabled: !l.mask!.enabled } }), '마스크 켜기/끄기')
                    if (doc.activeId !== l.id) editor.quiet(setActive(doc, l.id))
                    editor.set({ maskEditing: true, selectedIds: [l.id] })
                  }}
                />
              )}
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '3px' }}>
                {l.kind === 'text' && <TitleRounded sx={{ fontSize: 13, color: color.textSecondary }} />}
                {l.shape && <CategoryOutlined aria-label="도형" sx={{ fontSize: 13, color: color.textSecondary }} />}
                {renaming === l.id ? (
                  <Box
                    component="input"
                    autoFocus
                    defaultValue={l.name}
                    aria-label="레이어 이름"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    onBlur={(e: React.FocusEvent<HTMLInputElement>) => commitRename(l.id, e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    sx={{ flex: 1, minWidth: 0, height: 20, font: 'inherit', border: `1px solid ${color.accent}`, px: '2px' }}
                  />
                ) : (
                  <Box
                    component="span"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setRenaming(l.id)
                    }}
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: isActive ? font.bold : font.regular,
                      textDecoration: l.mask && !l.mask.enabled ? 'line-through' : 'none'
                    }}
                  >
                    {l.name}
                  </Box>
                )}
              </Box>
              {l.lock && (l.lock.alpha || l.lock.pixels || l.lock.position) && <LockRounded aria-label="잠김" sx={{ fontSize: 13, color: color.textSecondary }} />}
              {hasEffects(l.effects) && (
                <Tooltip title="레이어 효과 (더블클릭하면 고칩니다)">
                  <Box
                    component="span"
                    onDoubleClick={() => editor.set({ dialog: { kind: 'effects', layerId: l.id } })}
                    sx={{ fontStyle: 'italic', fontWeight: font.bold, color: color.textSecondary, fontSize: font.xs }}
                  >
                    fx
                  </Box>
                </Tooltip>
              )}
              {l.kind === 'adjustment' && (
                <Tooltip title="조정 설정">
                  <ButtonBase
                    aria-label="조정 설정"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAdjustmentEditor(l)
                    }}
                    sx={{ '& svg': { fontSize: 14 } }}
                  >
                    <TuneRounded />
                  </ButtonBase>
                </Tooltip>
              )}
            </Box>
          )
        })}
        {doc && rows.length === 0 && <Box sx={{ p: 2, color: color.textSecondary }}>레이어가 없습니다.</Box>}
      </Box>
      {/* 아래 버튼 줄 (Photoshop 레이어 패널 아래와 같은 순서) */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '1px',
          px: `${space.sm}px`,
          height: 26,
          flexShrink: 0,
          background: surface.toolbar,
          borderTop: `1px solid ${chrome.frame}`
        }}
      >
        <FootButton
          icon={<AutoAwesomeOutlined />}
          tooltip="레이어 효과"
          disabled={!active || active.kind === 'group' || active.kind === 'adjustment'}
          onClick={() => active && editor.set({ dialog: { kind: 'effects', layerId: active.id } })}
        />
        <FootButton icon={<CropSquareRounded />} tooltip="레이어 마스크 추가 (선택이 있으면 선택만 보이게)" disabled={!active} onClick={() => A.addMask()} />
        <FootButton icon={<ContrastRounded />} tooltip="새 조정 레이어" disabled={!doc} onClick={(e) => setAdjMenu(e.currentTarget)} />
        <FootButton icon={<CreateNewFolderOutlined />} tooltip="그룹 만들기 (Ctrl+G)" disabled={!selectedIds.length} onClick={A.group} />
        <FootButton icon={<AddBoxOutlined />} tooltip="새 레이어 (Ctrl+Shift+N)" disabled={!doc} onClick={A.newLayer} />
        <FootButton icon={<DeleteOutlineRounded />} tooltip="레이어 삭제" disabled={!selectedIds.length} onClick={A.deleteLayers} />
      </Box>
      <Menu anchorEl={adjMenu} open={!!adjMenu} onClose={() => setAdjMenu(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        {ADJUSTMENT_KINDS.map((k) => (
          <MenuItem
            key={k.key}
            onClick={() => {
              setAdjMenu(null)
              A.newAdjustmentLayer(k.key)
            }}
          >
            {k.label}…
          </MenuItem>
        ))}
      </Menu>
      <Menu open={!!ctxMenu} onClose={() => setCtxMenu(null)} anchorReference="anchorPosition" anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}>
        {[
          { label: '레이어 복제', run: A.duplicate, sc: 'Ctrl+J' },
          { label: '레이어 삭제', run: A.deleteLayers },
          { label: '이름 바꾸기', run: () => active && setRenaming(active.id) },
          null,
          { label: '그룹 만들기', run: A.group, sc: 'Ctrl+G' },
          { label: '그룹 해제', run: A.ungroupCmd, disabled: active?.kind !== 'group', sc: 'Ctrl+Shift+G' },
          { label: selectedIds.length > 1 ? '레이어 병합' : '아래 레이어와 병합', run: A.mergeDownCmd, sc: 'Ctrl+E' },
          null,
          { label: active?.clip ? '클리핑 마스크 해제' : '클리핑 마스크 만들기', run: A.toggleClip, sc: 'Ctrl+Alt+G' },
          { label: active?.mask ? '마스크 편집' : '레이어 마스크 추가', run: () => A.addMask() },
          { label: '마스크 적용', run: () => A.deleteMask(true), disabled: !active?.mask || !active.bitmap },
          { label: '마스크 삭제', run: () => A.deleteMask(false), disabled: !active?.mask },
          null,
          { label: '레이어 효과…', run: () => active && editor.set({ dialog: { kind: 'effects', layerId: active.id } }), disabled: !active?.bitmap },
          { label: '레이어 효과 복사', run: A.copyLayerStyle, disabled: !active?.effects },
          { label: '레이어 효과 붙여넣기', run: A.pasteLayerStyle, disabled: !A.hasStyleClip() },
          { label: '픽셀 선택', run: () => active && A.selectLayerPixels(active.id), disabled: !active?.bitmap },
          { label: '래스터화', run: A.rasterizeText, disabled: active?.kind !== 'text' && !active?.shape }
        ].map((it, i) =>
          it ? (
            <MenuItem
              key={it.label}
              disabled={it.disabled}
              onClick={() => {
                setCtxMenu(null)
                it.run()
              }}
              sx={{ justifyContent: 'space-between', gap: 3 }}
            >
              <span>{it.label}</span>
              {it.sc && (
                <Box component="span" sx={{ color: color.textSecondary }}>
                  {it.sc}
                </Box>
              )}
            </MenuItem>
          ) : (
            <Divider key={`s${i}`} />
          )
        )}
      </Menu>
    </Box>
  )
}

/** 조정 레이어 설정 열기 (종류에 맞는 탭으로) */
export function openAdjustmentEditor(l: Layer): void {
  const k = l.adjustment?.kind
  if (!k || k === 'invert') return
  const tab = k === 'curves' ? 'curves' : k === 'hueSaturation' ? 'hsl' : k === 'exposure' ? 'exposure' : k === 'levels' ? 'levels' : 'effects'
  editor.set({ dialog: { kind: 'adjust', tab, layerId: l.id } })
}
