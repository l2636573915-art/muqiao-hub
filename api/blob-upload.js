import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned } from "@vercel/blob/client";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;
const ALLOWED_CONTENT_TYPES = [
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
];

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

function getBlobAuthOptions() {
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  const legacyToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (oidcToken && storeId) {
    return { oidcToken, storeId };
  }

  if (legacyToken) {
    return { token: legacyToken };
  }

  const error = new Error(
    "Vercel Blob OIDC 凭证不可用。请确认 Blob 已连接到当前项目，并重新部署 Production。",
  );
  error.code = "BLOB_OIDC_NOT_AVAILABLE";
  throw error;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: "Origin not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (!process.env.BLOB_WEBHOOK_PUBLIC_KEY) {
      const error = new Error(
        "缺少 BLOB_WEBHOOK_PUBLIC_KEY。请确认 Blob 已连接到当前 Vercel 项目并重新部署。",
      );
      error.code = "BLOB_WEBHOOK_KEY_MISSING";
      throw error;
    }

    const jsonResponse = await handleUploadPresigned({
      body,
      request: req,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
      getSignedToken: async (pathname, clientPayload) => {
        const safePathname = String(pathname || "");
        if (!safePathname.startsWith("audio/")) {
          const error = new Error("只允许上传 audio/ 目录下的音频文件。");
          error.code = "INVALID_AUDIO_PATH";
          throw error;
        }

        const authOptions = getBlobAuthOptions();
        const token = await issueSignedToken({
          pathname: safePathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_AUDIO_BYTES,
          validUntil: Date.now() + TOKEN_TTL_MS,
          ...authOptions,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_AUDIO_BYTES,
            validUntil: Date.now() + UPLOAD_URL_TTL_MS,
            addRandomSuffix: true,
            allowOverwrite: false,
            tokenPayload: String(clientPayload || "{}").slice(0, 2000),
          },
        };
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    const message = String(err?.message || err || "上传授权失败");
    const code = String(err?.code || "");
    console.error("blob-upload presigned handler error", {
      code,
      message,
      hasOidcToken: Boolean(process.env.VERCEL_OIDC_TOKEN),
      hasStoreId: Boolean(process.env.BLOB_STORE_ID),
      hasWebhookPublicKey: Boolean(process.env.BLOB_WEBHOOK_PUBLIC_KEY),
      hasLegacyToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });

    if (
      code === "BLOB_OIDC_NOT_AVAILABLE" ||
      code === "BLOB_WEBHOOK_KEY_MISSING" ||
      /store|token|oidc|webhook public key/i.test(message)
    ) {
      return res.status(503).json({
        error: message,
        code: code || "BLOB_OIDC_NOT_AVAILABLE",
      });
    }

    if (code === "INVALID_AUDIO_PATH") {
      return res.status(400).json({ error: message, code });
    }

    return res.status(400).json({ error: message, code: code || "BLOB_UPLOAD_AUTH_FAILED" });
  }
}
