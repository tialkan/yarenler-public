#!/usr/bin/env node
// Yarenler tasarım belirteçleri derleyicisi. Bağımlılık yok.
// Girdi: tokens.json. Çıktı: dist/tokens.css ve dist/Tokens.swift.
// Kullanım: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
const version = tokens.$extensions?.['org.yarenler']?.version ?? '0.0.0';
const PREFIX = 'yr';

// Belirteç ağacını düz listeye çevirir: [{ path: ['font','size','md'], type, value, description }]
function flatten(node, path = [], inheritedType) {
  const out = [];
  const type = node.$type ?? inheritedType;
  if (Object.prototype.hasOwnProperty.call(node, '$value')) {
    out.push({ path, type, value: node.$value, description: node.$description });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$') || typeof v !== 'object' || v === null) continue;
    out.push(...flatten(v, [...path, k], type));
  }
  return out;
}

const all = flatten(tokens);
const isTheme = (t, name) => t.path[0] === 'color' && t.path[1] === name;
const light = all.filter((t) => isTheme(t, 'light'));
const dark = all.filter((t) => isTheme(t, 'dark'));
const rest = all.filter((t) => t.path[0] !== 'color');

if (light.length !== dark.length) {
  console.error(`Hata: açık temada ${light.length}, karanlık temada ${dark.length} renk var. Eşit olmalı.`);
  process.exit(1);
}
const lightKeys = new Set(light.map((t) => t.path.slice(2).join('.')));
for (const t of dark) {
  if (!lightKeys.has(t.path.slice(2).join('.'))) {
    console.error(`Hata: karanlık temadaki ${t.path.join('.')} açık temada yok.`);
    process.exit(1);
  }
}

// ---------- değer biçimleri ----------
const dimCss = (v) => (typeof v === 'object' ? `${v.value}${v.unit}` : String(v));
const durMs = (v) => (typeof v === 'object' ? (v.unit === 's' ? v.value * 1000 : v.value) : parseFloat(v));
function cssValue(t) {
  switch (t.type) {
    case 'color': return t.value;
    case 'dimension': return dimCss(t.value);
    case 'duration': return `${durMs(t.value)}ms`;
    case 'cubicBezier': return `cubic-bezier(${t.value.join(', ')})`;
    case 'fontFamily':
      return (Array.isArray(t.value) ? t.value : [t.value])
        .map((f) => (/[\s\d]/.test(f) && !f.includes('-') ? `'${f}'` : f)).join(', ');
    case 'shadow': {
      const s = t.value;
      return `${dimCss(s.offsetX)} ${dimCss(s.offsetY)} ${dimCss(s.blur)} ${dimCss(s.spread)} ${s.color}`;
    }
    default: return String(t.value);
  }
}

// ---------- CSS ----------
const cssName = (path) => `--${PREFIX}-${path.join('-')}`;
const colorName = (t) => cssName(['color', ...t.path.slice(2)]);
const line = (name, value, desc) => `  ${name}: ${value};${desc ? ` /* ${desc.replace(/\*\//g, '')} */` : ''}`;

const css = [];
css.push(`/* Yarenler tasarım belirteçleri v${version}. Bu dosya üretilir, elle düzenlemeyin. Kaynak: tokens.json */`);
css.push(':root {');
css.push('  color-scheme: light dark;');
for (const t of light) css.push(line(colorName(t), cssValue(t), t.description));
for (const t of rest) css.push(line(cssName(t.path), cssValue(t), t.description));
css.push('}');
const darkBlock = dark.map((t) => line(colorName(t), cssValue(t)));
css.push('');
css.push('@media (prefers-color-scheme: dark) {');
css.push('  :root:not([data-theme="light"]) {');
css.push(...darkBlock.map((l) => '  ' + l));
css.push('  }');
css.push('}');
css.push('');
css.push('[data-theme="dark"] {');
css.push('  color-scheme: dark;');
css.push(...darkBlock);
css.push('}');
css.push('');
css.push('[data-theme="light"] {');
css.push('  color-scheme: light;');
css.push(...light.map((t) => line(colorName(t), cssValue(t))));
css.push('}');
css.push('');
const durations = rest.filter((t) => t.type === 'duration');
css.push('@media (prefers-reduced-motion: reduce) {');
css.push('  :root {');
css.push(...durations.map((t) => `    ${cssName(t.path)}: 0ms;`));
css.push('  }');
css.push('}');
css.push('');

// ---------- Swift ----------
const camel = (s) => s.replace(/[-_ ](\w)/g, (_, c) => c.toUpperCase());
function ident(key, group) {
  let id = camel(key);
  if (/^\d/.test(id)) id = group[0].toLowerCase() + id; // 4 -> s4, 2xl -> s2xl
  return id;
}
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = (i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4);
  const a = h.length === 8 ? (parseInt(h.slice(6, 8), 16) / 255).toFixed(4) : '1';
  return { r: n(0), g: n(2), b: n(4), a };
}
const swiftColorName = (t) => ident(t.path.slice(2).join('-'), 'c');
const doc = (d, ind) => (d ? `${ind}/// ${d}\n` : '');

const sw = [];
sw.push(`// Yarenler tasarım belirteçleri v${version}. Bu dosya üretilir, elle düzenlemeyin. Kaynak: tokens.json`);
sw.push('import SwiftUI');
sw.push('#if canImport(UIKit)');
sw.push('import UIKit');
sw.push('#endif');
sw.push('');
sw.push('public enum YRTokens {');
for (const [label, list] of [['ColorLight', light], ['ColorDark', dark]]) {
  sw.push(`  public enum ${label} {`);
  for (const t of list) {
    const c = rgb(t.value);
    sw.push(`${doc(t.description, '    ')}    public static let ${swiftColorName(t)} = Color(.sRGB, red: ${c.r}, green: ${c.g}, blue: ${c.b}, opacity: ${c.a})`);
  }
  sw.push('  }');
  sw.push('');
}
sw.push('  /// Açık ve karanlık temaya kendiliğinden uyan renkler.');
sw.push('  public enum Colors {');
for (const t of light) {
  const n = swiftColorName(t);
  sw.push(`${doc(t.description, '    ')}    public static let ${n} = YRTokens.dynamic(light: "${t.value}", dark: "${dark.find((d) => d.path.slice(2).join('.') === t.path.slice(2).join('.')).value}")`);
}
sw.push('  }');
sw.push('');
const groups = {};
for (const t of rest) {
  if (['dimension', 'duration', 'number', 'fontWeight'].includes(t.type)) {
    const g = t.path.slice(0, -1).map((p) => camel(p[0].toUpperCase() + p.slice(1))).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
    (groups[g] ??= []).push(t);
  }
}
for (const [g, list] of Object.entries(groups)) {
  sw.push(`  public enum ${g} {`);
  for (const t of list) {
    const key = t.path[t.path.length - 1];
    const id = ident(key, g);
    let decl;
    if (t.type === 'duration') decl = `public static let ${id}: TimeInterval = ${durMs(t.value) / 1000}`;
    else if (t.type === 'dimension') {
      const v = typeof t.value === 'object' ? t.value : { value: parseFloat(t.value), unit: 'px' };
      decl = v.unit === 'em'
        ? `public static let ${id}: CGFloat = ${v.value} // em, yazı boyuyla çarpılır`
        : `public static let ${id}: CGFloat = ${v.value}`;
    } else if (t.type === 'fontWeight') decl = `public static let ${id}: CGFloat = ${t.value}`;
    else decl = Number.isInteger(t.value) ? `public static let ${id}: Int = ${t.value}` : `public static let ${id}: CGFloat = ${t.value}`;
    sw.push(`${doc(t.description, '    ')}    ${decl}`);
  }
  sw.push('  }');
  sw.push('');
}
const fams = rest.filter((t) => t.type === 'fontFamily');
sw.push('  public enum FontFamily {');
for (const t of fams) sw.push(`${doc(t.description, '    ')}    public static let ${ident(t.path.at(-1), 'f')}: [String] = [${t.value.map((f) => JSON.stringify(f)).join(', ')}]`);
sw.push('  }');
sw.push('');
sw.push('  static func dynamic(light: String, dark: String) -> Color {');
sw.push('    #if canImport(UIKit)');
sw.push('    return Color(uiColor: UIColor { traits in');
sw.push('      traits.userInterfaceStyle == .dark ? uiColor(dark) : uiColor(light)');
sw.push('    })');
sw.push('    #else');
sw.push('    return color(light)');
sw.push('    #endif');
sw.push('  }');
sw.push('');
sw.push('  static func components(_ hex: String) -> (Double, Double, Double, Double) {');
sw.push('    var s = hex; if s.hasPrefix("#") { s.removeFirst() }');
sw.push('    let v = UInt64(s, radix: 16) ?? 0');
sw.push('    if s.count == 8 {');
sw.push('      return (Double((v >> 24) & 0xFF) / 255, Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)');
sw.push('    }');
sw.push('    return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255, 1)');
sw.push('  }');
sw.push('');
sw.push('  static func color(_ hex: String) -> Color {');
sw.push('    let c = components(hex)');
sw.push('    return Color(.sRGB, red: c.0, green: c.1, blue: c.2, opacity: c.3)');
sw.push('  }');
sw.push('');
sw.push('  #if canImport(UIKit)');
sw.push('  static func uiColor(_ hex: String) -> UIColor {');
sw.push('    let c = components(hex)');
sw.push('    return UIColor(red: c.0, green: c.1, blue: c.2, alpha: c.3)');
sw.push('  }');
sw.push('  #endif');
sw.push('}');
sw.push('');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'tokens.css'), css.join('\n'));
writeFileSync(join(root, 'dist', 'Tokens.swift'), sw.join('\n'));
console.log(`tokens v${version}: ${light.length} renk x 2 tema, ${rest.length} diğer belirteç`);
console.log('yazıldı: dist/tokens.css, dist/Tokens.swift');
