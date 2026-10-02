const recordButton = document.querySelector('#recordButton');
const recordLabel = document.querySelector('#recordLabel');
const statusText = document.querySelector('#statusText');
const statusDot = document.querySelector('#statusDot');
const timer = document.querySelector('#timer');
const historySection = document.querySelector('#historySection');
const history = document.querySelector('#history');
const rowCount = document.querySelector('#rowCount');
const downloads = document.querySelector('#downloads');
const downloadAudio = document.querySelector('#downloadAudio');
const downloadText = document.querySelector('#downloadText');
const pauseButton = document.querySelector('#pauseButton');
const errorBox = document.querySelector('#error');

// Longer chunks give Whisper enough context to finish a sentence and reduce
// both transcription and translation requests. The final chunk is sent on stop.
const SEGMENT_MS = 8000;
let stream;
let segmentRecorder;
let masterRecorder;
let segmentTimer;
let timerId;
let startedAt = 0;
let recording = false;
let paused = false;
let stopping = false;
let segmentIndex = 0;
let inFlight = 0;
let rows = new Map();
let masterChunks = [];
let audioBlob = null;
let segmentStartedAt = 0;
let segmentRemainingMs = SEGMENT_MS;
let pausedAt = 0;
let pausedTotalMs = 0;

function setStatus(text, active = false) {
  statusText.textContent = text;
  statusDot.classList.toggle('active', active);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function updateTimer() {
  const nowPausedMs = paused ? Date.now() - pausedAt : 0;
  const seconds = Math.floor((Date.now() - startedAt - pausedTotalMs - nowPausedMs) / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function sentenceLines(text) {
  return text.trim().replace(/(?<=[.!?。！？])\s+/g, '\n');
}

function renderHistory() {
  // 화면에서는 최신 대화를 위에 표시합니다.
  const orderedRows = [...rows.values()].sort((a, b) => b.index - a.index);
  history.innerHTML = orderedRows.map((row) => `
    <article class="conversation-row ${row.pending ? 'pending' : ''}">
      <div class="row-meta"><span>${row.time}</span><span>${row.pending ? '처리 중…' : '완료'}</span></div>
      <div class="english-line">${escapeHtml(sentenceLines(row.english || '음성을 분석하고 있습니다…'))}</div>
      <div class="korean-line">${escapeHtml(sentenceLines(row.korean || ''))}</div>
    </article>
  `).join('');
  rowCount.textContent = `${orderedRows.filter((row) => !row.pending).length}개 문장`;
  historySection.hidden = orderedRows.length === 0;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function maybeFinish() {
  if (!stopping || inFlight > 0) return;
  setStatus('번역 완료');
  downloads.hidden = !audioBlob && rows.size === 0;
}

async function sendSegment(blob, index, startedSeconds) {
  if (!blob.size) return;
  inFlight += 1;
  const formData = new FormData();
  formData.append('audio', blob, `segment-${index}.webm`);
  formData.append('segment_index', String(index));
  formData.append('started_at', String(startedSeconds));
  try {
    const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '번역에 실패했습니다.');
    if (data.english) {
      rows.set(index, { index, time: formatTime(startedSeconds), english: data.english, korean: data.korean, pending: false });
      renderHistory();
    } else {
      rows.delete(index);
      renderHistory();
    }
  } catch (error) {
    rows.set(index, { index, time: formatTime(startedSeconds), english: `처리 실패: ${error.message}`, korean: '', pending: false });
    renderHistory();
    if (recording) showError(error.message);
  } finally {
    inFlight -= 1;
    maybeFinish();
  }
}

function startSegment() {
  if (!recording || paused) return;
  segmentRecorder = new MediaRecorder(stream);
  const chunks = [];
  const currentIndex = segmentIndex++;
  const startedSeconds = (Date.now() - startedAt - pausedTotalMs) / 1000;
  segmentStartedAt = Date.now();
  segmentRemainingMs = SEGMENT_MS;
  segmentRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  segmentRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: segmentRecorder.mimeType || 'audio/webm' });
    if (recording && !paused) startSegment();
    sendSegment(blob, currentIndex, startedSeconds);
  };
  segmentRecorder.start();
  rows.set(currentIndex, { index: currentIndex, time: formatTime(startedSeconds), pending: true });
  renderHistory();
  segmentTimer = setTimeout(() => {
    if (segmentRecorder?.state === 'recording') segmentRecorder.stop();
  }, segmentRemainingMs);
}

async function startRecording() {
  errorBox.hidden = true;
  downloads.hidden = true;
  rows = new Map();
  renderHistory();
  masterChunks = [];
  audioBlob = null;
  segmentIndex = 0;
  paused = false;
  pausedAt = 0;
  pausedTotalMs = 0;
  stopping = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    masterRecorder = new MediaRecorder(stream);
    masterRecorder.ondataavailable = (event) => { if (event.data.size) masterChunks.push(event.data); };
    masterRecorder.onstop = () => {
      audioBlob = new Blob(masterChunks, { type: masterRecorder.mimeType || 'audio/webm' });
      maybeFinish();
    };
    masterRecorder.start();
    recording = true;
    startedAt = Date.now();
    timerId = setInterval(updateTimer, 250);
    startSegment();
    recordLabel.textContent = '녹음 종료';
    pauseButton.hidden = false;
    pauseButton.textContent = '일시정지';
    recordButton.classList.add('recording');
    setStatus('듣는 중… 문장별로 기록하는 중', true);
  } catch (_error) {
    showError('마이크 권한이 필요합니다. 브라우저 설정을 확인해 주세요.');
  }
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  stopping = true;
  clearTimeout(segmentTimer);
  clearInterval(timerId);
  timer.textContent = '00:00';
  recordLabel.textContent = '녹음 시작';
  recordButton.classList.remove('recording');
  pauseButton.hidden = true;
  if (segmentRecorder?.state === 'recording') segmentRecorder.stop();
  if (masterRecorder?.state === 'recording') masterRecorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  setStatus('마지막 문장을 처리 중입니다…');
  maybeFinish();
}

function togglePause() {
  if (!recording || stopping) return;
  if (!paused) {
    paused = true;
    pausedAt = Date.now();
    segmentRemainingMs = Math.max(1000, SEGMENT_MS - (Date.now() - segmentStartedAt));
    clearTimeout(segmentTimer);
    segmentRecorder?.pause();
    masterRecorder?.pause();
    pauseButton.textContent = '재개';
    setStatus('일시정지됨');
    return;
  }
  pausedTotalMs += Date.now() - pausedAt;
  paused = false;
  segmentRecorder?.resume();
  masterRecorder?.resume();
  pauseButton.textContent = '일시정지';
  setStatus('듣는 중… 문장별로 기록하는 중', true);
  segmentTimer = setTimeout(() => {
    if (segmentRecorder?.state === 'recording') segmentRecorder.stop();
  }, segmentRemainingMs);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

recordButton.addEventListener('click', () => {
  if (recording) stopRecording();
  else if (!navigator.mediaDevices?.getUserMedia) showError('이 브라우저에서는 마이크 녹음을 사용할 수 없습니다.');
  else startRecording();
});

pauseButton.addEventListener('click', togglePause);

downloadAudio.addEventListener('click', () => {
  if (audioBlob) download(`english-recording-${new Date().toISOString().slice(0, 10)}.webm`, audioBlob);
});

downloadText.addEventListener('click', () => {
  // 저장 파일은 실제 대화 흐름대로 시간순으로 정렬합니다.
  const content = [...rows.values()]
    .sort((a, b) => a.index - b.index)
    .filter((row) => !row.pending && row.english)
    .map((row) => `[${row.time}]\nEN: ${row.english}\nKO: ${row.korean}`)
    .join('\n\n');
  download(`conversation-${new Date().toISOString().slice(0, 10)}.txt`, new Blob([content], { type: 'text/plain;charset=utf-8' }));
});
