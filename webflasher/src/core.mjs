export class FlashError extends Error {
  constructor(code) { super(code); this.name = 'FlashError'; this.code = code; }
}

export function browserSupport({ secure, serial, policy = true }) {
  return !secure ? 'https' : !serial ? 'unsupported' : !policy ? 'embedded' : null;
}

export function validateManifest(manifest) {
  if (manifest?.chipFamily !== 'ESP32-S3' || manifest.flashSize !== 0x1000000 ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) throw new FlashError('manifest');
  for (const mode of ['app', 'full']) {
    const image = manifest.images?.[mode];
    if (!image || image.offset !== (mode === 'app' ? 0x10000 : 0) ||
        !Number.isInteger(image.size) || image.size < 32 ||
        image.offset + image.size > 0x480000 ||
        !/^firmware\/[a-zA-Z0-9_./-]+\.bin$/.test(image.path ?? '') ||
        image.path.includes('..') || !/^[a-f0-9]{64}$/.test(image.sha256 ?? '') ||
        !/^[a-f0-9]{32}$/.test(image.md5 ?? '')) throw new FlashError('manifest');
  }
  return manifest;
}

export async function validateImage(image, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== image.size) throw new FlashError('size');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== image.sha256) throw new FlashError('checksum');
  if (bytes[0] !== 0xe9 || bytes[12] !== 9 || bytes[13] !== 0) throw new FlashError('imageChip');
}

export async function assertDevice(loader) {
  if (loader.chip?.CHIP_NAME !== 'ESP32-S3') throw new FlashError('chip');
  if (!loader.IS_STUB || loader.secureDownloadMode) throw new FlashError('loader');
  const security = await loader.getSecurityInfo();
  const encrypted = (security.flashCryptCnt >>> 0).toString(2).replaceAll('0', '').length % 2 === 1;
  if (security.parsedFlags?.SECURE_BOOT_EN || encrypted) throw new FlashError('secureDevice');
  const id = await loader.readFlashId();
  const capacity = (id >>> 16) & 255;
  if (capacity !== 0x18 && capacity !== 0x38) throw new FlashError('capacity');
}

export function assertPartitionLayout(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 128) throw new FlashError('layout');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  for (let at = 0; at + 32 <= bytes.length && view.getUint16(at, true) === 0x50aa; at += 32) {
    const name = new TextDecoder().decode(bytes.subarray(at + 12, at + 28)).split('\0')[0];
    if (entries.has(name)) throw new FlashError('layout');
    entries.set(name, [view.getUint32(at + 4, true), view.getUint32(at + 8, true)]);
  }
  const expected = { nvs: [0x9000, 0x6000], app0: [0x10000, 0x470000],
    spiffs: [0x480000, 0xb70000], coredump: [0xff0000, 0x10000] };
  if (entries.size !== 4 || Object.entries(expected).some(([name, range]) =>
    !entries.has(name) || entries.get(name).some((value, index) => value !== range[index]))) {
    throw new FlashError('layout');
  }
}

export function writeOptions(image, bytes, reportProgress) {
  return { fileArray: [{ data: bytes, address: image.offset }], flashMode: 'keep',
    flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true, reportProgress };
}

export async function installImage({ loader, manifest, mode, bytes, confirmed,
  onStage = () => {}, onProgress = () => {} }) {
  validateManifest(manifest);
  if (!['app', 'full'].includes(mode)) throw new FlashError('mode');
  if (!confirmed) throw new FlashError('confirm');
  const image = manifest.images[mode];
  await validateImage(image, bytes);
  onStage('checking');
  await assertDevice(loader);
  if (mode === 'app') assertPartitionLayout(await loader.readFlash(0x8000, 0x1000));
  onStage('writing');
  await loader.writeFlash(writeOptions(image, bytes, (_index, written, total) =>
    onProgress(total ? Math.min(100, Math.floor(written * 100 / total)) : 0)));
  onStage('verifying');
  const digest = await loader.flashMd5sum(image.offset, bytes.length);
  if (String(digest).toLowerCase() !== image.md5) throw new FlashError('verify');
  return { verified: true, offset: image.offset, bytes: bytes.length };
}
