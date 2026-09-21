import { useEffect, useRef } from 'react'
import Button from '@mui/material/Button'
import { Filters, DEFAULT_FILTERS, hasFilters } from '@core/index'
import { ClassicDialog, GroupBox, Check, SliderRow } from './parts'

/**
 * 필터 대화상자 — Compositor `FilterSheet` 의 가우시안 블러·모션 블러·노이즈 추가·렌즈 보정.
 * 값은 잠시 뒤 캔버스 미리보기에 반영되고, 취소하면 열기 전 값으로 되돌린다. 수식은 core/filters.ts.
 */
export default function FiltersDialog({ value, onChange, onClose }: { value: Filters; onChange: (f: Filters) => void; onClose: () => void }): JSX.Element {
  const before = useRef(value)
  useEffect(() => {
    before.current = value
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Filters>): void => onChange({ ...value, ...patch })
  const cancel = (): void => {
    onChange(before.current)
    onClose()
  }
  return (
    <ClassicDialog
      open
      title="필터"
      onClose={cancel}
      onEnter={onClose}
      width={460}
      actions={
        <>
          <Button variant="outlined" onClick={() => onChange(DEFAULT_FILTERS)} disabled={!hasFilters(value)} sx={{ mr: 'auto' }}>
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
      <GroupBox title="흐림">
        <SliderRow label="가우시안" value={value.blur} min={0} max={100} step={0.5} unit="px" onChange={(blur) => set({ blur })} />
        <SliderRow label="모션 거리" value={value.motionDistance} min={0} max={200} unit="px" onChange={(motionDistance) => set({ motionDistance })} />
        <SliderRow label="모션 각도" value={value.motionAngle} min={-180} max={180} unit="°" onChange={(motionAngle) => set({ motionAngle })} />
      </GroupBox>
      <GroupBox title="노이즈 추가">
        <SliderRow label="양" value={value.noise} min={0} max={100} unit="%" onChange={(noise) => set({ noise })} />
        <Check label="가우시안 분포 (끄면 균일)" checked={value.noiseGaussian} onChange={(noiseGaussian) => set({ noiseGaussian })} />
        <Check label="단색 (색 얼룩 없이 밝기만)" checked={value.noiseMono} onChange={(noiseMono) => set({ noiseMono })} />
      </GroupBox>
      <GroupBox title="렌즈 보정">
        <SliderRow label="왜곡" value={value.lens} min={-100} max={100} onChange={(lens) => set({ lens })} />
      </GroupBox>
    </ClassicDialog>
  )
}
