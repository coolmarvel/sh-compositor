import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { LayerEffects, DEFAULT_EFFECTS, DEFAULT_GLOW, hasEffects, ShadowEffect } from '@core/index'
import { PaletteControl } from '../bar'
import { ClassicDialog, GroupBox, Row, Check, SliderRow } from './parts'
import { ClassicTabs } from './tabs'
import { ui } from '../../theme'

const { color, font } = ui

type Tab = 'stroke' | 'shadow' | 'glow' | 'overlay' | 'inner'

/**
 * 효과 대화상자 — Compositor `EffectsSheet`(외곽선·그림자·색 덮기·안쪽 그림자).
 * 레이어에 비파괴로 붙는다. 스티커 프리셋 = 흰 외곽선 + 그림자 (배경 제거와 함께).
 */
export default function EffectsDialog({ value, onChange, onClose }: { value: LayerEffects; onChange: (e: LayerEffects) => void; onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('stroke')
  const before = useRef(value)
  useEffect(() => {
    before.current = value
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = (): void => {
    onChange(before.current)
    onClose()
  }
  const e = value
  const shadowRows = (key: 'shadow' | 'innerShadow', s: ShadowEffect): JSX.Element => {
    const set = (patch: Partial<ShadowEffect>): void => onChange({ ...e, [key]: { ...s, ...patch } })
    return (
      <GroupBox title={key === 'shadow' ? '그림자' : '안쪽 그림자'}>
        <Check label="사용" checked={s.enabled} onChange={(enabled) => set({ enabled })} />
        <SliderRow label="빛 각도" value={s.angle} min={-180} max={180} unit="°" onChange={(angle) => set({ angle })} />
        <SliderRow label="거리" value={s.distance} min={0} max={200} unit="px" onChange={(distance) => set({ distance })} />
        <SliderRow label="흐림" value={s.blur} min={0} max={100} unit="px" onChange={(blur) => set({ blur })} />
        <SliderRow label="불투명도" value={Math.round(s.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
        <Row label="색">
          <PaletteControl title="그림자 색" value={s.color} onChange={(c) => set({ color: c })} />
        </Row>
      </GroupBox>
    )
  }
  return (
    <ClassicDialog
      open
      title="레이어 효과"
      onClose={cancel}
      onEnter={onClose}
      width={480}
      actions={
        <>
          <Button variant="outlined" onClick={() => onChange(DEFAULT_EFFECTS)} disabled={!hasEffects(e)} sx={{ mr: 'auto' }}>
            모두 끄기
          </Button>
          <Button variant="outlined" onClick={cancel}>
            취소
          </Button>
          <Button variant="contained" onClick={onClose}>
            확인
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Button
          variant="outlined"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0, px: '12px' }}
          onClick={() =>
            onChange({
              ...DEFAULT_EFFECTS,
              stroke: { enabled: true, size: 10, color: '#ffffff', opacity: 1, inside: false },
              shadow: { enabled: true, angle: 120, distance: 6, blur: 12, color: '#000000', opacity: 0.35 }
            })
          }
        >
          스티커 프리셋
        </Button>
        <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>흰 외곽선과 옅은 그림자로 스티커처럼 만듭니다.</Box>
      </Box>
      <ClassicTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'stroke', label: '외곽선' },
          { key: 'shadow', label: '그림자' },
          { key: 'glow', label: '외부 광선' },
          { key: 'overlay', label: '색 덮기' },
          { key: 'inner', label: '안쪽 그림자' }
        ]}
      />
      <Box sx={{ minHeight: 230 }}>
        {tab === 'stroke' && (
          <GroupBox title="외곽선">
            <Check label="사용" checked={e.stroke.enabled} onChange={(enabled) => onChange({ ...e, stroke: { ...e.stroke, enabled } })} />
            <SliderRow label="두께" value={e.stroke.size} min={1} max={100} unit="px" onChange={(size) => onChange({ ...e, stroke: { ...e.stroke, size } })} />
            <SliderRow label="불투명도" value={Math.round(e.stroke.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ ...e, stroke: { ...e.stroke, opacity: v / 100 } })} />
            <Row label="색">
              <PaletteControl title="외곽선 색" value={e.stroke.color} onChange={(c) => onChange({ ...e, stroke: { ...e.stroke, color: c } })} />
              <Check label="안쪽에 그리기" checked={e.stroke.inside} onChange={(inside) => onChange({ ...e, stroke: { ...e.stroke, inside } })} />
            </Row>
          </GroupBox>
        )}
        {tab === 'shadow' && shadowRows('shadow', e.shadow)}
        {tab === 'glow' && (
          <GroupBox title="외부 광선">
            <Check label="사용" checked={!!e.outerGlow?.enabled} onChange={(enabled) => onChange({ ...e, outerGlow: { ...(e.outerGlow ?? DEFAULT_GLOW), enabled } })} />
            <SliderRow
              label="크기"
              value={(e.outerGlow ?? DEFAULT_GLOW).size}
              min={1}
              max={150}
              unit="px"
              onChange={(size) => onChange({ ...e, outerGlow: { ...(e.outerGlow ?? DEFAULT_GLOW), size } })}
            />
            <SliderRow
              label="퍼짐"
              value={(e.outerGlow ?? DEFAULT_GLOW).spread}
              min={0}
              max={100}
              unit="%"
              onChange={(spread) => onChange({ ...e, outerGlow: { ...(e.outerGlow ?? DEFAULT_GLOW), spread } })}
            />
            <SliderRow
              label="불투명도"
              value={Math.round((e.outerGlow ?? DEFAULT_GLOW).opacity * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onChange({ ...e, outerGlow: { ...(e.outerGlow ?? DEFAULT_GLOW), opacity: v / 100 } })}
            />
            <Row label="색">
              <PaletteControl title="광선 색" value={(e.outerGlow ?? DEFAULT_GLOW).color} onChange={(c) => onChange({ ...e, outerGlow: { ...(e.outerGlow ?? DEFAULT_GLOW), color: c } })} />
            </Row>
          </GroupBox>
        )}
        {tab === 'overlay' && (
          <GroupBox title="색 덮기">
            <Check label="사용 (모양 전체를 한 색으로 덮기)" checked={e.overlay.enabled} onChange={(enabled) => onChange({ ...e, overlay: { ...e.overlay, enabled } })} />
            <SliderRow label="불투명도" value={Math.round(e.overlay.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ ...e, overlay: { ...e.overlay, opacity: v / 100 } })} />
            <Row label="색">
              <PaletteControl title="덮을 색" value={e.overlay.color} onChange={(c) => onChange({ ...e, overlay: { ...e.overlay, color: c } })} />
            </Row>
          </GroupBox>
        )}
        {tab === 'inner' && shadowRows('innerShadow', e.innerShadow)}
      </Box>
    </ClassicDialog>
  )
}
