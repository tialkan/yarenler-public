#!/usr/bin/env node
// WCAG 2.1 kontrast denetimi. Bağımlılık yok.
// Metin çiftleri en az 4.5:1, bilgi taşıyan grafik öğeler en az 3:1 olmalı.
// Herhangi bir çift kalırsa çıkış kodu 1.
// Kullanım: node scripts/contrast.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

// [ön plan, arka plan, tür, açıklama]
const PAIRS = [
  ['text', 'bg', 'metin', 'Ana metin, zemin'],
  ['text', 'surface', 'metin', 'Ana metin, yüzey'],
  ['text', 'surface-2', 'metin', 'Ana metin, yüzey 2'],
  ['text-muted', 'bg', 'metin', 'İkincil metin, zemin'],
  ['text-muted', 'surface', 'metin', 'İkincil metin, yüzey'],
  ['text-muted', 'surface-2', 'metin', 'İkincil metin, yüzey 2'],
  ['accent', 'bg', 'metin', 'Bağlantı, zemin'],
  ['accent', 'surface', 'metin', 'Bağlantı, yüzey'],
  ['on-accent', 'accent', 'metin', 'Birincil düğme metni'],
  ['on-accent', 'accent-hover', 'metin', 'Birincil düğme metni, üzerine gelme'],
  ['heat.on-ilik', 'heat.ilik', 'metin', 'Ilık bant etiketi'],
  ['heat.on-sicak', 'heat.sicak', 'metin', 'Sıcak bant etiketi'],
  ['heat.on-kor', 'heat.kor', 'metin', 'Kor bant etiketi'],
  ['line', 'bg', 'grafik', 'Halka izi ve düğüm çerçevesi, zemin'],
  ['line', 'surface', 'grafik', 'İkincil düğme kenarı, yüzey'],
  ['accent', 'bg', 'grafik', 'Etkin sekme çizgisi'],
  ['heat.kor', 'surface', 'grafik', 'Kor düğümü, yüzey'],
  ['focus', 'bg', 'grafik', 'Odak halkası, zemin'],
  ['focus', 'surface', 'grafik', 'Odak halkası, yüzey'],
];
const MIN = { metin: 4.5, grafik: 3 };

function get(theme, path) {
  let n = tokens.color[theme];
  for (const p of path.split('.')) n = n?.[p];
  if (!n || typeof n.$value !== 'string') throw new Error(`Belirteç yok: color.${theme}.${path}`);
  return n.$value;
}
function luminance(hex) {
  const h = hex.replace('#', '').slice(0, 6);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let fail = 0;
let total = 0;
for (const theme of ['light', 'dark']) {
  console.log(`\n${theme === 'light' ? 'Açık tema' : 'Karanlık tema'}`);
  for (const [fg, bg, kind, label] of PAIRS) {
    const r = ratio(get(theme, fg), get(theme, bg));
    const ok = r >= MIN[kind];
    total++;
    if (!ok) fail++;
    console.log(`  ${ok ? 'GEÇTİ' : 'KALDI'}  ${r.toFixed(2).padStart(5)}:1  (en az ${MIN[kind]})  ${label}  [${fg} / ${bg}]`);
  }
  // Sıcaklık ölçeği sıralı mı: bant ısındıkça zeminden uzaklaşmalı.
  const bgL = luminance(get(theme, 'bg'));
  const d = ['ilik', 'sicak', 'kor'].map((k) => Math.abs(luminance(get(theme, `heat.${k}`)) - bgL));
  total++;
  const ordered = d[0] < d[1] && d[1] < d[2];
  if (!ordered) fail++;
  console.log(`  ${ordered ? 'GEÇTİ' : 'KALDI'}  sıcaklık ölçeği sıralı: Ilık < Sıcak < Kor (zeminden uzaklık)`);
}
console.log(`\n${total - fail}/${total} denetim geçti.`);
if (fail > 0) {
  console.error(`${fail} denetim kaldı.`);
  process.exit(1);
}
