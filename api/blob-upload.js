import { handleUpload } from "@vercel/blob/client";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://l2636573915-art.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

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

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: "Origin not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!String(pathname || "").startsWith("audio/")) {
          throw new Error("只允许上传音频文件。请输入 audio/ 开头的路径。 ");
        }

        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp3",
            "audio/mp4",
            "audio/x-m4a",
            "audio/wav",
            "audio/x-wav",
            "audio/webm",
            "audio/ogg",
            "audio/aac",
            "video/mp4",
            "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_AUDIO_BYTES,
          addRandomSuffix: true,
          tokenPayload: String(clientPayload || "{}").slice(0, 2000),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("audio blob upload completed", blob?.pathname || blob?.url || "unknown");
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    const message = String(err?.message || err || "上传授权失败");
    console.error("blob-upload handler error", err);

    if (/BLOB|store|token|oidc/i.test(message)) {
      return res.status(503).json({
        error: "Vercel Blob 尚未连接到该项目，请先在 Vercel Storage 中创建并连接 Blob 存储。",
        code: "BLOB_NOT_CONFIGURED",
      });
    }

    return res.status(400).json({ error: message });
  }
}
