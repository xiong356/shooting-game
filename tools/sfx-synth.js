// ============================================
// 枪声物理模型合成器（tools/sfx-synth.js，零依赖）
// ============================================
// 背景：assets/sfx/ak47-shot.wav 是 7 层物理模型合成的产物（见 assets/sfx/CREDITS.md），
// 但 AK 版生成脚本当年放在系统临时目录，已被 Windows 清理（教训记入文件头）。
// 本脚本重建同一套 7 层模型（冲击前沿 → 超音速锐响 → 爆鸣 → 膛音 → 低频轰 →
// 户外反射尾 → 机械音），按霰弹/内格夫的声学特征调参，生成：
//   assets/sfx/shotgun-shot.wav   霰弹「裂空」——12 号口径：低频轰深长 + 宽体爆鸣 + 泵动收尾
//   assets/sfx/negev-shot.wav     内格夫——5.56 弹链：锐响亮 + 短促紧致 + 枪机循环
// ak47-shot.wav 保持不动（原脚本失传，文件即最终产物）。
// 用法：node tools/sfx-synth.js ——确定性输出（PRNG 固定种子），可重复运行覆盖自身。
'use strict';
const fs = require('fs');
const path = require('path');

const SR = 44100;

/** 确定性 PRNG（mulberry32）：输出可复现，调参不抖 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad（cookbook）。type: 'lp' | 'hp' | 'bp' */
function filter(x, type, freq, Q) {
  const w0 = 2 * Math.PI * freq / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0, b1, b2;
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const k = 1 / a0;
  const B0 = b0 * k, B1 = b1 * k, B2 = b2 * k, A1 = a1 * k, A2 = a2 * k;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    y[i] = B0 * xn + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = y[i];
  }
  return y;
}

/** 指数衰减包络（tau = 衰减常数，样本数） */
function envExp(n, tau) {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.exp(-i / tau);
  return e;
}

function noiseBurst(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
  return a;
}

/** 正弦指数扫频（f0 → f1，t∈[0,1] 对数插值） */
function sweep(n, f0, f1) {
  const a = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += 2 * Math.PI * (f0 * Math.pow(f1 / f0, t)) / SR;
    a[i] = Math.sin(phase);
  }
  return a;
}

function mixAdd(dst, src, offset, gain) {
  for (let i = 0; i < src.length; i++) {
    const j = offset + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
}

function applyEnv(x, tau) {
  const e = envExp(x.length, tau);
  for (let i = 0; i < x.length; i++) x[i] *= e[i];
  return x;
}

function ms(n) { return Math.round(SR * n / 1000); }

/**
 * 7 层枪声模型。params 全为设计参数（layer gains/ms/freq），调参只动这里：
 *   attack:  {ms, gain}                    L1 冲击前沿（全频）
 *   crack:   {hp, ms, gain}                L2 超音速锐响（高通）
 *   body:    {bp, q, ms, tau, gain}        L3 爆鸣主体（带通）
 *   chamber: {bp, q, ms, tau, gain}        L4 膛音（窄带通共鸣）
 *   boom:    {f0, f1, ms, tau, gain}       L5 低频轰（正弦扫频）
 *   tail:    {delaysMs, lp, gains, tau}    L6 户外反射尾（主体延迟副本组）
 *   mech:    [{atMs, bp, q, ms, tau, gain}...]  L7 机械音（枪机/泵动，可多条）
 *   seed, durationMs, peakDb                 随机种子 / 总长 / 归一化峰值
 */
function synthGun(p) {
  const rng = mulberry32(p.seed);
  const n = ms(p.durationMs);
  const out = new Float32Array(n);

  // L1 冲击前沿：全频短爆（起音 1~2ms 的"啪"，真实枪声的相位对齐基准）
  mixAdd(out, noiseBurst(ms(p.attack.ms), rng), 0, p.attack.gain);

  // L2 超音速锐响：高通短噪声（弹头破空"嚓"）
  {
    const x = applyEnv(noiseBurst(ms(p.crack.ms) * 3, rng), ms(p.crack.ms));
    mixAdd(out, filter(x, 'hp', p.crack.hp, 0.7), 0, p.crack.gain);
  }

  // L3 爆鸣主体：带通中频团（枪声的"身体"）
  {
    const x = applyEnv(noiseBurst(ms(p.body.ms) * 4, rng), ms(p.body.tau));
    mixAdd(out, filter(x, 'bp', p.body.bp, p.body.q), 0, p.body.gain);
  }

  // L4 膛音：窄带通共鸣（枪管内的"膛"感）
  {
    const x = applyEnv(noiseBurst(ms(p.chamber.ms) * 4, rng), ms(p.chamber.tau));
    mixAdd(out, filter(x, 'bp', p.chamber.bp, p.chamber.q), 0, p.chamber.gain);
  }

  // L5 低频轰：正弦扫频（火药体积感；霰弹深长、5.56 浅短）
  {
    const x = applyEnv(sweep(ms(p.boom.ms), p.boom.f0, p.boom.f1), ms(p.boom.tau));
    mixAdd(out, x, 0, p.boom.gain);
  }

  // L6 户外反射尾：主体的延迟低通副本组（开阔场地的空间感）
  {
    const body = filter(applyEnv(noiseBurst(ms(p.durationMs * 0.6), rng), ms(p.body.tau)), 'bp', p.body.bp, p.body.q);
    p.tail.delaysMs.forEach((d, i) => {
      const x = filter(body.slice(), 'lp', p.tail.lp, 0.7);
      applyEnv(x, ms(p.tail.tau));
      mixAdd(out, x, ms(d), p.tail.gains[i]);
    });
  }

  // L7 机械音：枪机/泵动的金属瞬态（真实枪声"不是一发纯爆音"的关键）
  for (const m of p.mech) {
    const x = applyEnv(noiseBurst(ms(m.ms) * 3, rng), ms(m.tau));
    mixAdd(out, filter(x, 'bp', m.bp, m.q), ms(m.atMs), m.gain);
  }

  // 归一化到目标峰值 + 收尾淡出（防爆音/爆点）
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const target = Math.pow(10, p.peakDb / 20);
  const k = target / (peak || 1);
  const fout = ms(15), fin = ms(1);
  for (let i = 0; i < n; i++) {
    let v = out[i] * k;
    if (i < fin) v *= i / fin;
    if (i > n - fout) v *= (n - i) / fout;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** 16bit 单声道 WAV 写出（44 字节头） */
function writeWav(file, f32) {
  const n = f32.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
  console.log('写出 ' + file + '  ' + (n / SR).toFixed(2) + 's');
}

// ---- 霰弹「裂空」：12 号口径——轰得深、收得慢、泵动收尾 ----
const SHOTGUN = synthGun({
  seed: 20260929,
  durationMs: 750,
  peakDb: -1.0,
  attack:  { ms: 2.0, gain: 0.9 },
  crack:   { hp: 2000, ms: 8,  gain: 0.30 },   // 霰弹弹丸群无单一超音速尖响，锐响压低
  body:    { bp: 700,  q: 0.7, ms: 80, tau: 22, gain: 0.55 },  // 宽体爆鸣（低中频团）
  chamber: { bp: 500,  q: 3,   ms: 120, tau: 35, gain: 0.35 }, // 膛音低沉
  boom:    { f0: 110,  f1: 36, ms: 260, tau: 70, gain: 0.85 }, // 火药体积感：深且长（AK 是 180→55）
  tail:    { delaysMs: [28, 52, 83, 120, 170], lp: 1200, gains: [0.30, 0.22, 0.16, 0.11, 0.07], tau: 40 },
  mech:    [   // 泵动双段 clack（0.8s 射速内的循环动作，真实泵动枪每发都有）
    { atMs: 300, bp: 1200, q: 1.5, ms: 10, tau: 5, gain: 0.13 },
    { atMs: 300, bp: 300,  q: 1.0, ms: 14, tau: 7, gain: 0.10 },
    { atMs: 392, bp: 1000, q: 1.5, ms: 10, tau: 5, gain: 0.11 },
  ],
});

// ---- 内格夫：5.56 弹链——亮、快、紧，枪机循环清晰 ----
const NEGEV = synthGun({
  seed: 20260930,
  durationMs: 300,
  peakDb: -1.2,   // 略低于 AK：12.5 发/s 连响不宜每发顶满
  attack:  { ms: 1.2, gain: 0.9 },
  crack:   { hp: 3000, ms: 5,  gain: 0.50 },   // 5.56 弹头更轻更快：破空声更亮
  body:    { bp: 1400, q: 0.8, ms: 30, tau: 9,  gain: 0.55 },  // 紧致爆鸣（AK 2~8kHz 的更窄快版）
  chamber: { bp: 1300, q: 3,   ms: 45, tau: 14, gain: 0.30 },
  boom:    { f0: 150,  f1: 70, ms: 90,  tau: 32, gain: 0.50 }, // 浅短低频（自动武器不轰胸）
  tail:    { delaysMs: [22, 40, 65], lp: 1600, gains: [0.22, 0.14, 0.08], tau: 26 },
  mech:    [   // 枪机循环（自动武器的"咔哒"挂在报告尾部）
    { atMs: 70,  bp: 2500, q: 1.5, ms: 7,  tau: 4, gain: 0.10 },
    { atMs: 88,  bp: 900,  q: 1.2, ms: 9,  tau: 5, gain: 0.08 },
  ],
});

const OUT = path.resolve(__dirname, '../assets/sfx');
writeWav(path.join(OUT, 'shotgun-shot.wav'), SHOTGUN);
writeWav(path.join(OUT, 'negev-shot.wav'), NEGEV);
console.log('完成——两把枪的采样槽位（SFX_FILES）本就登记了这些路径，游戏刷新即生效。');
