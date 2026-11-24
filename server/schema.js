/* schema.js —— AI 契约树校验（Node 侧）
 * 规则与前端 src/lib/treeSchema.ts 保持一致，改动时两处同步。
 * 零依赖，Node 18+。
 */
"use strict";

const LIMITS = { maxDepth: 3, maxChildren: 8, maxTitle: 14, maxSummary: 20 };
const ID_PATTERN = /^[a-z0-9-]+$/;
const PROGRESS_PATTERN = /^\d+\/\d+$/;

function charLength(text) {
  return Array.from(text).length;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateTree(input) {
  const errors = [];

  if (!isRecord(input)) return { ok: false, errors: ["root 必须是对象"] };
  if (input.version !== 1) errors.push("version 必须是 1");

  const seen = new Map();

  const walk = (value, path, depth) => {
    if (!isRecord(value)) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    if (depth > LIMITS.maxDepth) {
      errors.push(`${path} 超过 ${LIMITS.maxDepth} 层`);
      return;
    }

    const id = value.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      errors.push(`${path}.id 必须是 [a-z0-9-] 且非空`);
    } else if (seen.has(id)) {
      errors.push(`${path}.id 重复（已在 ${seen.get(id)} 出现）`);
    } else {
      seen.set(id, path);
    }

    const title = value.title;
    if (typeof title !== "string" || title.trim() === "") {
      errors.push(`${path}.title 为空`);
    } else if (charLength(title) > LIMITS.maxTitle) {
      errors.push(`${path}.title 超长（${charLength(title)} > ${LIMITS.maxTitle} 字）`);
    }

    const summary = value.summary;
    if (typeof summary !== "string") {
      errors.push(`${path}.summary 必须是字符串`);
    } else if (charLength(summary) > LIMITS.maxSummary) {
      errors.push(`${path}.summary 超长（${charLength(summary)} > ${LIMITS.maxSummary} 字）`);
    }

    const meta = value.meta;
    if (!isRecord(meta)) {
      errors.push(`${path}.meta 缺失`);
    } else if (typeof meta.progress !== "string" || !PROGRESS_PATTERN.test(meta.progress)) {
      errors.push(`${path}.meta.progress 必须是 "已完成/总数"`);
    }

    const children = value.children;
    if (!Array.isArray(children)) {
      errors.push(`${path}.children 必须是数组`);
      return;
    }
    if (children.length > LIMITS.maxChildren) {
      errors.push(`${path}.children 过多（${children.length} > ${LIMITS.maxChildren} 个）`);
    }
    children.forEach((child, index) => walk(child, `${path}.children[${index}]`, depth + 1));
  };

  walk(input.root, "root", 1);
  return { ok: errors.length === 0, errors };
}

module.exports = { LIMITS, validateTree, charLength };
