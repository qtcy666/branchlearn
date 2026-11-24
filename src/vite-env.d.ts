/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 真接口地址；不配置时前端回落到本地 mock 生成。 */
  readonly VITE_AI_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
