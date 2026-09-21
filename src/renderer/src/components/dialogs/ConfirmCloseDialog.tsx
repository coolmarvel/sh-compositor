import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { ClassicDialog } from './parts'
import { ui } from '../../theme'

const { color, font } = ui

/** 저장하지 않은 문서 닫기 확인 — 저장 / 저장 안 함 / 취소 */
export default function ConfirmCloseDialog({ names, onSave, onDiscard, onClose }: { names: string[]; onSave: () => void; onDiscard: () => void; onClose: () => void }): JSX.Element {
  return (
    <ClassicDialog
      open
      title="저장하지 않은 변경"
      onClose={onClose}
      onEnter={onSave}
      width={400}
      actions={
        <>
          <Button variant="outlined" onClick={onDiscard} sx={{ mr: 'auto' }}>
            저장 안 함
          </Button>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={onSave} autoFocus>
            저장
          </Button>
        </>
      }
    >
      <Box>{names.length === 1 ? `"${names[0]}" 의 변경 내용을 저장할까요?` : `저장하지 않은 문서 ${names.length}개가 있습니다. 저장할까요?`}</Box>
      {names.length > 1 && <Box sx={{ color: color.textSecondary, fontSize: font.xs }}>{names.join(', ')}</Box>}
      <Box sx={{ color: color.textSecondary, fontSize: font.xs }}>저장하지 않으면 변경 내용이 사라집니다.</Box>
    </ClassicDialog>
  )
}
