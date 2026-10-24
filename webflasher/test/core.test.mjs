import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installImage, validateManifest, browserSupport, assertPartitionLayout } from '../src/core.mjs';

const payload = new Uint8Array(256).fill(42);
payload[0] = 0xe9; payload[12] = 9; payload[13] = 0;
const md5 = createHash('md5').update(payload).digest('hex');
const sha256 = createHash('sha256').update(payload).digest('hex');
const manifest = { version: '0.1.0', chipFamily: 'ESP32-S3', flashSize: 0x1000000,
  images: Object.fromEntries(['app', 'full'].map(mode => [mode, {
    offset: mode === 'app' ? 0x10000 : 0, path: `firmware/niagara-v0.1.0/${mode}.bin`,
    size: payload.length, sha256, md5 }])) };

function partitions() {
  const bytes = new Uint8Array(4096).fill(255);
  const view = new DataView(bytes.buffer);
  const rows = [['nvs', 0x9000, 0x6000], ['app0', 0x10000, 0x470000],
    ['spiffs', 0x480000, 0xb70000], ['coredump', 0xff0000, 0x10000]];
  rows.forEach(([label, offset, size], index) => {
    const at = index * 32;
    bytes.fill(0, at, at + 32);
    view.setUint16(at, 0x50aa, true); view.setUint32(at + 4, offset, true);
    view.setUint32(at + 8, size, true); bytes.set(new TextEncoder().encode(label), at + 12);
  });
  return bytes;
}

function fixture(overrides = {}) {
  const calls = [];
  const loader = { chip: { CHIP_NAME: 'ESP32-S3' }, IS_STUB: true, secureDownloadMode: false,
    getSecurityInfo: async () => ({ flashCryptCnt: 0, parsedFlags: { SECURE_BOOT_EN: false } }),
    readFlashId: async () => 0x1840c8,
    readFlash: async (...args) => { calls.push(['read', ...args]); return partitions(); },
    writeFlash: async options => { calls.push(['write', options]); options.reportProgress(0, 128, 256); },
    flashMd5sum: async (...args) => { calls.push(['digest', ...args]); return md5; }, ...overrides };
  return { loader, calls };
}

const run = (loader, options = {}) => installImage({ loader, manifest, mode: 'app',
  bytes: payload, confirmed: true, ...options });

test('app update validates layout, writes only app and checks device digest', async () => {
  const { loader, calls } = fixture(); const stages = []; const progress = [];
  assert.equal((await run(loader, { onStage: s => stages.push(s), onProgress: p => progress.push(p) })).verified, true);
  assert.deepEqual(calls[0], ['read', 0x8000, 0x1000]);
  const options = calls.find(c => c[0] === 'write')[1];
  assert.equal(options.fileArray[0].address, 0x10000);
  assert.equal(options.eraseAll, false); assert.equal(options.flashMode, 'keep');
  assert.deepEqual(stages, ['checking', 'writing', 'verifying']); assert.deepEqual(progress, [50]);
  assert.deepEqual(calls.at(-1), ['digest', 0x10000, 256]);
});

test('full image is explicit, starts at zero and never erases entire flash', async () => {
  const { loader, calls } = fixture(); await run(loader, { mode: 'full' });
  assert.ok(!calls.some(c => c[0] === 'read'));
  const options = calls.find(c => c[0] === 'write')[1];
  assert.equal(options.fileArray[0].address, 0); assert.equal(options.eraseAll, false);
});

test('no write without the mode-specific user confirmation', async () => {
  const { loader, calls } = fixture();
  await assert.rejects(run(loader, { confirmed: false }), { code: 'confirm' });
  assert.equal(calls.length, 0);
});

test('modified download is rejected before any device operation', async () => {
  const { loader, calls } = fixture(); const bytes = payload.slice(); bytes[50] ^= 1;
  await assert.rejects(run(loader, { bytes }), { code: 'checksum' }); assert.equal(calls.length, 0);
});

test('truncated download is rejected', async () => {
  const { loader, calls } = fixture();
  await assert.rejects(run(loader, { bytes: payload.slice(0, 128) }), { code: 'size' });
  assert.equal(calls.length, 0);
});

test('different chip is never written', async () => {
  const { loader, calls } = fixture({ chip: { CHIP_NAME: 'ESP32' } });
  await assert.rejects(run(loader), { code: 'chip' }); assert.equal(calls.length, 0);
});

test('8 MB board is never written', async () => {
  const { loader, calls } = fixture({ readFlashId: async () => 0x1740c8 });
  await assert.rejects(run(loader), { code: 'capacity' }); assert.equal(calls.length, 0);
});

test('secure boot and encrypted flash are refused', async () => {
  for (const security of [{ flashCryptCnt: 0, parsedFlags: { SECURE_BOOT_EN: true } },
    { flashCryptCnt: 7, parsedFlags: { SECURE_BOOT_EN: false } }]) {
    const { loader, calls } = fixture({ getSecurityInfo: async () => security });
    await assert.rejects(run(loader), { code: 'secureDevice' }); assert.equal(calls.length, 0);
  }
});

test('incompatible partition layout blocks an app update before writing', async () => {
  const bytes = partitions(); new DataView(bytes.buffer).setUint32(36, 0x20000, true);
  const { loader, calls } = fixture({ readFlash: async () => bytes });
  await assert.rejects(run(loader), { code: 'layout' }); assert.ok(!calls.some(c => c[0] === 'write'));
});

test('blank partition table is not silently converted into a full install', async () => {
  assert.throws(() => assertPartitionLayout(new Uint8Array(4096).fill(255)), { code: 'layout' });
});

test('device digest mismatch never reports verified success', async () => {
  const { loader, calls } = fixture({ flashMd5sum: async () => '0'.repeat(32) });
  await assert.rejects(run(loader), { code: 'verify' }); assert.ok(calls.some(c => c[0] === 'write'));
});

test('manifest cannot move the app or fetch an external/traversal payload', () => {
  for (const change of [{ offset: 0 }, { path: 'https://example.com/app.bin' },
    { path: 'firmware/../../app.bin' }, { size: 0x1000000 }]) {
    const copy = structuredClone(manifest); Object.assign(copy.images.app, change);
    assert.throws(() => validateManifest(copy), { code: 'manifest' });
  }
});

test('HTTPS, Web Serial and embedding policy all gate connection', () => {
  assert.equal(browserSupport({ secure: true, serial: true }), null);
  assert.equal(browserSupport({ secure: false, serial: true }), 'https');
  assert.equal(browserSupport({ secure: true, serial: false }), 'unsupported');
  assert.equal(browserSupport({ secure: true, serial: true, policy: false }), 'embedded');
});
