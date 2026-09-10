import JSZip from 'jszip';
import { H5P } from 'h5p-standalone';
import frameJsSource from 'h5p-standalone/dist/frame.bundle.js?raw';
import frameCssSource from 'h5p-standalone/dist/styles/h5p.css?raw';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="topbar"><div class="brand"><span class="brand-mark">H5</span><span>H5P Desk</span></div><div class="top-actions"><button id="open-button" class="button primary">Open .h5p</button><button id="about-button" class="icon-button" aria-label="About">?</button></div></header>
  <main class="shell"><section id="welcome" class="welcome"><div class="hero-icon">↗</div><p class="eyebrow">OFFLINE H5P PLAYER</p><h1>Learn without<br><em>limits.</em></h1><p class="intro">Open an H5P package directly from your computer. Your file stays on your device and is never extracted or uploaded.</p><button id="hero-open" class="button primary large">Choose an H5P file <span>→</span></button><p class="hint">or drag and drop a <strong>.h5p</strong> file anywhere</p></section><section id="player-view" class="player-view hidden"><div class="file-bar"><button id="back-button" class="back">← Library</button><div><strong id="file-name"></strong><span id="file-meta"></span></div></div><div id="h5p-container"></div></section><input id="file-input" type="file" accept=".h5p,application/zip" hidden /></main>
  <footer><span>H5P Desk</span><span>Files are processed locally</span></footer>`;

const input = document.querySelector('#file-input');
const welcome = document.querySelector('#welcome');
const playerView = document.querySelector('#player-view');
const container = document.querySelector('#h5p-container');
const status = (message) => { document.querySelector('#file-meta').textContent = message; };

document.querySelectorAll('#open-button, #hero-open').forEach((button) => button.addEventListener('click', () => input.click()));
document.querySelector('#about-button').addEventListener('click', () => alert('H5P Desk\nA small, private desktop player for H5P packages.'));
document.querySelector('#back-button').addEventListener('click', () => { container.replaceChildren(); playerView.classList.add('hidden'); welcome.classList.remove('hidden'); });
['dragenter', 'dragover'].forEach((event) => document.addEventListener(event, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((event) => document.addEventListener(event, (e) => { e.preventDefault(); document.body.classList.remove('dragging'); }));
document.addEventListener('drop', (e) => { const file = [...e.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith('.h5p')); if (file) openFile(file); });
input.addEventListener('change', () => input.files[0] && openFile(input.files[0]));

async function openFile(file) {
  welcome.classList.add('hidden'); playerView.classList.remove('hidden');
  document.querySelector('#file-name').textContent = file.name;
  status('Reading archive…'); container.replaceChildren();
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = new Map();
    for (const entry of Object.values(zip.files)) if (!entry.dir) entries.set(normalize(entry.name), await entry.async('blob'));
    if (!entries.has('h5p.json') || !entries.has('content/content.json')) throw new Error('This archive is missing h5p.json or content/content.json.');
    const archiveUrl = `http://h5p-archive.local/${crypto.randomUUID()}`;
    const urls = new Map([...entries].map(([name, blob]) => [name, URL.createObjectURL(blob)]));
    urls.set('frame.bundle.js', URL.createObjectURL(new Blob([frameJsSource], { type: 'text/javascript' })));
    urls.set('styles/h5p.css', URL.createObjectURL(new Blob([frameCssSource], { type: 'text/css' })));
    const restoreFetch = installArchiveFetch(archiveUrl, urls);
    status(`${entries.size} files · loaded locally`);
    await new H5P(container, { h5pJsonPath: archiveUrl, contentJsonPath: `${archiveUrl}/content`, librariesPath: archiveUrl, embedType: 'div', frame: true, fullScreen: true, frameJs: `${archiveUrl}/frame.bundle.js`, frameCss: `${archiveUrl}/styles/h5p.css` });
    window.addEventListener('pagehide', () => { restoreFetch(); urls.forEach((url) => URL.revokeObjectURL(url)); }, { once: true });
  } catch (error) { container.innerHTML = `<div class="error"><strong>Could not open this file</strong><p>${escapeHtml(error.message)}</p><button class="button" onclick="location.reload()">Try another file</button></div>`; status('Open failed'); }
}

function installArchiveFetch(root, urls) {
  const original = window.fetch;
  const originalAppendChild = Node.prototype.appendChild;
  const originalSetAttribute = Element.prototype.setAttribute;
  const resolve = (url) => { if (!url || !url.startsWith(root)) return null; return urls.get(normalize(url.slice(root.length))); };
  const rewrite = (url) => resolve(url) || url;
  window.fetch = async (request, options) => { const url = typeof request === 'string' ? request : request.url; const blobUrl = resolve(url); if (blobUrl) return original(blobUrl, options); if (url.startsWith(root)) return new Response('Not found', { status: 404 }); return original(request, options); };
  Element.prototype.setAttribute = function (name, value) {
    const attribute = name.toLowerCase();
    if (attribute === 'src' || attribute === 'href' || attribute === 'poster') value = rewrite(value);
    if (attribute === 'srcset' && typeof value === 'string') value = value.split(',').map((item) => { const [url, descriptor] = item.trim().split(/\s+/, 2); return [rewrite(url), descriptor].filter(Boolean).join(' '); }).join(', ');
    return originalSetAttribute.call(this, name, value);
  };
  const patchedProperties = [[HTMLImageElement, 'src'], [HTMLAudioElement, 'src'], [HTMLVideoElement, 'src'], [HTMLSourceElement, 'src'], [HTMLTrackElement, 'src'], [HTMLVideoElement, 'poster']];
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
  return () => { window.fetch = original; Node.prototype.appendChild = originalAppendChild; Element.prototype.setAttribute = originalSetAttribute; restorers.forEach((restore) => restore()); };
}
function normalize(path) { return path.replace(/^\/+/, '').replace(/\/+/g, '/'); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
