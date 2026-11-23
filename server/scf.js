"use strict";

/**
 * scf.js —— 腾讯云函数（SCF）入口。
 * 部署：新建云函数 → Node.js 18+ → 上传本目录 → 执行方法 scf.main_handler
 *       → 超时时间调到 60 秒 → 环境变量填 FILL_API_KEY → 开启函数 URL（POST，免鉴权）。
 */

const { cfg, fillTree } = require("./fill");

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": process.env.FILL_ALLOW_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function readBody(event) {
  if (!event) return {};
  if (typeof event === "string") return JSON.parse(event || "{}");
  if (!event.body) return {};
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(text || "{}");
}

exports.main_handler = async (event) => {
  const method =
    (event && (event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method))) ||
    "POST";

  if (String(method).toUpperCase() === "OPTIONS") {
    return respond(200, { ok: true });
  }

  const path =
    (event && (event.path || (event.requestContext && event.requestContext.path))) || "/fill";

  if (String(path).includes("/health")) {
    const c = cfg();
    return respond(200, {
      ok: true,
      model: c.model,
      baseUrl: c.baseUrl,
      keySet: Boolean(c.key),
    });
  }

  let body;
  try {
    body = readBody(event);
  } catch {
    return respond(400, { error: "请求体不是合法 JSON" });
  }

  try {
    const result = await fillTree(body);
    return respond(200, result);
  } catch (e) {
    const message = (e && e.message) || String(e);
    const code = (e && e.status) || 502;
    return respond(code, {
      error: message,
      errors: (e && e.errors) || undefined,
    });
  }
};
