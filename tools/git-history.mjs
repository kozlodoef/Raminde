// Разбор .git без git: только встроенные модули Node (zlib + fs).
// Зачем: в системе нет git, а история репозитория лежит в loose-объектах.
// Использование: node tools/git-history.mjs [путь-к-.git]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GIT = resolve(process.argv[2] ?? resolve(here, '..', '.git')).replace(/\\/g, '/');
const cache = new Map();

function readObject(sha) {
  if (cache.has(sha)) return cache.get(sha);
  const obj = inflateSync(readFileSync(`${GIT}/objects/${sha.slice(0, 2)}/${sha.slice(2)}`));
  const nul = obj.indexOf(0x00);
  const header = obj.toString('utf8', 0, nul);
  const [type, size] = header.split(' ');
  const result = { type, size: Number(size), body: obj.subarray(nul + 1) };
  cache.set(sha, result);
  return result;
}

function parseCommit(sha) {
  const text = readObject(sha).body.toString('utf8');
  return {
    sha,
    tree: text.match(/^tree ([0-9a-f]{40})/m)?.[1],
    parent: text.match(/^parent ([0-9a-f]{40})/m)?.[1] ?? null,
    author: text.match(/^author (.*)$/m)?.[1] ?? '',
    date: text.match(/^committer .*? (\d+ [+-]\d+)$/m)?.[1] ?? '',
    msg: (text.split('\n\n')[1] ?? '').trim(),
  };
}

function parseTree(body) {
  const entries = [];
  let o = 0;
  while (o < body.length) {
    const sp = body.indexOf(0x20, o);
    if (sp < 0) break;
    const mode = body.toString('utf8', o, sp);
    const nul = body.indexOf(0x00, sp);
    const name = body.toString('utf8', sp + 1, nul);
    const sha = body.subarray(nul + 1, nul + 21).toString('hex');
    entries.push({ mode, name, sha });
    o = nul + 21;
  }
  return entries;
}

function listFiles(treeSha, prefix = '', out = []) {
  for (const e of parseTree(readObject(treeSha).body)) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.mode === '40000') listFiles(e.sha, path, out);
    else out.push({ path, sha: e.sha });
  }
  return out;
}

// Цепочка коммитов: каждый reflog-строк описывает переход old → new,
// поэтому берём только НОВЫЕ хеши (нулевой хеш — это "до первого коммита").
const reflog = readFileSync(`${GIT}/logs/HEAD`, 'utf8').trim().split('\n');
const ZERO = '0'.repeat(40);
const seq = [];
for (const line of reflog) {
  const [, newSha] = line.split(' ');
  if (newSha && newSha !== ZERO && !seq.includes(newSha)) seq.push(newSha);
}
const head = readFileSync(`${GIT}/refs/heads/master`, 'utf8').trim();

console.log('=== ИСТОРИЯ ===');
const commits = seq.map(parseCommit);
commits.forEach((c, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${c.sha.slice(0, 12)}  ${c.msg}  [${c.author}]`);
});
console.log('\nHEAD =', head.slice(0, 12), '| коммитов в истории:', commits.length);

console.log('\n=== ЧТО МЕНЯЛОСЬ ОТ СНАПШОТА К СНАПШОТУ ===');
for (let i = 1; i < commits.length; i++) {
  const prev = new Map(listFiles(commits[i - 1].tree).map((f) => [f.path, f.sha]));
  const cur = new Map(listFiles(commits[i].tree).map((f) => [f.path, f.sha]));
  const added = [...cur.keys()].filter((p) => !prev.has(p));
  const removed = [...prev.keys()].filter((p) => !cur.has(p));
  const changed = [...cur.keys()].filter((p) => prev.has(p) && prev.get(p) !== cur.get(p));
  console.log(`\n#${i} → #${i + 1}:  +${added.length} -${removed.length} ~${changed.length}   (всего файлов: ${cur.size})`);
  if (added.length) console.log('   добавлено:', added.slice(0, 12).join(', '));
  if (removed.length) console.log('   удалено  :', removed.slice(0, 12).join(', '));
  if (changed.length) console.log('   изменено :', changed.slice(0, 12).join(', '));
}

console.log('\n=== ФАЙЛЫ В ПЕРВОМ СНАПШОТЕ ===');
listFiles(commits[0].tree).forEach((f) => console.log('  ', f.path));
