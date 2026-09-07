const form = document.querySelector("#workForm");
const activity = document.querySelector("#activity");
const processField = document.querySelector("#processField");
const processInput = document.querySelector("#process");
const errorBox = document.querySelector("#error");
const message = document.querySelector("#message");
const presetList = document.querySelector("#presetList");
const presetSearch = document.querySelector("#presetSearch");
const categoryTabs = document.querySelector("#categoryTabs");
const addRecordBtn = document.querySelector("#addRecordBtn");
const submittedHistory = document.querySelector("#submittedHistory");
const historyToggle = document.querySelector("#historyToggle");
const historyCount = document.querySelector("#historyCount");
const historyBody = document.querySelector("#historyBody");
const historyTable = document.querySelector("#historyTable");

const uploadAudioBtn = document.querySelector("#uploadAudioBtn");
const audioFileInput = document.querySelector("#audioFileInput");
const recordAudioBtn = document.querySelector("#recordAudioBtn");
const recordBtnText = document.querySelector("#recordBtnText");
const voiceStatus = document.querySelector("#voiceStatus");
const audioPreviewWrap = document.querySelector("#audioPreviewWrap");
const audioPreview = document.querySelector("#audioPreview");
const removeAudioBtn = document.querySelector("#removeAudioBtn");

const historyStorageKey = "timeFragmentSubmittedRecords";
const recordHeaders = [
  "部门岗位",
  "姓名",
  "任务编码",
  "业务域",
  "业务对象",
  "我在做什么",
  "我怎么做",
];

const savedRecords = [];
let submittedRecords = loadSubmittedRecords();
let activeCategory = "全部";
let selectedPreset = null;

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let recordingTimer = null;
let recordingStartedAt = 0;
let currentAudioUrl = "";

function escapeCell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resetStatus() {
  errorBox.textContent = "";
  message.classList.remove("show");
}

function setVoiceStatus(text, state = "") {
  voiceStatus.textContent = text;
  voiceStatus.classList.remove("active", "error-state");
  if (state) voiceStatus.classList.add(state);
}

function syncProcessField() {
  const hasActivity = activity.value.trim().length > 0;
  processField.hidden = !hasActivity;
  if (!hasActivity) processInput.value = "";
}

function renderCategories() {
  const categories = ["全部", ...new Set(presets.map((item) => item.category))];
  categoryTabs.innerHTML = categories
    .map(
      (category) =>
        `<button class="category-tab${category === activeCategory ? " active" : ""}" type="button" data-category="${escapeCell(category)}">${escapeCell(category)}</button>`,
    )
    .join("");
}

function renderPresets() {
  const keyword = presetSearch.value.trim().toLowerCase();
  const matched = presets.filter((item) => {
    const inCategory = activeCategory === "全部" || item.category === activeCategory;
    const text = `${item.code} ${item.category} ${item.object} ${item.task} ${item.description}`.toLowerCase();
    return inCategory && (!keyword || text.includes(keyword));
  });

  presetList.innerHTML = matched.length
    ? matched
        .map(
          (item) => `
            <button class="preset-option${selectedPreset?.code === item.code ? " selected" : ""}" type="button" data-code="${escapeCell(item.code)}">
              <span class="preset-code">${escapeCell(item.code)}</span>
              <span class="preset-tag">${escapeCell(item.category)}</span>
              <span class="preset-object">${escapeCell(item.object)}</span>
              <span class="preset-task">${escapeCell(item.task)}</span>
              <span class="preset-desc">${escapeCell(item.description)}</span>
            </button>
          `,
        )
        .join("")
    : `<div class="preset-empty">没有匹配的预置项，可以直接在上方输入框填写</div>`;
}

function selectActivity(item) {
  selectedPreset = item || null;
  activity.value = item ? `${item.category}>>${item.task}` : "";
  syncProcessField();
  renderPresets();
  if (item) {
    setTimeout(() => processInput.focus({ preventScroll: false }), 0);
  }
}

presetSearch.addEventListener("input", renderPresets);

categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderCategories();
  renderPresets();
});

presetList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-code]");
  if (!button) return;
  const item = presets.find((preset) => preset.code === button.dataset.code);
  if (item) selectActivity(item);
});

activity.addEventListener("input", () => {
  if (selectedPreset) {
    const expected = `${selectedPreset.category}>>${selectedPreset.task}`;
    if (activity.value !== expected) {
      selectedPreset = null;
      renderPresets();
    }
  }
  syncProcessField();
});

function getProfile() {
  return {
    部门岗位: document.querySelector("#departmentRole").value.trim(),
    姓名: document.querySelector("#personName").value.trim(),
  };
}

function getCurrentEntry() {
  return {
    ...getProfile(),
    任务编码: selectedPreset?.code || "",
    业务域: selectedPreset?.category || "",
    业务对象: selectedPreset?.object || "",
    我在做什么: activity.value.trim(),
    我怎么做: processInput.value.trim(),
  };
}

function validateProfile() {
  const departmentRole = document.querySelector("#departmentRole");
  const personName = document.querySelector("#personName");

  if (!departmentRole.value.trim()) {
    errorBox.textContent = "请填写部门岗位";
    departmentRole.focus();
    return false;
  }
  if (!personName.value.trim()) {
    errorBox.textContent = "请填写姓名";
    personName.focus();
    return false;
  }
  return true;
}

function validateEntry() {
  if (!activity.value.trim()) {
    errorBox.textContent = "请选择或填写“我在做什么”";
    activity.focus();
    return false;
  }
  if (!processInput.value.trim()) {
    errorBox.textContent = "请填写“我怎么做”";
    processInput.focus();
    return false;
  }
  return true;
}

function currentEntryHasContent() {
  return Boolean(activity.value.trim() || processInput.value.trim());
}

function clearEntry() {
  activity.value = "";
  processInput.value = "";
  selectedPreset = null;
  processField.hidden = true;
  renderPresets();
  clearAudioSelection();
}

function loadSubmittedRecords() {
  try {
    return JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
  } catch {
    return [];
  }
}

function saveSubmittedRecords() {
  try {
    localStorage.setItem(historyStorageKey, JSON.stringify(submittedRecords));
  } catch (err) {
    console.warn("无法保存本地历史记录，但不影响导出。", err);
  }
}

function renderSubmittedRecords() {
  const displayRecords = [...submittedRecords, ...savedRecords];
  submittedHistory.hidden = displayRecords.length === 0;
  historyCount.textContent = `${displayRecords.length} 条`;

  if (!displayRecords.length) {
    historyBody.hidden = true;
    historyToggle.setAttribute("aria-expanded", "false");
    historyTable.innerHTML = "";
    return;
  }

  historyTable.innerHTML = `
    <thead>
      <tr>${recordHeaders.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${displayRecords
        .map(
          (record) =>
            `<tr>${recordHeaders.map((header) => `<td>${escapeCell(record[header])}</td>`).join("")}</tr>`,
        )
        .join("")}
    </tbody>
  `;
}

historyToggle.addEventListener("click", () => {
  const shouldOpen = historyBody.hidden;
  historyBody.hidden = !shouldOpen;
  historyToggle.setAttribute("aria-expanded", String(shouldOpen));
});

function downloadRecords(records) {
  const rows = records
    .map(
      (record) =>
        `<tr>${recordHeaders.map((header) => `<td>${escapeCell(record[header])}</td>`).join("")}</tr>`,
    )
    .join("");

  const sheet = `<!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        table { border-collapse: collapse; font-family: Arial, "Microsoft YaHei", sans-serif; }
        th, td { border: 1px solid #b8c4d6; padding: 8px 10px; mso-number-format: "\\@"; }
        th { background: #eaf1fb; font-weight: 700; }
      </style>
    </head>
    <body>
      <table>
        <thead><tr>${recordHeaders.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`;

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const blob = new Blob(["\ufeff", sheet], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `时间碎片记录_${stamp}.xls`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

addRecordBtn.addEventListener("click", () => {
  resetStatus();
  if (!validateProfile() || !validateEntry()) return;

  savedRecords.push(getCurrentEntry());
  clearEntry();
  renderSubmittedRecords();
  message.textContent = `已添加 ${savedRecords.length} 条记录，可以继续填写下一条。`;
  message.classList.add("show");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  resetStatus();
  if (!validateProfile()) return;

  const records = [...savedRecords];
  if (currentEntryHasContent()) {
    if (!validateEntry()) return;
    records.push(getCurrentEntry());
  }

  if (!records.length) {
    errorBox.textContent = "请先填写或添加至少一条记录";
    activity.focus();
    return;
  }

  downloadRecords(records);
  submittedRecords = [...submittedRecords, ...records];
  saveSubmittedRecords();
  savedRecords.length = 0;
  clearEntry();
  renderSubmittedRecords();
  message.textContent = `已导出 ${records.length} 条记录，请查看浏览器下载列表或本地“下载”文件夹。`;
  message.classList.add("show");
});

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function stopRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

function stopMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function clearAudioSelection() {
  audioFileInput.value = "";
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = "";
  }
  audioPreview.removeAttribute("src");
  audioPreview.load();
  audioPreviewWrap.hidden = true;
  setVoiceStatus("录音或音频上传后，将在这里显示处理状态");
}

function showAudioPreview(file, sourceLabel) {
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(file);
  audioPreview.src = currentAudioUrl;
  audioPreviewWrap.hidden = false;
  const sizeMb = (file.size / 1024 / 1024).toFixed(1);
  setVoiceStatus(
    `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。前端已就绪，AI 转写接口接入后会自动整理并写入下方文本框。`,
    "active",
  );
}

function pickSupportedAudioMimeType() {
  if (!window.MediaRecorder) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

uploadAudioBtn.addEventListener("click", () => audioFileInput.click());

audioFileInput.addEventListener("change", () => {
  const file = audioFileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("audio/")) {
    setVoiceStatus("请选择音频文件，例如 MP3、M4A、WAV、WebM。", "error-state");
    audioFileInput.value = "";
    return;
  }
  showAudioPreview(file, "已选择录音");
});

recordAudioBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setVoiceStatus("当前浏览器不支持网页录音，请使用“上传录音”。", "error-state");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    const mimeType = pickSupportedAudioMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      stopRecordingTimer();
      stopMediaStream();
      recordAudioBtn.classList.remove("recording");
      recordBtnText.textContent = "开始录音";

      const finalType = mediaRecorder?.mimeType || recordedChunks[0]?.type || "audio/webm";
      const ext = finalType.includes("ogg") ? "ogg" : finalType.includes("mp4") ? "m4a" : "webm";
      const blob = new Blob(recordedChunks, { type: finalType });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = new File([blob], `现场录音_${stamp}.${ext}`, { type: finalType });
      showAudioPreview(file, "现场录音完成");
      recordedChunks = [];
      mediaRecorder = null;
    });

    mediaRecorder.start();
    recordingStartedAt = Date.now();
    recordAudioBtn.classList.add("recording");
    recordBtnText.textContent = "停止录音";
    setVoiceStatus("正在录音 00:00，完成后点击“停止录音”。", "active");

    recordingTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
      setVoiceStatus(`正在录音 ${formatDuration(seconds)}，完成后点击“停止录音”。`, "active");
    }, 1000);
  } catch (err) {
    stopRecordingTimer();
    stopMediaStream();
    mediaRecorder = null;
    recordAudioBtn.classList.remove("recording");
    recordBtnText.textContent = "开始录音";
    setVoiceStatus("无法使用麦克风，请检查浏览器麦克风权限，或改用“上传录音”。", "error-state");
    console.warn(err);
  }
});

removeAudioBtn.addEventListener("click", clearAudioSelection);

window.addEventListener("beforeunload", () => {
  stopRecordingTimer();
  stopMediaStream();
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
});

renderCategories();
renderPresets();
renderSubmittedRecords();
syncProcessField();
