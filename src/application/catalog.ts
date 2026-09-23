/**
 * MCP 도구 목록 (사람이 읽는 설명) — 서버(`server/mcp.ts`)가 도구 이름·제목·설명을 여기서 가져오고,
 * 편집기 사용 설명서(F1 ▸ MCP 탭)도 같은 목록을 보여 준다. 매개변수 스키마(zod)는 server/mcp.ts 에 있다 (렌더러에 zod 를 싣지 않게).
 * 단위 테스트가 이 목록과 실제 등록 도구·명령 등록부를 대조한다.
 */
export type ToolGroup = 'document' | 'image' | 'layer' | 'selection' | 'pixels' | 'adjust' | 'job'

export interface ToolDoc {
  name: string
  title: string
  group: ToolGroup
  /** 한 문장 한 줄 */
  lines: string[]
  /** 매개변수 요약 (사람용) */
  params: string
  /** application 명령 이름 (변경 도구만) */
  command?: string
  /** 문서를 바꾸는 도구인가 (docId·expectedRevision·operationId 필요) */
  mutates: boolean
}

export const TOOL_GROUPS: { key: ToolGroup; label: string }[] = [
  { key: 'document', label: '문서·파일' },
  { key: 'image', label: '이미지·캔버스' },
  { key: 'layer', label: '레이어·마스크' },
  { key: 'selection', label: '선택' },
  { key: 'pixels', label: '칠하기·고치기' },
  { key: 'adjust', label: '색 보정·필터' },
  { key: 'job', label: '작업' }
]

const M = '공통: docId, expectedRevision, operationId, waitMs?'

export const TOOL_CATALOG: ToolDoc[] = [
  // 문서
  { name: 'compositor_capabilities', title: '지원 기능', group: 'document', lines: ['지원 명령·형식·한도·보관 기간을 알려 줍니다.'], params: '(없음)', mutates: false },
  {
    name: 'compositor_document_create',
    title: '빈 문서 만들기',
    group: 'document',
    lines: ['배경 레이어 하나가 있는 새 문서를 만듭니다.'],
    params: 'width, height, background?(white·black·transparent·#rrggbb), resolution?, name?',
    mutates: false
  },
  {
    name: 'compositor_asset_upload_base64',
    title: '작은 파일 올리기',
    group: 'document',
    lines: ['HTTP 업로드를 쓸 수 없는 클라이언트용 base64 업로드입니다.', 'PNG·PSD·.shcomp 를 받고 assetId 를 돌려줍니다.'],
    params: 'dataBase64, name?',
    mutates: false
  },
  {
    name: 'compositor_document_import',
    title: '파일로 문서 만들기',
    group: 'document',
    lines: ['올린 PNG·PSD·.shcomp(assetId)로 문서를 만듭니다.', 'PSD 에서 옮기지 못한 항목은 warnings 로 알립니다.'],
    params: 'assetId, name?',
    mutates: false
  },
  { name: 'compositor_document_list', title: '내 문서 목록', group: 'document', lines: ['서버에 있는 내 문서와 revision·만료 시각을 봅니다.'], params: '(없음)', mutates: false },
  { name: 'compositor_document_get', title: '문서 정보', group: 'document', lines: ['revision·크기·레이어 수·선택 영역·실행 취소 가능 여부를 봅니다.'], params: 'docId', mutates: false },
  {
    name: 'compositor_document_rename',
    title: '문서 이름 바꾸기',
    group: 'document',
    lines: ['문서 이름(내보낼 파일 이름)을 바꿉니다.', 'revision 은 오르지 않습니다.'],
    params: 'docId, name',
    mutates: false
  },
  { name: 'compositor_document_delete', title: '문서 지우기', group: 'document', lines: ['문서와 진행 중인 작업을 지웁니다.', '되돌릴 수 없습니다.'], params: 'docId', mutates: false },
  { name: 'compositor_document_undo', title: '실행 취소', group: 'document', lines: ['마지막 변경을 되돌립니다.', '이것도 revision 을 올리는 변경입니다.'], params: M, mutates: true },
  { name: 'compositor_document_redo', title: '다시 실행', group: 'document', lines: ['되돌린 변경을 다시 적용합니다.'], params: M, mutates: true },
  {
    name: 'compositor_document_guides',
    title: '안내선',
    group: 'document',
    lines: ['세로·가로 안내선 위치를 통째로 정합니다.', '빈 배열이면 모두 지웁니다.'],
    params: `${M}, vertical[], horizontal[]`,
    command: 'document.guides',
    mutates: true
  },
  {
    name: 'compositor_export',
    title: '내보내기',
    group: 'document',
    lines: ['지정 revision(생략 = 현재)을 PNG(합성)·.shcomp·PSD 로 만듭니다.', '결과는 resource_link 와 downloadUrl 로 받습니다.'],
    params: 'docId, format(png·shcomp·psd), revision?, operationId?, waitMs?',
    mutates: false
  },
  { name: 'compositor_histogram', title: '히스토그램', group: 'document', lines: ['합성 결과 또는 레이어 하나의 밝기·RGB 분포를 봅니다.'], params: 'docId, layerId?', mutates: false },
  // 이미지
  {
    name: 'compositor_image_resize',
    title: '이미지 크기',
    group: 'image',
    lines: ['문서 전체를 새 크기로 바꿉니다 (레이어 변형을 비율대로, 양선형).', 'resolution 을 주면 DPI 도 바꿉니다.'],
    params: `${M}, width, height, resolution?`,
    command: 'image.resize',
    mutates: true
  },
  {
    name: 'compositor_image_crop',
    title: '자르기',
    group: 'image',
    lines: ['문서 안의 사각형으로 자릅니다.', 'deleteCropped 면 캔버스 밖 픽셀을 버립니다.'],
    params: `${M}, x, y, width, height, deleteCropped?`,
    command: 'image.crop',
    mutates: true
  },
  {
    name: 'compositor_image_canvas_size',
    title: '캔버스 크기',
    group: 'image',
    lines: ['종이만 늘이거나 줄입니다 (앵커 기준).', '늘어난 여백은 투명·색·내용 인식(content)으로 채웁니다.'],
    params: `${M}, width, height, anchor?(nw…se, 기본 c), background?(null·#rrggbb·content)`,
    command: 'image.canvasSize',
    mutates: true
  },
  { name: 'compositor_image_rotate', title: '캔버스 회전', group: 'image', lines: ['90·-90·180도로 돌립니다.'], params: `${M}, angle`, command: 'image.rotate', mutates: true },
  {
    name: 'compositor_image_flip',
    title: '캔버스 반전',
    group: 'image',
    lines: ['모든 레이어를 좌우 또는 상하로 뒤집습니다.'],
    params: `${M}, axis(horizontal·vertical)`,
    command: 'image.flip',
    mutates: true
  },
  { name: 'compositor_image_trim', title: '투명 여백 자르기', group: 'image', lines: ['보이는 픽셀의 경계로 캔버스를 줄입니다.'], params: M, command: 'image.trim', mutates: true },
  { name: 'compositor_image_flatten', title: '이미지 병합', group: 'image', lines: ['모든 레이어를 한 장으로 합칩니다.'], params: M, command: 'image.flatten', mutates: true },
  // 레이어
  {
    name: 'compositor_layer_list',
    title: '레이어 목록',
    group: 'layer',
    lines: ['레이어 ID·종류·표시·불투명도·혼합·위치·크기·잠금을 봅니다.', '배열은 아래 → 위 순서입니다.'],
    params: 'docId',
    mutates: false
  },
  {
    name: 'compositor_layer_add',
    title: '레이어 추가',
    group: 'layer',
    lines: ['빈 픽셀 레이어·폴더·조정 레이어를 추가하거나, 올린 PNG(assetId)를 새 레이어로 넣습니다.'],
    params: `${M}, kind(pixel·group·adjustment·image), name?, adjustmentKind?, assetId?, x?, y?, aboveId?`,
    command: 'layer.add',
    mutates: true
  },
  {
    name: 'compositor_layer_update',
    title: '레이어 속성',
    group: 'layer',
    lines: ['이름·표시·불투명도·혼합·클리핑·잠금·위치·크기·회전·반전·레이어 효과·조정 설정·도형 모양·마스크 켜기를 준 것만 바꿉니다.'],
    params: `${M}, layerId, name?, visible?, opacity?, blend?, clip?, x?, y?, width?, height?, rotation?, flipH?, flipV?, lock?, effects?, adjustment?, shape?, maskEnabled?, maskLinked?`,
    command: 'layer.update',
    mutates: true
  },
  {
    name: 'compositor_layer_delete',
    title: '레이어 삭제',
    group: 'layer',
    lines: ['레이어 여러 장을 지웁니다 (폴더는 안의 것까지).'],
    params: `${M}, layerIds[]`,
    command: 'layer.delete',
    mutates: true
  },
  { name: 'compositor_layer_duplicate', title: '레이어 복제', group: 'layer', lines: ['레이어를 복제해 바로 위에 둡니다.'], params: `${M}, layerIds[]`, command: 'layer.duplicate', mutates: true },
  {
    name: 'compositor_layer_reorder',
    title: '레이어 순서',
    group: 'layer',
    lines: ['한 칸 앞·뒤로 옮기거나(by), 다른 레이어 위·아래·폴더 안으로 옮깁니다(targetId + where).'],
    params: `${M}, layerId, by?(1·-1) 또는 targetId, where(above·below·inside)`,
    command: 'layer.reorder',
    mutates: true
  },
  { name: 'compositor_layer_group', title: '그룹 만들기', group: 'layer', lines: ['레이어들을 새 폴더에 넣습니다.'], params: `${M}, layerIds[], name?`, command: 'layer.group', mutates: true },
  { name: 'compositor_layer_ungroup', title: '그룹 해제', group: 'layer', lines: ['폴더를 풀어 안의 레이어를 밖으로 냅니다.'], params: `${M}, layerId`, command: 'layer.ungroup', mutates: true },
  {
    name: 'compositor_layer_merge',
    title: '레이어 병합',
    group: 'layer',
    lines: ['아래 레이어와(down), 고른 레이어끼리(layers), 보이는 레이어 전부(visible)를 합칩니다.'],
    params: `${M}, mode, layerId?, layerIds[]?, name?`,
    command: 'layer.merge',
    mutates: true
  },
  {
    name: 'compositor_layer_mask',
    title: '레이어 마스크',
    group: 'layer',
    lines: ['마스크 추가(전부 보임·전부 가림·선택 영역만)·선택 영역으로 다시 만들기·적용하거나 버리며 삭제·반전·페더.'],
    params: `${M}, layerId, op(add·fromSelection·delete·invert·feather), initial?, apply?, radius?`,
    command: 'layer.mask',
    mutates: true
  },
  {
    name: 'compositor_layer_set_active',
    title: '활성 레이어',
    group: 'layer',
    lines: ['활성 레이어를 정합니다 (새 레이어가 그 위에 들어갑니다).'],
    params: `${M}, layerId`,
    command: 'layer.setActive',
    mutates: true
  },
  {
    name: 'compositor_layer_flip',
    title: '레이어 반전',
    group: 'layer',
    lines: ['레이어 하나를 좌우·상하로 뒤집습니다 (비파괴).'],
    params: `${M}, layerId, axis`,
    command: 'layer.flip',
    mutates: true
  },
  {
    name: 'compositor_layer_via_copy',
    title: '복사·잘라서 새 레이어',
    group: 'layer',
    lines: ['선택 영역을 복사(또는 잘라)해 새 레이어로 만듭니다 (Ctrl+J / Ctrl+Shift+J).'],
    params: `${M}, layerId, cut?`,
    command: 'layer.viaCopy',
    mutates: true
  },
  // 선택
  {
    name: 'compositor_selection_set',
    title: '선택 만들기',
    group: 'selection',
    lines: ['전체·해제·반전·사각형·타원·다각형·마법봉·레이어 픽셀로 선택합니다.', 'mode 로 지금 선택에 더하거나 빼거나 겹칩니다.'],
    params: `${M}, shape, mode?(replace·add·subtract·intersect), x?, y?, width?, height?, points[]?, tolerance?, contiguous?, sampleAll?, layerId?`,
    command: 'selection.set',
    mutates: true
  },
  {
    name: 'compositor_selection_modify',
    title: '선택 다듬기',
    group: 'selection',
    lines: ['확장·축소·페더·매끄럽게·이동.'],
    params: `${M}, op, amount? 또는 dx, dy`,
    command: 'selection.modify',
    mutates: true
  },
  // 픽셀
  {
    name: 'compositor_pixels_fill',
    title: '채우기',
    group: 'pixels',
    lines: ['선택 영역(없으면 전체)을 한 색으로 채웁니다.', 'target 이 mask 면 마스크를 그 밝기로 채웁니다.'],
    params: `${M}, layerId, color, target?`,
    command: 'pixels.fill',
    mutates: true
  },
  { name: 'compositor_pixels_erase', title: '지우기', group: 'pixels', lines: ['선택 영역의 픽셀을 투명하게 지웁니다 (Delete).'], params: `${M}, layerId`, command: 'pixels.erase', mutates: true },
  {
    name: 'compositor_pixels_stroke_selection',
    title: '선 그리기',
    group: 'pixels',
    lines: ['선택 테두리를 따라 선을 그립니다 (편집 ▸ 선 그리기).'],
    params: `${M}, layerId, width, color, position?, opacity?`,
    command: 'pixels.strokeSelection',
    mutates: true
  },
  {
    name: 'compositor_pixels_content_fill',
    title: '내용 인식 채우기',
    group: 'pixels',
    lines: ['선택 영역을 주변 그림으로 자연스럽게 메웁니다 (Shift+F5).'],
    params: `${M}, layerId`,
    command: 'pixels.contentFill',
    mutates: true
  },
  {
    name: 'compositor_brush_stroke',
    title: '브러시·지우개 획',
    group: 'pixels',
    lines: ['점 배열 하나가 획 하나입니다 (필압 선택).', '마스크에도 칠할 수 있습니다.'],
    params: `${M}, layerId, points[{x,y,pressure?}], brush?{size,hardness,opacity}, mode?(paint·erase), color?, target?`,
    command: 'brush.stroke',
    mutates: true
  },
  {
    name: 'compositor_gradient_apply',
    title: '그라데이션',
    group: 'pixels',
    lines: ['두 점 사이 선형·원형 그라데이션을 얹습니다.', 'endColor 가 없으면 투명으로 갑니다.'],
    params: `${M}, layerId, from{x,y}, to{x,y}, shape?, color, endColor?, reverse?, target?`,
    command: 'gradient.apply',
    mutates: true
  },
  {
    name: 'compositor_retouch_stroke',
    title: '흐림·문지르기·리퀴파이',
    group: 'pixels',
    lines: ['점 배열을 따라 흐리게 하거나 밀어서 모양을 바꿉니다 (R 도구).'],
    params: `${M}, layerId, points[], mode(blur·smudge·liquify), brush?, strength?, target?`,
    command: 'retouch.stroke',
    mutates: true
  },
  {
    name: 'compositor_clone_stroke',
    title: '복제 도장',
    group: 'pixels',
    lines: ['source 점의 그림을 첫 점 기준 같은 거리로 옮겨 칠합니다 (S 도구).'],
    params: `${M}, layerId, points[], source{x,y}, brush?, sampleAll?`,
    command: 'clone.stroke',
    mutates: true
  },
  {
    name: 'compositor_heal_stroke',
    title: '스팟 복구',
    group: 'pixels',
    lines: ['칠한 자리를 주변 그림으로 메웁니다 (J 도구, 내용 인식 방식).'],
    params: `${M}, layerId, points[], brush?`,
    command: 'heal.stroke',
    mutates: true
  },
  {
    name: 'compositor_shape_add',
    title: '도형',
    group: 'pixels',
    lines: ['사각형·둥근 사각형·타원·선을 새 도형 레이어로 그립니다.', '나중에 layer.update 의 shape 로 다시 고칠 수 있습니다.'],
    params: `${M}, kind, x, y, width, height, fill?, stroke?, strokeWidth?, radius?, dir?, name?`,
    command: 'shape.add',
    mutates: true
  },
  // 보정·필터
  {
    name: 'compositor_adjust_apply',
    title: '보정',
    group: 'adjust',
    lines: ['레벨·커브·노출·색조/채도·그레인·반전·그라데이션 맵·채널별·색역별 보정을 레이어에 바로 겁니다.', '선택 영역이 있으면 그 안에만.'],
    params: `${M}, layerId, adjustment{exposure, offset, gamma, inBlack, inWhite, midtone, outBlack, outWhite, curve[], hue, saturation, lightness, grain, invert, gradientMap, channels, hueRanges, colorize}`,
    command: 'adjust.apply',
    mutates: true
  },
  {
    name: 'compositor_adjust_quick',
    title: '빠른 보정',
    group: 'adjust',
    lines: ['반전·채도 감소·자동 대비(contrast)·자동 색상(color)·자동 톤(neutral).'],
    params: `${M}, layerId, kind`,
    command: 'adjust.quick',
    mutates: true
  },
  {
    name: 'compositor_adjust_more',
    title: '흑백·색상 균형·활기·포스터화·한계값',
    group: 'adjust',
    lines: ['이미지 ▸ 조정의 나머지 다섯 가지.'],
    params: `${M}, layerId, kind, blackWhite?, colorBalance?, vibrance?, saturation?, levels?, threshold?`,
    command: 'adjust.more',
    mutates: true
  },
  {
    name: 'compositor_filter_apply',
    title: '필터',
    group: 'adjust',
    lines: ['가우시안·모션 블러, 노이즈, 렌즈 보정, 언샤프 마스크, 하이 패스, 모자이크, 노이즈 감소(중간값).'],
    params: `${M}, layerId, filter, params{…}, seed?`,
    command: 'filter.apply',
    mutates: true
  },
  // 작업
  {
    name: 'compositor_job_get',
    title: '작업 상태',
    group: 'job',
    lines: ['queued·running·succeeded·failed·cancelled 와 결과·오류.', 'waitMs 를 주면 끝날 때까지 그만큼 기다립니다.'],
    params: 'jobId, waitMs?',
    mutates: false
  },
  { name: 'compositor_job_cancel', title: '작업 취소', group: 'job', lines: ['커밋 전이면 취소합니다.'], params: 'jobId', mutates: false }
]

/** 서버에서 할 수 없는 편집기 기능 (사용 설명서·capabilities 에 같은 문구) */
export const UNSUPPORTED_ON_SERVER = [
  '문자 레이어 만들기·편집 (서버에 글꼴·캔버스 없음 — PSD 의 문자는 픽셀로 옵니다)',
  'AI 배경 제거·피사체 선택·개체 선택 (브라우저 전용 모델)',
  'JPEG·WebP·HEIC·TIFF 가져오기와 JPEG·WebP 내보내기 (브라우저 디코더)'
]
