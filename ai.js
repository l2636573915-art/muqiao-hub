(() => {
  const AI_API_BASE = String(window.MUQIAO_AI_API_BASE || "").replace(/\/$/, "");
  const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
  const BLOB_CLIENT_URL = "https://esm.sh/@vercel/blob@2.8.0/client";
  let aiRequestController = null;
  let blobClientPromise = null;

  function selectedTaskContext() {
    return {
      taskCode: selectedPreset?.code || "",
      category: selectedPreset?.category || "",
      businessObject: selectedPreset?.object || "",
      taskName: selectedPreset?.task || "",
      activity: activity.value.trim(),
    };
  }

  function inferAudioType(file) {
    if (file.type) return file.type;
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".mp3")) return "audio/mpeg";
    if (name.endsWith(".m4a") || name.endsWith(".mp4")) return "audio/mp4";
    if (name.endsWith(".wav")) return "audio/wav";
    if (name.endsWith(".ogg")) return "audio/ogg";
    if (name.endsWith(".aac")) return "audio/aac";
    if (name.endsWith(".webm")) return "audio/webm";
    return "application/octet-stream";
  }

  function safeUploadName(file) {
    const raw = String(file.name || "recording.webm")
      .replace(/[\\/:*?"<>|\r\n]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 120);
    return `audio/${Date.now()}_${raw || "recording.webm"}`;
  }

  async function loadBlobClient() {
    if (!blobClientPromise) {
      blobClientPromise = import(BLOB_CLIENT_URL);
    }
    return blobClientPromise;
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

  async function uploadAudioToBlob(file, context, signal) {
    setVoiceStatus("正在准备上传录音…", "active");

    const { upload } = await loadBlobClient();
    const contentType = inferAudioType(file);
    const uploadFile = file.type
      ? file
      : new File([file], file.name || "recording.webm", {
          type: contentType,
          lastModified: file.lastModified || Date.now(),
        });

    const blob = await upload(safeUploadName(uploadFile), uploadFile, {
      access: "private",
      handleUploadUrl: `${AI_API_BASE}/api/blob-upload`,
      contentType,
      clientPayload: JSON.stringify(context),
      multipart: uploadFile.size > 5 * 1024 * 1024,
      abortSignal: signal,
      onUploadProgress(progress) {
        const percent = Number(progress?.percentage);
        if (Number.isFinite(percent)) {
          setVoiceStatus(`正在上传录音 ${Math.max(0, Math.min(100, Math.round(percent)))}%…`, "active");
        } else {
          setVoiceStatus("正在上传录音…", "active");
        }
      },
    });

    return {
      blobUrl: blob.url,
      pathname: blob.pathname,
      fileName: uploadFile.name || "recording.webm",
      mimeType: contentType,
    };
  }

  async function transcribeAndOrganize(file) {
    if (aiRequestController) aiRequestController.abort();
    aiRequestController = new AbortController();
    const { signal } = aiRequestController;

    try {
      const context = selectedTaskContext();
      const uploaded = await uploadAudioToBlob(file, context, signal);

      setVoiceStatus("录音上传完成，正在 AI 转写…", "active");
      const transcribed = await requestJson(`${AI_API_BASE}/api/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...uploaded,
          ...context,
        }),
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

      let detail = err?.message || "AI 转写失败，请稍后重试。";
      if (err?.code === "OPENAI_API_KEY_MISSING") {
        detail = "AI 后端已经部署，但还没有配置 OpenAI API Key。";
      } else if (err?.code === "BLOB_NOT_CONFIGURED") {
        detail = "20MB 上传功能已经接好，但 Vercel Blob 还没有连接到后端项目。请先创建并连接 Blob 存储。";
      }

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
        `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。文件超过 20MB，请缩短录音或压缩后再试。`,
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
      `${sourceLabel}：${file.name || "录音"}（${sizeMb} MB）。准备上传并自动转写…`,
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
