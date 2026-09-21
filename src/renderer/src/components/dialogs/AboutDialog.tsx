import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { ClassicDialog, GroupBox } from './parts'
import { ui } from '../../theme'
import appIconUrl from '../../assets/app-icon.png'
import signUrl from '../../assets/sign.png'

const { color, space, font } = ui

declare const __APP_VERSION__: string

/** 도움말 → 정보. 제작 크레딧 + 오픈소스 고지 (Compositor MIT 조건: 저작권 표시 유지) */
export default function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
  return (
    <ClassicDialog
      open
      title="SH Compositor 정보"
      onClose={onClose}
      onEnter={onClose}
      width={480}
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
        <Box className="selectable" sx={{ fontSize: font.xs, color: color.textSecondary, lineHeight: 1.6 }}>
          화면 구성·도구·레이어 모델·프로젝트 형식(.comp v7 호환)·보정·필터·효과·내용 인식 채우기·마법봉의 설계와 수식은
          <b> Compositor</b> (Copyright © 2026 Wonder Assembly LLC, MIT License) 를 TypeScript·WebGL2 로 옮긴 것입니다.
          <br />
          Permission is hereby granted, free of charge, to any person obtaining a copy of this software… (전문은 설치 폴더의 LICENSE 참조)
          <br />
          AI 배경 제거: @imgly/background-removal (AGPL-3.0) · 압축: fflate (MIT) · UI: React, MUI (MIT)
        </Box>
      </GroupBox>
    </ClassicDialog>
  )
}
