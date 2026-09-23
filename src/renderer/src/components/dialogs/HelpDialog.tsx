import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { ClassicDialog } from './parts'
import { ClassicTabs } from './tabs'
import { TOOLS } from '../../tools'
import { TOOL_CATALOG, TOOL_GROUPS, UNSUPPORTED_ON_SERVER } from '../../../../application/catalog'
import { ui } from '../../theme'

const { color, chrome, space, font, surface } = ui

/** 한 줄 = [누르는 키, 하는 일(한 문장 한 줄)] */
type Row = [string, string | string[]]
interface Section {
  title: string
  rows?: Row[]
  notes?: string[]
}
type TabKey = 'start' | 'tools' | 'select' | 'paint' | 'adjust' | 'layers' | 'view' | 'mcp'

/** 도구 설명(`tools/index.ts` desc)을 문장마다 한 줄로 */
const sentences = (s: string): string[] => s.split(/(?<=\.)\s+/).filter(Boolean)

const TOOL_ROWS: Row[] = TOOLS.map((t) => [t.shortcut.replace('·', ' / '), [t.label, ...sentences(t.desc)]])

/** MCP 도구 표 — `application/catalog.ts` 를 그대로 (서버가 등록하는 도구와 같은 목록). 이름은 접두사 compositor_ 를 뗀다 */
const MCP_SECTIONS: Section[] = TOOL_GROUPS.map((g) => ({
  title: g.label,
  rows: TOOL_CATALOG.filter((t) => t.group === g.key).map((t): Row => [t.name.replace(/^compositor_/, ''), [t.title, ...t.lines, `매개변수: ${t.params}`]])
}))

/** 사용 설명서 내용. 단축키는 `App.tsx onKey`·메뉴와 같아야 한다 (바꾸면 여기도) */
const PAGES: Record<TabKey, Section[]> = {
  start: [
    {
      title: '처음 쓰는 순서',
      notes: [
        '파일 ▸ 열기(Ctrl+O)로 사진을 열거나, 파일을 창에 끌어다 놓습니다.',
        '그림이 열려 있을 때 끌어다 놓은 사진은 새 레이어로 들어갑니다.',
        '왼쪽 도구 막대에서 도구를 고르면 위쪽 옵션 줄이 그 도구에 맞게 바뀝니다.',
        '맨 아래 상태 줄에 지금 도구의 사용법이 나옵니다.',
        '작업은 Ctrl+S로 프로젝트(.shcomp)에 저장해 두면 레이어가 그대로 남습니다.',
        '다른 프로그램에 쓸 그림은 파일 ▸ 내보내기로 PNG·JPEG·WebP를 만듭니다.'
      ]
    },
    {
      title: '되돌리기',
      rows: [
        ['Ctrl+Z', '방금 한 작업을 취소합니다.'],
        ['Ctrl+Shift+Z / Ctrl+Y', '취소한 작업을 다시 합니다.'],
        ['작업 내역 탭', ['오른쪽 아래 작업 내역에서 단계를 누르면 그때로 돌아갑니다.', '스냅샷을 만들어 두면 언제든 그 상태로 돌아올 수 있습니다.']]
      ]
    },
    {
      title: '어느 도구에서나 쓰는 키',
      rows: [
        ['Space 누른 채 끌기', '잠시 손 도구가 되어 화면을 옮깁니다.'],
        ['Ctrl+끌기', '잠시 이동 도구가 되어 레이어를 옮깁니다.'],
        ['X', '전경색과 배경색을 서로 바꿉니다.'],
        ['D', '색을 기본값(검정과 흰색)으로 되돌립니다.'],
        ['F1', '이 사용 설명서를 엽니다.']
      ]
    }
  ],
  tools: [{ title: '도구 (왼쪽 도구 막대)', rows: TOOL_ROWS, notes: ['W를 누를 때마다 마법봉과 개체 선택이 번갈아 바뀝니다.', 'B는 브러시, E는 지우개입니다.'] }],
  select: [
    {
      title: '선택 기본',
      rows: [
        ['Ctrl+A', '그림 전체를 선택합니다.'],
        ['Ctrl+D', '선택을 해제합니다.'],
        ['Ctrl+Shift+I', '선택을 반대로 뒤집습니다.'],
        ['Shift+끌기', '지금 선택에 더합니다.'],
        ['Alt+끌기', '지금 선택에서 뺍니다.'],
        ['Delete', '선택한 곳의 그림을 지웁니다.'],
        ['Ctrl+J', '선택한 곳을 복사해 새 레이어로 만듭니다.'],
        ['Ctrl+Shift+J', '선택한 곳을 잘라 새 레이어로 만듭니다.']
      ]
    },
    {
      title: 'AI 개체 선택 (W)',
      rows: [
        ['사각형·올가미로 감싸기', ['피사체를 넉넉히 감싸면 테두리에 딱 맞게 선택됩니다.']],
        ['칠해서 잡기', '피사체 위를 문지르면 그 개체 전체가 선택됩니다.'],
        ['클릭', '클릭한 자리의 개체를 선택합니다.'],
        ['Shift+클릭', '빠진 부분을 누르면 선택에 포함합니다.'],
        ['Alt+클릭', '잘못 들어간 부분을 누르면 선택에서 뺍니다.'],
        ['옵션 줄 테두리', '선택을 몇 픽셀 넓히거나 좁힙니다.'],
        ['옵션 줄 부드럽게', '선택 경계를 부드럽게 흐립니다.']
      ],
      notes: ['사진마다 처음 한 번은 분석에 몇 초 걸리고, 그 뒤로는 바로 됩니다.', '인터넷 없이 컴퓨터 안에서만 동작합니다.']
    },
    {
      title: '선택 다듬기',
      rows: [
        ['Ctrl+Alt+R', ['가장자리 다듬기를 엽니다.', '머리카락이나 털 같은 가는 테두리를 살립니다.']],
        ['Shift+F6', '선택 경계를 부드럽게 퍼지게 합니다(페더).'],
        ['Shift+F5', '선택한 곳을 주변 그림으로 자연스럽게 메웁니다.'],
        ['선택 ▸ 피사체 (AI)', '사진의 주인공을 한 번에 선택합니다.']
      ]
    }
  ],
  paint: [
    {
      title: '브러시·지우개 (B / E)',
      rows: [
        ['[ / ]', '브러시를 작게 하거나 크게 합니다.'],
        ['Shift+[ / Shift+]', '브러시 가장자리를 부드럽게 하거나 단단하게 합니다.'],
        ['숫자 1 ~ 0', '불투명도를 10%부터 100%까지 바꿉니다.'],
        ['Shift+클릭', '마지막으로 찍은 곳과 직선으로 잇습니다.'],
        ['Alt+Backspace', '선택한 곳을 전경색으로 채웁니다.'],
        ['Ctrl+Backspace', '선택한 곳을 배경색으로 채웁니다.']
      ]
    },
    {
      title: '고치기',
      rows: [
        ['J 스팟 복구', '잡티 위를 칠하면 주변 그림으로 메웁니다.'],
        ['S 복제 도장', ['Alt+클릭으로 가져올 곳을 찍습니다.', '그다음 끌면 그 그림을 옮겨 칠합니다.']],
        ['R 흐림·문지르기', '칠한 곳을 흐리게 하거나 밀어서 모양을 바꿉니다.']
      ]
    },
    {
      title: '그리기·글자',
      rows: [
        ['G 그라데이션', ['끌어서 방향을 정하고 Enter로 적용합니다.', 'Shift를 누르면 45°씩 꺾입니다.']],
        ['U 도형', ['끌어서 새 레이어에 도형을 그립니다.', 'Shift는 정사각형과 원, Alt는 가운데 기준입니다.']],
        ['T 문자', ['클릭하고 입력한 뒤 Ctrl+Enter로 확정합니다.', 'Esc를 누르면 입력을 취소합니다.']],
        ['I 스포이트', ['클릭한 곳의 색을 전경색으로 가져옵니다.', 'Alt+클릭하면 배경색으로 가져옵니다.']]
      ]
    }
  ],
  adjust: [
    {
      title: '색·밝기 조정 (이미지 ▸ 조정)',
      rows: [
        ['Ctrl+L', '레벨로 어두운 곳과 밝은 곳을 맞춥니다.'],
        ['Ctrl+M', '커브로 밝기를 곡선으로 조정합니다.'],
        ['Ctrl+U', '색조와 채도를 바꿉니다.'],
        ['Ctrl+B', '색상 균형으로 색감을 맞춥니다.'],
        ['Ctrl+Shift+Alt+B', '흑백으로 바꿉니다.'],
        ['Ctrl+I', '색을 반전합니다.'],
        ['Ctrl+Shift+U', '채도를 없애 회색으로 만듭니다.'],
        ['Ctrl+Shift+L', '자동 톤으로 밝기를 맞춥니다.'],
        ['Ctrl+Shift+Alt+L', '자동 대비로 대비를 맞춥니다.'],
        ['Ctrl+Shift+B', '자동 색상으로 색 틀어짐을 바로잡습니다.']
      ]
    },
    {
      title: '필터·AI',
      notes: [
        '필터 메뉴에서 흐림, 선명하게, 모자이크, 노이즈 감소를 적용합니다.',
        '필터 ▸ 배경 제거 (AI)는 사진에서 배경을 지우고 피사체만 남깁니다.',
        '레이어 ▸ 새 조정 레이어로 보정하면 원본은 그대로 두고 나중에 다시 고칠 수 있습니다.'
      ]
    }
  ],
  layers: [
    {
      title: '레이어 만들기·정리',
      rows: [
        ['Ctrl+Shift+N', '새 레이어를 만듭니다.'],
        ['Ctrl+J', '레이어를 복제합니다.'],
        ['Ctrl+G', '고른 레이어를 그룹(폴더)으로 묶습니다.'],
        ['Ctrl+Shift+G', '그룹을 풉니다.'],
        ['Ctrl+] / Ctrl+[', '레이어를 한 칸 위나 아래로 옮깁니다.'],
        ['Ctrl+E', '아래 레이어와 합칩니다.'],
        ['Ctrl+Shift+E', '보이는 레이어를 모두 합칩니다.'],
        ['Ctrl+Alt+G', '아래 레이어 모양대로만 보이게 합니다(클리핑 마스크).'],
        ['Q', '레이어 마스크를 추가합니다.']
      ]
    },
    {
      title: '이동·변형 (V)',
      rows: [
        ['끌기', '레이어를 옮깁니다.'],
        ['핸들 끌기', ['모서리 핸들로 크기를 바꿉니다.', '위쪽 원을 끌면 회전합니다.']],
        ['Ctrl+모서리 끌기', ['자유 변형으로 모서리를 따로 움직입니다.', 'Enter를 누르면 적용합니다.']],
        ['Alt+끌기', '레이어를 복제하면서 옮깁니다.'],
        ['방향키', ['1px씩 옮깁니다.', 'Shift를 함께 누르면 10px씩 옮깁니다.']],
        ['옵션 줄 정렬 버튼', ['고른 레이어들을 왼쪽이나 가운데 등으로 맞춥니다.', '세 개 이상이면 같은 간격으로 늘어놓습니다.']]
      ]
    },
    {
      title: '레이어 패널',
      rows: [
        ['이름 두 번 클릭', '레이어 이름을 바꿉니다.'],
        ['효과 줄 두 번 클릭', '그림자, 외곽선, 광선 같은 레이어 효과를 고칩니다.'],
        ['오른쪽 클릭', '레이어 효과 복사와 붙여넣기 등 자주 쓰는 명령이 나옵니다.'],
        ['마스크 썸네일 클릭', ['마스크를 칠할 수 있게 됩니다.', '검정은 가리고 흰색은 보이게 합니다.']]
      ]
    }
  ],
  view: [
    {
      title: '화면 보기',
      rows: [
        ['Ctrl++ / Ctrl+-', '확대하거나 축소합니다.'],
        ['Ctrl+0', '그림 전체가 화면에 들어오게 맞춥니다.'],
        ['Ctrl+1', '실제 크기(100%)로 봅니다.'],
        ["Ctrl+'", '격자를 켜거나 끕니다.'],
        ['Ctrl+R', '눈금자를 켜거나 끕니다.'],
        ['눈금자에서 끌기', ['안내선을 만듭니다.', '눈금자로 다시 끌어 놓으면 지워집니다.']],
        ['Ctrl+;', '안내선을 보이거나 숨깁니다.'],
        ['Ctrl+Shift+;', '안내선에 달라붙기를 켜거나 끕니다.'],
        ['Ctrl+Alt+;', '안내선을 잠급니다.']
      ]
    },
    {
      title: '파일',
      rows: [
        ['Ctrl+N', '새 그림을 만듭니다.'],
        ['Ctrl+O', '사진, PSD, 프로젝트를 엽니다.'],
        ['Ctrl+Shift+O', '다른 사진을 지금 그림에 레이어로 가져옵니다.'],
        ['Ctrl+S', '프로젝트(.shcomp)로 저장합니다.'],
        ['Ctrl+Shift+S', ['다른 이름으로 저장합니다.', 'PSD로도 저장할 수 있습니다.']],
        ['Ctrl+Shift+Alt+S', 'PNG로 내보냅니다.'],
        ['Ctrl+C / Ctrl+V', ['복사하고 붙여넣습니다.', '다른 프로그램과도 주고받을 수 있습니다.']],
        ['Ctrl+Shift+C', '보이는 그대로 합쳐서 복사합니다.'],
        ['Ctrl+W', '지금 탭을 닫습니다.'],
        ['Ctrl+K', '환경 설정을 엽니다.']
      ]
    }
  ],
  mcp: [
    {
      title: 'MCP 로 AI 에게 편집 시키기',
      notes: [
        'MCP(Model Context Protocol)는 AI 프로그램이 다른 프로그램의 기능을 도구로 부르는 공개 표준입니다.',
        'SH Compositor 서버를 켜 두면 Claude, ChatGPT, Cursor 처럼 MCP 를 지원하는 AI 가 아래 도구로 그림을 편집합니다.',
        '서버는 이 프로그램과 별개로 실행하는 명령줄 프로그램이며 브라우저나 이 창이 없어도 돌아갑니다.',
        '서버 문서는 이 창의 문서와 따로 있습니다. 파일(.shcomp, PSD, PNG)로 주고받습니다.'
      ]
    },
    {
      title: '연결하기',
      rows: [
        ['서버 만들기', ['프로젝트 폴더에서 npm run build:server 를 실행합니다.', 'out/server/index.mjs 가 서버입니다.']],
        ['로컬 (stdio)', ['AI 프로그램이 서버를 직접 띄웁니다. 토큰이 필요 없습니다.', 'Claude Code: claude mcp add sh-compositor -- node <경로>/out/server/index.mjs --stdio']],
        [
          '원격 (HTTP)',
          [
            'SHC_TOKENS="이름:비밀(32자 이상)" npm run server 로 켭니다.',
            '주소는 http://127.0.0.1:8787/mcp 이고 Authorization: Bearer 비밀 헤더를 붙입니다.',
            'ChatGPT 처럼 인터넷 주소만 받는 클라이언트는 HTTPS 로 공개된 주소가 필요합니다.'
          ]
        ],
        [
          '작업 순서',
          [
            '문서 만들기 또는 파일 올려 가져오기 → layer_list 로 레이어 ID 확인 → 편집 도구 → export 로 결과 받기.',
            '모든 변경 도구는 docId, expectedRevision, operationId 를 받습니다.',
            'expectedRevision 이 다르면 REVISION_CONFLICT 로 거절되니 document_get 으로 다시 읽습니다.'
          ]
        ]
      ]
    },
    { title: '서버에서 할 수 없는 것', notes: UNSUPPORTED_ON_SERVER },
    ...MCP_SECTIONS.map((s) => ({ ...s, title: `도구: ${s.title} (이름 앞에 compositor_ 가 붙습니다)` }))
  ]
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'start', label: '시작하기' },
  { key: 'tools', label: '도구' },
  { key: 'select', label: '선택' },
  { key: 'paint', label: '칠하기·고치기' },
  { key: 'adjust', label: '색 보정·필터' },
  { key: 'layers', label: '레이어' },
  { key: 'view', label: '화면·파일' },
  { key: 'mcp', label: 'MCP' }
]

const LAST_TAB = 'sc.helpTab'

const KEY = /^(Ctrl|Shift|Alt|Space|Delete|Backspace|Enter|Esc|F\d+|[A-Z0-9]|[[\];'=+-])$/

/** 키 하나 (키보드 모양 상자) */
function Kbd({ k }: { k: string }): JSX.Element {
  return (
    <Box
      component="kbd"
      sx={{ fontFamily: 'inherit', fontSize: font.xs, lineHeight: '16px', px: '5px', border: `1px solid ${chrome.frame}`, borderBottomWidth: '2px', borderRadius: '3px', background: surface.toolbar }}
    >
      {k}
    </Box>
  )
}

/** 조합 한 개 — "Ctrl+Shift+Z", "Shift+끌기", "J 스팟 복구" 처럼 키는 상자, 동작·이름은 굵은 글자 */
function Combo({ text }: { text: string }): JSX.Element {
  const parts = text.split(/\+(?=.)/)
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
      {parts.map((p, j) => {
        const [head, ...rest] = p.split(' ')
        const body = KEY.test(p) ? (
          <Kbd k={p} />
        ) : KEY.test(head) && rest.length ? (
          <>
            <Kbd k={head} />
            <Box component="span" sx={{ fontWeight: font.bold }}>
              {rest.join(' ')}
            </Box>
          </>
        ) : (
          <Box component="span" sx={{ fontWeight: font.bold }}>
            {p}
          </Box>
        )
        return (
          <Box component="span" key={j} sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {j > 0 && (
              <Box component="span" sx={{ color: color.textSecondary }}>
                +
              </Box>
            )}
            {body}
          </Box>
        )
      })}
    </Box>
  )
}

/** 키 칸 — "A / B" 는 "또는" 으로 잇는다 */
function Keys({ text }: { text: string }): JSX.Element {
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '4px', rowGap: '2px' }}>
      {text.split(' / ').map((c, i) => (
        <Box component="span" key={c} sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {i > 0 && (
            <Box component="span" sx={{ color: color.textSecondary }}>
              또는
            </Box>
          )}
          <Combo text={c} />
        </Box>
      ))}
    </Box>
  )
}

/** 도움말 ▸ 사용 설명서 (F1). 큰 기능별 탭, 한 줄에 한 문장 */
export default function HelpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const v = localStorage.getItem(LAST_TAB) as TabKey | null
      return v && v in PAGES ? v : 'start'
    } catch {
      return 'start'
    }
  })
  const pick = (t: TabKey): void => {
    setTab(t)
    try {
      localStorage.setItem(LAST_TAB, t)
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
  }
  return (
    <ClassicDialog
      open
      title="사용 설명서"
      onClose={onClose}
      width={760}
      actions={
        <Button variant="contained" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <ClassicTabs value={tab} onChange={pick} tabs={TABS} />
      <Box
        role="tabpanel"
        aria-label={TABS.find((t) => t.key === tab)?.label}
        className="selectable"
        sx={{ height: 460, overflowY: 'auto', border: `1px solid ${chrome.frame}`, borderTop: 'none', p: `${space.base}px ${space.lg}px`, background: color.canvas }}
      >
        {PAGES[tab].map((s) => (
          <Box key={s.title} sx={{ mb: `${space.lg}px` }}>
            <Box sx={{ fontWeight: font.bold, fontSize: font.lg, mb: `${space.xs}px`, pb: '2px', borderBottom: `1px solid ${color.border}` }}>{s.title}</Box>
            {s.rows && (
              <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: font.md, '& td': { py: '3px', verticalAlign: 'top', lineHeight: 1.6 } }}>
                <tbody>
                  {s.rows.map(([k, v]) => (
                    <tr key={k}>
                      <Box component="td" sx={{ width: 230, pr: `${space.base}px`, whiteSpace: 'nowrap' }}>
                        <Keys text={k} />
                      </Box>
                      <td>
                        {(Array.isArray(v) ? v : [v]).map((line, i) => (
                          <Box key={i} sx={{ fontWeight: s.rows === TOOL_ROWS && i === 0 ? font.bold : font.regular }}>
                            {line}
                          </Box>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            )}
            {s.notes && (
              <Box sx={{ mt: `${space.xs}px`, fontSize: font.md, color: s.rows ? color.textSecondary : color.text, lineHeight: 1.7 }}>
                {s.notes.map((n) => (
                  <Box key={n}>{n}</Box>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </ClassicDialog>
  )
}
