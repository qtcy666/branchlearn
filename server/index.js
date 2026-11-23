/* index.js —— 树学 AI 填充的 HTTP 入口
 * 零依赖，Node 18+。
 * 环境变量：
 *   FILL_API_KEY        必填（mock 模式除外）
 *   FILL_BASE_URL       默认 https://api.deepseek.com
 *   FILL_MODEL          默认 deepseek-flash
 *   FILL_PORT           默认 8787
 *   FILL_ORIGIN         允许的前端来源，默认 *
 *   FILL_LIMIT_PER_MIN  每 IP 每分钟次数，默认 5
 *   FILL_MOCK=1         返回固定数据，不调用模型
 */
"use strict";

const http = require("http");
const { fillTree, cfg } = require("./fill");

const PORT = Number(process.env.FILL_PORT || 8788);
const ORIGIN = process.env.FILL_ORIGIN || "*";
const MAX_BODY = 64 * 1024;
const LIMIT_PER_MIN = Math.max(1, Number(process.env.FILL_LIMIT_PER_MIN || 5));

/** 极简内存限流：云函数冷启动会重置，够挡住误触和短时刷量。 */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const record = hits.get(ip);
  if (!record || now > record.reset) {
    hits.set(ip, { count: 1, reset: now + 60000 });
    return false;
  }
  if (record.count >= LIMIT_PER_MIN) return true;
  record.count += 1;
  return false;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...corsHeaders(),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const e = new Error("请求体过大");
        e.status = 413;
        reject(e);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        const err = new Error("请求体不是合法 JSON");
        err.status = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && url === "/health") {
    const c = cfg();
    send(res, 200, { ok: true, model: c.model, mock: c.mock });
    return;
  }

  if (req.method !== "POST" || url !== "/fill") {
    send(res, 404, { error: "not_found", message: "只支持 POST /fill 与 GET /health" });
    return;
  }

  try {
    if (rateLimited(clientIp(req))) {
      send(res, 429, { error: "rate_limited", message: "用得太频繁了，等一分钟再试" });
      return;
    }

    const body = await readBody(req);
    const result = await fillTree({
      query: body.query,
      goal: body.goal,
      shape: body.shape,
    });
    send(res, 200, result);
  } catch (e) {
    const status = e.status && Number.isInteger(e.status) ? e.status : 502;
    const message = status === 502 ? "这次没生成成功，换个说法或稍后再试" : e.message;
    console.error("[fill]", status, e.message);
    send(res, status, {
      error: status === 422 ? "invalid_structure" : "fill_failed",
      message,
      errors: Array.isArray(e.details) ? e.details : [],
    });
  }
});

server.listen(PORT, () => {
  const c = cfg();
  console.log(`[fill] listening on http://localhost:${PORT}  model=${c.model}  mock=${c.mock}`);
  if (!c.mock && !c.key) console.warn("[fill] 警告：FILL_API_KEY 未配置，请求会失败。可用 FILL_MOCK=1 联调前端。");
});
