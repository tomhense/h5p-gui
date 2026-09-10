import JSZip from 'jszip';
import { H5P } from 'h5p-standalone';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import frameJsAsset from 'h5p-standalone/dist/frame.bundle.js?url';
import frameCssAsset from 'h5p-standalone/dist/styles/h5p.css?url';
import frameJsSource from 'h5p-standalone/dist/frame.bundle.js?raw';
import frameCssSource from 'h5p-standalone/dist/styles/h5p.css?raw';
import coreFontUrl from 'h5p-standalone/dist/fonts/h5p-core-30.woff2?url';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <main class="shell"><section id="welcome" class="welcome"><p class="eyebrow">OFFLINE · PRIVATE · LOCAL</p><h1>Local <em>H5P</em> Player</h1><p class="intro">Open an H5P package from your computer. Files stay on your device.</p><div id="drop-zone" class="drop-zone"><button id="open-button" class="button primary large">Choose an .h5p file</button><p>or drop a file here</p></div></section><section id="player-view" class="player-view hidden"><div class="file-bar"><button id="back-button" class="back">← Back</button><div><strong id="file-name"></strong><span id="file-meta"></span></div></div><div id="h5p-container"></div></section><input id="file-input" type="file" accept=".h5p,application/zip" hidden /></main>`;

const input = document.querySelector('#file-input');
const welcome = document.querySelector('#welcome');
const playerView = document.querySelector('#player-view');
const container = document.querySelector('#h5p-container');
const status = (message) => { document.querySelector('#file-meta').textContent = message; };
let restoreArchiveFetch = null;
let archiveUrls = null;
let archiveFontStyle = null;

document.querySelector('#open-button').addEventListener('click', async () => {
  const path = await open({ multiple: false, filters: [{ name: 'H5P package', extensions: ['h5p'] }] });
  if (typeof path !== 'string') return;
  showCliLoading(path);
  openPath(path).catch(showOpenError);
});
document.querySelector('#back-button').addEventListener('click', () => { container.replaceChildren(); playerView.classList.add('hidden'); welcome.classList.remove('hidden'); });
['dragenter', 'dragover'].forEach((event) => document.addEventListener(event, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((event) => document.addEventListener(event, (e) => { e.preventDefault(); document.body.classList.remove('dragging'); }));
document.addEventListener('drop', (e) => { const file = [...e.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith('.h5p')); if (file) openFile(file); });
input.addEventListener('change', () => input.files[0] && openFile(input.files[0]));
invoke('cli_file_path').then((path) => {
  if (!path) return;
  showCliLoading(path);
  return openPath(path);
}).catch((error) => {
  showOpenError(error);
});

function showOpenError(error) {
  container.innerHTML = `<div class="error"><strong>Could not open this file</strong><p>${escapeHtml(error.message)}</p></div>`;
  status('Open failed');
}

function showCliLoading(path) {
  welcome.classList.add('hidden');
  playerView.classList.remove('hidden');
  document.querySelector('#file-name').textContent = path.split(/[\\/]/).pop() || path;
  status('Loading…');
  container.innerHTML = '<div class="loading"><span class="spinner"></span><span>Loading presentation…</span></div>';
}

async function openPath(path) {
  const root = await invoke('serve_h5p', { path });
  container.replaceChildren();
  await new H5P(container, { h5pJsonPath: root, contentJsonPath: `${root}/content`, librariesPath: root, embedType: 'div', frame: true, fullScreen: true, frameJs: frameJsAsset, frameCss: frameCssAsset });
}

async function openFile(file) {
  welcome.classList.add('hidden'); playerView.classList.remove('hidden');
  document.querySelector('#file-name').textContent = file.name;
  status('Reading archive…'); container.replaceChildren();
  try {
    restoreArchiveFetch?.();
    archiveUrls?.forEach((url) => URL.revokeObjectURL(url));
    archiveFontStyle?.remove();
    restoreArchiveFetch = null;
    archiveUrls = null;
    archiveFontStyle = null;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = new Map();
    for (const entry of Object.values(zip.files)) if (!entry.dir) {
      const name = normalize(entry.name);
      const blob = await entry.async('blob');
      entries.set(name, new Blob([blob], { type: mimeFor(name) }));
    }
    if (!entries.has('h5p.json') || !entries.has('content/content.json')) throw new Error('This archive is missing h5p.json or content/content.json.');
    // H5P's URL normalizer only accepts http(s) URLs. The archive is still
    // entirely virtual: installArchiveFetch maps this URL to blob URLs.
    const archiveUrl = `http://localhost/__h5p/${crypto.randomUUID()}`;
    const urls = new Map([...entries].map(([name, blob]) => [name, URL.createObjectURL(blob)]));
    archiveUrls = urls;
    for (const [name, blob] of entries) {
      if (!name.toLowerCase().endsWith('.css')) continue;
      const oldUrl = urls.get(name);
      const css = rewriteCssUrls(await blob.text(), name, urls, coreFontUrl);
      urls.set(name, URL.createObjectURL(new Blob([css], { type: 'text/css' })));
      URL.revokeObjectURL(oldUrl);
    }
    const frameCss = rewriteCssUrls(frameCssSource, 'styles/h5p.css', urls, coreFontUrl);
    urls.set('frame.bundle.js', URL.createObjectURL(new Blob([frameJsSource], { type: 'text/javascript' })));
    urls.set('styles/h5p.css', URL.createObjectURL(new Blob([frameCss], { type: 'text/css' })));
    const font = (name) => urls.get(name) || [...urls.entries()].find(([path]) => path.split('/').pop() === name)?.[1];
    archiveFontStyle = document.createElement('style');
    archiveFontStyle.textContent = [
      fontFace('H5PFontAwesome4', font('fontawesome-webfont.woff2'), 'normal'),
      fontFace('H5PFontIcons', font('h5p.woff'), 'normal'),
      fontFace('H5PDroidSans', font('500391a5880cb0fbf3b6.ttf'), 'normal'),
      fontFace('H5PDroidSans', font('d90853a4f553e6c2b974.ttf'), 'bold')
    ].filter(Boolean).join('\n');
    document.head.appendChild(archiveFontStyle);
    restoreArchiveFetch = installArchiveFetch(archiveUrl, urls);
    status(`${entries.size} files · loaded locally`);
    await new H5P(container, { h5pJsonPath: archiveUrl, contentJsonPath: `${archiveUrl}/content`, librariesPath: archiveUrl, embedType: 'div', frame: true, fullScreen: true, frameJs: `${archiveUrl}/frame.bundle.js`, frameCss: `${archiveUrl}/styles/h5p.css` });
    window.addEventListener('pagehide', () => { restoreArchiveFetch?.(); archiveUrls?.forEach((url) => URL.revokeObjectURL(url)); }, { once: true });
  } catch (error) { container.innerHTML = `<div class="error"><strong>Could not open this file</strong><p>${escapeHtml(error.message)}</p><button class="button" onclick="location.reload()">Try another file</button></div>`; status('Open failed'); }
}

function installArchiveFetch(root, urls) {
  const original = window.fetch;
  const originalAppendChild = Node.prototype.appendChild;
  const originalSetAttribute = Element.prototype.setAttribute;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalMediaLoad = HTMLMediaElement.prototype.load;
  const resolve = (url) => {
    if (!url) return null;
    const value = typeof url === 'string' ? url : url.toString();
    if (!value.startsWith(root)) return null;
    return urls.get(normalize(value.slice(root.length).split(/[?#]/, 1)[0]));
  };
  const rewrite = (url) => resolve(url) || url;
  window.fetch = async (request, options) => {
    const url = typeof request === 'string' ? request : request.url;
    const blobUrl = resolve(url);
    if (blobUrl) return original(blobUrl, options);
    if (typeof url === 'string' && url.startsWith(root)) return new Response('Not found', { status: 404 });
    return original(request, options);
  };
  Element.prototype.setAttribute = function (name, value) {
    const attribute = name.toLowerCase();
    if (attribute === 'src' || attribute === 'href' || attribute === 'poster') value = rewrite(value);
    if (attribute === 'srcset' && typeof value === 'string') value = value.split(',').map((item) => { const [url, descriptor] = item.trim().split(/\s+/, 2); return [rewrite(url), descriptor].filter(Boolean).join(' '); }).join(', ');
    return originalSetAttribute.call(this, name, value);
  };
  const patchedProperties = [[HTMLScriptElement, 'src'], [HTMLLinkElement, 'href'], [HTMLImageElement, 'src'], [HTMLMediaElement, 'src'], [HTMLSourceElement, 'src'], [HTMLTrackElement, 'src'], [HTMLVideoElement, 'poster']];
  const restorers = patchedProperties.map(([type, property]) => {
    const descriptor = Object.getOwnPropertyDescriptor(type.prototype, property);
    if (!descriptor?.set || !descriptor.get) return () => {};
    Object.defineProperty(type.prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, rewrite(value)); } });
    return () => Object.defineProperty(type.prototype, property, descriptor);
  });
  Node.prototype.appendChild = function (node) {
    if (node instanceof HTMLScriptElement) { const blobUrl = resolve(node.src); if (blobUrl) node.src = blobUrl; }
    if (node instanceof HTMLLinkElement) { const blobUrl = resolve(node.href); if (blobUrl) node.href = blobUrl; }
    return originalAppendChild.call(this, node);
  };
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    return originalXhrOpen.call(this, method, rewrite(url), ...args);
  };
  HTMLMediaElement.prototype.load = function () {
    const source = this.getAttribute('src');
    if (source) this.setAttribute('src', rewrite(source));
    this.querySelectorAll('source[src]').forEach((element) => element.setAttribute('src', rewrite(element.getAttribute('src'))));
    return originalMediaLoad.call(this);
  };
  return () => { window.fetch = original; Node.prototype.appendChild = originalAppendChild; Element.prototype.setAttribute = originalSetAttribute; XMLHttpRequest.prototype.open = originalXhrOpen; HTMLMediaElement.prototype.load = originalMediaLoad; restorers.forEach((restore) => restore()); };
}
function normalize(path) { return path.replace(/^\/+/, '').replace(/\/+/g, '/'); }
function mimeFor(path) {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({
    css: 'text/css', js: 'text/javascript', json: 'application/json',
    mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/x-m4v', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', eot: 'application/vnd.ms-fontobject'
  })[extension] || 'application/octet-stream';
}
function fontFace(name, url, weight) { return url ? `@font-face{font-family:${JSON.stringify(name)};src:url(${JSON.stringify(url)});font-weight:${weight};font-style:normal}` : ''; }
function rewriteCssUrls(css, stylesheetPath, urls, coreFontUrl) {
  return css.replace(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/gi, (match, quote, assetPath) => {
    if (/^(data:|https?:|blob:|#)/i.test(assetPath)) return match;
    let archivePath;
    try { archivePath = normalize(new URL(assetPath, `http://archive.invalid/${stylesheetPath}`).pathname); } catch { return match; }
    const basename = archivePath.split('/').pop();
    const replacement = urls.get(archivePath) || [...urls.entries()].find(([name]) => name.split('/').pop() === basename)?.[1] || (basename === 'h5p-core-30.woff2' ? coreFontUrl : null);
    return replacement ? `url(${quote}${replacement}${quote})` : match;
  });
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
