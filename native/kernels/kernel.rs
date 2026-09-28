// SH Compositor 픽셀 커널 (Rust → wasm32-unknown-unknown, 단일 파일 rustc 빌드).
// 규칙: TypeScript 기준 구현(core/*.ts)과 같은 수식·반올림. 버퍼는 JS 브리지가 소유하고 포인터는 호출 사이에 남지 않는다.
// 내용: 리터칭 dab(흐림·문지르기·리퀴파이) · 가우시안 블러(상자 3회, 프리멀티플라이드) · 중간값.
// 닷지/번/스펀지는 측정 결과 영역 복사가 계산보다 비싸 TS(core/tone.ts)에 둔다 (2026-09-23 kernel-bench).
use std::alloc::{alloc_zeroed, dealloc, Layout};
#[no_mangle]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
    unsafe { alloc_zeroed(Layout::from_size_align(len, 8).unwrap()) }
}
#[no_mangle]
pub unsafe extern "C" fn release(ptr: *mut u8, len: usize) {
    dealloc(ptr, Layout::from_size_align(len, 8).unwrap());
}
fn tip(d: f64, r: f64, hardness: f64) -> f64 {
    if r <= 0.5 { return if d <= 0.5 {1.0} else {0.0}; }
    let h = hardness.clamp(0.0, 0.999);
    let inner = h * r;
    if h >= 0.98 { return (r-d+0.5).clamp(0.0, 1.0); }
    if d <= inner { return 1.0; }
    if d >= r { return 0.0; }
    let t = (d-inner)/(r-inner);
    1.0-t*t*(3.0-2.0*t)
}
fn byte(v: f64) -> u8 { v.clamp(0.0,255.0).round_ties_even() as u8 }
#[no_mangle]
pub unsafe extern "C" fn dab(
    src: *const u8, out: *mut u8, weights: *const f64,
    pw: i32, ph: i32, px: i32, py: i32,
    x0: i32, y0: i32, rw: i32, rh: i32,
    mode: i32, cx: f64, cy: f64, dx: f64, dy: f64,
    radius: f64, hardness: f64, opacity: f64,
) {
    let sample = |x: i32, y: i32, c: usize| -> f64 {
        let xx = (x-px).clamp(0,pw-1) as usize;
        let yy = (y-py).clamp(0,ph-1) as usize;
        *src.add((yy*pw as usize+xx)*4+c) as f64
    };
    let k = ((radius/6.0+0.5).floor() as i32).max(1);
    for ry in 0..rh { for rx in 0..rw {
        let x=x0+rx; let y=y0+ry;
        let index=(ry*rw+rx) as usize;
        let ux=x as f64+0.5-cx; let uy=y as f64+0.5-cy;
        let a=tip((ux*ux+uy*uy).sqrt(),radius,if mode==2 {0.0} else {hardness})*opacity* *weights.add(index);
        let mut values=[0.0;4];
        for c in 0..4 { values[c]=sample(x,y,c); }
        if a>0.0 {
            if mode==0 {
                let mut sums=[0.0;4]; let mut n=0.0;
                let step=(k>>1).max(1) as usize;
                for j in (-k..=k).step_by(step) { for i in (-k..=k).step_by(step) {
                    let al=sample(x+i,y+j,3);
                    for c in 0..3 { sums[c]+=sample(x+i,y+j,c)*al; }
                    sums[3]+=al; n+=1.0;
                }}
                let t=a*0.35;
                if sums[3]>0.0 { for c in 0..3 { values[c]+=(sums[c]/sums[3]-values[c])*t; } }
                values[3]+=(sums[3]/n-values[3])*t;
            } else if mode==1 {
                let sx=(x as f64-dx+0.5).floor() as i32;
                let sy=(y as f64-dy+0.5).floor() as i32;
                for c in 0..4 { values[c]+=(sample(sx,sy,c)-values[c])*a; }
            } else {
                let sx=x as f64-dx*a; let sy=y as f64-dy*a;
                let ix=sx.floor() as i32; let iy=sy.floor() as i32;
                let fx=sx-ix as f64; let fy=sy-iy as f64;
                for c in 0..4 {
                    let mut v=0.0;
                    for j in 0..2 { for i in 0..2 {
                        v+=sample(ix+i,iy+j,c)*if i==1 {fx} else {1.0-fx}*if j==1 {fy} else {1.0-fy};
                    }}
                    values[c]=v;
                }
            }
        }
        for c in 0..4 { *out.add(index*4+c)=byte(values[c]); }
    }}
}

// ── 가우시안 블러: core/filters.ts gaussianBlur 와 같은 상자 3회 (σ→r), 프리멀티플라이드 f32, 바깥 = 투명 ──
fn box_pass(src: &[f32], dst: &mut [f32], width: usize, height: usize, r: usize, horizontal: bool) {
    let span = (r * 2 + 1) as f32;
    let lines = if horizontal { height } else { width };
    let count = if horizontal { width } else { height };
    let step = if horizontal { 4 } else { width * 4 };
    for line in 0..lines {
        let base = if horizontal { line * width * 4 } else { line * 4 };
        for c in 0..4 {
            let mut sum = 0.0f32;
            let k_end = r.min(count - 1);
            for k in 0..=k_end { sum += src[base + k * step + c]; }
            for i in 0..count {
                dst[base + i * step + c] = sum / span;
                let add = i + r + 1;
                if add < count { sum += src[base + add * step + c]; }
                if i >= r { sum -= src[base + (i - r) * step + c]; }
            }
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gaussian_blur(src: *const u8, out: *mut u8, width: i32, height: i32, sigma: f64) {
    let w = width as usize; let h = height as usize; let n = w * h * 4;
    let s = sigma;
    let r = (((12.0 * s * s / 3.0 + 1.0).sqrt() - 1.0) / 2.0).round().max(1.0) as usize;
    let mut a: Vec<f32> = Vec::with_capacity(n);
    for i in (0..n).step_by(4) {
        let al = *src.add(i + 3) as f32 / 255.0;
        a.push(*src.add(i) as f32 * al);
        a.push(*src.add(i + 1) as f32 * al);
        a.push(*src.add(i + 2) as f32 * al);
        a.push(*src.add(i + 3) as f32);
    }
    let mut b: Vec<f32> = vec![0.0; n];
    for _ in 0..3 {
        box_pass(&a, &mut b, w, h, r, true);
        std::mem::swap(&mut a, &mut b);
        box_pass(&a, &mut b, w, h, r, false);
        std::mem::swap(&mut a, &mut b);
    }
    for i in (0..n).step_by(4) {
        let al = a[i + 3];
        *out.add(i + 3) = byte(al as f64);
        if al > 0.0 {
            let k = 255.0 / al;
            *out.add(i) = byte((a[i] * k) as f64);
            *out.add(i + 1) = byte((a[i + 1] * k) as f64);
            *out.add(i + 2) = byte((a[i + 2] * k) as f64);
        } else { *out.add(i) = 0; *out.add(i + 1) = 0; *out.add(i + 2) = 0; }
    }
}

// ── 중간값: core/filters.ts medianFilter 와 같은 히스토그램 슬라이딩 (RGB, 알파 그대로) ──
#[no_mangle]
pub unsafe extern "C" fn median(src: *const u8, out: *mut u8, width: i32, height: i32, radius: i32) {
    let w = width as usize; let h = height as usize; let r = radius as isize;
    let n = w * h * 4;
    for i in 0..n { *out.add(i) = *src.add(i); }
    if r <= 0 { return; }
    let half = ((2 * r + 1) * (2 * r + 1)) as usize >> 1;
    let mut hist = [0i32; 256];
    for c in 0..3usize {
        for y in 0..h {
            hist.iter_mut().for_each(|v| *v = 0);
            let mut count: i32 = 0;
            let y0 = (y as isize - r).max(0) as usize;
            let y1 = (y as isize + r).min(h as isize - 1) as usize;
            let mut add_col = |x: isize, d: i32, hist: &mut [i32; 256], count: &mut i32| {
                if x < 0 || x >= w as isize { return; }
                for yy in y0..=y1 {
                    hist[*src.add((yy * w + x as usize) * 4 + c) as usize] += d;
                    *count += d;
                }
            };
            for x in -r..=r { add_col(x, 1, &mut hist, &mut count); }
            for x in 0..w as isize {
                let target = half.min((count >> 1) as usize) as i32;
                let mut acc = 0i32; let mut v = 0usize;
                while v < 256 { acc += hist[v]; if acc > target { break; } v += 1; }
                *out.add((y * w + x as usize) * 4 + c) = v.min(255) as u8;
                add_col(x - r, -1, &mut hist, &mut count);
                add_col(x + r + 1, 1, &mut hist, &mut count);
            }
        }
    }
}
