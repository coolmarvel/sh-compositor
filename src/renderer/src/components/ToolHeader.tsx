import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FlipRounded from '@mui/icons-material/FlipRounded'
import { editor, useEditor, useDoc } from '../editor/store'
import { toolInfo } from '../tools'
import { CROP_RATIO_LIST, hasCrop } from '../tools/misc'
import { hasPendingDistort } from '../tools/move'
import { runCommand } from '../editor/commands'
import { selectAll, deselect, invertSelection } from '../editor/actions'
import { renderText } from '../editor/text'
import { getLayer, updateLayer, flipLayer, type LayerTransform } from '@core/index'
import { Group, GDivider, BarInput, SliderControl, ToggleChip, IconBevel, Hint, selectSx } from './bar'
import { Check } from './dialogs/parts'
import { ui } from '../theme'

const { color, chrome, size, space, font, surface } = ui

/** 흔한 한글·영문 글꼴 (Windows 기본 탑재) */
const FONTS = ['Malgun Gothic', '돋움', '굴림', '바탕', '궁서', 'Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Impact', 'Consolas']

function Num({ label, value, onCommit, width = 60, unit }: { label: string; value: number; onCommit: (v: number) => void; width?: number; unit?: string }): JSX.Element {
  return (
    <Group label={label}>
      <BarInput
        type="number"
        key={Math.round(value * 100)}
        value={String(Math.round(value * 100) / 100)}
        width={width}
        ariaLabel={label}
        onChange={(v) => {
          const n = Number(v)
          if (v !== '' && Number.isFinite(n)) onCommit(n)
        }}
      />
      {unit && (
        <Box component="span" sx={{ color: color.textSecondary, fontSize: font.xs }}>
          {unit}
        </Box>
      )}
    </Group>
  )
}

/** 이동 도구 — 수치 변형 (Compositor TransformInspector) */
function MoveHeader(): JSX.Element {
  const doc = useDoc()
  const s = useEditor((st) => st.settings)
  const l = doc ? getLayer(doc, doc.activeId) : null
  const t = l?.transform
  const set = (patch: Partial<LayerTransform>): void => {
    if (!doc || !l || !t) return
    let next = { ...t, ...patch }
    // 비율 잠금: 폭을 바꾸면 높이도 (가운데 유지)
    if (s.showTransformControls && patch.width !== undefined && patch.height === undefined) next = { ...next, height: (t.height * patch.width) / t.width }
    if (s.showTransformControls && patch.height !== undefined && patch.width === undefined) next = { ...next, width: (t.width * patch.height) / t.height }
    editor.commit(updateLayer(doc, l.id, { transform: next }), '변형')
  }
  const pct = l?.bitmap && t ? (t.width / l.bitmap.width) * 100 : 100
  return (
    <>
      {t && l && l.kind !== 'group' && l.kind !== 'adjustment' ? (
        <>
          <Num label="X" value={t.x} onCommit={(x) => set({ x })} />
          <Num label="Y" value={t.y} onCommit={(y) => set({ y })} />
          <Num label="폭" value={t.width} onCommit={(width) => set({ width: Math.max(1, width) })} />
          <Num label="높이" value={t.height} onCommit={(height) => set({ height: Math.max(1, height) })} />
          <Num
            label="배율"
            value={pct}
            unit="%"
            onCommit={(p) =>
              l.bitmap &&
              set({ width: (l.bitmap.width * p) / 100, height: (l.bitmap.height * p) / 100, x: t.x + t.width / 2 - (l.bitmap.width * p) / 200, y: t.y + t.height / 2 - (l.bitmap.height * p) / 200 })
            }
          />
          <Num label="각도" value={t.rotation} unit="°" width={52} onCommit={(rotation) => set({ rotation })} />
          <IconBevel icon={<FlipRounded />} tooltip="좌우 반전" onClick={() => doc && editor.commit(flipLayer(doc, l.id, true), '좌우 반전')} />
          <IconBevel icon={<FlipRounded sx={{ transform: 'rotate(90deg)' }} />} tooltip="상하 반전" onClick={() => doc && editor.commit(flipLayer(doc, l.id, false), '상하 반전')} />
          <GDivider />
        </>
      ) : (
        <Hint>레이어를 고르면 위치·크기를 숫자로 바꿀 수 있습니다.</Hint>
      )}
      <Check label="비율 고정" checked={s.showTransformControls} onChange={(v) => editor.setSettings({ showTransformControls: v })} />
      <Check label="자동 선택 (누른 레이어)" checked={s.autoSelect} onChange={(autoSelect) => editor.setSettings({ autoSelect })} />
      {hasPendingDistort() && (
        <>
          <GDivider />
          <Button variant="contained" onClick={() => runCommand('toolCommit')}>
            자유 변형 적용
          </Button>
          <Button variant="outlined" onClick={() => runCommand('toolCancel')}>
            취소
          </Button>
        </>
      )}
    </>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }): JSX.Element {
  return (
    <Box sx={{ display: 'flex' }}>
      {options.map((o) => (
        <ToggleChip key={o.key} label={o.label} tooltip={o.label} on={value === o.key} onClick={() => onChange(o.key)} />
      ))}
    </Box>
  )
}

function BrushControls({ opacityLabel = '불투명도', strength = false }: { opacityLabel?: string; strength?: boolean }): JSX.Element {
  const s = useEditor((st) => st.settings)
  const b = s.brush
  return (
    <>
      <SliderControl label="크기" tooltip="[ ] 로 조절" value={b.size} min={1} max={1000} format={(v) => `${Math.round(v)}px`} onChange={(v) => editor.setSettings({ brush: { ...b, size: v } })} />
      <SliderControl
        label="경도"
        tooltip="Shift+[ ] 로 조절"
        value={Math.round(b.hardness * 100)}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onChange={(v) => editor.setSettings({ brush: { ...b, hardness: v / 100 } })}
      />
      {strength ? (
        <SliderControl label="강도" tooltip="1~0 키" value={s.blurStrength} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => editor.setSettings({ blurStrength: v })} />
      ) : (
        <SliderControl
          label={opacityLabel}
          tooltip="1~0 키 (획 전체의 상한)"
          value={Math.round(b.opacity * 100)}
          min={1}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => editor.setSettings({ brush: { ...b, opacity: v / 100 } })}
        />
      )}
    </>
  )
}

/** 문자 도구 — 선택한 문자 레이어가 있으면 바로 그 레이어를 바꾼다 */
function TypeHeader(): JSX.Element {
  const s = useEditor((st) => st.settings)
  const doc = useDoc()
  const l = doc ? getLayer(doc, doc.activeId) : null
  const tl = l?.kind === 'text' && l.text ? l : null
  const apply = (patch: Partial<typeof s>, textPatch: Record<string, unknown>): void => {
    editor.setSettings(patch)
    if (doc && tl?.text) {
      const data = { ...tl.text, ...textPatch }
      const bmp = renderText(data)
      editor.commit(updateLayer(doc, tl.id, { text: data, bitmap: bmp, transform: { ...tl.transform, width: bmp.width, height: bmp.height } }), '문자 서식')
    }
  }
  const cur = tl?.text
  return (
    <>
      <Group label="글꼴">
        <Select
          value={cur?.font ?? s.typeFont}
          onChange={(e) => apply({ typeFont: e.target.value }, { font: e.target.value })}
          sx={{ ...selectSx, width: 140 }}
          SelectDisplayProps={{ 'aria-label': '글꼴' } as React.HTMLAttributes<HTMLDivElement>}
        >
          {FONTS.map((f) => (
            <MenuItem key={f} value={f} sx={{ fontFamily: f }}>
              {f}
            </MenuItem>
          ))}
        </Select>
      </Group>
      <Num label="크기" value={cur?.size ?? s.typeSize} unit="px" onCommit={(v) => v > 0 && apply({ typeSize: v }, { size: v })} />
      <ToggleChip label="굵게" tooltip="굵게" on={cur?.bold ?? s.typeBold} onClick={() => apply({ typeBold: !(cur?.bold ?? s.typeBold) }, { bold: !(cur?.bold ?? s.typeBold) })} />
      <ToggleChip label="기울임" tooltip="기울임" on={cur?.italic ?? s.typeItalic} onClick={() => apply({ typeItalic: !(cur?.italic ?? s.typeItalic) }, { italic: !(cur?.italic ?? s.typeItalic) })} />
      <Seg
        value={cur?.align ?? s.typeAlign}
        options={[
          { key: 'left', label: '왼쪽' },
          { key: 'center', label: '가운데' },
          { key: 'right', label: '오른쪽' }
        ]}
        onChange={(v) => apply({ typeAlign: v }, { align: v })}
      />
      {cur && (
        <>
          <Num label="줄 간격" value={cur.lineHeight} onCommit={(v) => v > 0 && apply({}, { lineHeight: v })} width={50} />
          <Num label="자간" value={cur.tracking} onCommit={(v) => apply({}, { tracking: v })} width={50} />
          <Group label="색">
            <Box
              component="input"
              type="color"
              value={cur.color}
              aria-label="문자 색"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => apply({}, { color: e.target.value })}
              sx={{ width: 28, height: size.ctlMd, p: 0, border: `1px solid ${color.borderStrong}` }}
            />
          </Group>
        </>
      )}
    </>
  )
}

/**
 * 도구 헤더 — Compositor 의 도구별 헤더 줄(TransformInspector·BrushControls·LassoControls…).
 * 도구를 바꾸면 내용이 바뀌고 높이는 고정 (캔버스가 흔들리지 않게).
 */
export default function ToolHeader(): JSX.Element {
  const tool = useEditor((s) => s.tool)
  const s = useEditor((st) => st.settings)
  const maskEditing = useEditor((st) => st.maskEditing)
  // 도구 내부 상태(자르기 상자·자유 변형 진행 중)가 바뀌면 다시 그린다
  useEditor((st) => st.renderTick)
  const doc = useDoc()
  const info = toolInfo(tool)
  let body: JSX.Element | null = null
  switch (tool) {
    case 'move':
      body = <MoveHeader />
      break
    case 'marquee':
      body = (
        <>
          <Seg
            value={s.marqueeKind}
            options={[
              { key: 'rect', label: '사각형' },
              { key: 'ellipse', label: '타원' }
            ]}
            onChange={(marqueeKind) => editor.setSettings({ marqueeKind })}
          />
          <SelectionOps />
        </>
      )
      break
    case 'lasso':
      body = (
        <>
          <Seg
            value={s.lassoKind}
            options={[
              { key: 'free', label: '자유' },
              { key: 'polygon', label: '다각형' }
            ]}
            onChange={(lassoKind) => editor.setSettings({ lassoKind })}
          />
          <SelectionOps />
        </>
      )
      break
    case 'wand':
      body = (
        <>
          <SliderControl
            label="허용 오차"
            tooltip="클릭한 색에서 채널마다 이만큼까지 같은 색으로 봅니다"
            value={s.wandTolerance}
            min={0}
            max={255}
            format={(v) => String(v)}
            onChange={(wandTolerance) => editor.setSettings({ wandTolerance })}
          />
          <Check label="인접" checked={s.wandContiguous} onChange={(wandContiguous) => editor.setSettings({ wandContiguous })} />
          <Check label="모든 레이어" checked={s.wandSampleAll} onChange={(wandSampleAll) => editor.setSettings({ wandSampleAll })} />
          <SelectionOps />
        </>
      )
      break
    case 'crop':
      body = (
        <>
          <Group label="비율">
            <Select
              value={s.cropRatio}
              onChange={(e) => editor.setSettings({ cropRatio: e.target.value })}
              sx={{ ...selectSx, width: 110 }}
              SelectDisplayProps={{ 'aria-label': '자르기 비율' } as React.HTMLAttributes<HTMLDivElement>}
            >
              {CROP_RATIO_LIST.map((r) => (
                <MenuItem key={r.key} value={r.key}>
                  {r.label}
                </MenuItem>
              ))}
            </Select>
          </Group>
          <Check label="잘린 픽셀 삭제" checked={s.cropDelete} onChange={(cropDelete) => editor.setSettings({ cropDelete })} />
          <GDivider />
          <Button variant="contained" disabled={!hasCrop()} onClick={() => runCommand('toolCommit')}>
            자르기 적용
          </Button>
          <Button variant="outlined" disabled={!hasCrop()} onClick={() => runCommand('toolCancel')}>
            취소
          </Button>
        </>
      )
      break
    case 'brush':
      body = (
        <>
          <Seg
            value={s.brushMode}
            options={[
              { key: 'paint', label: '칠하기 (B)' },
              { key: 'erase', label: '지우개 (E)' }
            ]}
            onChange={(brushMode) => editor.setSettings({ brushMode })}
          />
          <BrushControls />
          {maskEditing && <Hint>마스크를 칠하는 중 — 검정 = 가림, 흰색 = 보임</Hint>}
        </>
      )
      break
    case 'spotHealing':
      body = (
        <>
          <Seg
            value={s.healMode}
            options={[
              { key: 'contentAware', label: '내용 인식' },
              { key: 'proximity', label: '근접 일치' }
            ]}
            onChange={(healMode) => editor.setSettings({ healMode })}
          />
          <BrushControls opacityLabel="불투명도" />
        </>
      )
      break
    case 'cloneStamp':
      body = (
        <>
          <BrushControls />
          <Check label="정렬" checked={s.cloneAligned} onChange={(cloneAligned) => editor.setSettings({ cloneAligned })} />
          <Check label="모든 레이어에서" checked={s.cloneSampleAll} onChange={(cloneSampleAll) => editor.setSettings({ cloneSampleAll })} />
        </>
      )
      break
    case 'blur':
      body = (
        <>
          <Seg
            value={s.blurMode}
            options={[
              { key: 'blur', label: '흐림' },
              { key: 'smudge', label: '문지르기' },
              { key: 'liquify', label: '리퀴파이' }
            ]}
            onChange={(blurMode) => editor.setSettings({ blurMode })}
          />
          <BrushControls strength />
        </>
      )
      break
    case 'gradient':
      body = (
        <>
          <Seg
            value={s.gradientShape}
            options={[
              { key: 'linear', label: '선형' },
              { key: 'radial', label: '원형' }
            ]}
            onChange={(gradientShape) => editor.setSettings({ gradientShape })}
          />
          <Check label="뒤집기" checked={s.gradientReverse} onChange={(gradientReverse) => editor.setSettings({ gradientReverse })} />
          <Check label="전경색 → 투명" checked={s.gradientToTransparent} onChange={(gradientToTransparent) => editor.setSettings({ gradientToTransparent })} />
        </>
      )
      break
    case 'shape':
      body = (
        <>
          <Seg
            value={s.shapeKind}
            options={[
              { key: 'rect', label: '사각형' },
              { key: 'roundRect', label: '둥근 사각형' },
              { key: 'ellipse', label: '타원' },
              { key: 'line', label: '선' }
            ]}
            onChange={(shapeKind) => editor.setSettings({ shapeKind })}
          />
          <Check label="채우기(전경색)" checked={s.shapeFill} onChange={(shapeFill) => editor.setSettings({ shapeFill })} />
          <Check label="외곽선(배경색)" checked={s.shapeStroke} onChange={(shapeStroke) => editor.setSettings({ shapeStroke })} />
          <Num label="두께" value={s.shapeStrokeWidth} unit="px" onCommit={(v) => editor.setSettings({ shapeStrokeWidth: Math.max(0, v) })} width={48} />
          {s.shapeKind === 'roundRect' && <Num label="모서리" value={s.shapeRadius} unit="px" onCommit={(v) => editor.setSettings({ shapeRadius: Math.max(0, v) })} width={48} />}
        </>
      )
      break
    case 'type':
      body = <TypeHeader />
      break
    case 'eyedropper':
      body = <Check label="표본 고리" checked={s.sampleRing} onChange={(sampleRing) => editor.setSettings({ sampleRing })} />
      break
    case 'hand':
    case 'zoom':
      body = (
        <>
          <Button variant="outlined" onClick={() => runCommand('fit')}>
            화면에 맞춤
          </Button>
          <Button variant="outlined" onClick={() => runCommand('actualSize')}>
            실제 크기
          </Button>
          <Hint>Ctrl+0 맞춤 · Ctrl+1 실제 크기 · Ctrl+휠 확대/축소 · Space+끌기 이동</Hint>
        </>
      )
      break
  }
  return (
    <Box
      role="toolbar"
      aria-label="도구 옵션"
      sx={{
        height: size.toolBar + 2,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: `${space.sm}px`,
        px: `${space.base}px`,
        background: surface.toolbar2,
        borderBottom: `1px solid ${chrome.frame}`,
        overflowX: 'auto',
        '& > *': { flexShrink: 0 }
      }}
    >
      <Box component="span" sx={{ fontWeight: font.bold, minWidth: 96, whiteSpace: 'nowrap' }}>
        {info?.key === 'brush' && s.brushMode === 'erase' ? '지우개' : (info?.label ?? '도구 없음')}
      </Box>
      <GDivider />
      {doc ? body : <Hint>파일 → 새로 만들기(Ctrl+N) 또는 열기(Ctrl+O)</Hint>}
    </Box>
  )
}

/** 선택 도구 공통 — 모두·해제·반전·확장/축소/페더·레이어 픽셀 */
function SelectionOps(): JSX.Element {
  const doc = useDoc()
  const has = !!doc?.selection
  return (
    <>
      <GDivider />
      <Button variant="outlined" onClick={selectAll}>
        모두
      </Button>
      <Button variant="outlined" disabled={!has} onClick={deselect}>
        해제
      </Button>
      <Button variant="outlined" onClick={invertSelection}>
        반전
      </Button>
      <Button variant="outlined" disabled={!has} onClick={() => editor.set({ dialog: { kind: 'selectAmount', op: 'feather' } })}>
        페더…
      </Button>
    </>
  )
}
