import { createTheme } from '@mui/material/styles'
import { ui, color, chrome, font, size, shadow, surface, space } from './styles/tokens'

/**
 * 클래식 MUI 스킨 (v1.4.0~).
 *
 * 2026-09-21 사용자 지시: sh-messenger·remote-assist 같은 **클래식** UI/UX.
 * 토큰 SSOT 는 `styles/tokens.ts` 이고 이 파일은 MUI 부품을 그 토큰으로 다시 칠하기만 한다.
 * 규칙: 반경 0 · 1px 테두리 · 12px 돋움 · 24px 컨트롤 · 베벨 버튼 면 ·
 * 그림자는 팝오버/대화상자만 · 포커스는 안쪽 1px 점선.
 *
 * (이전 TailAdmin 계열 둥근 테마는 v1.3.2 까지 — ADR-0007 에 교체 사유)
 */
export { ui }

const focusRing = { outline: `1px dotted ${color.text}`, outlineOffset: '-3px' } as const

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: color.accent, dark: color.accentPressed, light: color.accentSubtle },
    error: { main: color.danger },
    success: { main: color.success },
    warning: { main: color.warning },
    background: { default: color.sunken, paper: color.canvas },
    text: { primary: color.text, secondary: color.textSecondary, disabled: color.textDisabled },
    divider: color.border
  },
  shape: { borderRadius: 0 },
  typography: {
    fontFamily: font.sans,
    fontSize: font.md,
    // MUI 의 rem 환산(htmlFontSize 16 기준)을 쓰지 않고 px 로 고정 — 클래식은 픽셀 단위로 맞춘다
    htmlFontSize: 16,
    body1: { fontSize: font.md, lineHeight: font.lhNormal },
    body2: { fontSize: font.md, lineHeight: font.lhDense },
    caption: { fontSize: font.xs, lineHeight: font.lhDense },
    subtitle1: { fontSize: font.lg, fontWeight: font.bold, lineHeight: font.lhDense },
    subtitle2: { fontSize: font.md, fontWeight: font.semibold, lineHeight: font.lhDense },
    h6: { fontSize: font.xl, fontWeight: font.bold, lineHeight: font.lhTight },
    button: { textTransform: 'none', fontWeight: font.semibold, fontSize: font.md, lineHeight: font.lhTight }
  },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { fontFamily: font.sans } } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' },
      styleOverrides: {
        root: {
          borderRadius: 0,
          minWidth: 0,
          height: size.ctlMd,
          padding: `0 ${space.lg}px`,
          gap: space.sm,
          boxShadow: 'none',
          '&.Mui-focusVisible': focusRing,
          '& .MuiButton-startIcon': { marginRight: space.sm, marginLeft: 0 },
          '& .MuiButton-startIcon > *:first-of-type': { fontSize: size.icon },
          '&.Mui-disabled': { color: color.textDisabled, borderColor: color.border }
        },
        // 주 버튼: accent 채움 + 진한 테두리. 한 화면에 하나
        contained: {
          border: `1px solid ${color.accentPressed}`,
          '&:hover': { backgroundColor: color.accentHover, boxShadow: 'none' },
          '&:active': { backgroundColor: color.accentPressed },
          '&.Mui-disabled': { backgroundColor: color.controlBottom, color: color.textDisabled, borderColor: color.border }
        },
        // 기본 버튼: 흰→회색 베벨 면 + 1px 진한 테두리
        outlined: {
          background: surface.bevel,
          border: `1px solid ${color.buttonBorder}`,
          color: color.text,
          '&:hover': { background: surface.bevelHover, borderColor: color.hoverEdge },
          '&:active': { background: surface.bevelPressed },
          '&.Mui-disabled': { background: color.sunken }
        },
        outlinedInherit: {
          background: surface.bevel,
          border: `1px solid ${color.buttonBorder}`,
          color: color.text,
          '&:hover': { background: surface.bevelHover, borderColor: color.hoverEdge }
        },
        text: { '&:hover': { backgroundColor: color.hover } },
        textInherit: { color: color.text, '&:hover': { backgroundColor: color.hover } }
      }
    },
    MuiIconButton: {
      defaultProps: { size: 'small', disableRipple: true },
      styleOverrides: {
        root: {
          borderRadius: 0,
          width: size.ctlSm,
          height: size.ctlSm,
          padding: 0,
          color: color.textSecondary,
          border: '1px solid transparent',
          '& svg': { fontSize: size.icon },
          '&:hover': { backgroundColor: color.canvas, borderColor: color.hoverEdge, color: color.text },
          '&:active': { background: surface.pressed, borderColor: chrome.toolbarEdge },
          '&.Mui-focusVisible': focusRing,
          '&.Mui-disabled': { color: color.textDisabled }
        }
      }
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: font.md, backgroundColor: color.input },
        input: { padding: `0 ${space.sm}px`, height: size.ctlMd, boxSizing: 'border-box' }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          height: size.ctlMd,
          backgroundColor: color.input,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: color.borderStrong, borderWidth: 1 },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: color.borderStrong },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: color.accent, borderWidth: 1 }
        },
        input: { padding: `0 ${space.sm}px` }
      }
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        select: {
          fontSize: font.md,
          paddingTop: 0,
          paddingBottom: 0,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center'
        },
        icon: { fontSize: size.icon, right: 2, color: color.textSecondary }
      }
    },
    MuiMenu: {
      defaultProps: { elevation: 0, transitionDuration: 0 },
      styleOverrides: {
        paper: {
          borderRadius: 0,
          border: `1px solid ${color.borderStrong}`,
          boxShadow: shadow.raised,
          marginTop: 1
        },
        list: { padding: space.xs }
      }
    },
    MuiPopover: {
      defaultProps: { elevation: 0, transitionDuration: 0 },
      styleOverrides: {
        paper: { borderRadius: 0, border: `1px solid ${color.borderStrong}`, boxShadow: shadow.raised }
      }
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          minHeight: size.row,
          // MUI 는 600px 이상에서 minHeight:auto 로 줄인다 — 클래식 22px 행을 지킨다
          '@media (min-width: 600px)': { minHeight: size.row },
          fontSize: font.md,
          padding: `0 ${space.base}px`,
          color: color.text,
          '&:hover': { backgroundColor: chrome.toolbarFace },
          '&.Mui-selected': { backgroundColor: color.accent, color: color.textOnAccent },
          '&.Mui-selected:hover': { backgroundColor: color.accentHover },
          '&.Mui-focusVisible': focusRing
        }
      }
    },
    MuiDivider: { styleOverrides: { root: { borderColor: color.border } } },
    MuiDialog: {
      defaultProps: { transitionDuration: 0 },
      styleOverrides: {
        paper: { borderRadius: 0, border: `1px solid ${chrome.frame}`, boxShadow: shadow.dialog }
      }
    },
    // 덮개는 대화상자에만 — 메뉴·팝오버의 투명 백드롭까지 어두워지지 않게
    MuiBackdrop: { styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: color.scrim } } } },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: font.xl,
          fontWeight: font.bold,
          padding: `${space.base}px ${space.lg}px`,
          background: surface.chrome,
          borderBottom: `1px solid ${chrome.frame}`,
          cursor: 'move',
          userSelect: 'none'
        }
      }
    },
    MuiDialogContent: { styleOverrides: { root: { padding: space.lg } } },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: space.base, gap: space.base, borderTop: `1px solid ${color.border}`, background: surface.status }
      }
    },
    MuiTooltip: {
      defaultProps: { arrow: false, enterDelay: 400, disableInteractive: true },
      styleOverrides: {
        tooltip: {
          backgroundColor: color.warningSubtle,
          color: color.text,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: 0,
          boxShadow: shadow.raised,
          fontSize: font.xs,
          fontWeight: font.regular,
          padding: `${space.xs}px ${space.md}px`
        }
      }
    },
    MuiSlider: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { height: 4, padding: '10px 0', color: color.accent },
        rail: { backgroundColor: color.controlBottom, opacity: 1, borderRadius: 0, border: `1px solid ${color.borderStrong}` },
        track: { borderRadius: 0, border: 'none' },
        thumb: {
          width: 10,
          height: 16,
          borderRadius: 0,
          background: surface.bevel,
          border: `1px solid ${color.borderStrong}`,
          '&:hover, &.Mui-focusVisible, &.Mui-active': { boxShadow: 'none', borderColor: color.accent }
        }
      }
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none', borderRadius: 0 },
        outlined: { borderColor: color.borderStrong }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          border: `1px solid ${color.borderStrong}`,
          fontSize: font.md,
          padding: `${space.xs}px ${space.base}px`,
          alignItems: 'center'
        },
        icon: { padding: 0, marginRight: space.md, '& svg': { fontSize: size.icon } },
        message: { padding: 0 },
        action: { padding: 0, marginRight: 0 }
      }
    },
    MuiSnackbar: { defaultProps: { transitionDuration: 0 } },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 10, borderRadius: 0, border: `1px solid ${color.borderStrong}`, backgroundColor: color.canvas },
        bar: { borderRadius: 0, backgroundColor: color.accent }
      }
    },
    MuiCircularProgress: { defaultProps: { size: 14, thickness: 5 } }
  }
})
