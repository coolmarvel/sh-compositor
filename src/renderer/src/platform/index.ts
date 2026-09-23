/**
 * 실행 환경 고르기 — Electron 은 preload 가 `window.api` 를 넣는다. 없으면(웹 빌드·브라우저) 웹 어댑터를 넣는다.
 * main.tsx 가 **가장 먼저** import 한다 (다른 모듈이 window.api 를 읽기 전에).
 */
import { createWebApi, installUnloadGuard, setWebHooks, type WebHooks } from './web'

export const isWeb = !(window as { api?: unknown }).api
if (isWeb) {
  window.api = createWebApi()
  installUnloadGuard()
}

/** 웹일 때만 의미가 있다 (편집기 상태를 platform 이 직접 import 하지 않게) */
export function connectPlatform(h: WebHooks): void {
  if (isWeb) setWebHooks(h)
}
