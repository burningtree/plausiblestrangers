// Fine-grained loudness for the bar waveform on track and song pages:
// 4 values per second for every audio file in public/audio, keyed by the
// file's public path (e.g. "/audio/i-am-your-bug/r-u-r.m4a").
// Written to src/data/peaks-hd.json, which is only read at build time.
//
//   npm run peaks          only files not done yet
//   npm run peaks -- --force   everything again
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'public/audio');
const OUT = path.join(ROOT, 'src/data/peaks-hd.json');
const PER_SECOND = 4;
const RATE = 4000;
const FORCE = process.argv.includes('--force');

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited ${code}`))));
  });

async function peaks(file) {
  const pcm = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const size = RATE / PER_SECOND;
  const count = Math.max(1, Math.floor(samples.length / size));
  const rms = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / size));
  }
  const max = Math.max(...rms) || 1;
  return rms.map((v) => Math.round((v / max) * 100) / 100);
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(m4a|mp3|wav|flac|ogg)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const all = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
const files = await walk(AUDIO);
let done = 0;
for (const f of files) {
  const key = '/' + path.relative(path.join(ROOT, 'public'), f).split(path.sep).join('/');
  if (all[key] && !FORCE) continue;
  all[key] = await peaks(f);
  done++;
  process.stdout.write(`\r${done} analysed`);
}
await writeFile(OUT, JSON.stringify(all));
console.log(`\n${Object.keys(all).length} files in ${path.relative(ROOT, OUT)}`);
