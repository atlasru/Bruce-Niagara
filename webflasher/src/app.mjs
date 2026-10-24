import { ESPLoader, Transport } from 'esptool-js';
import { FlashError, browserSupport, validateManifest, assertDevice, installImage } from './core.mjs';
import { translations } from './i18n.mjs';

const $ = id => document.getElementById(id);
let language;
try { language = localStorage.getItem('niagara-language'); } catch { /* Storage can be disabled. */ }
if (!['ru', 'en'].includes(language)) language = navigator.language.startsWith('ru') ? 'ru' : 'en';
const state = { manifest: null, mode: 'app', loader: null, transport: null, port: null,
  busy: false, verified: false, stage: null, error: null, support: null };
let logText = '';
const t = key => translations[language][key] ?? translations.en[key] ?? key;

function log(message) {
  logText = (logText + String(message)).slice(-60000);
  $('log').textContent = logText;
  $('log').scrollTop = $('log').scrollHeight;
}

function setStage(stage) {
  state.stage = stage;
  $('stage-label').textContent = t(`stage_${stage}`);
  log(`\n[${stage}]\n`);
  render();
}

function render() {
  $('mode-description').textContent = t(state.mode === 'app' ? 'appDescription' : 'fullDescription');
  $('mode-description').classList.toggle('danger', state.mode === 'full');
  $('confirm-text').textContent = t(state.mode === 'app' ? 'appConfirm' : 'fullConfirm');
  $('install-label').textContent = t(state.mode === 'app' ? 'installApp' : 'installFull');
  $('mode-switch').disabled = state.busy;
  $('confirm').disabled = state.busy;
  $('connect').hidden = !!state.loader;
  $('connect').disabled = state.busy || !state.manifest || !!state.support;
  $('install').hidden = !state.loader;
  $('install').disabled = state.busy || !$('confirm').checked || !state.manifest || !!state.support;
  $('disconnect').hidden = !state.loader;
  $('disconnect').disabled = state.busy;
  $('device-state').classList.toggle('connected', !!state.loader);
  $('device-label').textContent = t(state.loader ? 'connected' : 'notConnected');
  $('device-detail').textContent = t(state.loader ? 'connectedHint' : 'deviceHint');
  $('browser-note').textContent = t(state.support ?? 'ready');
  $('error').hidden = !state.error;
  $('error').textContent = state.error ? t(`error_${state.error}`) : '';
  $('success').hidden = !state.verified;
  $('progress-section').hidden = !state.stage;
  if (state.stage) $('stage-label').textContent = t(`stage_${state.stage}`);
  if (state.manifest) {
    const image = state.manifest.images[state.mode];
    $('image-size').textContent = `${(image.size / 1e6).toFixed(2)} MB · ${state.manifest.version}`;
    $('download').href = `${state.manifest.releaseUrl.replace('/tag/', '/download/')}/${image.asset}`;
  }
}

function applyLanguage() {
  document.documentElement.lang = language;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  $('language').textContent = language === 'ru' ? 'EN' : 'RU';
  $('language').setAttribute('aria-label', language === 'ru' ? 'Switch to English' : 'Переключить на русский');
  render();
}

function showError(error) {
  log(`\nERROR: ${error?.message ?? error}\n`);
  state.error = error instanceof FlashError ? error.code :
    error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'permission' : 'connection';
  $('log-details').open = true;
}

async function closePort() {
  try { await state.transport?.disconnect(); } catch (error) { log(`\nDisconnect: ${error.message}\n`); }
  state.loader = null; state.transport = null; state.port = null;
}

$('language').addEventListener('click', () => {
  language = language === 'ru' ? 'en' : 'ru';
  try { localStorage.setItem('niagara-language', language); } catch { /* Optional preference. */ }
  applyLanguage();
});

for (const radio of document.querySelectorAll('[name=mode]')) radio.addEventListener('change', () => {
  if (state.busy || !radio.checked) return;
  state.mode = radio.value; state.error = null; state.verified = false; state.stage = null;
  $('confirm').checked = false;
  render();
});
$('confirm').addEventListener('change', render);

$('connect').addEventListener('click', async () => {
  if (state.busy || state.support || !state.manifest) return;
  state.busy = true; state.error = null; state.verified = false;
  setStage('connecting');
  try {
    // Keep requestPort in the original user activation, before network awaits.
    state.port = await navigator.serial.requestPort();
    state.transport = new Transport(state.port, true);
    const candidate = new ESPLoader({ transport: state.transport, baudrate: 230400,
      terminal: { clean() {}, writeLine: value => log(`${value}\n`), write: log }, debugLogging: false });
    await candidate.main();
    await assertDevice(candidate);
    state.loader = candidate;
    state.stage = null;
  } catch (error) {
    if (error?.name !== 'NotFoundError') showError(error);
    await closePort();
    state.stage = null;
  } finally { state.busy = false; render(); }
});

$('disconnect').addEventListener('click', async () => {
  if (state.busy) return;
  await closePort(); state.stage = null; render();
});

async function loadImage(mode) {
  const image = state.manifest.images[mode];
  const url = new URL(image.path, new URL('./firmware.json', location.href));
  if (url.origin !== location.origin) throw new FlashError('manifest');
  let response;
  try { response = await fetch(url); } catch { throw new FlashError('download'); }
  if (!response.ok) throw new FlashError('download');
  const bytes = new Uint8Array(await response.arrayBuffer());
  // installImage verifies both byte length and SHA-256 before any write.
  return bytes;
}

$('install').addEventListener('click', async () => {
  if (state.busy || !state.loader || !$('confirm').checked || !state.manifest) return;
  const mode = state.mode;
  state.busy = true; state.error = null; state.verified = false;
  $('progress').value = 0; $('percentage').textContent = '0%';
  setStage('downloading');
  try {
    const bytes = await loadImage(mode);
    await installImage({ loader: state.loader, manifest: state.manifest, mode, bytes, confirmed: true,
      onStage: setStage, onProgress: value => {
        $('progress').value = value; $('percentage').textContent = `${value}%`;
      } });
    state.verified = true;
    $('progress').value = 100; $('percentage').textContent = '100%';
    setStage('done');
    try { await state.loader.after('hard_reset'); } catch (error) { log(`\nReset: ${error.message}\n`); }
  } catch (error) {
    showError(error);
    state.stage = null;
  } finally {
    await closePort();
    state.busy = false;
    $('confirm').checked = false;
    render();
  }
});

$('save-log').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([logText], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'bruce-niagara-flasher.log';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener('beforeunload', event => {
  if (state.busy && !state.verified) { event.preventDefault(); event.returnValue = ''; }
});

const policy = document.permissionsPolicy ?? document.featurePolicy;
state.support = browserSupport({ secure: window.isSecureContext, serial: 'serial' in navigator,
  policy: typeof policy?.allowsFeature === 'function' ? policy.allowsFeature('serial') : true });
applyLanguage();

try {
  const response = await fetch('./firmware.json', { cache: 'no-cache' });
  if (!response.ok) throw new FlashError('manifest');
  state.manifest = validateManifest(await response.json());
  $('release-link').textContent = `v${state.manifest.version} ↗`;
  $('release-link').href = state.manifest.releaseUrl;
} catch (error) { showError(new FlashError('manifest')); log(`\n${error.message}\n`); }
render();
