/** 표시용 포맷터 — 사이드바·상태 줄·내보내기 대화상자 공용 */

/** 바이트 → "12.3 KB" */
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 폭×높이 → "1920×1080" */
export function dims(w: number, h: number): string {
  return `${Math.round(w).toLocaleString()}×${Math.round(h).toLocaleString()}`
}
