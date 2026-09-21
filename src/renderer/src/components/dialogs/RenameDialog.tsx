import { useState } from 'react'
import Button from '@mui/material/Button'
import { BarInput } from '../bar'
import { ClassicDialog, Row } from './parts'

export default function RenameDialog({ name, onClose, onApply }: { name: string; onClose: () => void; onApply: (name: string) => void }): JSX.Element {
  const [v, setV] = useState(name)
  const apply = (): void => {
    if (v.trim()) onApply(v.trim())
  }
  return (
    <ClassicDialog
      open
      title="레이어 이름 바꾸기"
      onClose={onClose}
      onEnter={apply}
      width={340}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={apply} disabled={!v.trim()}>
            확인
          </Button>
        </>
      }
    >
      <Row label="이름">
        <BarInput value={v} width={220} ariaLabel="새 이름" onChange={setV} />
      </Row>
    </ClassicDialog>
  )
}
