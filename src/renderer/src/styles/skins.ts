/**
 * 크롬 스킨 — `~/sh-web-editor/src/styles/skins.css`(DEXT5 3.5 배포본 13개 스킨 실측값)에서 생성.
 * 구조·크기는 같고 크롬(타이틀바·메뉴·툴바·상태 줄) 색만 바뀐다. 보기 → 스킨 메뉴에서 고른다.
 * 재생성: sh-web-editor 의 skins.css 를 다시 읽어 이 표를 만든다(값을 손으로 고치지 않는다).
 */

export interface ChromeSkin {
  frame: string
  menubarTop: string
  menubarBottom: string
  toolbarLight: string
  toolbarFace: string
  toolbarRow2Bottom: string
  toolbarEdge: string
  pressed: string
  pressedLight: string
  separator: string
  statusTop: string
  statusLight: string
  statusFace: string
  tabActive: string
}

export type SkinName = 'blue' | 'brown' | 'darkgray' | 'gold' | 'gray' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'silver' | 'white' | 'yellow'

export const SKIN_LABELS: Record<SkinName, string> = {
  blue: '파랑',
  brown: '갈색',
  darkgray: '진회색',
  gold: '금색',
  gray: '회색',
  green: '초록',
  orange: '주황',
  pink: '분홍',
  purple: '보라',
  red: '빨강',
  silver: '은색',
  white: '흰색',
  yellow: '노랑'
}

export const SKINS: Record<SkinName, ChromeSkin> = {
  blue: { frame: '#a1abb9', menubarTop: '#edf2f6', menubarBottom: '#d9e1ec', toolbarLight: '#fafbff', toolbarFace: '#e6edf6', toolbarRow2Bottom: '#ecf1f7', toolbarEdge: '#afb6c6', pressed: '#d3dbe7', pressedLight: '#eff1f5', separator: '#c5ccd9', statusTop: '#d4d4d4', statusLight: '#f8f8f8', statusFace: '#ececec', tabActive: '#d7dde9' },
  brown: { frame: '#cb9958', menubarTop: '#f7e2c1', menubarBottom: '#e9bf7f', toolbarLight: '#fef8ea', toolbarFace: '#e2cba3', toolbarRow2Bottom: '#e4cea8', toolbarEdge: '#cb9958', pressed: '#d6b884', pressedLight: '#f8f4eb', separator: '#dcad70', statusTop: '#e1cc99', statusLight: '#fff8ec', statusFace: '#fff6e7', tabActive: '#e8d5b0' },
  darkgray: { frame: '#7d7d7d', menubarTop: '#bbbbbb', menubarBottom: '#969696', toolbarLight: '#e8e8e8', toolbarFace: '#bababa', toolbarRow2Bottom: '#b0aeae', toolbarEdge: '#7d7d7d', pressed: '#b8b8b8', pressedLight: '#f4f4f4', separator: '#969390', statusTop: '#c8c8c8', statusLight: '#f5f5f5', statusFace: '#ebebeb', tabActive: '#c1c1c1' },
  gold: { frame: '#c9be7d', menubarTop: '#f3eed1', menubarBottom: '#dad2a1', toolbarLight: '#fefce9', toolbarFace: '#e8e1b4', toolbarRow2Bottom: '#e8e1b4', toolbarEdge: '#c9be7d', pressed: '#d8cd8a', pressedLight: '#f9f7e0', separator: '#cfc58b', statusTop: '#ded395', statusLight: '#f3efd1', statusFace: '#f6f2da', tabActive: '#f6edba' },
  gray: { frame: '#b8babc', menubarTop: '#f4f4f4', menubarBottom: '#dfdfdf', toolbarLight: '#fafbff', toolbarFace: '#eaeaea', toolbarRow2Bottom: '#eaeaea', toolbarEdge: '#b8babc', pressed: '#d5d5d5', pressedLight: '#f2f2f2', separator: '#c6c6c6', statusTop: '#d4d4d4', statusLight: '#f8f8f8', statusFace: '#ececec', tabActive: '#e2e2e3' },
  green: { frame: '#98c331', menubarTop: '#eafbc5', menubarBottom: '#c5e282', toolbarLight: '#f7fee4', toolbarFace: '#d1ed8f', toolbarRow2Bottom: '#d1ed8f', toolbarEdge: '#98c331', pressed: '#c1e272', pressedLight: '#f4fae8', separator: '#b0db4a', statusTop: '#b5e249', statusLight: '#f2fade', statusFace: '#e8f6c6', tabActive: '#e1f3b5' },
  orange: { frame: '#ffa52f', menubarTop: '#ffe8bd', menubarBottom: '#ffbb50', toolbarLight: '#fff7e9', toolbarFace: '#ffce89', toolbarRow2Bottom: '#ffcc85', toolbarEdge: '#ffa52f', pressed: '#ffc679', pressedLight: '#fff6ea', separator: '#ffb34f', statusTop: '#ffbf6b', statusLight: '#fdf5e7', statusFace: '#fbe9cc', tabActive: '#ffd49d' },
  pink: { frame: '#d5a8d5', menubarTop: '#fcecfb', menubarBottom: '#f0c6f0', toolbarLight: '#fef8fe', toolbarFace: '#f8def8', toolbarRow2Bottom: '#f8def8', toolbarEdge: '#d5a8d5', pressed: '#e6bbe6', pressedLight: '#f4e4f3', separator: '#dfbcdf', statusTop: '#e7c4e7', statusLight: '#f9f1f8', statusFace: '#fcf6fa', tabActive: '#f2deee' },
  purple: { frame: '#ae9bd5', menubarTop: '#f3ecff', menubarBottom: '#d8c9f2', toolbarLight: '#fbfaff', toolbarFace: '#e4daf7', toolbarRow2Bottom: '#ddd0f1', toolbarEdge: '#b5a2da', pressed: '#ded3f1', pressedLight: '#faf8fd', separator: '#b5a3d9', statusTop: '#ccb8ec', statusLight: '#f2eef6', statusFace: '#f1e8f6', tabActive: '#e1d6f3' },
  red: { frame: '#eb644e', menubarTop: '#ffd6d3', menubarBottom: '#ff968c', toolbarLight: '#ffeaea', toolbarFace: '#ffc0b9', toolbarRow2Bottom: '#febbb4', toolbarEdge: '#f96c55', pressed: '#ffaea6', pressedLight: '#fff2f1', separator: '#ff8f87', statusTop: '#ffbab5', statusLight: '#fff2ec', statusFace: '#ffefe7', tabActive: '#ffd2cc' },
  silver: { frame: '#acaba7', menubarTop: '#ebebe8', menubarBottom: '#c8c7c1', toolbarLight: '#f5f5f5', toolbarFace: '#d6d5cf', toolbarRow2Bottom: '#d6d5cf', toolbarEdge: '#acaba7', pressed: '#bab8ad', pressedLight: '#ebeae6', separator: '#b7b6b1', statusTop: '#d4d4d4', statusLight: '#f8f8f8', statusFace: '#ececec', tabActive: '#dbdad4' },
  white: { frame: '#b1b2b4', menubarTop: '#ffffff', menubarBottom: '#f3f3f3', toolbarLight: '#ffffff', toolbarFace: '#ffffff', toolbarRow2Bottom: '#ffffff', toolbarEdge: '#b1b2b4', pressed: '#f6f6f6', pressedLight: '#fefefe', separator: '#b7b8ba', statusTop: '#d4d4d4', statusLight: '#f3f3f3', statusFace: '#f3f3f3', tabActive: '#ffffff' },
  yellow: { frame: '#cfc700', menubarTop: '#fdfed8', menubarBottom: '#e6de6e', toolbarLight: '#fefee9', toolbarFace: '#f3ee96', toolbarRow2Bottom: '#f7f07b', toolbarEdge: '#cfc700', pressed: '#f1ea8d', pressedLight: '#fdfced', separator: '#dad20b', statusTop: '#e6de1b', statusLight: '#fdfde7', statusFace: '#fbfbcc', tabActive: '#ebe486' }
}
