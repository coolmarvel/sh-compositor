import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import { editor, useEditor, useDoc } from '../editor/store'
import * as A from '../editor/actions'
import { bakeLayer, adjustLayer, editPixels } from '../editor/pixels'
import { encodeJpeg, encodeWebp, mergedBitmap, saveProject } from '../editor/io'
import { clearSessionRecovery } from '../editor/autosave'
import { runCommand, capture, land } from '../editor/commandBridge'
import { resizeCommand, layerUpdateCommand } from '../../../application/commands'
import { unpackProject } from '@core/index'
import {
  getLayer,
  updateLayer,
  makeLayer,
  identityTransform,
  newDoc,
  flattenDoc,
  histogram,
  parseHex,
  embedJpegDpi,
  DEFAULT_ADJUST,
  DEFAULT_FILTERS,
  DEFAULT_EFFECTS,
  DEFAULT_MATTE,
  refineMatte,
  makeSelection,
  smoothSelection,
  featherSelection,
  type Selection,
  applyMoreAdjust,
  DEFAULT_MORE,
  type MoreAdjust,
  type MoreAdjustKind,
  ADJUSTMENT_KINDS,
  type Adjustments,
  type Filters,
  type LayerEffects,
  type Doc,
  type Bitmap,
  type MatteRefine
} from '@core/index'
import { ClassicTabs } from './dialogs/tabs'
import { ClassicDialog, SliderRow, GroupBox, Row, Note, Lines, Check } from './dialogs/parts'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { selectSx } from './bar'
import { checkOnline, type OnlineModel } from '../editor/bgremove'
import { addGuide } from '../editor/guides'
import { BarInput, PaletteControl } from './bar'
import type { Tab as AdjustTab } from './dialogs/AdjustDialog'
import { ui } from '../theme'

const AdjustDialog = lazy(() => import('./dialogs/AdjustDialog'))
const FiltersDialog = lazy(() => import('./dialogs/FiltersDialog'))
const EffectsDialog = lazy(() => import('./dialogs/EffectsDialog'))
const ImageSizeDialog = lazy(() => import('./dialogs/ImageSizeDialog'))
const CanvasSizeDialog = lazy(() => import('./dialogs/CanvasSizeDialog'))
const ExportDialog = lazy(() => import('./dialogs/ExportDialog'))
const NewCanvasDialog = lazy(() => import('./dialogs/NewCanvasDialog'))
const SelectAmountDialog = lazy(() => import('./dialogs/SelectAmountDialog'))
const ColorDialog = lazy(() => import('./dialogs/ColorDialog'))
const RenameDialog = lazy(() => import('./dialogs/RenameDialog'))
const ConfirmCloseDialog = lazy(() => import('./dialogs/ConfirmCloseDialog'))
const AboutDialog = lazy(() => import('./dialogs/AboutDialog'))
const HelpDialog = lazy(() => import('./dialogs/HelpDialog'))

const { color, font } = ui
const close = (): void => editor.set({ dialog: null })

/** 비트맵 → 스포이트용 축소본 */
function sampleOf(b: Bitmap, side = 420): ImageData {
  const s = Math.min(1, side / Math.max(b.width, b.height))
  const src = new OffscreenCanvas(b.width, b.height)
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0)
  const w = Math.max(1, Math.round(b.width * s))
  const h = Math.max(1, Math.round(b.height * s))
  const out = new OffscreenCanvas(w, h)
  const g = out.getContext('2d', { willReadFrequently: true })!
  g.drawImage(src, 0, 0, w, h)
  return g.getImageData(0, 0, w, h)
}

/** 선택 영역 → 회색 마스크 비트맵 (미리보기용 임시 조정 레이어에) */
function selectionMaskBitmap(d: Doc): Bitmap | null {
  if (!d.selection) return null
  const data = new Uint8ClampedArray(d.width * d.height * 4)
  const m = d.selection.mask
  for (let i = 0; i < m.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = m[i]
    data[i * 4 + 3] = 255
  }
  return { width: d.width, height: d.height, data }
}

/**
 * 제스처형 편집 — 값이 바뀔 때마다 이력 한 칸을 덮어쓰고, 취소(= 처음 값으로 돌아옴)면 그 칸을 되돌린다.
 * 조정 레이어 설정·레이어 효과처럼 문서에 바로 들어가는 비파괴 편집용.
 */
function useGestureEdit<T>(initial: T, label: string, apply: (d: Doc, v: T) => Doc): { onChange: (v: T) => void; onClose: () => void } {
  const recorded = useRef(false)
  const last = useRef(initial)
  return {
    onChange: (v) => {
      const d = editor.doc
      if (!d) return
      last.current = v
      editor.commitGesture(apply(d, v), label)
      recorded.current = true
    },
    onClose: () => {
      editor.endGesture()
      if (recorded.current && last.current === initial) editor.undo()
      close()
    }
  }
}

/** 보정 — 조정 레이어면 그 설정을 바로, 아니면 활성 레이어에 (미리보기 = 임시 조정 레이어를 GPU 로) */
function AdjustHost({ tab, layerId }: { tab: AdjustTab; layerId?: string }): JSX.Element | null {
  const doc = useRef(editor.doc).current
  const adjLayer = doc && layerId ? getLayer(doc, layerId) : null
  const target = doc && !layerId ? getLayer(doc, doc.activeId) : null
  const initial = adjLayer?.adjustment?.settings ?? DEFAULT_ADJUST
  const [value, setValue] = useState<Adjustments>(initial)
  const latest = useRef(value)
  const hist = useMemo(() => {
    if (!doc) return null
    if (adjLayer) {
      const idx = doc.layers.findIndex((l) => l.id === adjLayer.id)
      return histogram(flattenDoc({ ...doc, layers: doc.layers.slice(0, idx) }).data)
    }
    if (!target?.bitmap) return null
    return histogram(getLayer(bakeLayer(doc, target.id), target.id)!.bitmap!.data)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sample = useMemo(() => (doc ? sampleOf(mergedBitmap(doc)) : null), []) // eslint-disable-line react-hooks/exhaustive-deps
  const gesture = useGestureEdit<Adjustments>(initial, '조정 설정', (d, a) => updateLayer(d, adjLayer!.id, { adjustment: { ...adjLayer!.adjustment!, settings: a } }))

  // 파괴적 보정 미리보기: 대상 바로 위에 클리핑된 임시 조정 레이어 (선택 영역 = 그 마스크)
  useEffect(() => {
    if (!doc || !target || adjLayer) return
    const mask = selectionMaskBitmap(doc)
    const tmp = makeLayer('adjustment', '미리보기', null, identityTransform(doc.width, doc.height), {
      adjustment: { kind: 'levels', settings: value },
      clip: true,
      parentId: target.parentId,
      mask: mask ? { bitmap: mask, enabled: true, linked: false } : null
    })
    const idx = doc.layers.findIndex((l) => l.id === target.id)
    editor.setPreview({ ...doc, layers: [...doc.layers.slice(0, idx + 1), tmp, ...doc.layers.slice(idx + 1)] })
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.setPreview(null), [])

  if (!doc) return null
  if (adjLayer?.adjustment) {
    const kind = adjLayer.adjustment.kind
    const t: AdjustTab = kind === 'curves' ? 'curves' : kind === 'hueSaturation' ? 'hsl' : kind === 'exposure' ? 'exposure' : kind === 'levels' ? 'levels' : 'effects'
    const label = ADJUSTMENT_KINDS.find((k) => k.key === kind)?.label ?? '조정'
    return (
      <AdjustDialog
        value={value}
        hist={hist}
        sample={sample}
        initialTab={t}
        title={`${label} (조정 레이어)`}
        tabs={[{ key: t, label }]}
        onChange={(a) => {
          setValue(a)
          gesture.onChange(a)
        }}
        onClose={gesture.onClose}
      />
    )
  }
  if (!target) return null
  return (
    <AdjustDialog
      value={value}
      hist={hist}
      sample={sample}
      initialTab={tab}
      title={`${target.name} 보정${doc.selection ? ' (선택 영역만)' : ''}`}
      onChange={(a) => {
        latest.current = a
        setValue(a)
      }}
      onClose={() => {
        editor.setPreview(null)
        close()
        // 취소면 DEFAULT 로 되돌아온 상태 = 바뀐 것 없음
        const d = editor.doc
        const v = latest.current
        if (d && v !== DEFAULT_ADJUST) editor.commit(adjustLayer(d, target.id, v, null), '보정')
      }}
    />
  )
}

/** 필터 — CPU 로 계산해 잠시 뒤 캔버스에 미리보기 */
function FiltersHost({ focus }: { focus?: string }): JSX.Element | null {
  const doc = useRef(editor.doc).current
  const target = doc ? getLayer(doc, doc.activeId) : null
  const [value, setValue] = useState<Filters>(DEFAULT_FILTERS)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    if (!doc || !target) return
    const t = setTimeout(() => editor.setPreview(value === DEFAULT_FILTERS ? null : adjustLayer(doc, target.id, null, value)), 180)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.setPreview(null), [])
  if (!doc || !target) return null
  return (
    <FiltersDialog
      initialTab={focus === 'sharpen' || focus === 'other' ? focus : 'blur'}
      value={value}
      onChange={(f) => {
        latest.current = f
        setValue(f)
      }}
      onClose={() => {
        editor.setPreview(null)
        close()
        const v = latest.current
        const at = capture()
        if (at && v !== DEFAULT_FILTERS && getLayer(at.doc, target.id)) void editor.busy('필터 적용 중…', () => land(at, adjustLayer(at.doc, target.id, null, v), '필터'))
      }}
    />
  )
}

function EffectsHost({ layerId }: { layerId: string }): JSX.Element | null {
  const doc = useRef(editor.doc).current
  const l = doc ? getLayer(doc, layerId) : null
  const initial = l?.effects ?? DEFAULT_EFFECTS
  const [value, setValue] = useState<LayerEffects>(initial)
  const gesture = useGestureEdit<LayerEffects>(initial, '레이어 효과', (d, e) => updateLayer(d, layerId, { effects: e }))
  if (!l) return null
  return (
    <EffectsDialog
      value={value}
      onChange={(e) => {
        setValue(e)
        gesture.onChange(e)
      }}
      onClose={gesture.onClose}
    />
  )
}

type BgMode = 'auto' | 'offline' | 'online'
const BG_MODE_KEY = 'sc.bgMode'
const loadBgMode = (): BgMode => {
  try {
    const v = localStorage.getItem(BG_MODE_KEY)
    return v === 'offline' || v === 'online' || v === 'auto' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * 배경 제거 — 엔진 고르기: 자동(인터넷이 되면 최신, 아니면 내장) · 내장(오프라인) · 최신(온라인 전용).
 * 온라인을 골랐는데 인터넷이 안 되면 막고 안내한다 (내장 모델로 계속할지 묻는다).
 */
function RemoveBgDialog(): JSX.Element {
  const [m, setM] = useState<MatteRefine>(DEFAULT_MATTE)
  const [mode, setMode] = useState<BgMode>(loadBgMode)
  const [model, setModel] = useState<OnlineModel>('isnet_fp16')
  const [online, setOnline] = useState<boolean | null>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    let alive = true
    void checkOnline().then((ok) => alive && setOnline(ok))
    return () => {
      alive = false
    }
  }, [])
  const run = (engine: 'offline' | 'online'): void => {
    try {
      localStorage.setItem(BG_MODE_KEY, mode)
    } catch {
      /* 무시 */
    }
    close()
    void A.removeBackground(m, { engine, model })
  }
  const go = async (): Promise<void> => {
    if (mode === 'offline') return run('offline')
    const ok = online ?? (await checkOnline())
    setOnline(ok)
    if (ok) return run('online')
    if (mode === 'auto') return run('offline')
    setBlocked(true) // 온라인 전용인데 연결 없음 → 안내
  }
  const radio = (k: BgMode, label: string, hint: string): JSX.Element => (
    <Box component="label" sx={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      <input type="radio" name="bg-mode" checked={mode === k} onChange={() => (setMode(k), setBlocked(false))} style={{ margin: 0, accentColor: color.accent }} />
      <b>{label}</b>
      <Box component="span" sx={{ fontSize: font.xs, color: color.textSecondary }}>
        {hint}
      </Box>
    </Box>
  )
  return (
    <ClassicDialog
      open
      title="배경 제거 (AI)"
      onClose={close}
      onEnter={() => void go()}
      width={540}
      actions={
        blocked ? (
          <>
            <Button variant="outlined" onClick={close}>
              취소
            </Button>
            <Button variant="contained" onClick={() => run('offline')}>
              내장 모델로 진행
            </Button>
          </>
        ) : (
          <>
            <Button variant="outlined" onClick={close}>
              취소
            </Button>
            <Button variant="contained" onClick={() => void go()}>
              배경 제거
            </Button>
          </>
        )
      }
    >
      <Lines small={false}>{['활성 레이어에서 피사체를 찾아 나머지를 레이어 마스크로 가립니다.', '계산은 이 PC에서 하며 사진은 어디에도 올리지 않습니다.']}</Lines>
      <GroupBox title="모델">
        {radio('auto', '자동', '인터넷이 되면 최신 모델, 안 되면 내장 모델을 씁니다.')}
        {radio('offline', '내장 (오프라인)', '설치할 때 함께 들어온 모델입니다. 인터넷이 필요 없습니다.')}
        {radio('online', '최신 (온라인)', '더 정확한 최신 모델을 내려받아 씁니다. 인터넷이 필요합니다.')}
        {mode !== 'offline' && (
          <Row label="정밀도" labelWidth={60}>
            <Select
              value={model}
              onChange={(e) => setModel(e.target.value as OnlineModel)}
              sx={{ ...selectSx, width: 220 }}
              SelectDisplayProps={{ 'aria-label': '온라인 모델 정밀도' } as React.HTMLAttributes<HTMLDivElement>}
            >
              <MenuItem value="isnet_fp16">표준 (fp16, 빠름)</MenuItem>
              <MenuItem value="isnet">최고 (전정밀, 내려받기 큼)</MenuItem>
            </Select>
          </Row>
        )}
        <Box sx={{ fontSize: font.xs, color: online === false ? color.danger : color.textSecondary }}>
          {online === null ? '인터넷 연결을 확인하는 중…' : online ? '● 인터넷에 연결되어 있어 최신 모델을 쓸 수 있습니다.' : '○ 인터넷에 연결되어 있지 않습니다. 내장 모델만 쓸 수 있습니다.'}
        </Box>
      </GroupBox>
      {blocked && <Note ok={false}>인터넷에 연결되어 있지 않아 최신(온라인) 모델을 받을 수 없습니다. 내장 모델로 진행하거나, 연결 후 다시 시도하세요.</Note>}
      <SliderRow label="가장자리 다듬기" labelWidth={100} value={m.refine} min={0} max={40} unit="px" onChange={(refine) => setM({ ...m, refine })} />
      <SliderRow label="가장자리 이동" labelWidth={100} value={m.shift} min={-20} max={20} unit="px" onChange={(shift) => setM({ ...m, shift })} />
      <SliderRow label="매트 대비" labelWidth={100} value={m.contrast} min={0} max={100} onChange={(contrast) => setM({ ...m, contrast })} />
      <Lines>{['가장자리 다듬기: 머리카락·털처럼 가는 부분을 살립니다.', '가장자리 이동: 음수로 하면 테두리에 남은 배경색이 줄어듭니다.', '매트 대비: 뿌옇게 비치는 부분을 걷어 냅니다.']}</Lines>
    </ClassicDialog>
  )
}

/** JPEG·WebP 내보내기 — 실제 인코딩 결과·용량 미리보기 (Compositor JPEGExportSheet) */
function ExportHost({ format }: { format: 'jpeg' | 'webp' }): JSX.Element | null {
  const tab = editor.tab
  const flat = useMemo(() => (tab ? mergedBitmap(tab.history.present) : null), []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!tab || !flat) return null
  const jpeg = format === 'jpeg'
  const enc = async (q: number, m: string): Promise<Uint8Array> => (jpeg ? encodeJpeg(flat, q / 100, parseHex(m)) : encodeWebp(flat, q / 100))
  return (
    <ExportDialog
      open
      formatLabel={jpeg ? 'JPEG' : 'WebP'}
      opaque={jpeg}
      quality={jpeg ? 90 : 85}
      matte="#ffffff"
      applyLabel="저장…"
      encode={async (q, m) => ({ bytes: await enc(q, m), mime: jpeg ? 'image/jpeg' : 'image/webp', width: flat.width, height: flat.height })}
      onClose={close}
      onApply={async (q, m) => {
        close()
        const path = await window.api.saveAs(`${tab.name}.${jpeg ? 'jpg' : 'webp'}`, jpeg ? 'jpeg' : 'webp')
        if (!path) return
        await editor.busy(`${jpeg ? 'JPEG' : 'WebP'} 저장 중…`, async () => {
          const bytes = await enc(q, m)
          await window.api.write(path, jpeg ? embedJpegDpi(bytes, tab.history.present.resolution) : bytes)
          editor.toast('ok', `내보냈습니다: ${path}`)
        })
      }}
    />
  )
}

/** 이전 실행이 비정상 종료되며 남긴 자동 저장본 복구 */
function RecoverDialog({ items }: { items: { id: string; name: string; path: string | null; savedAt: number }[] }): JSX.Element {
  const [pick, setPick] = useState<Set<string>>(() => new Set(items.map((i) => i.id)))
  const restore = async (): Promise<void> => {
    close()
    for (const it of items) {
      if (pick.has(it.id)) {
        const ok = await editor.busy(`${it.name} 복구 중…`, async () => {
          const doc = unpackProject(await window.api.recovery.read(it.id))
          // 복구본은 "저장 안 됨" 상태로 연다 (원래 경로가 있으면 기억 — 저장하면 덮어쓴다)
          editor.addTab(doc, `${it.name} (복구됨)`, null, '복구')
          return true
        })
        if (!ok) continue
      }
      await window.api.recovery.clear(it.id).catch(() => {})
    }
  }
  const discard = async (): Promise<void> => {
    close()
    for (const it of items) await window.api.recovery.clear(it.id).catch(() => {})
  }
  return (
    <ClassicDialog
      open
      title="문서 복구"
      onClose={close}
      onEnter={() => void restore()}
      width={440}
      actions={
        <>
          <Button variant="outlined" onClick={() => void discard()} sx={{ mr: 'auto' }}>
            모두 버리기
          </Button>
          <Button variant="outlined" onClick={close}>
            나중에
          </Button>
          <Button variant="contained" onClick={() => void restore()} disabled={pick.size === 0}>
            복구
          </Button>
        </>
      }
    >
      <Lines small={false}>{['지난번에 프로그램이 저장하지 않은 채 끝났습니다.', '자동 저장된 문서를 복구할까요?']}</Lines>
      <GroupBox title="자동 저장본">
        {items.map((it) => (
          <Box key={it.id} component="label" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={pick.has(it.id)}
              onChange={(e) => {
                const n = new Set(pick)
                if (e.target.checked) n.add(it.id)
                else n.delete(it.id)
                setPick(n)
              }}
              style={{ margin: 0, accentColor: color.accent }}
            />
            <b>{it.name}</b>
            <Box component="span" sx={{ fontSize: font.xs, color: color.textSecondary }}>
              {new Date(it.savedAt).toLocaleString()}
            </Box>
          </Box>
        ))}
      </GroupBox>
      <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>나중에를 누르면 다음에 실행할 때 다시 묻습니다.</Box>
    </ClassicDialog>
  )
}

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x…) Direct3D11 …)" → "NVIDIA GeForce RTX 3060" */
function shortGpu(name: string): string {
  const inner = name.replace(/^ANGLE \(/, '').replace(/\)$/, '')
  const part = inner.split(', ')[1] ?? inner
  return (
    part
      .replace(/\s*\(0x[0-9A-Fa-f]+\).*$/, '')
      .replace(/\s+Direct3D.*$/, '')
      .trim() || name
  )
}

/** 이미지 ▸ 조정 ▸ 흑백·색상 균형·활기·포스터화·한계값 — 활성 레이어(선택 영역 한정)에, 잠시 뒤 캔버스 미리보기 */
function MoreAdjustHost({ which }: { which: MoreAdjustKind }): JSX.Element | null {
  const doc = useRef(editor.doc).current
  const target = doc ? getLayer(doc, doc.activeId) : null
  const [a, setA] = useState<MoreAdjust>({ ...DEFAULT_MORE, kind: which })
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones')
  const latest = useRef(a)
  latest.current = a
  useEffect(() => {
    if (!doc || !target) return
    const t = setTimeout(() => editor.setPreview(editPixels(doc, target.id, 'layer', undefined, (px) => applyMoreAdjust(px, a))), 150)
    return () => clearTimeout(t)
  }, [a]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.setPreview(null), [])
  if (!doc || !target) return null
  const ok = (): void => {
    editor.setPreview(null)
    close()
    const d = editor.doc
    if (d)
      editor.commit(
        editPixels(d, target.id, 'layer', undefined, (px) => applyMoreAdjust(px, latest.current)),
        MORE_LABELS[latest.current.kind]
      )
  }
  const bw = (k: keyof typeof a.bw, label: string): JSX.Element => (
    <SliderRow key={k} label={label} labelWidth={60} value={a.bw[k]} min={-200} max={300} unit="%" onChange={(v) => setA({ ...a, bw: { ...a.bw, [k]: v } })} />
  )
  const cbRow = (tone: 'shadows' | 'midtones' | 'highlights', i: 0 | 1 | 2, label: string): JSX.Element => (
    <SliderRow
      key={tone + i}
      label={label}
      labelWidth={90}
      value={a.cb[tone][i]}
      min={-100}
      max={100}
      onChange={(v) => {
        const arr = [...a.cb[tone]] as [number, number, number]
        arr[i] = v
        setA({ ...a, cb: { ...a.cb, [tone]: arr } })
      }}
    />
  )
  return (
    <ClassicDialog
      open
      title={`${MORE_LABELS[a.kind]}${doc.selection ? ' (선택 영역만)' : ''}`}
      onClose={close}
      onEnter={ok}
      width={480}
      actions={
        <>
          <Button variant="outlined" onClick={close}>
            취소
          </Button>
          <Button variant="contained" onClick={ok}>
            확인
          </Button>
        </>
      }
    >
      <ClassicTabs value={a.kind} onChange={(kind) => setA({ ...a, kind })} tabs={(Object.keys(MORE_LABELS) as MoreAdjustKind[]).map((k) => ({ key: k, label: MORE_LABELS[k] }))} />
      <Box sx={{ minHeight: 250, display: 'flex', flexDirection: 'column', gap: '6px', pt: '8px' }}>
        {a.kind === 'blackWhite' && (
          <>
            {bw('reds', '빨강')}
            {bw('yellows', '노랑')}
            {bw('greens', '초록')}
            {bw('cyans', '청록')}
            {bw('blues', '파랑')}
            {bw('magentas', '마젠타')}
            <Lines>{['색마다 흑백으로 바뀔 때의 밝기를 정합니다.', '하늘을 어둡게 하려면 파랑을 낮추세요.']}</Lines>
          </>
        )}
        {a.kind === 'colorBalance' && (
          <>
            <Row label="범위" labelWidth={90}>
              {(
                [
                  ['shadows', '어두운 곳'],
                  ['midtones', '중간'],
                  ['highlights', '밝은 곳']
                ] as const
              ).map(([k, label]) => (
                <Box key={k} component="label" sx={{ display: 'flex', alignItems: 'center', gap: '4px', mr: '10px' }}>
                  <input type="radio" name="cb-tone" checked={tone === k} onChange={() => setTone(k)} style={{ margin: 0, accentColor: color.accent }} />
                  {label}
                </Box>
              ))}
            </Row>
            {cbRow(tone, 0, '청록 ↔ 빨강')}
            {cbRow(tone, 1, '마젠타 ↔ 초록')}
            {cbRow(tone, 2, '노랑 ↔ 파랑')}
            <Check label="밝기 유지" checked={a.cb.preserveLuminosity} onChange={(preserveLuminosity) => setA({ ...a, cb: { ...a.cb, preserveLuminosity } })} />
          </>
        )}
        {a.kind === 'vibrance' && (
          <>
            <SliderRow label="활기" labelWidth={60} value={a.vibrance} min={-100} max={100} onChange={(vibrance) => setA({ ...a, vibrance })} />
            <SliderRow label="채도" labelWidth={60} value={a.saturation} min={-100} max={100} onChange={(saturation) => setA({ ...a, saturation })} />
            <Lines>{['활기는 흐린 색을 더 많이, 이미 선명한 색은 조금만 올립니다.', '인물 사진에서 피부가 과하게 붉어지지 않습니다.']}</Lines>
          </>
        )}
        {a.kind === 'posterize' && <SliderRow label="단계" labelWidth={60} value={a.levels} min={2} max={32} onChange={(levels) => setA({ ...a, levels })} />}
        {a.kind === 'threshold' && (
          <>
            <SliderRow label="경계" labelWidth={60} value={a.threshold} min={1} max={255} onChange={(threshold) => setA({ ...a, threshold })} />
            <Lines>{['이 밝기보다 밝으면 흰색, 어두우면 검정이 됩니다.']}</Lines>
          </>
        )}
      </Box>
    </ClassicDialog>
  )
}

const MORE_LABELS: Record<MoreAdjustKind, string> = { blackWhite: '흑백', colorBalance: '색상 균형', vibrance: '활기', posterize: '포스터화', threshold: '한계값' }

/**
 * 선택 ▸ 가장자리 다듬기 (포토샵 Select and Mask 의 핵심만) — 그림의 경계를 길잡이로 선택 테두리를 맞춘다.
 * 가장자리 감지(가이드 필터)로 머리카락·털을 살리고, 매끄럽게·페더·대비·가장자리 이동으로 다듬는다. 미리보기는 바로.
 */
function RefineEdgeDialog(): JSX.Element {
  const d0 = useRef(editor.doc).current
  const [o, setO] = useState({ radius: 6, smooth: 0, feather: 0, contrast: 0, shift: 0, dim: true })
  // 길잡이 = 보이는 그림의 밝기 (한 번만)
  const guide = useMemo(() => {
    if (!d0) return null
    const flat = mergedBitmap(d0)
    const g = new Float32Array(flat.width * flat.height)
    for (let i = 0; i < g.length; i++) g[i] = (0.299 * flat.data[i * 4] + 0.587 * flat.data[i * 4 + 1] + 0.114 * flat.data[i * 4 + 2]) / 255
    return g
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const result = useRef<Selection | null>(null)
  useEffect(() => {
    if (!d0?.selection || !guide) return
    const t = setTimeout(() => {
      const W = d0.width
      const H = d0.height
      let m: Float32Array = Float32Array.from(d0.selection!.mask, (v) => v / 255)
      m = refineMatte(m, guide, W, H, { refine: o.radius, shift: o.shift, contrast: o.contrast })
      let sel = makeSelection(
        W,
        H,
        Uint8Array.from(m, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
      )
      if (sel && o.smooth) sel = smoothSelection(sel, o.smooth)
      if (sel && o.feather) sel = featherSelection(sel, o.feather)
      result.current = sel
      // 미리보기: 선택 테두리 + (켜면) 바깥을 어둡게 — 1×1 검정 레이어를 문서 크기로 늘리고 선택 반전을 마스크로
      let layers = d0.layers
      if (o.dim && sel) {
        const inv = new Uint8ClampedArray(W * H * 4)
        for (let i = 0; i < W * H; i++) {
          inv[i * 4] = inv[i * 4 + 1] = inv[i * 4 + 2] = 255 - sel.mask[i]
          inv[i * 4 + 3] = 255
        }
        const tint = makeLayer('pixel', '미리보기', { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }, identityTransform(W, H), {
          opacity: 0.6,
          mask: { bitmap: { width: W, height: H, data: inv }, enabled: true, linked: true }
        })
        layers = [...layers, tint]
      }
      editor.setPreview({ ...d0, layers, selection: sel })
    }, 120)
    return () => clearTimeout(t)
  }, [o]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.setPreview(null), [])
  const go = (): void => {
    editor.setPreview(null)
    close()
    const d = editor.doc
    if (d && result.current) editor.commit({ ...d, selection: result.current }, '가장자리 다듬기')
  }
  const set = (patch: Partial<typeof o>): void => setO({ ...o, ...patch })
  return (
    <ClassicDialog
      open
      title="가장자리 다듬기"
      onClose={close}
      onEnter={go}
      width={460}
      actions={
        <>
          <Button variant="outlined" onClick={close}>
            취소
          </Button>
          <Button variant="contained" onClick={go}>
            확인
          </Button>
        </>
      }
    >
      <GroupBox title="가장자리 감지">
        <SliderRow label="반경" labelWidth={90} value={o.radius} min={0} max={40} unit="px" onChange={(radius) => set({ radius })} />
        <Lines>{['선택 테두리를 그림의 경계에 맞춥니다.', '머리카락·털처럼 가는 부분이 살아납니다.']}</Lines>
      </GroupBox>
      <GroupBox title="전체 가장자리">
        <SliderRow label="매끄럽게" labelWidth={90} value={o.smooth} min={0} max={20} unit="px" onChange={(smooth) => set({ smooth })} />
        <SliderRow label="페더" labelWidth={90} value={o.feather} min={0} max={30} unit="px" onChange={(feather) => set({ feather })} />
        <SliderRow label="대비" labelWidth={90} value={o.contrast} min={0} max={100} unit="%" onChange={(contrast) => set({ contrast })} />
        <SliderRow label="가장자리 이동" labelWidth={90} value={o.shift} min={-20} max={20} unit="px" onChange={(shift) => set({ shift })} />
      </GroupBox>
      <Check label="선택 바깥을 어둡게 보기" checked={o.dim} onChange={(dim) => set({ dim })} />
    </ClassicDialog>
  )
}

/** 편집 ▸ 환경 설정 — 실행취소 단계·자동 저장·속도·배경 제거 모델 */
function PreferencesDialog(): JSX.Element {
  const s = editor.state.settings
  const [hist, setHist] = useState(s.historyLimit)
  const [budget, setBudget] = useState(s.historyBudgetMB)
  const [auto, setAuto] = useState(s.autosaveMinutes)
  const [fast, setFast] = useState(s.fastInteract)
  const [bg, setBg] = useState<BgMode>(loadBgMode)
  const gpu = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : '없음'
    } catch {
      return '알 수 없음'
    }
  })()
  const software = /swiftshader|llvmpipe|basic render/i.test(gpu)
  const go = (): void => {
    close()
    editor.setSettings({ historyLimit: hist, historyBudgetMB: budget, autosaveMinutes: auto, fastInteract: fast })
    try {
      localStorage.setItem(BG_MODE_KEY, bg)
    } catch {
      /* 무시 */
    }
  }
  return (
    <ClassicDialog
      open
      title="환경 설정"
      onClose={close}
      onEnter={go}
      width={520}
      actions={
        <>
          <Button variant="outlined" onClick={close}>
            취소
          </Button>
          <Button variant="contained" onClick={go}>
            확인
          </Button>
        </>
      }
    >
      <GroupBox title="작업">
        <SliderRow label="실행 취소 단계" labelWidth={100} value={hist} min={20} max={300} step={10} unit="칸" onChange={setHist} />
        <SliderRow label="실행 취소 메모리" labelWidth={100} value={budget} min={256} max={8192} step={256} unit="MB" onChange={setBudget} />
        <Row label="자동 저장" labelWidth={100}>
          <Select
            value={auto}
            onChange={(e) => setAuto(Number(e.target.value))}
            sx={{ ...selectSx, width: 140 }}
            SelectDisplayProps={{ 'aria-label': '자동 저장 간격' } as React.HTMLAttributes<HTMLDivElement>}
          >
            {[0, 1, 3, 5, 10].map((m) => (
              <MenuItem key={m} value={m}>
                {m === 0 ? '끔' : `${m}분마다`}
              </MenuItem>
            ))}
          </Select>
        </Row>
        <Lines>{['실행 취소 메모리를 넘으면 오래된 단계부터 지웁니다.', '큰 사진을 다룰 때는 메모리를 줄이세요.', '자동 저장은 프로그램이 갑자기 꺼졌을 때 복구하는 데 쓰입니다.']}</Lines>
      </GroupBox>
      <GroupBox title="속도">
        <Check label="끄거나 칠하는 동안 화면을 낮은 해상도로 그리기 (빠름)" checked={fast} onChange={setFast} />
        <Box sx={{ fontSize: font.xs, color: software ? color.danger : color.textSecondary }}>
          {software ? 'GPU 없이 CPU로 화면을 그리고 있어 느릴 수 있습니다. 위 설정을 켜 두세요.' : `그래픽: ${shortGpu(gpu)}`}
        </Box>
      </GroupBox>
      <GroupBox title="배경 제거·피사체 선택">
        <Row label="기본 모델" labelWidth={100}>
          <Select
            value={bg}
            onChange={(e) => setBg(e.target.value as BgMode)}
            sx={{ ...selectSx, width: 220 }}
            SelectDisplayProps={{ 'aria-label': '기본 모델' } as React.HTMLAttributes<HTMLDivElement>}
          >
            <MenuItem value="auto">자동 (인터넷이 되면 최신)</MenuItem>
            <MenuItem value="offline">내장 (오프라인)</MenuItem>
            <MenuItem value="online">최신 (온라인)</MenuItem>
          </Select>
        </Row>
      </GroupBox>
    </ClassicDialog>
  )
}

/** 편집 ▸ 선 그리기 — 두께·위치·색·불투명도 */
function StrokeDialog(): JSX.Element {
  const [w, setW] = useState(4)
  const [pos, setPos] = useState<'inside' | 'center' | 'outside'>('center')
  const [hexc, setHex] = useState(() => '#' + editor.state.fg.map((v) => v.toString(16).padStart(2, '0')).join(''))
  const [op, setOp] = useState(100)
  const go = (): void => {
    close()
    A.strokeSelection({ width: w, position: pos, color: parseHex(hexc), opacity: op / 100 })
  }
  return (
    <ClassicDialog
      open
      title="선 그리기"
      onClose={close}
      onEnter={go}
      width={380}
      actions={
        <>
          <Button variant="outlined" onClick={close}>
            취소
          </Button>
          <Button variant="contained" onClick={go}>
            확인
          </Button>
        </>
      }
    >
      <SliderRow label="두께" labelWidth={56} value={w} min={1} max={100} unit="px" onChange={setW} />
      <SliderRow label="불투명도" labelWidth={56} value={op} min={1} max={100} unit="%" onChange={setOp} />
      <Row label="색" labelWidth={56}>
        <PaletteControl title="선 색" value={hexc} onChange={setHex} />
      </Row>
      <Row label="위치" labelWidth={56}>
        {(
          [
            ['inside', '안쪽'],
            ['center', '가운데'],
            ['outside', '바깥쪽']
          ] as const
        ).map(([k, label]) => (
          <Box key={k} component="label" sx={{ display: 'flex', alignItems: 'center', gap: '4px', mr: '12px' }}>
            <input type="radio" name="stroke-pos" checked={pos === k} onChange={() => setPos(k)} style={{ margin: 0, accentColor: color.accent }} />
            {label}
          </Box>
        ))}
      </Row>
    </ClassicDialog>
  )
}

/** 보기 ▸ 안내선 ▸ 새 안내선 — 방향과 위치(px 또는 %) */
function NewGuideDialog(): JSX.Element {
  const [axis, setAxis] = useState<'v' | 'h'>('v')
  const [pos, setPos] = useState('50%')
  const d = editor.doc
  const size = d ? (axis === 'v' ? d.width : d.height) : 0
  const parsed = pos.trim().endsWith('%') ? (parseFloat(pos) / 100) * size : parseFloat(pos)
  const ok = Number.isFinite(parsed) && parsed >= 0 && parsed <= size
  const go = (): void => {
    if (!ok) return
    close()
    addGuide(axis, parsed)
  }
  return (
    <ClassicDialog
      open
      title="새 안내선"
      onClose={close}
      onEnter={go}
      width={340}
      actions={
        <>
          <Button variant="outlined" onClick={close}>
            취소
          </Button>
          <Button variant="contained" onClick={go} disabled={!ok}>
            확인
          </Button>
        </>
      }
    >
      <Row label="방향" labelWidth={48}>
        {(['v', 'h'] as const).map((a) => (
          <Box key={a} component="label" sx={{ display: 'flex', alignItems: 'center', gap: '4px', mr: '12px' }}>
            <input type="radio" name="guide-axis" checked={axis === a} onChange={() => setAxis(a)} style={{ margin: 0, accentColor: color.accent }} />
            {a === 'v' ? '세로' : '가로'}
          </Box>
        ))}
      </Row>
      <Row label="위치" labelWidth={48}>
        <BarInput value={pos} width={90} ariaLabel="안내선 위치" onChange={setPos} />
        <Box component="span" sx={{ color: color.textSecondary }}>
          px 또는 % (0~{size}px)
        </Box>
      </Row>
    </ClassicDialog>
  )
}

/** 닫기 확인 → 저장/버림 뒤 탭 닫기(또는 앱 종료) */
export async function finishClose(tabIds: string[], quit: boolean, save: boolean): Promise<void> {
  close()
  for (const id of tabIds) {
    if (save) {
      editor.switchTab(id)
      const ok = await saveProject()
      if (!ok) return // 저장 취소 → 닫기도 취소
    }
    editor.closeTab(id)
  }
  if (quit) {
    await clearSessionRecovery()
    void window.api.win.confirmClose()
  }
}

let untitled = 0

/** 열린 대화상자 하나를 그린다 (store.dialog) */
export default function DialogHost(): JSX.Element | null {
  const dialog = useEditor((s) => s.dialog)
  const doc = useDoc()
  const tabs = useEditor((s) => s.tabs)
  if (!dialog) return null
  let body: JSX.Element | null = null
  switch (dialog.kind) {
    case 'newCanvas':
      body = (
        <NewCanvasDialog
          onClose={close}
          onCreate={(r) => {
            close()
            const bg: [number, number, number, number] | null =
              r.background === 'transparent' ? null : r.background === 'black' ? [0, 0, 0, 255] : r.background === 'bg' ? [...editor.state.bg, 255] : [255, 255, 255, 255]
            editor.addTab(newDoc(r.width, r.height, bg, r.dpi), `제목 없음 ${++untitled}`, null, '새로 만들기')
          }}
        />
      )
      break
    case 'imageSize':
      if (doc)
        body = (
          <ImageSizeDialog
            open
            source={{ width: doc.width, height: doc.height }}
            initialDpi={doc.resolution}
            onClose={close}
            onApply={(r) => {
              close()
              runCommand(resizeCommand, { width: r.width ?? doc.width, height: r.height ?? doc.height, resolution: r.dpi })
            }}
          />
        )
      break
    case 'canvasSize':
      if (doc)
        body = (
          <CanvasSizeDialog
            open
            frame={{ width: doc.width, height: doc.height }}
            value={null}
            onClose={close}
            onApply={(o) => {
              close()
              void A.applyCanvasSize(o)
            }}
          />
        )
      break
    case 'adjust':
      body = <AdjustHost tab={dialog.tab} layerId={dialog.layerId} />
      break
    case 'filters':
      body = <FiltersHost focus={dialog.focus} />
      break
    case 'effects':
      body = <EffectsHost layerId={dialog.layerId} />
      break
    case 'export':
      body = <ExportHost format={dialog.format} />
      break
    case 'recover':
      body = <RecoverDialog items={dialog.items} />
      break
    case 'selectAmount':
      body = (
        <SelectAmountDialog
          op={dialog.op}
          onClose={close}
          onApply={(px) => {
            close()
            if (dialog.op === 'maskFeather') A.featherMask(px)
            else if (dialog.op === 'smooth') A.smoothSel(px)
            else A.modifySelection(dialog.op, px)
          }}
        />
      )
      break
    case 'color': {
      const which = dialog.which
      body = (
        <ColorDialog
          title={which === 'fg' ? '전경색' : '배경색'}
          value={which === 'fg' ? editor.state.fg : editor.state.bg}
          onClose={close}
          onApply={(c) => {
            close()
            editor.set(which === 'fg' ? { fg: c } : { bg: c })
          }}
        />
      )
      break
    }
    case 'rename': {
      const l = doc && getLayer(doc, dialog.layerId)
      if (doc && l)
        body = (
          <RenameDialog
            name={l.name}
            onClose={close}
            onApply={(name) => {
              close()
              runCommand(layerUpdateCommand, { layerId: l.id, name }, '이름 바꾸기')
            }}
          />
        )
      break
    }
    case 'confirmClose': {
      const names = tabs.filter((t) => dialog.tabIds.includes(t.id)).map((t) => t.name)
      body = (
        <ConfirmCloseDialog names={names} onClose={close} onSave={() => void finishClose(dialog.tabIds, dialog.quit, true)} onDiscard={() => void finishClose(dialog.tabIds, dialog.quit, false)} />
      )
      break
    }
    case 'help':
      body = <HelpDialog onClose={close} />
      break
    case 'about':
      body = <AboutDialog onClose={close} />
      break
    case 'removeBg':
      body = <RemoveBgDialog />
      break
    case 'newGuide':
      body = <NewGuideDialog />
      break
    case 'stroke':
      body = <StrokeDialog />
      break
    case 'preferences':
      body = <PreferencesDialog />
      break
    case 'refineEdge':
      body = <RefineEdgeDialog />
      break
    case 'moreAdjust':
      body = <MoreAdjustHost which={dialog.which} />
      break
  }
  if (!body) {
    // 대상이 사라진 대화상자 (문서를 닫는 등) — 조용히 닫는다
    queueMicrotask(close)
    return null
  }
  return <Suspense fallback={null}>{body}</Suspense>
}
