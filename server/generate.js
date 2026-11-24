/* generate.js —— 阶段 2：真模型生成 + 契约校验 + 重试 + 缓存
 *
 * 与 fill.js 的区别：
 * - 输出阶段 0 的契约树（version/root），不是旧模板结构；
 * - 不联网检索，用 json_object 强约束，降低解析失败率；
 * - 校验失败把 errors 回喂模型，最多重试 2 次；
 * - 成功结果缓存 10 分钟，避免同一主题反复花钱。
 *
 * 零依赖，Node 18+。
 */
"use strict";

const { validateTree } = require("./schema");

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const TIMEOUT_MS = 50000;
const MAX_RETRY = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map();

function cfg() {
  return {
    key: process.env.AI_API_KEY || process.env.FILL_API_KEY || "",
    baseUrl: (process.env.AI_BASE_URL || process.env.FILL_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ""),
    model: process.env.AI_MODEL || process.env.FILL_MODEL || DEFAULT_MODEL,
    mock: process.env.AI_MOCK === "1" || process.env.FILL_MOCK === "1",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- mock：结构与前端 buildMockTree 保持一致 ---------- */

const MOCK_OUTLINE = [
  ["行列式", ["二阶与三阶行列式", "全排列与对换", "行列式的性质", "行列式按行展开", "克拉默法则"]],
  ["矩阵", ["矩阵的线性运算", "矩阵的乘法", "逆矩阵", "分块矩阵", "矩阵的秩"]],
  ["线性方程组", ["初等变换与初等矩阵", "齐次线性方程组", "非齐次线性方程组", "解的结构"]],
  ["向量组", ["线性相关与无关", "向量组的秩", "向量空间", "基与维数"]],
  ["二次型", ["特征值与特征向量", "相似矩阵与对角化", "二次型及其标准形", "正定二次型"]],
];

function short(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

function buildMockTree(topic) {
  const toNode = (title, path) => ({
    id: path === "" ? "root" : `n-${path}`,
    title: short(title, 14),
    summary: "",
    meta: { progress: "0/0" },
    children: [],
  });

  const root = toNode(short(topic, 14) || "未命名课程", "");
  root.summary = "AI 生成草稿";
  root.children = MOCK_OUTLINE.map(([chapter, points], chapterIndex) => {
    const chapterNode = toNode(chapter, String(chapterIndex));
    chapterNode.children = points.map((point, pointIndex) =>
      toNode(point, `${chapterIndex}-${pointIndex}`),
    );
    return chapterNode;
  });

  return { version: 1, root };
}

/* ---------- 提示词 ---------- */

function buildMessages(topic, goal, errors) {
  const system = [
    "你是课程大纲生成器，只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。",
    "结构必须是：",
    '{"version":1,"root":{"id":"root","title":"课程名","summary":"一句话目标","meta":{"progress":"0/0"},"children":[{"id":"n-0","title":"章名","summary":"","meta":{"progress":"0/0"},"children":[]}]}}',
    "约束：",
    "- 固定 3 层：课程 → 章 → 知识点，总共 20–35 个节点；",
    "- 每个节点最多 8 个子节点；",
    "- title 不超过 14 个汉字，不带「第一章」「1.」这类编号；",
    "- summary 不超过 20 个汉字，可以为空字符串；",
    "- id 只能用小写字母、数字、连字符，且全局唯一；",
    "- 章名用教材通用名称，知识点要具体到能单独打勾。",
  ].join("\n");

  const user = [
    `课程：${topic}`,
    `目标：${goal || "系统学习"}`,
    errors && errors.length
      ? `上次输出有以下问题，请逐条修正后重新输出完整 JSON：\n- ${errors.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

/* ---------- 模型调用 ---------- */

async function callModel(topic, goal, errors) {
  const c = cfg();
  if (!c.key) {
    const e = new Error("服务端未配置模型 Key");
    e.status = 500;
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.key}`,
      },
      body: JSON.stringify({
        model: c.model,
        messages: buildMessages(topic, goal, errors),
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const e = new Error(`模型服务返回 ${res.status}`);
      e.status = res.status === 429 ? 503 : 502;
      e.detail = text.slice(0, 300);
      throw e;
    }

    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : undefined;
    if (typeof content !== "string") throw new Error("模型没有返回内容");
    return parseJson(content);
  } catch (e) {
    if (e && e.name === "AbortError") {
      const timeout = new Error("模型超时");
      timeout.status = 504;
      throw timeout;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 生成一棵契约树。
 * @returns {Promise<{tree: object, cached: boolean}>}
 */
async function generateTree(topic, goal) {
  const c = cfg();
  if (c.mock) return { tree: buildMockTree(topic), cached: false };

  const cacheKey = `${topic}|${goal || ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { tree: hit.tree, cached: true };
  }

  let lastErrors = [];
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    try {
      const tree = await callModel(topic, goal, lastErrors);
      const result = validateTree(tree);
      if (result.ok) {
        cache.set(cacheKey, { tree, at: Date.now() });
        return { tree, cached: false };
      }
      lastErrors = result.errors;
      lastError = Object.assign(new Error("模型输出结构不合法"), {
        status: 422,
        errors: lastErrors,
      });
    } catch (e) {
      lastError = e;
    }

    if (attempt < MAX_RETRY) await sleep(600 * (attempt + 1));
  }

  throw lastError || new Error("生成失败");
}

function flattenNodes(root) {
  const rows = [];
  const walk = (node, depth) => {
    rows.push({ id: node.id, title: node.title, depth });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 1);
  return rows;
}

module.exports = { cfg, generateTree, flattenNodes, buildMockTree, cache };
