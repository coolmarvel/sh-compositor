import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import { editor, useEditor, useDoc } from '../editor/store'
import * as A from '../editor/actions'
import { bakeLayer, adjustLayer } from '../editor/pixels'
import { encodeJpeg, encodeWebp, mergedBitmap, saveProject } from '../editor/io'
import { clearSessionRecovery } from '../editor/autosave'
import { unpackProject } from '@core/index'
import {
  getLayer,
  updateLayer,
  makeLayer,
  identityTransform,
  newDoc,
  resizeImage,
  flattenDoc,
  histogram,
  parseHex,
  embedJpegDpi,
  DEFAULT_ADJUST,
  DEFAULT_FILTERS,
  DEFAULT_EFFECTS,
  DEFAULT_MATTE,
  ADJUSTMENT_KINDS,
  type Adjustments,
  type Filters,
  type LayerEffects,
  type Doc,
  type Bitmap,
  type MatteRefine
} from '@core/index'
import { ClassicDialog, SliderRow, GroupBox, Row, Note } from './dialogs/parts'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { selectSx } from './bar'
import { checkOnline, type OnlineModel } from '../editor/bgremove'
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
    editor.set({ preview: { ...doc, layers: [...doc.layers.slice(0, idx + 1), tmp, ...doc.layers.slice(idx + 1)] } })
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.set({ preview: null }), [])

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
      title={`보정 — ${target.name}${doc.selection ? ' (선택 영역)' : ''}`}
      onChange={(a) => {
        latest.current = a
        setValue(a)
      }}
      onClose={() => {
        editor.set({ preview: null })
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
function FiltersHost(): JSX.Element | null {
  const doc = useRef(editor.doc).current
  const target = doc ? getLayer(doc, doc.activeId) : null
  const [value, setValue] = useState<Filters>(DEFAULT_FILTERS)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    if (!doc || !target) return
    const t = setTimeout(() => editor.set({ preview: value === DEFAULT_FILTERS ? null : adjustLayer(doc, target.id, null, value) }), 180)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => editor.set({ preview: null }), [])
  if (!doc || !target) return null
  return (
    <FiltersDialog
      value={value}
      onChange={(f) => {
        latest.current = f
        setValue(f)
      }}
      onClose={() => {
        editor.set({ preview: null })
        close()
        const v = latest.current
        const d = editor.doc
        if (d && v !== DEFAULT_FILTERS) void editor.busy('필터 적용 중…', () => editor.commit(adjustLayer(d, target.id, null, v), '필터'))
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
      width={480}
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
      <Box>
        활성 레이어에서 피사체를 찾아 나머지를 <b>레이어 마스크</b>로 가립니다. 계산은 이 PC 에서 하고 이미지는 어디에도 올리지 않습니다.
      </Box>
      <GroupBox title="모델">
        {radio('auto', '자동', '인터넷이 되면 최신, 아니면 내장 모델')}
        {radio('offline', '내장 (오프라인)', '인스톨러에 포함된 모델 — 인터넷 불필요')}
        {radio('online', '최신 (온라인)', '개선된 최신 모델을 내려받아 사용 — 인터넷 필요')}
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
          {online === null ? '인터넷 연결 확인 중…' : online ? '● 온라인 — 최신 모델을 쓸 수 있습니다.' : '○ 오프라인 — 최신 모델을 쓸 수 없습니다 (내장 모델은 사용 가능).'}
        </Box>
      </GroupBox>
      {blocked && <Note ok={false}>인터넷에 연결되어 있지 않아 최신(온라인) 모델을 받을 수 없습니다. 내장 모델로 진행하거나, 연결 후 다시 시도하세요.</Note>}
      <SliderRow label="가장자리 다듬기" labelWidth={100} value={m.refine} min={0} max={40} unit="px" onChange={(refine) => setM({ ...m, refine })} />
      <SliderRow label="가장자리 이동" labelWidth={100} value={m.shift} min={-20} max={20} unit="px" onChange={(shift) => setM({ ...m, shift })} />
      <SliderRow label="매트 대비" labelWidth={100} value={m.contrast} min={0} max={100} onChange={(contrast) => setM({ ...m, contrast })} />
      <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>다듬기 = 머리카락·털 살리기 · 이동(음수) = 테두리 배경색 띠 없애기 · 대비 = 뿌연 반투명 걷기 (Compositor GuidedMatte)</Box>
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
      <Box>지난번에 프로그램이 저장하지 않은 채 끝났습니다. 자동 저장된 문서를 복구할까요?</Box>
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
      <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>"나중에"를 누르면 다음 실행 때 다시 묻습니다.</Box>
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
              editor.commit(resizeImage(doc, r.width ?? doc.width, r.height ?? doc.height, r.dpi), '이미지 크기')
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
      body = <FiltersHost />
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
              editor.commit(updateLayer(doc, l.id, { name }), '이름 바꾸기')
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
    case 'about':
      body = <AboutDialog onClose={close} />
      break
    case 'removeBg':
      body = <RemoveBgDialog />
      break
  }
  if (!body) {
    // 대상이 사라진 대화상자 (문서를 닫는 등) — 조용히 닫는다
    queueMicrotask(close)
    return null
  }
  return <Suspense fallback={null}>{body}</Suspense>
}
