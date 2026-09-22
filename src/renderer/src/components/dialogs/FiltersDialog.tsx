import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { Filters, DEFAULT_FILTERS, hasFilters } from '@core/index'
import { ClassicDialog, GroupBox, Check, SliderRow, Lines } from './parts'
import { ClassicTabs } from './tabs'

type Tab = 'blur' | 'sharpen' | 'other'

/**
 * 필터 대화상자 — Compositor `FilterSheet`(흐림·노이즈·렌즈) + 포토샵 필터(언샤프 마스크·하이 패스·모자이크·노이즈 감소).
 * 값은 잠시 뒤 캔버스 미리보기에 반영되고, 취소하면 열기 전 값으로 되돌린다. 수식은 core/filters.ts.
 */
export default function FiltersDialog({ value, onChange, onClose, initialTab = 'blur' }: { value: Filters; onChange: (f: Filters) => void; onClose: () => void; initialTab?: Tab }): JSX.Element {
  const before = useRef(value)
  const [tab, setTab] = useState<Tab>(initialTab)
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
      width={480}
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
      <ClassicTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'blur', label: '흐림·노이즈·렌즈' },
          { key: 'sharpen', label: '선명하게' },
          { key: 'other', label: '모자이크·노이즈 감소' }
        ]}
      />
      <Box sx={{ minHeight: 300, display: 'flex', flexDirection: 'column', gap: '8px', pt: '8px' }}>
        {tab === 'blur' && (
          <>
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
          </>
        )}
        {tab === 'sharpen' && (
          <>
            <GroupBox title="언샤프 마스크">
              <SliderRow label="양" value={value.sharpenAmount ?? 0} min={0} max={500} unit="%" onChange={(sharpenAmount) => set({ sharpenAmount })} />
              <SliderRow label="반경" value={value.sharpenRadius ?? 1} min={0.3} max={20} step={0.1} unit="px" onChange={(sharpenRadius) => set({ sharpenRadius })} />
              <SliderRow label="한계값" value={value.sharpenThreshold ?? 0} min={0} max={255} onChange={(sharpenThreshold) => set({ sharpenThreshold })} />
              <Lines>{['사진을 또렷하게 합니다.', '보통 양 80~150%, 반경 1~2px 이 알맞습니다.', '한계값을 올리면 피부처럼 매끈한 곳은 건드리지 않습니다.']}</Lines>
            </GroupBox>
            <GroupBox title="하이 패스">
              <SliderRow label="반경" value={value.highPass ?? 0} min={0} max={50} step={0.5} unit="px" onChange={(highPass) => set({ highPass })} />
              <Lines>{['윤곽만 남기고 나머지를 회색으로 만듭니다.', '레이어를 복제해 하이 패스를 걸고 오버레이로 겹치면 선명해집니다.']}</Lines>
            </GroupBox>
          </>
        )}
        {tab === 'other' && (
          <>
            <GroupBox title="모자이크">
              <SliderRow label="칸 크기" value={value.mosaic ?? 0} min={0} max={100} unit="px" onChange={(mosaic) => set({ mosaic })} />
            </GroupBox>
            <GroupBox title="노이즈 감소">
              <SliderRow label="반경" value={value.median ?? 0} min={0} max={10} unit="px" onChange={(median) => set({ median })} />
              <Lines>{['점처럼 튀는 잡티를 주변 값으로 바꿉니다.', '반경을 키울수록 뭉개집니다.']}</Lines>
            </GroupBox>
          </>
        )}
      </Box>
    </ClassicDialog>
  )
}
