# 树学

> 把「我要学好 X」拆成一棵树，标出哪里会了、哪里还空着，并告诉你今天该学什么。

Vibe Coding 课程第二个自由项目（占成绩 5%）。纯前端网页，数据只存在本机浏览器。

---

## 现在是什么状态

**Phase 0（骨架）已完成**：

- Vite + React + TypeScript 工程跑通
- 数据结构定稿：`src/types/tree.ts`
- 本地存储封装（含损坏数据兜底）：`src/lib/storage.ts`
- 应用骨架、空状态、新建课程弹窗

**还没做**（按 `docs/PLAN.md` 推进）：建树编辑、状态标记、今天做什么、导出分享、打磨。

---

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:4173 。

> 注意：不要直接用 `npm run dev` 之外的方式启动 dev server。
> 当前工作区路径包含 `%`，Vite 的 dev server 会抛 `URI malformed`。
> `scripts/dev.mjs` 已经绕开了这个问题，细节见 `docs/ERROR_LOG.md` E-02。

其他命令：

```bash
npm run build      # 类型检查 + 生产构建，产物在 dist/
npm run preview    # 预览已构建的产物
npm run typecheck  # 只做类型检查
```

---

## 部署到 GitHub Pages

1. 在 GitHub 新建一个公开仓库，例如 `branchlearn`
2. 在项目目录执行：

```bash
git init
git add .
git commit -m "Phase 0: skeleton and data model"
git branch -M main
git remote add origin https://github.com/<你的用户名>/branchlearn.git
git push -u origin main
```

3. 构建并发布 `dist/`：

```bash
npm run build
npx gh-pages -d dist
```

或者在仓库 Settings → Pages 里选择 `gh-pages` 分支。

4. 链接形如 `https://<你的用户名>.github.io/branchlearn/`

> `vite.config.ts` 里 `base: './'` 已经配置为相对路径，放在子路径下也能正确加载资源。

---

## 目录

```
branchlearn/
├── scripts/dev.mjs          本地开发启动器（绕开路径含 % 的问题）
├── src/
│   ├── components/          界面组件
│   ├── lib/storage.ts       localStorage 读写与数据清洗
│   ├── store/useTreeStore.ts 全局状态与自动保存
│   ├── styles/              设计 token 与全局样式
│   ├── types/tree.ts        数据结构（唯一真相源）
│   ├── App.tsx
│   └── main.tsx
└── docs/                    项目文档（在上一级目录）
```

---

## 相关文档

- `../docs/PROJECT_SCOPE.md` — 做什么、不做什么
- `../docs/PLAN.md` — 分几个 Phase、每个 Phase 怎么验收
- `../docs/DECISIONS.md` — 每个决定的原因与代价
- `../docs/RESEARCH.md` — 同类产品与技术组件调研
- `../docs/DEV_LOG.md` — 每天做了什么
- `../docs/ERROR_LOG.md` — 踩过的坑
