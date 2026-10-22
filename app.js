import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

const ffmpeg = new FFmpeg();
let loaded = false;

async function loadFFmpeg() {
  if (loaded) return;
  const status = document.getElementById('globalStatus');
  status.textContent = 'Loading video engine (first time may take ~30s)...';
  try {
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    loaded = true;
    status.textContent = 'Ready';
  } catch (err) {
    status.textContent = '';
    throw new Error('Failed to load video engine: ' + err.message);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return 'unknown';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function getDuration(file) {
  try {
    await loadFFmpeg();
    const name = 'probe_' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    await ffmpeg.writeFile(name, await fetchFile(file));
    let duration = null;
    const logHandler = ({ message }) => {
      const match = message.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
      }
    };
    ffmpeg.on('log', logHandler);
    try {
      await ffmpeg.exec(['-i', name, '-f', 'null', '-']);
    } catch (e) {}
    ffmpeg.off('log', logHandler);
    await ffmpeg.deleteFile(name);
    return duration;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function showError(container, msg) {
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = msg;
  container.appendChild(div);
}

function createShareButton(blob, filename) {
  const url = URL.createObjectURL(blob);
  const container = document.createElement('div');
  container.className = 'output-item';
  const nameEl = document.createElement('div');
  nameEl.className = 'file-name';
  nameEl.textContent = filename;
  container.appendChild(nameEl);

  const shareBtn = document.createElement('button');
  shareBtn.className = 'share';
  shareBtn.textContent = 'Save / Share';
  shareBtn.onclick = async () => {
    const file = new File([blob], filename, { type: 'video/mp4' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
      }
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };
  container.appendChild(shareBtn);

  const dl = document.createElement('a');
  dl.href = url;
  dl.download = filename;
  dl.className = 'btn';
  dl.textContent = 'Download MP4';
  dl.style.marginTop = '8px';
  container.appendChild(dl);

  return container;
}

async function clearFS() {
  try {
    const files = await ffmpeg.listDir('/');
    for (const f of files) {
      if (f.name !== '.' && f.name !== '..') {
        try { await ffmpeg.deleteFile(f.name); } catch {}
      }
    }
  } catch {}
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  };
});

const convertInput = document.getElementById('convertInput');
const convertList = document.getElementById('convertList');
const convertWarning = document.getElementById('convertWarning');
const startConvert = document.getElementById('startConvert');
let convertFiles = [];

document.getElementById('pickConvert').onclick = () => convertInput.click();

convertInput.onchange = async () => {
  convertFiles = Array.from(convertInput.files);
  convertList.innerHTML = '';
  convertWarning.innerHTML = '';
  startConvert.disabled = convertFiles.length === 0;
  if (!convertFiles.length) return;

  let totalSize = 0;
  for (const file of convertFiles) {
    totalSize += file.size;
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-name">${file.name}</div>
      <div class="file-meta">Size: ${formatSize(file.size)} | Length: probing...</div>
    `;
    convertList.appendChild(item);
    const meta = item.querySelector('.file-meta');
    try {
      const dur = await getDuration(file);
      meta.textContent = `Size: ${formatSize(file.size)} | Length: ${formatDuration(dur)}`;
    } catch (err) {
      meta.textContent = `Size: ${formatSize(file.size)} | Length: error reading`;
      showError(convertList, `Could not read ${file.name}: ${err.message}`);
    }
  }
  if (totalSize > 1024 * 1024 * 1024) {
    convertWarning.innerHTML = '<div class="warning">Warning: Total size over 1 GB. iPad may run out of memory.</div>';
  }
};

startConvert.onclick = async () => {
  if (!convertFiles.length) return;
  startConvert.disabled = true;
  const progressArea = document.getElementById('convertProgress');
  const outputs = document.getElementById('convertOutputs');
  progressArea.innerHTML = '';
  outputs.innerHTML = '';

  try {
    await loadFFmpeg();
    for (let i = 0; i < convertFiles.length; i++) {
      const file = convertFiles[i];
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <div class="file-name">${file.name}</div>
        <div class="progress-bar" id="cbar${i}">
          <div class="progress-fill" id="cprog${i}"></div>
          <div class="progress-text" id="ctxt${i}">0%</div>
        </div>
        <div class="status" id="cstat${i}">Starting...</div>
      `;
      progressArea.appendChild(item);

      const progFill = document.getElementById(`cprog${i}`);
      const progText = document.getElementById(`ctxt${i}`);
      const progBar = document.getElementById(`cbar${i}`);
      const stat = document.getElementById(`cstat${i}`);

      let gotProgress = false;
      const onProgress = ({ progress }) => {
        gotProgress = true;
        progBar.classList.remove('indeterminate');
        const pct = Math.round(progress * 100);
        progFill.style.width = pct + '%';
        progText.textContent = pct + '%';
        stat.textContent = `Converting... ${pct}%`;
      };
      ffmpeg.on('progress', onProgress);
      setTimeout(() => {
        if (!gotProgress) progBar.classList.add('indeterminate');
      }, 800);

      try {
        const inName = `in_${i}.avi`;
        const outName = `out_${i}.mp4`;
        await ffmpeg.writeFile(inName, await fetchFile(file));

        let success = false;
        try {
          await ffmpeg.exec([
            '-i', inName,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outName
          ]);
          success = true;
        } catch (e) {
          try {
            await ffmpeg.exec([
              '-i', inName,
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-an',
              '-movflags', '+faststart',
              outName
            ]);
            success = true;
          } catch (e2) {
            throw e2;
          }
        }

        if (success) {
          const data = await ffmpeg.readFile(outName);
          const blob = new Blob([data.buffer], { type: 'video/mp4' });
          const base = file.name.replace(/\.avi$/i, '');
          outputs.appendChild(createShareButton(blob, base + '.mp4'));
          stat.textContent = 'Done';
          progFill.style.width = '100%';
          progText.textContent = '100%';
          progBar.classList.remove('indeterminate');
        }
        await ffmpeg.deleteFile(inName);
        await ffmpeg.deleteFile(outName);
      } catch (err) {
        stat.textContent = 'Error';
        showError(progressArea, `Failed to convert ${file.name}: ${err.message || err}`);
      }
      ffmpeg.off('progress', onProgress);
    }
    await clearFS();
  } catch (err) {
    showError(progressArea, 'Processing failed: ' + (err.message || err));
  }
  startConvert.disabled = false;
};

const combineInput = document.getElementById('combineInput');
const combineList = document.getElementById('combineList');
const combineWarning = document.getElementById('combineWarning');
const startCombine = document.getElementById('startCombine');
let combineFiles = [];

document.getElementById('pickCombine').onclick = () => combineInput.click();

combineInput.onchange = async () => {
  combineFiles = Array.from(combineInput.files);
  await renderCombineList(true);
};

async function renderCombineList(probe = false) {
  combineList.innerHTML = '';
  combineWarning.innerHTML = '';
  startCombine.disabled = combineFiles.length < 2;
  if (!combineFiles.length) return;

  let totalSize = 0;
  for (const file of combineFiles) {
    totalSize += file.size;
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.innerHTML = `
      <div class="file-name">${file.name}</div>
      <div class="file-meta">Size: ${formatSize(file.size)} | Length: probing...</div>
      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="move-up" style="flex:1; padding:10px; font-size:1rem;">↑ Up</button>
        <button class="move-down" style="flex:1; padding:10px; font-size:1rem;">↓ Down</button>
      </div>
    `;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', combineFiles.indexOf(file).toString());
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      const to = combineFiles.indexOf(file);
      if (from !== to && !isNaN(from)) {
        const [moved] = combineFiles.splice(from, 1);
        combineFiles.splice(to, 0, moved);
        renderCombineList(false);
      }
    });
    item.querySelector('.move-up').onclick = () => {
      const idx = combineFiles.indexOf(file);
      if (idx > 0) {
        [combineFiles[idx-1], combineFiles[idx]] = [combineFiles[idx], combineFiles[idx-1]];
        renderCombineList(false);
      }
    };
    item.querySelector('.move-down').onclick = () => {
      const idx = combineFiles.indexOf(file);
      if (idx < combineFiles.length - 1) {
        [combineFiles[idx+1], combineFiles[idx]] = [combineFiles[idx], combineFiles[idx+1]];
        renderCombineList(false);
      }
    };
    combineList.appendChild(item);

    const meta = item.querySelector('.file-meta');
    if (probe) {
      try {
        const dur = await getDuration(file);
        meta.textContent = `Size: ${formatSize(file.size)} | Length: ${formatDuration(dur)}`;
      } catch (err) {
        meta.textContent = `Size: ${formatSize(file.size)} | Length: error reading`;
        showError(combineList, `Could not read ${file.name}: ${err.message}`);
      }
    } else {
      meta.textContent = `Size: ${formatSize(file.size)} | Length: (reorder)`;
    }
  }
  if (totalSize > 1024 * 1024 * 1024) {
    combineWarning.innerHTML = '<div class="warning">Warning: Total size over 1 GB. iPad may run out of memory.</div>';
  }
}

startCombine.onclick = async () => {
  if (combineFiles.length < 2) return;
  startCombine.disabled = true;
  const progressArea = document.getElementById('combineProgress');
  const outputs = document.getElementById('combineOutputs');
  progressArea.innerHTML = '<div class="status">Preparing clips...</div>';
  outputs.innerHTML = '';

  try {
    await loadFFmpeg();
    await clearFS();

    const first = combineFiles[0];
    const probeName = 'probe_first';
    await ffmpeg.writeFile(probeName, await fetchFile(first));
    let targetW = 1280, targetH = 720, targetFps = 30;
    const logHandler = ({ message }) => {
      const res = message.match(/(\d{2,4})x(\d{2,4})/);
      if (res) { targetW = parseInt(res[1]); targetH = parseInt(res[2]); }
      const fps = message.match(/(\d+(?:\.\d+)?) fps/);
      if (fps) targetFps = Math.round(parseFloat(fps[1]));
    };
    ffmpeg.on('log', logHandler);
    try { await ffmpeg.exec(['-i', probeName, '-f', 'null', '-']); } catch {}
    ffmpeg.off('log', logHandler);
    await ffmpeg.deleteFile(probeName);

    const intermediates = [];
    for (let i = 0; i < combineFiles.length; i++) {
      const file = combineFiles[i];
      progressArea.innerHTML = `<div class="status">Normalizing ${i + 1}/${combineFiles.length}: ${file.name}</div>
        <div class="progress-bar" id="nbar">
          <div class="progress-fill" id="nprog"></div>
          <div class="progress-text" id="ntxt">0%</div>
        </div>`;
      const progFill = document.getElementById('nprog');
      const progText = document.getElementById('ntxt');
      const progBar = document.getElementById('nbar');
      let gotProgress = false;
      const onProgress = ({ progress }) => {
        gotProgress = true;
        progBar.classList.remove('indeterminate');
        const pct = Math.round(progress * 100);
        progFill.style.width = pct + '%';
        progText.textContent = pct + '%';
      };
      ffmpeg.on('progress', onProgress);
      setTimeout(() => {
        if (!gotProgress) progBar.classList.add('indeterminate');
      }, 800);

      const inName = `clip_${i}`;
      const outName = `norm_${i}.mp4`;
      await ffmpeg.writeFile(inName, await fetchFile(file));

      const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,fps=${targetFps}`;
      try {
        await ffmpeg.exec([
          '-i', inName,
          '-vf', vf,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '2',
          outName
        ]);
      } catch (e) {
        await ffmpeg.exec([
          '-i', inName,
          '-vf', vf,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-an',
          outName
        ]);
      }
      intermediates.push(outName);
      await ffmpeg.deleteFile(inName);
      ffmpeg.off('progress', onProgress);
    }

    progressArea.innerHTML = `<div class="status">Joining clips...</div>
      <div class="progress-bar" id="jbar">
        <div class="progress-fill" id="jprog"></div>
        <div class="progress-text" id="jtxt">0%</div>
      </div>`;
    const listContent = intermediates.map(n => `file '${n}'`).join('\n');
    await ffmpeg.writeFile('list.txt', new TextEncoder().encode(listContent));

    const jFill = document.getElementById('jprog');
    const jText = document.getElementById('jtxt');
    const jBar = document.getElementById('jbar');
    let gotJoin = false;
    const onJoinProgress = ({ progress }) => {
      gotJoin = true;
      jBar.classList.remove('indeterminate');
      const pct = Math.round(progress * 100);
      jFill.style.width = pct + '%';
      jText.textContent = pct + '%';
    };
    ffmpeg.on('progress', onJoinProgress);
    setTimeout(() => {
      if (!gotJoin) jBar.classList.add('indeterminate');
    }, 600);

    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'list.txt',
      '-c', 'copy',
      'combined.mp4'
    ]);
    ffmpeg.off('progress', onJoinProgress);
    if (jFill) {
      jFill.style.width = '100%';
      jText.textContent = '100%';
      jBar.classList.remove('indeterminate');
    }

    const data = await ffmpeg.readFile('combined.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    outputs.appendChild(createShareButton(blob, 'combined.mp4'));
    progressArea.innerHTML = '<div class="status">Done</div>';

    for (const n of intermediates) await ffmpeg.deleteFile(n);
    await ffmpeg.deleteFile('list.txt');
    await ffmpeg.deleteFile('combined.mp4');
    await clearFS();
  } catch (err) {
    showError(progressArea, 'Combine failed: ' + (err.message || err));
  }
  startCombine.disabled = false;
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.getElementById('globalStatus').textContent = 'Tap a button to begin. Engine loads on first use.';