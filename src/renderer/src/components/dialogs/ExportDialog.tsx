import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Slider from '@mui/material/Slider'
import CircularProgress from '@mui/material/CircularProgress'
import { PaletteControl } from '../bar'
import { ClassicDialog, Row, Note } from './parts'
import { humanSize, dims } from '../../util/format'
import { ui } from '../../theme'

const { color, space, font } = ui

export interface EncodedSample {
  bytes: Uint8Array
  mime: string
  width: number
  height: number
}

/**
 * 내보내기 미리보기 — Compositor `JPEGExportSheet` 이식.
 * 품질을 움직이면 **실제로 인코딩한 결과**와 최종 용량을 보여 준다(200ms 디바운스, 늦게 온 결과는 버림).
 * 투명을 못 담는 포맷이면 매트(투명 자리를 채울 색)도 고른다.
 */
export default function ExportDialog({
  open,
  formatLabel,
  opaque,
  quality,
  matte,
  encode,
  onClose,
  onApply,
  applyLabel = '이 설정 사용'
}: {
  open: boolean
  formatLabel: string
  /** JPEG·BMP 처럼 투명을 못 담는가 → 매트 색 선택 표시 */
  opaque: boolean
  quality: number
  matte: string
  /** 현재 옵션 전부 + 이 품질·매트로 선택 파일을 인코딩 */
  encode: (quality: number, matte: string) => Promise<EncodedSample>
  onClose: () => void
  onApply: (quality: number, matte: string) => void
  /** 확인 버튼 문구 */
  applyLabel?: string
}): JSX.Element {
  const [q, setQ] = useState(quality)
  const [m, setM] = useState(matte)
  const [result, setResult] = useState<{ url: string; size: number; w: number; h: number; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const gen = useRef(0)

  useEffect(() => {
    if (open) {
      setQ(quality)
      setM(matte)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = `${q}|${m}`
  useEffect(() => {
    if (!open) return
    const my = ++gen.current
    setError(null)
    const timer = setTimeout(async () => {
      try {
        const s = await encode(q, m)
        if (my !== gen.current) return
        const url = URL.createObjectURL(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }))
        setResult((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return { url, size: s.bytes.length, w: s.width, h: s.height, key }
        })
      } catch (e) {
        if (my === gen.current) setError(e instanceof Error ? e.message : String(e))
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // 닫히면(언마운트) 마지막 결과 URL 해제
  const lastUrl = useRef<string | null>(null)
  lastUrl.current = result?.url ?? null
  useEffect(() => () => void (lastUrl.current && URL.revokeObjectURL(lastUrl.current)), [])

  const ready = !!result && result.key === key && !error
  const apply = (): void => {
    if (ready) onApply(q, m)
  }

  return (
    <ClassicDialog
      open={open}
      title={`${formatLabel} 내보내기`}
      onClose={onClose}
      onEnter={apply}
      width={620}
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            취소
          </Button>
          <Button variant="contained" onClick={apply} disabled={!ready}>
            {applyLabel}
          </Button>
        </>
      }
    >
      <Box sx={{ height: 330, bgcolor: color.viewer, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color.borderStrong}` }}>
        {result && <Box component="img" src={result.url} alt="인코딩 결과" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {!ready && !error && (
          <Box
            sx={{
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              gap: `${space.sm}px`,
              bgcolor: color.warningSubtle,
              border: `1px solid ${color.borderStrong}`,
              px: `${space.base}px`,
              py: `${space.xs}px`
            }}
          >
            <CircularProgress />
            미리보기 갱신 중…
          </Box>
        )}
      </Box>
      <Row label="품질">
        <Slider value={q} min={10} max={100} step={1} onChange={(_, v) => setQ(v as number)} aria-label="품질" sx={{ flex: 1 }} />
        <Box className="tnum" sx={{ width: 40, textAlign: 'right' }}>
          {q}%
        </Box>
      </Row>
      {opaque && (
        <Row label="투명 자리">
          <PaletteControl title="투명한 부분을 채울 색 (매트)" value={m} onChange={setM} />
          <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>{formatLabel} 은(는) 투명을 담지 못해 이 색으로 채웁니다.</Box>
        </Row>
      )}
      <Note ok={!error}>{error ?? (ready ? `${humanSize(result.size)} · ${dims(result.w, result.h)}px · 실제 인코딩 결과` : '인코딩 중…')}</Note>
    </ClassicDialog>
  )
}
