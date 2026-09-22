import { useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import {
  Adjustments,
  DEFAULT_ADJUST,
  DEFAULT_TONE,
  Histogram,
  curveLut,
  CurvePoint,
  hasAdjust,
  ToneChannel,
  ChannelTone,
  COLOR_RANGES,
  ColorRange,
  AUTO_LEVELS_MODES,
  AutoLevelsMode,
  autoLevelsFor,
  LevelsSample,
  sampleLevels
} from '@core/index'
import { PaletteControl, selectSx } from '../bar'
import { ClassicTabs } from './tabs'
import { ClassicDialog, GroupBox, Row, Check, SliderRow } from './parts'
import { ui } from '../../theme'

const { color, space, font } = ui

export type Tab = 'levels' | 'curves' | 'exposure' | 'hsl' | 'effects'
export const TABS: { key: Tab; label: string }[] = [
  { key: 'levels', label: '레벨' },
  { key: 'curves', label: '커브' },
  { key: 'exposure', label: '노출' },
  { key: 'hsl', label: '색조/채도' },
  { key: 'effects', label: '그레인·반전·맵' }
]

/** 히스토그램 막대 — 한두 칸의 큰 봉우리(단색 배경)가 나머지를 눌러 버리지 않게 95퍼센타일×4 로 자른다 (Compositor LevelsHistogramDisplay) */
function HistogramView({ hist, channel, black, white }: { hist: Histogram | null; channel: 'rgb' | ToneChannel; black: number; white: number }): JSX.Element {
  const W = 256
  const H = 90
  const path = useMemo(() => {
    if (!hist) return ''
    const bins = Array.from(channel === 'rgb' ? hist.lum : hist[channel])
    const interior = bins
      .slice(1, 255)
      .filter((v) => v > 0)
      .sort((a, b) => a - b)
    const peak = Math.max(...bins)
    const typical = interior.length ? interior[Math.floor((interior.length - 1) * 0.95)] : peak
    const top = Math.max(1, Math.min(peak, typical * 4))
    let d = `M0 ${H}`
    for (let i = 0; i < 256; i++) d += ` L${i} ${H - Math.min(1, bins[i] / top) * H}`
    return `${d} L255 ${H} Z`
  }, [hist, channel])
  const fill = channel === 'r' ? '#c0392b' : channel === 'g' ? '#27ae60' : channel === 'b' ? '#2e6fd9' : color.textSecondary
  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" sx={{ width: '100%', height: H, bgcolor: color.canvas, border: `1px solid ${color.borderStrong}`, display: 'block' }}>
      {path ? (
        <path d={path} fill={fill} />
      ) : (
        <text x="128" y="50" textAnchor="middle" fontSize="11" fill={color.textMuted}>
          히스토그램 없음
        </text>
      )}
      <line x1={black} x2={black} y1={0} y2={H} stroke={color.text} strokeDasharray="2 2" />
      <line x1={white} x2={white} y1={0} y2={H} stroke={color.text} strokeDasharray="2 2" />
    </Box>
  )
}

/** 커브 편집기 — 클릭 = 점 추가, 드래그 = 이동, 더블클릭 = 삭제(양 끝점 제외). 256×256 좌표 */
function CurveEditor({ points, onChange }: { points: CurvePoint[]; onChange: (p: CurvePoint[]) => void }): JSX.Element {
  const S = 220
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const lut = useMemo(() => curveLut(points), [points])
  const toPt = (e: React.PointerEvent): CurvePoint => {
    const r = ref.current!.getBoundingClientRect()
    return { x: Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), y: Math.round(Math.min(255, Math.max(0, (1 - (e.clientY - r.top) / r.height) * 255))) }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const line = Array.from(lut, (y, x) => `${(x / 255) * S},${S - (y / 255) * S}`).join(' ')
  return (
    <Box
      component="svg"
      ref={ref}
      viewBox={`0 0 ${S} ${S}`}
      sx={{ width: S, height: S, bgcolor: color.canvas, border: `1px solid ${color.borderStrong}`, touchAction: 'none', cursor: 'crosshair', flexShrink: 0 }}
      onPointerDown={(e: React.PointerEvent<SVGSVGElement>) => {
        const p = toPt(e)
        // 가까운 점이 있으면 그 점을 잡고, 없으면 새 점
        const near = sorted.findIndex((q) => Math.abs(q.x - p.x) < 8 && Math.abs(q.y - p.y) < 12)
        let next = sorted
        let idx = near
        if (near < 0) {
          next = [...sorted, p].sort((a, b) => a.x - b.x)
          idx = next.indexOf(p)
          onChange(next)
        }
        drag.current = idx
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e: React.PointerEvent<SVGSVGElement>) => {
        const i = drag.current
        if (i == null) return
        const p = toPt(e)
        const next = sorted.map((q) => ({ ...q }))
        const lo = i > 0 ? next[i - 1].x + 1 : 0
        const hi = i < next.length - 1 ? next[i + 1].x - 1 : 255
        // 양 끝점은 x 고정 (검정·흰색 끝)
        next[i] = { x: i === 0 ? 0 : i === next.length - 1 ? 255 : Math.min(hi, Math.max(lo, p.x)), y: p.y }
        onChange(next)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onDoubleClick={(e: React.MouseEvent<SVGSVGElement>) => {
        const r = ref.current!.getBoundingClientRect()
        const x = ((e.clientX - r.left) / r.width) * 255
        const i = sorted.findIndex((q, k) => k > 0 && k < sorted.length - 1 && Math.abs(q.x - x) < 8)
        if (i > 0) onChange(sorted.filter((_, k) => k !== i))
      }}
    >
      {[1, 2, 3].map((k) => (
        <g key={k} stroke={color.border}>
          <line x1={(S * k) / 4} x2={(S * k) / 4} y1={0} y2={S} />
          <line y1={(S * k) / 4} y2={(S * k) / 4} x1={0} x2={S} />
        </g>
      ))}
      <line x1={0} y1={S} x2={S} y2={0} stroke={color.border} strokeDasharray="3 3" />
      <polyline points={line} fill="none" stroke={color.text} strokeWidth={1.5} />
      {sorted.map((q, i) => (
        <rect key={i} x={(q.x / 255) * S - 3.5} y={S - (q.y / 255) * S - 3.5} width={7} height={7} fill={color.canvas} stroke={color.text} />
      ))}
    </Box>
  )
}

type Channel = 'rgb' | ToneChannel
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'rgb', label: 'RGB' },
  { key: 'r', label: '빨강' },
  { key: 'g', label: '초록' },
  { key: 'b', label: '파랑' }
]

/** 채널 고르기 콤보 (레벨·커브 공용) */
function ChannelSelect({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }): JSX.Element {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Channel)} sx={{ ...selectSx, width: 96 }} SelectDisplayProps={{ 'aria-label': '채널' } as React.HTMLAttributes<HTMLDivElement>}>
      {CHANNELS.map((c) => (
        <MenuItem key={c.key} value={c.key}>
          {c.label}
        </MenuItem>
      ))}
    </Select>
  )
}

/** 스포이트 표본 — 문서 축소본을 보여 주고 클릭한 곳의 색을 돌려준다 */
function SampleView({ sample, onPick }: { sample: ImageData; onPick: (rgb: [number, number, number]) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    ref.current?.getContext('2d')?.putImageData(sample, 0, 0)
  }, [sample])
  return (
    <Box
      component="canvas"
      ref={ref}
      width={sample.width}
      height={sample.height}
      aria-label="스포이트 표본"
      onClick={(e: React.MouseEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = Math.min(sample.width - 1, Math.floor(((e.clientX - r.left) / r.width) * sample.width))
        const y = Math.min(sample.height - 1, Math.floor(((e.clientY - r.top) / r.height) * sample.height))
        const o = (y * sample.width + x) * 4
        if (sample.data[o + 3] > 0) onPick([sample.data[o], sample.data[o + 1], sample.data[o + 2]])
      }}
      sx={{ height: 120, width: 'auto', maxWidth: '100%', cursor: 'crosshair', border: `1px solid ${color.borderStrong}`, display: 'block' }}
    />
  )
}

/**
 * 보정 대화상자 — Compositor 의 Levels/Curves/Exposure/Hue·Saturation/Grain/Gradient Map 시트를 한 창의 탭으로.
 * 레벨·커브는 RGB 합성 + 채널별(빨강·초록·파랑), 레벨은 자동 3모드와 검정/회색/흰 점 스포이트,
 * 색조/채도는 마스터 + 6색역 + 색상화. 값은 **바로 미리보기에 반영**되고, 취소하면 열기 전 값으로 되돌린다.
 * 수식은 core/adjust.ts (테스트됨).
 */
export default function AdjustDialog({
  value,
  hist,
  sample,
  onChange,
  onClose,
  initialTab,
  title = '보정',
  tabs = TABS
}: {
  open?: boolean
  initialTab?: Tab
  title?: string
  /** 조정 레이어는 자기 종류 탭만 */
  tabs?: { key: Tab; label: string }[]
  value: Adjustments
  /** 대상의 히스토그램 (레벨 탭·자동 레벨용) */
  hist: Histogram | null
  /** 스포이트용 축소본 */
  sample: ImageData | null
  onChange: (a: Adjustments) => void
  onClose: () => void
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'levels')
  const [levelCh, setLevelCh] = useState<Channel>('rgb')
  const [curveCh, setCurveCh] = useState<Channel>('rgb')
  const [range, setRange] = useState<'master' | ColorRange>('master')
  const [autoMode, setAutoMode] = useState<AutoLevelsMode>('contrast')
  const [picker, setPicker] = useState<LevelsSample | null>(null)
  const before = useRef<Adjustments>(value)
  useEffect(() => {
    before.current = value
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const a = value
  const set = (patch: Partial<Adjustments>): void => onChange({ ...a, ...patch })
  const cancel = (): void => {
    onChange(before.current)
    onClose()
  }
  const channels = a.channels ?? DEFAULT_ADJUST.channels
  // 레벨: RGB 면 합성 값, 채널이면 그 채널 값
  const lv: ChannelTone = levelCh === 'rgb' ? { ...DEFAULT_TONE, inBlack: a.inBlack, inWhite: a.inWhite, midtone: a.midtone, outBlack: a.outBlack, outWhite: a.outWhite } : channels[levelCh]
  const setLv = (patch: Partial<ChannelTone>): void => {
    if (levelCh === 'rgb') set(patch)
    else set({ channels: { ...channels, [levelCh]: { ...channels[levelCh], ...patch } } })
  }
  const curvePts = curveCh === 'rgb' ? a.curve : channels[curveCh].curve
  const setCurve = (curve: CurvePoint[]): void => {
    if (curveCh === 'rgb') set({ curve })
    else set({ channels: { ...channels, [curveCh]: { ...channels[curveCh], curve } } })
  }
  const rangeAdj = range === 'master' ? { hue: a.hue, saturation: a.saturation, lightness: a.lightness } : (a.hueRanges?.[range] ?? { hue: 0, saturation: 0, lightness: 0 })
  const setRangeAdj = (patch: Partial<{ hue: number; saturation: number; lightness: number }>): void => {
    if (range === 'master') set(patch)
    else set({ hueRanges: { ...a.hueRanges, [range]: { ...rangeAdj, ...patch } } })
  }

  return (
    <ClassicDialog
      open
      title={title}
      onClose={cancel}
      onEnter={onClose}
      width={540}
      actions={
        <>
          <Button variant="outlined" onClick={() => onChange(DEFAULT_ADJUST)} disabled={!hasAdjust(a)} sx={{ mr: 'auto' }}>
            모두 초기화
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
      {tabs.length > 1 && <ClassicTabs value={tab} onChange={setTab} tabs={tabs} />}

      <Box sx={{ minHeight: 300, display: 'flex', flexDirection: 'column', gap: `${space.base}px`, pt: `${space.base}px` }}>
        {tab === 'levels' && (
          <>
            <Row label="채널">
              <ChannelSelect value={levelCh} onChange={setLevelCh} />
            </Row>
            <HistogramView hist={hist} channel={levelCh} black={lv.inBlack} white={lv.inWhite} />
            <GroupBox title="입력 레벨">
              <SliderRow label="검정" value={lv.inBlack} min={0} max={254} onChange={(v) => setLv({ inBlack: Math.min(v, lv.inWhite - 1) })} />
              <SliderRow label="중간톤" value={lv.midtone} min={0.1} max={9.99} step={0.01} onChange={(midtone) => setLv({ midtone })} />
              <SliderRow label="흰색" value={lv.inWhite} min={1} max={255} onChange={(v) => setLv({ inWhite: Math.max(v, lv.inBlack + 1) })} />
            </GroupBox>
            <GroupBox title="출력 레벨">
              <SliderRow label="검정" value={lv.outBlack} min={0} max={255} onChange={(outBlack) => setLv({ outBlack })} />
              <SliderRow label="흰색" value={lv.outWhite} min={0} max={255} onChange={(outWhite) => setLv({ outWhite })} />
            </GroupBox>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px`, flexWrap: 'wrap' }}>
              <Select
                value={autoMode}
                onChange={(e) => setAutoMode(e.target.value as AutoLevelsMode)}
                sx={{ ...selectSx, width: 210 }}
                SelectDisplayProps={{ 'aria-label': '자동 방식' } as React.HTMLAttributes<HTMLDivElement>}
              >
                {AUTO_LEVELS_MODES.map((m) => (
                  <MenuItem key={m.key} value={m.key}>
                    {m.label}
                  </MenuItem>
                ))}
              </Select>
              <Button
                variant="outlined"
                disabled={!hist}
                onClick={() => {
                  const r = hist && autoLevelsFor(hist, autoMode)
                  if (r) set(r)
                }}
                title="위아래 0.1% 를 잘라 낸 지점을 검정·흰색 끝으로"
              >
                자동
              </Button>
              <Box sx={{ width: 8 }} />
              {(['black', 'gray', 'white'] as LevelsSample[]).map((m) => (
                <Button
                  key={m}
                  variant="outlined"
                  disabled={!sample}
                  aria-pressed={picker === m}
                  onClick={() => setPicker(picker === m ? null : m)}
                  sx={picker === m ? { borderColor: color.accent, background: color.accentSubtle } : undefined}
                >
                  {m === 'black' ? '검정 점' : m === 'gray' ? '회색 점' : '흰 점'}
                </Button>
              ))}
            </Box>
            {picker && sample && (
              <Box>
                <Box sx={{ fontSize: font.xs, color: color.textSecondary, mb: `${space.xs}px` }}>
                  아래 그림에서 {picker === 'black' ? '가장 어두워야 할 곳' : picker === 'gray' ? '무채색(회색)이어야 할 곳' : '가장 밝아야 할 곳'}을 클릭하세요. 세 채널이 함께 맞춰집니다.
                </Box>
                <SampleView
                  sample={sample}
                  onPick={(rgb) => {
                    onChange(sampleLevels(a, rgb, picker))
                    setLevelCh('rgb')
                    setPicker(null)
                  }}
                />
              </Box>
            )}
          </>
        )}

        {tab === 'curves' && (
          <>
            <Row label="채널">
              <ChannelSelect value={curveCh} onChange={setCurveCh} />
            </Row>
            <Box sx={{ display: 'flex', gap: `${space.lg}px` }}>
              <CurveEditor points={curvePts} onChange={setCurve} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${space.base}px`, fontSize: font.md, color: color.textSecondary }}>
                <Box>클릭하면 점을 더하고 끌면 옮깁니다.</Box>
                <Box>점을 더블클릭하면 지웁니다.</Box>
                <Box>가로축은 원래 밝기, 세로축은 바뀐 밝기입니다.</Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${space.sm}px`, mt: `${space.base}px` }}>
                  <Button
                    variant="outlined"
                    onClick={() =>
                      setCurve([
                        { x: 0, y: 0 },
                        { x: 64, y: 50 },
                        { x: 192, y: 205 },
                        { x: 255, y: 255 }
                      ])
                    }
                  >
                    S자 (대비 ↑)
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() =>
                      setCurve([
                        { x: 0, y: 0 },
                        { x: 128, y: 158 },
                        { x: 255, y: 255 }
                      ])
                    }
                  >
                    밝게
                  </Button>
                  <Button variant="outlined" onClick={() => setCurve(DEFAULT_ADJUST.curve)}>
                    직선으로
                  </Button>
                </Box>
              </Box>
            </Box>
          </>
        )}

        {tab === 'exposure' && (
          <GroupBox title="노출">
            <SliderRow label="노출" value={a.exposure} min={-5} max={5} step={0.05} unit="EV" onChange={(exposure) => set({ exposure })} />
            <SliderRow label="오프셋" value={a.offset} min={-0.5} max={0.5} step={0.005} onChange={(offset) => set({ offset })} />
            <SliderRow label="감마" value={a.gamma} min={0.1} max={3} step={0.01} onChange={(gamma) => set({ gamma })} />
          </GroupBox>
        )}

        {tab === 'hsl' && (
          <>
            <Row label="범위">
              <Select
                value={range}
                disabled={a.colorize}
                onChange={(e) => setRange(e.target.value as typeof range)}
                sx={{ ...selectSx, width: 140 }}
                SelectDisplayProps={{ 'aria-label': '색 범위' } as React.HTMLAttributes<HTMLDivElement>}
              >
                <MenuItem value="master">마스터 (전체)</MenuItem>
                {COLOR_RANGES.map((r) => (
                  <MenuItem key={r.key} value={r.key}>
                    {r.label}
                  </MenuItem>
                ))}
              </Select>
              <Check
                label="색상화 (한 색조로 물들이기)"
                checked={a.colorize}
                onChange={(colorize) => {
                  setRange('master')
                  // Photoshop 처럼 색상화를 켜면 채도 25 에서 출발
                  onChange({ ...a, colorize, ...(colorize ? { hue: 0, saturation: 25, lightness: 0 } : { hue: 0, saturation: 0, lightness: 0 }) })
                }}
              />
            </Row>
            <GroupBox title={a.colorize ? '색상화' : range === 'master' ? '마스터 (전체 색)' : COLOR_RANGES.find((r) => r.key === range)!.label}>
              <SliderRow label="색조" value={rangeAdj.hue} min={a.colorize ? 0 : -180} max={a.colorize ? 360 : 180} unit="°" onChange={(hue) => setRangeAdj({ hue })} />
              <SliderRow label="채도" value={rangeAdj.saturation} min={a.colorize ? 0 : -100} max={100} onChange={(saturation) => setRangeAdj({ saturation })} />
              <SliderRow label="밝기" value={rangeAdj.lightness} min={-100} max={100} onChange={(lightness) => setRangeAdj({ lightness })} />
            </GroupBox>
            <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>색 범위는 포토샵과 같습니다. 예를 들어 빨강은 345°~15°이고 양쪽 30°에 걸쳐 약해집니다.</Box>
          </>
        )}

        {tab === 'effects' && (
          <>
            <GroupBox title="그레인">
              <SliderRow label="양" value={a.grain} min={0} max={100} onChange={(grain) => set({ grain })} />
            </GroupBox>
            <GroupBox title="반전">
              <Check label="색 반전 (네거티브)" checked={a.invert} onChange={(invert) => set({ invert })} />
            </GroupBox>
            <GroupBox title="그라데이션 맵">
              <Check
                label="사용 (밝기에 따라 두 색 사이로 칠하기)"
                checked={!!a.gradientMap}
                onChange={(on) => set({ gradientMap: on ? { shadows: '#000000', highlights: '#ffffff', reversed: false } : null })}
              />
              {a.gradientMap && (
                <Row label="색">
                  <PaletteControl label="어두운 쪽" title="어두운 쪽 색" value={a.gradientMap.shadows} onChange={(shadows) => set({ gradientMap: { ...a.gradientMap!, shadows } })} />
                  <PaletteControl label="밝은 쪽" title="밝은 쪽 색" value={a.gradientMap.highlights} onChange={(highlights) => set({ gradientMap: { ...a.gradientMap!, highlights } })} />
                  <Check label="뒤집기" checked={a.gradientMap.reversed} onChange={(reversed) => set({ gradientMap: { ...a.gradientMap!, reversed } })} />
                </Row>
              )}
            </GroupBox>
          </>
        )}
      </Box>
    </ClassicDialog>
  )
}
