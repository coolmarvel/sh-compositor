import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { ClassicDialog, GroupBox, Lines } from './parts'
import { ui } from '../../theme'
import appIconUrl from '../../assets/app-icon.png'
import signUrl from '../../assets/sign.png'

const { color, space, font } = ui

declare const __APP_VERSION__: string

/** 오픈소스 고지 — 한 줄에 하나씩 (이름 · 라이선스 · 쓰임) */
const NOTICES: [string, string, string][] = [
  ['Compositor', 'MIT', '원본 편집기 (© 2026 Wonder Assembly LLC)'],
  ['@imgly/background-removal', 'AGPL-3.0', 'AI 배경 제거'],
  ['React · MUI', 'MIT', '화면'],
  ['fflate', 'MIT', '프로젝트 파일 압축'],
  ['ag-psd', 'MIT', 'PSD 열기·저장'],
  ['SlimSAM · transformers.js', 'Apache-2.0', 'AI 개체 선택']
]

/** 도움말 → 정보. 제작 크레딧 + 오픈소스 고지 (Compositor MIT 조건: 저작권 표시 유지) */
export default function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
  return (
    <ClassicDialog
      open
      title="SH Compositor 정보"
      onClose={onClose}
      onEnter={onClose}
      width={540}
      actions={
        <Button variant="contained" onClick={onClose}>
          확인
        </Button>
      }
    >
      <Box sx={{ display: 'flex', gap: `${space.lg}px`, alignItems: 'center' }}>
        <Box component="img" src={appIconUrl} alt="" sx={{ width: 48, height: 48 }} />
        <Box>
          <Box sx={{ fontSize: font.xl, fontWeight: font.bold }}>SH Compositor {version && `v${version}`}</Box>
          <Box sx={{ color: color.textSecondary }}>레이어 기반 오프라인 이미지 편집기</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px`, mt: `${space.xs}px` }}>
            제작 이성현 © 2026
            <Box component="img" src={signUrl} alt="이성현 서명" sx={{ height: 16 }} />
          </Box>
        </Box>
      </Box>
      <GroupBox title="오픈소스 고지">
        <Lines>{['macOS용 무료 편집기 Compositor를 Windows용으로 옮겨 만들었습니다.', '라이선스 전문은 설치 폴더의 LICENSE.txt와 THIRD_PARTY_NOTICES.md에 있습니다.']}</Lines>
        <Box
          component="table"
          className="selectable"
          sx={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: font.xs,
            '& td': { py: '2px', pr: '10px', verticalAlign: 'top', whiteSpace: 'nowrap' },
            '& td:last-of-type': { whiteSpace: 'normal', pr: 0 }
          }}
        >
          <tbody>
            {NOTICES.map(([name, lic, use]) => (
              <tr key={name}>
                <td>
                  <b>{name}</b>
                </td>
                <td>{lic}</td>
                <td>{use}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </GroupBox>
    </ClassicDialog>
  )
}
