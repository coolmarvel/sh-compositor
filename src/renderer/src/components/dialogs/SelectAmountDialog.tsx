import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { BarInput } from '../bar'
import { ClassicDialog, Row } from './parts'
import { ui } from '../../theme'

const { color } = ui

const TITLES = { expand: '선택 영역 확장', contract: '선택 영역 축소', feather: '선택 영역 페더', maskFeather: '마스크 페더', smooth: '선택 영역 매끄럽게' } as const
const memory: Record<keyof typeof TITLES, number> = { expand: 4, contract: 4, feather: 8, maskFeather: 8, smooth: 4 }

/** 선택 ▸ 수정 ▸ 확장/축소/페더 — Compositor `SelectionAmountSheet` */
export default function SelectAmountDialog({ op, onClose, onApply }: { op: keyof typeof TITLES; onClose: () => void; onApply: (px: number) => void }): JSX.Element {
  const [v, setV] = useState(String(memory[op]))
  const n = Number(v)
  const ok = Number.isFinite(n) && n > 0 && n <= 500
  const apply = (): void => {
    if (!ok) return
    memory[op] = n
    onApply(n)
  }
  return (
    <ClassicDialog
      open
      title={TITLES[op]}
      onClose={onClose}
      onEnter={apply}
      width={320}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={apply} disabled={!ok}>
            확인
          </Button>
        </>
      }
    >
      <Row label={op === 'smooth' ? '반경' : op === 'feather' || op === 'maskFeather' ? '페더 반경' : op === 'expand' ? '확장' : '축소'}>
        <BarInput type="number" width={80} value={v} ariaLabel="픽셀" onChange={setV} />
        <Box component="span" sx={{ color: color.textSecondary }}>
          픽셀 (1~500)
        </Box>
      </Row>
    </ClassicDialog>
  )
}
