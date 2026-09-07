const form = document.querySelector("#workForm");
const activity = document.querySelector("#activity");
const activityTrigger = document.querySelector("#activityTrigger");
const businessObject = document.querySelector("#businessObject");
const error = document.querySelector("#error");
const message = document.querySelector("#message");
const presetPanel = document.querySelector("#presetPanel");
const presetList = document.querySelector("#presetList");
const presetSearch = document.querySelector("#presetSearch");
const categoryTabs = document.querySelector("#categoryTabs");
const closePreset = document.querySelector("#closePreset");
const customPreset = document.querySelector("#customPreset");
const addRecordBtn = document.querySelector("#addRecordBtn");
const submittedHistory = document.querySelector("#submittedHistory");
const historyToggle = document.querySelector("#historyToggle");
const historyCount = document.querySelector("#historyCount");
const historyBody = document.querySelector("#historyBody");
const historyTable = document.querySelector("#historyTable");
const savedRecords = [];
const historyStorageKey = "timeFragmentSubmittedRecords";
const recordHeaders = [
  "部门岗位", "姓名", "开始时间", "结束时间", "我在做什么", "业务对象",
  "任务怎么来的", "怎么处理", "工具", "异常", "找人等待", "最后怎么结束", "业务流简要概述",
];
let submittedRecords = loadSubmittedRecords();
const entryFields = [
  "startTime", "endTime", "activity", "businessObject", "source", "handling",
  "tool", "exception", "waiting", "ending", "businessFlow",
].map((id) => document.querySelector(`#${id}`));

const visiblePresets = presets.filter(
  (item) => item.category !== "其他" && item.task !== "其他未列明工作",
);

let activeCategory = "全部";
let presetReturnTarget = activity;

function selectActivity(item) {
  const activityLabel = item ? `${item.category}>>${item.task}` : "";
  activity.value = activityLabel;
  if (item) businessObject.value = item.object;
  closePresetPanel();
}

function openPresetPanel(focusTarget = activity) {
  presetReturnTarget = focusTarget;
  presetPanel.hidden = false;
  activityTrigger.setAttribute("aria-expanded", "true");
  presetSearch.focus();
  renderPresets();
}

function closePresetPanel(focusTarget = presetReturnTarget) {
  presetPanel.hidden = true;
  activityTrigger.setAttribute("aria-expanded", "false");
  focusTarget.focus();
}

function chooseCustomActivity() {
  activity.value = "";
  closePresetPanel(activity);
}

function renderCategories() {
  const categories = ["全部", ...new Set(visiblePresets.map((item) => item.category))];
  categoryTabs.innerHTML = categories
    .map((category) => `<button class="category-tab${category === activeCategory ? " active" : ""}" type="button" data-category="${category}">${category}</button>`)
    .join("");
}

function renderPresets() {
  const keyword = presetSearch.value.trim().toLowerCase();
  const matched = visiblePresets.filter((item) => {
    const inCategory = activeCategory === "全部" || item.category === activeCategory;
    const text = `${item.category} ${item.object} ${item.task} ${item.description}`.toLowerCase();
    return inCategory && (!keyword || text.includes(keyword));
  });

  presetList.innerHTML = matched.length === 0
    ? `<div class="preset-empty">没有匹配的预置项，可以选择自己填写</div>`
    : matched.map((item) => `
      <button class="preset-option" type="button" data-index="${presets.indexOf(item)}">
        <span class="preset-tag">${item.category}</span>
        <span class="preset-object">${item.object}</span>
        <span class="preset-main">
          <span class="preset-task">${item.task}</span>
          <span class="preset-desc">${item.description}</span>
        </span>
      </button>`).join("");
}

activityTrigger.addEventListener("click", () => openPresetPanel(activity));
closePreset.addEventListener("click", () => closePresetPanel());
customPreset.addEventListener("click", chooseCustomActivity);
presetSearch.addEventListener("input", renderPresets);

categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderCategories();
  renderPresets();
});

presetList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-index]");
  if (!button) return;
  selectActivity(presets[Number(button.dataset.index)]);
});

presetPanel.addEventListener("click", (event) => {
  if (event.target === presetPanel) closePresetPanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !presetPanel.hidden) closePresetPanel();
});

historyToggle.addEventListener("click", () => {
  const shouldOpen = historyBody.hidden;
  historyBody.hidden = !shouldOpen;
  historyToggle.setAttribute("aria-expanded", String(shouldOpen));
});

renderCategories();
renderPresets();
renderSubmittedRecords();

function clearEntry() {
  entryFields.forEach((field) => { field.value = ""; });
}

function currentEntryHasContent() {
  return entryFields.some((field) => field.value.trim());
}

function getProfile() {
  return {
    部门岗位: document.querySelector("#departmentRole").value.trim(),
    姓名: document.querySelector("#personName").value.trim(),
  };
}

function getCurrentEntry() {
  return {
    ...getProfile(),
    开始时间: document.querySelector("#startTime").value,
    结束时间: document.querySelector("#endTime").value,
    我在做什么: activity.value.trim(),
    业务对象: document.querySelector("#businessObject").value.trim(),
    任务怎么来的: document.querySelector("#source").value.trim(),
    怎么处理: document.querySelector("#handling").value.trim(),
    工具: document.querySelector("#tool").value.trim(),
    异常: document.querySelector("#exception").value.trim() || "无",
    找人等待: document.querySelector("#waiting").value.trim() || "无",
    最后怎么结束: document.querySelector("#ending").value.trim(),
    业务流简要概述: document.querySelector("#businessFlow").value.trim(),
  };
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadSubmittedRecords() {
  try {
    return JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
  } catch {
    return [];
  }
}

function saveSubmittedRecords() {
  localStorage.setItem(historyStorageKey, JSON.stringify(submittedRecords));
}

function renderSubmittedRecords() {
  const displayRecords = [...submittedRecords, ...savedRecords];
  submittedHistory.hidden = displayRecords.length === 0;
  historyCount.textContent = `${displayRecords.length} 条`;
  if (displayRecords.length === 0) {
    historyBody.hidden = true;
    historyToggle.setAttribute("aria-expanded", "false");
    historyTable.innerHTML = "";
    return;
  }

  historyTable.innerHTML = `
    <thead><tr>${recordHeaders.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr></thead>
    <tbody>${displayRecords.map((record) => `<tr>${recordHeaders.map((header) => `<td>${escapeCell(record[header])}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function downloadRecords(records) {
  const rows = records.map((record) => `<tr>${recordHeaders.map((header) => `<td>${escapeCell(record[header])}</td>`).join("")}</tr>`).join("");
  const sheet = `<!doctype html>
    <html><head><meta charset="UTF-8" />
    <style>table { border-collapse: collapse; font-family: Arial, "Microsoft YaHei", sans-serif; } th, td { border: 1px solid #b8c4d6; padding: 8px 10px; mso-number-format: "\\@"; } th { background: #eaf1fb; font-weight: 700; }</style>
    </head><body><table><thead><tr>${recordHeaders.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const now = new Date();
  const stamp = [
    now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), "_",
    String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const blob = new Blob([sheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `时间碎片记录_${stamp}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function validateProfile() {
  const departmentRole = document.querySelector("#departmentRole");
  const personName = document.querySelector("#personName");
  if (!departmentRole.value.trim()) {
    error.textContent = "请填写部门岗位";
    departmentRole.focus();
    return false;
  }
  if (!personName.value.trim()) {
    error.textContent = "请填写姓名";
    personName.focus();
    return false;
  }
  return true;
}

function validateEntry() {
  const firstInvalid = entryFields.find((field) => field.required && !field.value.trim());
  if (firstInvalid) {
    error.textContent = "请补全当前记录的必填项";
    firstInvalid.focus();
    return false;
  }

  const startTime = document.querySelector("#startTime");
  const endTime = document.querySelector("#endTime");
  if (startTime.value >= endTime.value) {
    error.textContent = "结束时间需要晚于开始时间";
    endTime.focus();
    return false;
  }
  return true;
}

function resetStatus() {
  error.textContent = "";
  message.classList.remove("show");
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

  if (records.length === 0) {
    error.textContent = "请先填写或添加至少一条记录";
    document.querySelector("#startTime").focus();
    return;
  }

  submittedRecords = [...submittedRecords, ...records];
  saveSubmittedRecords();
  downloadRecords(records);
  savedRecords.length = 0;
  clearEntry();
  renderSubmittedRecords();
  message.textContent = `已提交 ${records.length} 条记录，表格已下载。`;
  message.classList.add("show");
});
