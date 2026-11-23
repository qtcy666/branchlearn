/**
 * 首屏示意图。
 * 目的不是装饰，而是让人在 3 秒内看懂三件事：
 * 一棵树长什么样、状态怎么标、以及"今天做什么"长什么样。
 */
export function HeroIllustration() {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 480 400"
      role="img"
      aria-label="一棵学习树的示意：课程下分章节，章节下是知识点，部分已标记为掌握，右侧浮出今日推荐"
    >
      <defs>
        <filter id="heroCardShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#1b1a17" floodOpacity="0.09" />
        </filter>
        <filter id="heroChipShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="8" floodColor="#1b1a17" floodOpacity="0.10" />
        </filter>
      </defs>

      <rect
        x="10"
        y="10"
        width="460"
        height="380"
        rx="22"
        fill="#ffffff"
        stroke="#e7e3da"
        filter="url(#heroCardShadow)"
      />

      {/* 连接线 */}
      <g stroke="#e2ddd2" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M240 62 V84" />
        <path d="M240 84 H85 V108" />
        <path d="M240 84 V108" />
        <path d="M240 84 H395 V108" />
        <path d="M85 148 V176" />
        <path d="M85 208 V232" />
        <path d="M240 148 V176" />
        <path d="M240 208 V232" />
        <path d="M395 148 V176" />
        <path d="M395 208 V232" />
      </g>

      {/* 根节点 */}
      <rect x="180" y="20" width="120" height="42" rx="11" fill="#f4f2ec" />
      <text x="240" y="46" textAnchor="middle" fontSize="14" fontWeight="600" fill="#1b1a17">
        线性代数
      </text>

      {/* 章节 */}
      <g fontSize="12.5" fill="#454340">
        <rect x="32" y="110" width="106" height="38" rx="10" fill="#ffffff" stroke="#e7e3da" />
        <text x="85" y="133" textAnchor="middle">
          第一章 行列式
        </text>

        <rect x="187" y="110" width="106" height="38" rx="10" fill="#ffffff" stroke="#e7e3da" />
        <text x="240" y="133" textAnchor="middle">
          第二章 矩阵
        </text>

        <rect x="342" y="110" width="106" height="38" rx="10" fill="#ffffff" stroke="#e7e3da" />
        <text x="395" y="133" textAnchor="middle">
          第三章 向量
        </text>
      </g>

      {/* 叶子节点：状态圆点 + 标题占位线 */}
      <g>
        {/* 第一章 */}
        <circle cx="47" cy="191" r="5" fill="#2f6b4f" />
        <rect x="60" y="187" width="62" height="7" rx="3.5" fill="#d8d3c8" />
        <circle cx="47" cy="247" r="5" fill="none" stroke="#c9c3b6" strokeWidth="1.4" />
        <rect x="60" y="243" width="48" height="7" rx="3.5" fill="#e6e2d9" />

        {/* 第二章 */}
        <circle cx="202" cy="191" r="5" fill="#d9a441" />
        <rect x="215" y="187" width="66" height="7" rx="3.5" fill="#d8d3c8" />
        <circle cx="202" cy="247" r="5" fill="none" stroke="#c9c3b6" strokeWidth="1.4" />
        <rect x="215" y="243" width="52" height="7" rx="3.5" fill="#e6e2d9" />

        {/* 第三章 */}
        <circle cx="357" cy="191" r="5" fill="none" stroke="#c9c3b6" strokeWidth="1.4" />
        <rect x="370" y="187" width="58" height="7" rx="3.5" fill="#e6e2d9" />
        <circle cx="357" cy="247" r="5" fill="none" stroke="#c9c3b6" strokeWidth="1.4" />
        <rect x="370" y="243" width="44" height="7" rx="3.5" fill="#e6e2d9" />
      </g>

      {/* 今日推荐浮层 */}
      <g filter="url(#heroChipShadow)">
        <rect x="286" y="286" width="168" height="100" rx="14" fill="#ffffff" stroke="#e7e3da" />
        <text x="302" y="310" fontSize="10" letterSpacing="1" fill="#8b877e">
          今天做什么
        </text>
        <text x="302" y="334" fontSize="14.5" fontWeight="600" fill="#1b1a17">
          矩阵的乘法
        </text>
        <rect x="302" y="348" width="66" height="22" rx="6" fill="#2f6b4f" />
        <text x="335" y="363" textAnchor="middle" fontSize="10.5" fill="#ffffff">
          已掌握
        </text>
        <text x="378" y="363" fontSize="10.5" fill="#8b877e">
          换一个
        </text>
      </g>
    </svg>
  )
}
