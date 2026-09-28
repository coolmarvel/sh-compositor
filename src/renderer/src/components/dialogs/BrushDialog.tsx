import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { editor, useEditor } from '../../editor/store'
import { decodeImage } from '../../editor/io'
import { StrokeCoverage, applyStroke, bytesToBase64, DEFAULT_TIP, type BrushSettings, type BrushTip, type BrushTexture, type Bitmap } from '@core/index'
import { ClassicDialog, GroupBox, Row, Check, SliderRow, Lines } from './parts'
import { ui } from '../../theme'

const { color, font, chrome } = ui
const TIP_MAX = 256

/** 그림 → 팁 알파 (알파가 있으면 알파, 아니면 어두울수록 진하게). 긴 변 256px 까지 줄인다 */
function toTip(b: Bitmap): { width: number; height: number; alphaBase64: string } {
  const s = Math.min(1, TIP_MAX / Math.max(b.width, b.height))
  const w = Math.max(1, Math.round(b.width * s))
  const h = Math.max(1, Math.round(b.height * s))
  let hasAlpha = false
  for (let i = 3; i < b.data.length; i += 4)
    if (b.data[i] < 255) {
      hasAlpha = true
      break
    }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(b.width - 1, Math.floor(x / s))
      const sy = Math.min(b.height - 1, Math.floor(y / s))
      const o = (sy * b.width + sx) * 4
      out[y * w + x] = hasAlpha ? b.data[o + 3] : 255 - Math.round(0.299 * b.data[o] + 0.587 * b.data[o + 1] + 0.114 * b.data[o + 2])
    }
  return { width: w, height: h, alphaBase64: bytesToBase64(out) }
}
function toTexture(b: Bitmap, prev?: BrushTexture): BrushTexture {
  const s = Math.min(1, TIP_MAX / Math.max(b.width, b.height))
  const w = Math.max(1, Math.round(b.width * s))
  const h = Math.max(1, Math.round(b.height * s))
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (Math.min(b.height - 1, Math.floor(y / s)) * b.width + Math.min(b.width - 1, Math.floor(x / s))) * 4
      out[y * w + x] = Math.round(0.299 * b.data[o] + 0.587 * b.data[o + 1] + 0.114 * b.data[o + 2])
    }
  return { width: w, height: h, grayBase64: bytesToBase64(out), scale: prev?.scale ?? 1, strength: prev?.strength ?? 0.5 }
}

/** 브러시 설정 — 팁 모양·각도·원형도·간격·흩뿌리기·지터·질감. 아래에 견본 획 미리보기 */
export default function BrushDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const b = useEditor((st) => st.settings.brush)
  const [draft, setDraft] = useState<BrushSettings>(b)
  const tip: BrushTip = draft.tip ?? DEFAULT_TIP
  const setTip = (patch: Partial<BrushTip>): void => setDraft({ ...draft, tip: { ...tip, ...patch } })
  // MUI Dialog(Portal)는 첫 커밋 뒤에야 내용을 붙인다 → useRef 는 첫 effect 에서 null. 콜백 ref 상태로 캔버스가 생기면 그린다
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const c = preview
    if (!c) return
    const W = c.width
    const H = c.height
    const s: BrushSettings = { ...draft, size: Math.min(draft.size, 60), opacity: draft.opacity }
    const cov = new StrokeCoverage(W, H, s, 3)
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      cov.lineTo(20 + t * (W - 40), H / 2 + Math.sin(t * Math.PI * 2) * (H / 4), 0.3 + 0.7 * Math.sin(t * Math.PI))
    }
    const white: Bitmap = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) }
    const out = applyStroke(white, cov, [0, 0, 0], 'paint')
    const g = c.getContext('2d')
    if (!g) return
    g.putImageData(new ImageData(new Uint8ClampedArray(out.data), W, H), 0, 0)
  }, [draft, preview])
  const load = async (what: 'tip' | 'texture'): Promise<void> => {
    const files = await window.api.open('image')
    if (!files[0]) return
    try {
      const { bitmap } = await decodeImage(files[0].bytes, files[0].name)
      if (what === 'tip') setDraft({ ...draft, tip: { ...tip, shape: 'image', image: toTip(bitmap) } })
      else setDraft({ ...draft, texture: toTexture(bitmap, draft.texture) })
    } catch (e) {
      editor.toast('err', e instanceof Error ? e.message : String(e))
    }
  }
  const ok = (): void => {
    editor.setSettings({ brush: draft })
    onClose()
  }
  return (
    <ClassicDialog
      open
      title="브러시 설정"
      onClose={onClose}
      onEnter={ok}
      width={520}
      actions={
        <>
          <Button variant="outlined" onClick={() => setDraft({ ...draft, tip: undefined, texture: undefined })} sx={{ mr: 'auto' }}>
            둥근 팁으로
          </Button>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={ok}>
            확인
          </Button>
        </>
      }
    >
      {/* Box 는 width/height 를 CSS 로 취급해 캔버스 픽셀 크기가 300×150 이 된다 → 일반 canvas 로 속성을 직접 준다 */}
      <canvas ref={setPreview} width={480} height={90} aria-label="브러시 미리보기" style={{ display: 'block', width: '100%', border: `1px solid ${chrome.frame}`, background: '#fff' }} />
      <GroupBox title="팁 모양">
        <Row label="모양" labelWidth={80}>
          {(
            [
              ['round', '둥근'],
              ['square', '사각'],
              ['image', '그림']
            ] as const
          ).map(([k, label]) => (
            <Box key={k} component="label" sx={{ display: 'flex', alignItems: 'center', gap: '4px', mr: '10px', fontSize: font.md }}>
              <input type="radio" name="tip-shape" checked={tip.shape === k} onChange={() => setTip({ shape: k })} style={{ margin: 0, accentColor: color.accent }} />
              {label}
            </Box>
          ))}
          <Button variant="outlined" size="small" onClick={() => void load('tip')}>
            그림 불러오기…
          </Button>
        </Row>
        {tip.shape === 'image' && !tip.image && <Lines>{['PNG 를 불러오면 투명도(없으면 어두운 정도)가 팁이 됩니다.']}</Lines>}
        <SliderRow label="각도" labelWidth={80} value={tip.angle} min={-180} max={180} unit="°" onChange={(angle) => setTip({ angle })} />
        <SliderRow label="원형도" labelWidth={80} value={Math.round(tip.roundness * 100)} min={5} max={100} unit="%" onChange={(v) => setTip({ roundness: v / 100 })} />
        <SliderRow label="간격" labelWidth={80} value={Math.round((tip.spacing ?? 0.025) * 100)} min={1} max={200} unit="%" onChange={(v) => setTip({ spacing: v / 100 })} />
        <Lines>{['간격은 지름 대비 비율입니다. 넓히면 점이 띄엄띄엄 찍힙니다.']}</Lines>
      </GroupBox>
      <GroupBox title="흩뿌리기·지터">
        <SliderRow label="흩뿌리기" labelWidth={80} value={Math.round((tip.scatter ?? 0) * 100)} min={0} max={200} unit="%" onChange={(v) => setTip({ scatter: v / 100 })} />
        <SliderRow label="크기 지터" labelWidth={80} value={Math.round((tip.sizeJitter ?? 0) * 100)} min={0} max={100} unit="%" onChange={(v) => setTip({ sizeJitter: v / 100 })} />
        <SliderRow label="불투명도 지터" labelWidth={80} value={Math.round((tip.opacityJitter ?? 0) * 100)} min={0} max={100} unit="%" onChange={(v) => setTip({ opacityJitter: v / 100 })} />
      </GroupBox>
      <GroupBox title="질감">
        <Row label="무늬" labelWidth={80}>
          <Button variant="outlined" size="small" onClick={() => void load('texture')}>
            그림 불러오기…
          </Button>
          <Check label="질감 사용" checked={!!draft.texture} disabled={!draft.texture} onChange={(on) => !on && setDraft({ ...draft, texture: undefined })} />
        </Row>
        {draft.texture && (
          <>
            <SliderRow
              label="배율"
              labelWidth={80}
              value={Math.round(draft.texture.scale * 100)}
              min={10}
              max={400}
              unit="%"
              onChange={(v) => setDraft({ ...draft, texture: { ...draft.texture!, scale: v / 100 } })}
            />
            <SliderRow
              label="강도"
              labelWidth={80}
              value={Math.round(draft.texture.strength * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => setDraft({ ...draft, texture: { ...draft.texture!, strength: v / 100 } })}
            />
          </>
        )}
        <Lines>{['밝은 곳은 그대로 칠해지고 어두운 곳은 덜 칠해집니다.']}</Lines>
      </GroupBox>
    </ClassicDialog>
  )
}
