// 실행 환경(Electron/웹)을 다른 모듈보다 먼저 정한다
import { connectPlatform } from './platform'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { theme } from './theme'
import { applyTokens } from './styles/tokens'
import './styles/base.css'
import App from './App'
import { editor } from './editor/store'
import * as io from './editor/io'
import { flattenDoc } from '@core/index'
import { autosaveNow } from './editor/autosave'
import { retouchReady } from './editor/retouchWasm'
import { docThumbnail } from './editor/commands'
import * as bridge from './editor/commandBridge'

// 토큰(SSOT)을 :root CSS 변수로 주입 — base.css 와 sx 의 var() 가 이 값을 읽는다. 렌더 전에 1회.
applyTokens()

connectPlatform({ hasUnsaved: () => editor.state.tabs.some((t) => editor.isDirty(t)), notify: (kind, text) => editor.toast(kind, text) })

// E2E 전용 조회 창구 — main 이 SC_E2E 로 띄울 때만 (?e2e=1)
if (new URLSearchParams(location.search).has('e2e')) Object.assign(window, { __sc: { editor, io, flattenDoc, autosaveNow, docThumbnail, retouchReady, bridge } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
)
