import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { createExtractorFromFile } from 'node-unrar-js';

/** Extract a .zip / .7z / .rar into dest. */
export async function extract(archive: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });
  const ext = path.extname(archive).toLowerCase();
  if (ext === '.zip') return extractZip(archive, dest);
  if (ext === '.7z') return extract7z(archive, dest);
  if (ext === '.rar') return extractRar(archive, dest);
  throw new Error(`Unsupported archive type: ${ext || path.basename(archive)}`);
}

function extractZip(archive: string, dest: string): void {
  const root = path.resolve(dest);
  const zip = new AdmZip(archive);
  for (const entry of zip.getEntries()) {
    const target = path.resolve(root, entry.entryName);
    // zip-slip guard: never write outside dest
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  }
}

function extract7z(archive: string, dest: string): Promise<void> {
  // when packaged, the binary lives outside the asar
  const bin = path7za.replace('app.asar', 'app.asar.unpacked');
  return new Promise((resolve, reject) => {
    const s = Seven.extractFull(archive, dest, { $bin: bin });
    s.on('end', () => resolve());
    s.on('error', (e: Error) => reject(e));
  });
}

async function extractRar(archive: string, dest: string): Promise<void> {
  const ex = await createExtractorFromFile({ filepath: archive, targetPath: dest });
  const { files } = ex.extract();
  for (const _ of files) { /* iterating performs the extraction */ }
}
