import fs from "node:fs/promises";
import formidable from "formidable";
import { del, get } from "@vercel/blob";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const LEGACY_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://l2636573915-art.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

const buckets = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin || "";
  return !origin || ALLOWED_ORIGINS.has(origin) || origin.endsWith(".vercel.app");
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function withinRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.startedAt > WINDOW_MS) {
    buckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isTrustedBlobUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".blob.vercel-storage.com") ||
        url.hostname.endsWith(".private.blob.vercel-storage.com")) &&
      url.pathname.includes("/audio/")
    );
  } catch {
    return false;
  }
}

function safeFileName(value, fallback = "recording.webm") {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .slice(0, 180) || fallback;
}

function buildContext(fields) {
  const activity = String(firstValue(fields.activity)).slice(0, 300);
  const taskCode = String(firstValue(fields.taskCode)).slice(0, 60);
  const category = String(firstValue(fields.category)).slice(0, 120);
  const businessObject = String(firstValue(fields.businessObject)).slice(0, 120);
  const taskName = String(firstValue(fields.taskName)).slice(0, 160);

  return [
    taskCode && `任务编码：${taskCode}`,
    category && `业务域：${category}`,
    businessObject && `业务对象：${businessObject}`,
    taskName && `预置任务：${taskName}`,
    activity && `当前任务：${activity}`,
  ].filter(Boolean).join("；");
}

async function callOpenAI({ apiKey, buffer, mimeType, fileName, context }) {
  const openaiForm = new FormData();
  openaiForm.append("file", new Blob([buffer], { type: mimeType }), fileName);
  openaiForm.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
  openaiForm.append("language", "zh");
  openaiForm.append("response_format", "json");

  if (context) {
    openaiForm.append(
      "prompt",
      `这是一段中文物流客服业务操作口述。请准确识别物流、报关、提单、订舱、港前、清关、派送等业务术语。上下文：${context}`,
    );
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: openaiForm,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("OpenAI transcription error", response.status, payload);
    const error = new Error(payload?.error?.message || "录音转写失败，请稍后重试。");
    error.code = "TRANSCRIPTION_FAILED";
    throw error;
  }

  const transcript = String(payload.text || "").trim();
  if (!transcript) {
    const error = new Error("没有识别到有效语音内容。");
    error.code = "EMPTY_TRANSCRIPT";
    throw error;
  }

  return transcript;
}

async function transcribeFromBlob(body, apiKey) {
  const blobUrl = String(body.blobUrl || "");
  if (!isTrustedBlobUrl(blobUrl)) {
    const error = new Error("录音文件地址无效。");
    error.code = "INVALID_BLOB_URL";
    throw error;
  }

  let result;
  try {
    result = await get(blobUrl, { access: "private", useCache: false });
  } catch (err) {
    const error = new Error("无法读取录音文件，请确认 Vercel Blob 已连接到项目。");
    error.code = "BLOB_NOT_CONFIGURED";
    error.cause = err;
    throw error;
  }

  if (!result || result.statusCode !== 200) {
    const error = new Error("没有找到刚刚上传的录音文件。");
    error.code = "BLOB_NOT_FOUND";
    throw error;
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
    const error = new Error("录音文件超过 20MB，请缩短录音或压缩后再试。");
    error.code = "AUDIO_TOO_LARGE";
    throw error;
  }

  const mimeType = String(body.mimeType || result.blob?.contentType || "audio/webm");
  const fileName = safeFileName(body.fileName || result.blob?.pathname?.split("/").pop());
  const context = buildContext(body);

  return callOpenAI({
    apiKey,
    buffer: arrayBuffer,
    mimeType,
    fileName,
    context,
  });
}

async function transcribeLegacyUpload(req, apiKey) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: LEGACY_MAX_AUDIO_BYTES,
    allowEmptyFiles: false,
  });

  const [fields, files] = await form.parse(req);
  const rawAudio = files.audio;
  const audio = Array.isArray(rawAudio) ? rawAudio[0] : rawAudio;
  if (!audio) {
    const error = new Error("没有收到录音文件。");
    error.code = "AUDIO_MISSING";
    throw error;
  }

  const buffer = await fs.readFile(audio.filepath);
  const mimeType = audio.mimetype || "audio/webm";
  const fileName = safeFileName(audio.originalFilename || "recording.webm");
  const context = buildContext(fields);

  return callOpenAI({ apiKey, buffer, mimeType, fileName, context });
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: "Origin not allowed" });
  if (!withinRateLimit(req)) return res.status(429).json({ error: "请求过于频繁，请稍后再试。" });

  const contentType = String(req.headers["content-type"] || "");
  let cleanupBlobUrl = "";

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (contentType.includes("application/json")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      const body = JSON.parse(raw);
      cleanupBlobUrl = String(body.blobUrl || "");

      if (!apiKey) {
        if (isTrustedBlobUrl(cleanupBlobUrl)) {
          await del(cleanupBlobUrl).catch(() => {});
        }
        return res.status(503).json({
          error: "AI 服务尚未配置 OPENAI_API_KEY。",
          code: "OPENAI_API_KEY_MISSING",
        });
      }

      const transcript = await transcribeFromBlob(body, apiKey);
      return res.status(200).json({ transcript });
    }

    if (!apiKey) {
      return res.status(503).json({
        error: "AI 服务尚未配置 OPENAI_API_KEY。",
        code: "OPENAI_API_KEY_MISSING",
      });
    }

    const transcript = await transcribeLegacyUpload(req, apiKey);
    return res.status(200).json({ transcript });
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");
    const code = String(err?.code || "");

    if (/maxFileSize|maxTotalFileSize|too large/i.test(message) || code === "AUDIO_TOO_LARGE") {
      return res.status(413).json({ error: code === "AUDIO_TOO_LARGE" ? message : "旧版直传仅支持 4MB；请刷新页面使用新版 20MB 上传方式。", code: code || "AUDIO_TOO_LARGE" });
    }

    if (code === "BLOB_NOT_CONFIGURED") {
      console.error("blob read error", err?.cause || err);
      return res.status(503).json({ error: message, code });
    }

    if (code === "INVALID_BLOB_URL" || code === "BLOB_NOT_FOUND" || code === "AUDIO_MISSING") {
      return res.status(400).json({ error: message, code });
    }

    if (code === "EMPTY_TRANSCRIPT") {
      return res.status(422).json({ error: message, code });
    }

    if (code === "TRANSCRIPTION_FAILED") {
      return res.status(502).json({ error: message, code });
    }

    console.error("transcribe handler error", err);
    return res.status(500).json({ error: "录音处理失败，请稍后重试。" });
  } finally {
    if (isTrustedBlobUrl(cleanupBlobUrl)) {
      await del(cleanupBlobUrl).catch((err) => {
        console.warn("Failed to delete temporary audio blob", err);
      });
    }
  }
}
