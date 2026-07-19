/**
 * Off-thread BM25 snapshot builder for MemoryIndex.
 * Loaded only via worker_threads so large vault walks never block the Core event loop.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createHash, randomBytes } from 'node:crypto';
import {
  createWriteStream,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { once } from 'node:events';

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  'out',
  'target',
]);

function shouldSkipDirectory(name) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith('node_modules_')) return true;
  return false;
}

function tokenize(text) {
  return text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 1);
}

function titleFromMarkdown(content, relativePath) {
  const heading = /^#\s+(.+)$/mu.exec(content);
  if (heading?.[1]?.trim()) return heading[1].trim().slice(0, 500);
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end >= 0) {
      for (const line of content.slice(4, end).split('\n')) {
        const match = /^title:\s*(.+)$/iu.exec(line);
        if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/gu, '').slice(0, 500);
      }
    }
  }
  return relativePath.replace(/\.md$/iu, '');
}

function markdownFiles(root, directory, maxFilesPerRoot, acc = []) {
  if (acc.length > maxFilesPerRoot) {
    throw new Error(`Memory root exceeds ${maxFilesPerRoot} Markdown files`);
  }
  const resolved = realpathSync(directory);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return acc;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (shouldSkipDirectory(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      markdownFiles(root, absolutePath, maxFilesPerRoot, acc);
      continue;
    }
    if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) {
      acc.push(absolutePath);
      if (acc.length > maxFilesPerRoot) {
        throw new Error(`Memory root exceeds ${maxFilesPerRoot} Markdown files`);
      }
    }
  }
  return acc.sort();
}

function scanRoot(root, maxFileBytes, maxFilesPerRoot) {
  const realRoot = realpathSync(root.path);
  const files = markdownFiles(realRoot, realRoot, maxFilesPerRoot);
  const documents = [];
  for (const absolutePath of files) {
    const stat = statSync(absolutePath);
    if (stat.size > maxFileBytes) continue;
    const content = readFileSync(absolutePath, 'utf8');
    const relativePath = relative(realRoot, absolutePath).split(sep).join('/');
    const title = titleFromMarkdown(content, relativePath);
    const tokens = tokenize(`${title}\n${content}`);
    const termFreqEntries = [];
    const termFreq = new Map();
    for (const token of tokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    for (const [term, count] of termFreq) termFreqEntries.push([term, count]);
    const sourceId = createHash('sha256')
      .update(`${root.id}:${relativePath}`)
      .digest('hex')
      .slice(0, 24);
    documents.push({
      sourceId,
      rootId: root.id,
      authority: root.authority,
      relativePath,
      title,
      content,
      tokens,
      termFreqEntries,
    });
  }
  return documents;
}

function buildSnapshot(request) {
  const { roots, maxFileBytes, maxFilesPerRoot, indexedAt } = request;
  const documents = [];
  const rootStats = [];
  for (const root of roots) {
    const rootDocs = scanRoot(root, maxFileBytes, maxFilesPerRoot);
    const rootRevision = createHash('sha256')
      .update(rootDocs.map((doc) => `${root.id}:${root.authority}:${doc.relativePath}:${createHash('sha256').update(doc.content).digest('hex')}`).join('\n'))
      .digest('hex')
      .slice(0, 24);
    rootStats.push({
      id: root.id,
      documentCount: rootDocs.length,
      revision: rootRevision,
      lastIndexedAt: indexedAt,
    });
    documents.push(...rootDocs);
  }
  const docFreqEntries = [];
  const docFreq = new Map();
  let totalLength = 0;
  for (const document of documents) {
    totalLength += document.tokens.length;
    const seen = new Set(document.tokens);
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  for (const [term, count] of docFreq) docFreqEntries.push([term, count]);
  const revision = createHash('sha256')
    .update(rootStats.map((stats) => stats.revision).join('|'))
    .digest('hex')
    .slice(0, 32);
  return {
    revision,
    indexedAt,
    documents,
    docFreqEntries,
    avgDocLength: documents.length ? totalLength / documents.length : 0,
    rootStats,
  };
}

async function writeSnapshotFile(snapshot) {
  // NDJSON avoids a single giant structured-clone / JSON.parse on the Core thread.
  const snapshotPath = join(tmpdir(), `jericho-mem-${process.pid}-${randomBytes(8).toString('hex')}.ndjson`);
  const stream = createWriteStream(snapshotPath, { encoding: 'utf8' });
  const write = async (line) => {
    if (!stream.write(`${line}\n`)) await once(stream, 'drain');
  };
  await write(JSON.stringify({
    type: 'meta',
    revision: snapshot.revision,
    indexedAt: snapshot.indexedAt,
    avgDocLength: snapshot.avgDocLength,
    rootStats: snapshot.rootStats,
    docFreqEntries: snapshot.docFreqEntries,
  }));
  for (const document of snapshot.documents) {
    await write(JSON.stringify({ type: 'doc', document }));
  }
  stream.end();
  await once(stream, 'finish');
  return snapshotPath;
}

try {
  const snapshot = buildSnapshot(workerData);
  const snapshotPath = await writeSnapshotFile(snapshot);
  parentPort.postMessage({ ok: true, snapshotPath });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
