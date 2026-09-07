(() => {
  const AI_API_BASE = String(window.MUQIAO_AI_API_BASE || "").replace(/\/$/, "");
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
  let aiRequestController = null;

  function selectedTaskContext() {
    return {
      taskCode: selectedPreset?.code || "",
      category: selectedPreset?.category || "",
      businessObject: selectedPreset?.object || "",
      taskName: selectedPreset?.task || "",
      activity: activity.value.trim(),
    };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload?.error || `请求失败（${response.status}）`);
      err.code = payload?.code || "";
      throw err;
    }
    return payload;
  }

  async function transcribeAndOrganize(file) {
    if (aiRequestController) aiRequestController.abort();
    aiRequestController = new AbortController();
    const { signal } = aiRequestController;

    try {
      const context = selectedTaskContext();
      const formData = new FormData();
      formData.append("audio", file, file.name || "recording.webm");
      Object.entries(context).forEach(([key, value]) => formData.append(key, value));

      setVoiceStatus("正在转写录音，请稍候…", "active");
      const transcribed = await requestJson(`${AI_API_BASE}/api/transcribe`, {
        method: "POST",
        body: formData,
        signal,
      });

      setVoiceStatus("录音已转写，正在整理成清晰的操作步骤…", "active");
      const organized = await requestJson(`${AI_API_BASE}/api/organize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcribed.transcript,
          ...context,
        }),
        signal,
      });

      processInput.value = organized.processText || "";
      processInput.dispatchEvent(new Event("input", { bubbles: true }));
      setVoiceStatus("AI 已完成转写和整理，结果已自动填入“我怎么做”，你可以继续修改。", "active");
      processInput.focus();
    } catch (err) {
      if (err?.name === "AbortError") return;
      const detail = err?.code === "OPENAI_API_KEY_MISSING"
        ? "AI 后端已经部署，但还没有配置 OpenAI API Key。"
        : (err?.message || "AI 转写失败，请稍后重试。");
      setVoiceStatus(detail, "error-state");
      console.warn("AI 转写/整理失败：", err);
    } finally {
      aiRequestController = null;
    }
  }

  const originalShowAudioPreview = showAudioPreview;
  showAudioPreview = async function enhancedShowAudioPreview(file, sourceLabel) {
    originalShowAudioPreview(file, sourceLabel);

    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    if (file.size > MAX_AUDIO_BYTES) {
      setVoiceStatus(
        `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。文件超过 4MB，请缩短录音或压缩后再试。`,
        "error-state",
      );
      return;
    }

    if (!AI_API_BASE) {
      setVoiceStatus(
        `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。AI 后端地址尚未配置。`,
        "error-state",
      );
      return;
    }

    setVoiceStatus(
      `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。正在上传并转写…`,
      "active",
    );
    await transcribeAndOrganize(file);
  };

  removeAudioBtn.addEventListener("click", () => {
    if (aiRequestController) {
      aiRequestController.abort();
      aiRequestController = null;
    }
  });
})();
