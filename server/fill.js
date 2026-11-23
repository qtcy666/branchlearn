/* fill.js —— AI 填充核心：DeepSeek 联网搜索 + 强制 JSON + 结构校验
 * 零依赖，Node 18+（内置 fetch）。
 *
 * 关键事实（见 DeepSeek 文档「联网工具」）：
 * 1. 联网工具在 Chat Completions 上可直接声明 tools: [{ type: "deepseek_web_search" }]；
 * 2. 要求使用 deepseek-flash 模型；
 * 3. 声明联网工具后 response_format 必须是 text，不能用 JSON mode，
 *    所以 JSON 只能靠提示词约束 + 本地容错提取。
 */
"use strict";

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";
const TIMEOUT_MS = 90000;
const MAX_TOTAL_NODES = 120;
const MIN_TOTAL_NODES = 20;

function cfg() {
  return {
    key: process.env.FILL_API_KEY || "",
    baseUrl: (process.env.FILL_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ""),
    model: process.env.FILL_MODEL || DEFAULT_MODEL,
    mock: process.env.FILL_MOCK === "1",
  };
}

/* ---------- 模板 ---------- */

function normalizeShape(shape) {
  const bad = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    return e;
  };
  if (!shape || !Array.isArray(shape.levels)) throw bad("模板缺少 levels");
  if (shape.levels.length < 2 || shape.levels.length > 5) throw bad("模板层数应为 2–5 层");

  for (const level of shape.levels) {
    if (typeof level.label !== "string" || !level.label.trim()) throw bad("模板每层都要有 label");
    if (!Array.isArray(level.count) || level.count.length !== 2) throw bad("模板每层 count 应为 [min, max]");
    const [min, max] = level.count;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 20) {
      throw bad(`模板「${level.label}」的数量区间不合法`);
    }
    if (!Number.isInteger(level.maxChars) || level.maxChars < 2 || level.maxChars > 40) {
      throw bad(`模板「${level.label}」的字数上限不合法`);
    }
  }
  return shape;
}

/* ---------- 提示词 ---------- */

function buildMessages(query, goal, shape) {
  const levelLines = shape.levels
    .map((l, i) => `${i + 1}. ${l.role}（${l.label}）：每个父节点下 ${l.count[0]}–${l.count[1]} 个，标题不超过 ${l.maxChars} 字`)
    .join("\n");

  const system = [
    "你是学习路径填充器。你只输出 JSON，不解释，不改变模板的层数。",
    "先联网检索这门课程的公开教学大纲或教材目录，优先高校、教材、官方文档，不要采用培训机构的营销内容。",
    "没有可靠来源时按通用学科结构填写，并在 note 写「推测」。",
  ].join("\n");

  const user = [
    `课程：${query}`,
    `目标：${goal || "系统学习"}`,
    `模板（共 ${shape.levels.length} 层）：`,
    levelLines,
    "",
    "只输出下面形状的 JSON，不要 Markdown 代码块，不要任何解释：",
    '{"root":"课程名","description":"一句话目标","children":[{"title":"章节名","children":[{"title":"知识点","note":"来源或推测"}]}]}',
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ---------- JSON 容错提取 ---------- */

function extractJson(text) {
  let s = String(text || "").trim();
  if (!s) throw new Error("模型返回为空");

  // 模型常把 JSON 包在 ```json 代码块里
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("返回内容里没有 JSON 对象");
  s = s.slice(start, end + 1);

  // 先直接解析；失败再修常见的两种毛病：中文引号、尾随逗号
  try {
    return JSON.parse(s);
  } catch (e) {
    const repaired = s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      throw new Error("JSON 解析失败：" + e2.message);
    }
  }
}

/* ---------- 结构校验（与前端 treeShape.ts 保持同一套规则） ---------- */

function walk(items, levelIndex, shape, errors) {
  const level = shape.levels[levelIndex];
  if (!level) {
    errors.push(`第 ${levelIndex + 1} 层超出了模板的层数`);
    return Array.isArray(items) ? items.length : 0;
  }

  const [min, max] = level.count;
  if (items.length < min || items.length > max) {
    errors.push(`${level.label}有 ${items.length} 个，应在 ${min}–${max} 个之间`);
  }

  let total = 0;
  for (const item of items) {
    total += 1;
    const title = String(item && item.title != null ? item.title : "").trim();
    if (!title) {
      errors.push(`${level.label}里有空标题`);
    } else if (title.length > level.maxChars) {
      errors.push(`「${title}」超过 ${level.maxChars} 字`);
    }

    const children = item && Array.isArray(item.children) ? item.children : [];
    const isLeafLevel = levelIndex === shape.levels.length - 1;
    if (isLeafLevel) {
      if (children.length > 0) errors.push(`「${title}」已经是最底层，不应再有子节点`);
    } else if (children.length === 0) {
      errors.push(`「${title}」缺少${shape.levels[levelIndex + 1].label}`);
    } else {
      total += walk(children, levelIndex + 1, shape, errors);
    }
  }
  return total;
}

function validateFill(result, shape) {
  const errors = [];
  const root = String(result && result.root != null ? result.root : "").trim();
  const rootLevel = shape.levels[0];

  if (!root) errors.push("课程名为空");
  else if (root.length > rootLevel.maxChars) errors.push(`课程名超过 ${rootLevel.maxChars} 字`);

  let total = 1;
  if (!Array.isArray(result && result.children)) {
    errors.push("缺少章节列表 children");
  } else {
    total += walk(result.children, 1, shape, errors);
  }

  if (total < MIN_TOTAL_NODES) errors.push(`整棵树只有 ${total} 个节点，拆得不够细`);
  if (total > MAX_TOTAL_NODES) errors.push(`整棵树有 ${total} 个节点，太碎了，不好用`);

  return errors;
}

/* ---------- 调用模型 ---------- */

function collectSources(message) {
  const out = [];
  const seen = new Set();
  const steps = Array.isArray(message.server_tool_calls) ? message.server_tool_calls : [];
  for (const step of steps) {
    const calls = Array.isArray(step && step.calls) ? step.calls : [];
    for (const call of calls) {
      const sources = Array.isArray(call && call.sources) ? call.sources : [];
      for (const s of sources) {
        if (!s || !s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        out.push({ title: s.title || s.url, url: s.url });
      }
    }
  }
  return out.slice(0, 10);
}

async function callModel(messages) {
  const { key, baseUrl, model } = cfg();
  if (!key) {
    const e = new Error("FILL_API_KEY 未配置");
    e.status = 500;
    throw e;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        messages,
        // 声明后由模型判断是否搜索；服务端执行，客户端不用处理工具调用
        tools: [{ type: "deepseek_web_search" }],
        temperature: 0.2,
        max_tokens: 6000,
        stream: false,
      }),
      signal: ctrl.signal,
    });

    const raw = await r.text();
    if (!r.ok) {
      throw new Error(`模型接口 ${r.status}: ${raw.slice(0, 300)}`);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error("模型返回的不是 JSON：" + raw.slice(0, 200));
    }
    // 生成中途失败时 HTTP 仍是 200，错误在响应体里
    if (data.error) throw new Error("模型返回错误：" + JSON.stringify(data.error).slice(0, 300));

    const message = data.choices && data.choices[0] && data.choices[0].message;
    if (!message) throw new Error("模型返回为空");
    const content = typeof message.content === "string" ? message.content : "";
    if (!content.trim()) throw new Error("模型没有输出内容");

    return { content, sources: collectSources(message), usage: data.usage || null };
  } catch (e) {
    if (e && e.name === "AbortError") {
      const err = new Error("检索超时，可以再试一次");
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- mock：没有 key 时也能联调前端 ---------- */

function mockFill(shape) {
  const chapters = [
    ["第一章 集合与关系", ["集合的基本运算", "关系的性质", "等价关系与划分", "偏序关系"]],
    ["第二章 图论基础", ["图的连通性", "欧拉图与哈密顿图", "树与生成树", "平面图"]],
    ["第三章 数理逻辑", ["命题逻辑", "范式与推理", "谓词逻辑", "量词与推理规则"]],
    ["第四章 组合数学", ["排列与组合", "容斥原理", "递推关系", "生成函数"]],
    ["第五章 代数结构", ["群的定义与性质", "循环群", "环与域", "同态与同构"]],
  ];
  const children = chapters.map(([title, points]) => ({
    title,
    children: points.map((point) => ({ title: point, note: "推测（mock 数据）" })),
  }));
  return {
    root: "离散数学",
    description: "期末复习",
    children,
    sources: [
      { title: "离散数学教学大纲（示例）", url: "https://example.edu/discrete-math" },
    ],
  };
}

/* ---------- 入口 ---------- */

async function fillTree({ query, goal, shape }) {
  const { mock } = cfg();
  const q = String(query == null ? "" : query).trim();
  if (!q) {
    const e = new Error("课程名为空");
    e.status = 400;
    throw e;
  }
  if (q.length > 40) {
    const e = new Error("课程名太长了，40 字以内");
    e.status = 400;
    throw e;
  }

  const safeShape = normalizeShape(shape);
  const started = Date.now();

  if (mock) {
    const m = mockFill(safeShape);
    return { ...m, meta: { model: "mock", elapsed: Date.now() - started, mock: true } };
  }

  const messages = buildMessages(q, goal, safeShape);
  let lastError = null;
  let lastDetails = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { content, sources, usage } = await callModel(messages);

    try {
      const tree = extractJson(content);
      const errors = validateFill(tree, safeShape);
      if (errors.length === 0) {
        return {
          ...tree,
          sources,
          meta: { model: cfg().model, elapsed: Date.now() - started, usage },
        };
      }
      lastError = new Error(errors.join("；"));
      lastDetails = errors;
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: "上面的 JSON 有以下问题：" + errors.join("；") + "。请修正后重新只输出 JSON，不要解释。",
      });
    } catch (e) {
      lastError = e;
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: "上面的输出不是合法 JSON（" + e.message + "）。请只输出 JSON，不要 Markdown 代码块。",
      });
    }
  }

  const err = new Error(lastError ? lastError.message : "生成失败，请换个说法重试");
  err.status = 422;
  err.details = lastDetails;
  throw err;
}

module.exports = { fillTree, validateFill, extractJson, normalizeShape, cfg };
