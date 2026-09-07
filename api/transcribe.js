import fs from "node:fs/promises";
import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false,
  },
};

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

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: "Origin not allowed" });
  if (!withinRateLimit(req)) return res.status(429).json({ error: "请求过于频繁，请稍后再试。" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI 服务尚未配置 OPENAI_API_KEY。",
      code: "OPENAI_API_KEY_MISSING",
    });
  }

  try {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 4 * 1024 * 1024,
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);
    const rawAudio = files.audio;
    const audio = Array.isArray(rawAudio) ? rawAudio[0] : rawAudio;

    if (!audio) return res.status(400).json({ error: "没有收到录音文件。" });

    const buffer = await fs.readFile(audio.filepath);
    const mimeType = audio.mimetype || "audio/webm";
    const fileName = audio.originalFilename || "recording.webm";

    const activity = String(firstValue(fields.activity)).slice(0, 300);
    const taskCode = String(firstValue(fields.taskCode)).slice(0, 60);
    const category = String(firstValue(fields.category)).slice(0, 120);
    const businessObject = String(firstValue(fields.businessObject)).slice(0, 120);
    const taskName = String(firstValue(fields.taskName)).slice(0, 160);

    const context = [
      taskCode && `任务编码：${taskCode}`,
      category && `业务域：${category}`,
      businessObject && `业务对象：${businessObject}`,
      taskName && `预置任务：${taskName}`,
      activity && `当前任务：${activity}`,
    ].filter(Boolean).join("；");

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
      return res.status(502).json({
        error: payload?.error?.message || "录音转写失败，请稍后重试。",
        code: "TRANSCRIPTION_FAILED",
      });
    }

    const transcript = String(payload.text || "").trim();
    if (!transcript) {
      return res.status(422).json({ error: "没有识别到有效语音内容。" });
    }

    return res.status(200).json({ transcript });
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");
    if (/maxFileSize|maxTotalFileSize|too large/i.test(message)) {
      return res.status(413).json({ error: "录音文件过大，请控制在 4MB 以内。" });
    }
    console.error("transcribe handler error", err);
    return res.status(500).json({ error: "录音处理失败，请稍后重试。" });
  }
}
