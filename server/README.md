# AI 填充服务

树学的「用 AI 生成」后端：接收课程名，联网检索后按模板返回 JSON 树。

零依赖，Node 18+（需要内置 `fetch`）。

## 本地跑

### 1. 不花钱先看流程（mock）

```bash
cd branchlearn/server
FILL_MOCK=1 node index.js
# 或 npm run mock
```

启动后 `POST /fill` 返回一棵固定的离散数学树，用来联调前端。

### 2. 接真实模型

```bash
cd branchlearn/server
FILL_API_KEY=sk-你的key node index.js
```

Key 需要能调用 `deepseek-flash`（DeepSeek 联网工具只支持这个模型）。

### 3. 前端连过来

```bash
cd branchlearn
npm run dev
```

前端默认请求 `http://localhost:8788`；要改地址，在 `.env.local` 里写：

```
VITE_FILL_API=http://localhost:8788
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FILL_API_KEY` | 空 | 必填（mock 模式除外） |
| `FILL_BASE_URL` | `https://api.deepseek.com` | 模型接口地址 |
| `FILL_MODEL` | `deepseek-flash` | 联网工具要求这个模型 |
| `FILL_PORT` | `8788` | 监听端口 |
| `FILL_ORIGIN` | `*` | 允许的前端来源，部署时改成站点域名 |
| `FILL_LIMIT_PER_MIN` | `5` | 每 IP 每分钟请求数 |
| `FILL_MOCK` | 空 | 设为 `1` 返回固定数据 |

## 接口

`POST /fill`

```json
{
  "query": "离散数学",
  "goal": "期末复习",
  "shape": { "levels": [ ... ] }
}
```

返回扁平结构：`root`、`description`、`children`、`sources`、`meta`。

`GET /health` 返回 `{ ok, model, mock }`，用来确认服务活着。

错误码：`400` 参数、`429` 限流、`500` 未配置 Key、`504` 超时、`502` 模型失败、`422` 结构不合法。

## 部署

云函数（阿里云 FC / 腾讯云 SCF）用「自定义运行时」跑 `node index.js`，
把 `FILL_PORT` 设为平台要求的端口，`FILL_ORIGIN` 改成前端域名。
`FILL_API_KEY` 配到平台的环境变量里，不要写进代码。

部署后把前端构建变量 `VITE_FILL_API` 指向函数地址，重新构建。
