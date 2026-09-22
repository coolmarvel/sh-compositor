// Scalar f64 preserves the TypeScript reference's arithmetic and Uint8Clamped rounding.
// Buffers are exclusively owned by the JS bridge; no pointers survive a call.
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
