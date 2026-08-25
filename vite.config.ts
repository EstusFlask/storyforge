import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

function resolveBuildSha(): string {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (envSha) return envSha.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

export default defineConfig({
  // Frozen E2E workspaces symlink node_modules. Give each disposable copy its
  // own optimizer cache so it cannot reuse or mutate the live dev server's
  // prebundled Tiptap graph (which registers editor extensions globally).
  cacheDir: process.env.STORYFORGE_E2E_SNAPSHOT === '1'
    ? '.vite-e2e-cache'
    : 'node_modules/.vite',
  define: {
    __STORYFORGE_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      base: '/storyforge/',
      scope: '/storyforge/',
      manifest: {
        name: '故事熔炉 StoryForge',
        short_name: '故事熔炉',
        description: 'AI 驱动的小说创作工坊',
        theme_color: '#6366f1',
        background_color: '#0a0a0f',
        display: 'standalone',
        start_url: '/storyforge/',
        scope: '/storyforge/',
        lang: 'zh-CN',
        icons: [
          {
            src: '/storyforge/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/storyforge/index.html',
        navigateFallbackDenylist: [/^\/(?!storyforge)/],
        // 主 bundle 已随功能增多突破 2 MiB（pdf.js + mammoth + 分块流水线），
        // 放宽到 5 MiB 让它被精确预缓存而不是只靠 runtime cache。
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  base: '/storyforge/',
  server: {
    port: 1111,
    // CF-1: 端口被占用时直接失败报错，而不是静默换到 1112 —— 避免用户以为在 1111、
    // 实际打开的却是被旧进程占用的 1111（错误服务 / 重定向循环）。
    strictPort: true,
    open: '/storyforge/',
    proxy: {
      '/deepseek-proxy': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/deepseek-proxy/, ''),
        secure: true,
      },
      '/openai-proxy': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/openai-proxy/, ''),
        secure: true,
      },
      '/kimi-proxy': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/kimi-proxy/, ''),
        secure: true,
      },
      '/claude-proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/claude-proxy/, ''),
        secure: true,
      },
      '/nvidia-proxy': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/nvidia-proxy/, ''),
        secure: true,
      },
      '/doubao-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/doubao-proxy/, ''),
        secure: true,
      },
      '/agnes-proxy': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/agnes-proxy/, ''),
        secure: true,
      },
      '/longcat-proxy': {
        target: 'https://api.longcat.chat',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/longcat-proxy/, ''),
        secure: true,
      },
      '/opencode-proxy': {
        target: 'https://opencode.ai',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencode-proxy/, '/zen/go'),
        secure: true,
      },
      // NS-5 embedding：国内嵌入服务本地代理（绕浏览器 CORS）
      '/siliconflow-proxy': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/siliconflow-proxy/, ''),
        secure: true,
      },
      '/qwen-proxy': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/qwen-proxy/, ''),
        secure: true,
      },
      '/glm-proxy': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/glm-proxy/, ''),
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 只把 react 固定成独立 vendor chunk（便于缓存）。
        // pdfjs / mammoth / three / jszip 均已通过「动态 import() 按需加载」自然分块，
        // 不可在此用 manualChunks 固定它们——否则会被并入主包静态引用、反而变回首屏 eager 加载。
        // Phase 3.5:把大的静态依赖拆成独立 vendor chunk。
        // 好处:① 主包变小、解析更快 ② 这些库很少变,浏览器可长期缓存(应用更新不必重下)。
        manualChunks(id) {
          // Object-form manual chunks also absorb dependencies. That made React
          // absorb editor modules and the simulation interpreter absorb product
          // runtimes, producing circular chunks. File ownership keeps the same
          // cache boundaries without moving transitive dependencies across them.
          const normalizedId = id.replaceAll('\\', '/')
          if (/\/node_modules\/(?:react|react-dom|react-router)\//.test(normalizedId)) return 'vendor-react'
          if (normalizedId.includes('/node_modules/@tiptap/')) return 'vendor-editor'
          if (normalizedId.includes('/node_modules/dexie/')) return 'vendor-db'
          if (normalizedId.includes('/node_modules/d3-hierarchy/')) return 'vendor-d3'
          if (normalizedId.includes('/node_modules/lucide-react/')) return 'vendor-icons'

          const aiContextModules = [
            '/src/lib/ai/context-builder.ts',
            '/src/lib/knowledge-ledger/knowledge-ledger.ts',
            '/src/lib/cultivation/progress.ts',
            '/src/lib/foreshadow/suggestions.ts',
            '/src/lib/foreshadow/context.ts',
            '/src/lib/storyline/storyline-progress.ts',
          ]
          if (aiContextModules.some(modulePath => normalizedId.endsWith(modulePath))) return 'ai-context'
          if (normalizedId.endsWith('/src/lib/ai/prompt-seeds.ts')) return 'prompt-seeds-core'
          if (normalizedId.endsWith('/src/lib/simulation/runtime.ts')) return 'simulation-platform-runtime'
          if (normalizedId.endsWith('/src/lib/game-production/runtime-package.ts')
            || normalizedId.endsWith('/src/lib/game-production/preview-manifest.ts')) {
            return 'game-runtime-package'
          }

          const simulationStoryModules = [
            '/src/lib/adventure/runtime.ts',
            '/src/lib/avg/runtime.ts',
            '/src/lib/character-interaction/runtime.ts',
            '/src/lib/narrative-simulation/runtime.ts',
            '/src/lib/open-world/runtime.ts',
          ]
          if (simulationStoryModules.some(modulePath => normalizedId.endsWith(modulePath))) {
            return 'simulation-story-products'
          }

          // TTRPG authoring/compilation is intentionally a separate boundary
          // from the live simulation interpreter. The runtime preview adapter
          // may load a frozen Build, but producing that Build (Brief, compiler,
          // media adoption and publication checks) is not part of every turn.
          // Keeping these acyclic modules together prevents the product layer
          // from being absorbed into simulation-platform-runtime as the TTRPG
          // production surface grows.
          const ttrpgProductionModules = [
            '/src/lib/ttrpg/production-service.ts',
            '/src/lib/ttrpg/production-brief.ts',
            '/src/lib/ttrpg/production-compiler.ts',
            '/src/lib/ttrpg/production-source.ts',
            '/src/lib/ttrpg/production-kernel.ts',
            '/src/lib/ttrpg/production-media.ts',
            '/src/lib/ttrpg/release.ts',
            '/src/lib/ttrpg/campaign-proposal.ts',
            '/src/lib/ttrpg/house-rule.ts',
            '/src/lib/ttrpg/d20-fantasy-rule-pack.ts',
            '/src/lib/ttrpg/d100-investigation-rule-pack.ts',
            '/src/lib/ttrpg/rank-lite-rule-pack.ts',
            '/src/lib/ttrpg/storyforge-rule-pack.ts',
          ]
          if (ttrpgProductionModules.some(modulePath => normalizedId.endsWith(modulePath))) {
            return 'ttrpg-production'
          }

          const simulationTtrpgModules = [
            '/src/lib/ttrpg/campaign.ts',
            '/src/lib/ttrpg/rule-pack.ts',
            '/src/lib/ttrpg/runtime.ts',
            '/src/lib/ttrpg/action-feedback.ts',
            '/src/lib/ttrpg/viewer-projection.ts',
            '/src/lib/ttrpg/continuity-state.ts',
            '/src/lib/ttrpg/action-requirement.ts',
            '/src/lib/ttrpg/action-economy.ts',
            '/src/lib/ttrpg/ability-ledger.ts',
            '/src/lib/ttrpg/item-ledger.ts',
            '/src/lib/ttrpg/effect-runtime.ts',
          ]
          if (simulationTtrpgModules.some(modulePath => normalizedId.endsWith(modulePath))) {
            return 'simulation-ttrpg-products'
          }

          const gameReleaseModules = [
            '/src/lib/game-production/preview-source.ts',
            '/src/lib/text-game/releases.ts',
          ]
          if (gameReleaseModules.some(modulePath => normalizedId.endsWith(modulePath))) {
            return 'simulation-platform-runtime'
          }

          // These modules are one source-level strongly connected component:
          // registry readers -> simulation/release verification -> authoring /
          // portable lifecycle -> registry readers. Keeping the SCC together
          // avoids cross-chunk ESM initialization cycles.
          if (normalizedId.endsWith('/src/lib/registry/context-sources.ts')
            || normalizedId.endsWith('/src/lib/ttrpg/gm-context.ts')) {
            return 'simulation-platform-runtime'
          }

          // Large, acyclic dependencies of the platform runtime can safely use
          // a separate cache boundary. They never import the SCC above, so this
          // reduces the runtime chunk without manufacturing circular chunks.
          const simulationPlatformSupportModules = [
            '/src/lib/simulation/canon-snapshot.ts',
            '/src/lib/text-game/content.ts',
            '/src/lib/retrieval/retrieval.ts',
            '/src/lib/retrieval/rag-library.ts',
            '/src/lib/narrative/blueprint.ts',
            '/src/lib/agent/run/event-schema.ts',
            '/src/lib/agent/run/projection.ts',
            '/src/lib/agent/creative-reliability.ts',
            '/src/lib/game-production/media-blob-store.ts',
            '/src/lib/memory/consistency-dossier.ts',
            '/src/lib/consistency/impact-analysis.ts',
            '/src/lib/ai/world-rules-manifest.ts',
            '/src/lib/style/learning-agent.ts',
            '/src/lib/agent/read-sources.ts',
            '/src/lib/node-authoring/contracts.ts',
            '/src/lib/agent/run/verification-receipt.ts',
            '/src/lib/reference-analysis/merge-analysis.ts',
            '/src/lib/agent/context-policy.ts',
            '/src/lib/history/agent-baseline.ts',
            '/src/lib/inspiration/workspace.ts',
            '/src/lib/consistency/held-items.ts',
            '/src/lib/reference-analysis/derived-agent-baseline.ts',
            '/src/lib/style/style-learning.ts',
            '/src/lib/world-engine/works.ts',
            '/src/lib/world-engine/lifecycle.ts',
            '/src/lib/game-production/media-resolver.ts',
            '/src/stores/ai-config.ts',
            '/src/lib/character-interaction/world-grounding.ts',
            '/src/lib/character-interaction/source-character.ts',
            '/src/lib/text-game/agent-contract.ts',
            '/src/lib/utils/sanitize-svg.ts',
            '/src/lib/ai/chapter-memory/handoff-format.ts',
            '/src/lib/utils/world-portals.ts',
            '/src/lib/codex/extraction.ts',
            '/src/lib/ai/codex-context.ts',
            '/src/lib/ai/cultivation-context.ts',
          ]
          if (simulationPlatformSupportModules.some(modulePath => normalizedId.endsWith(modulePath))) {
            return 'simulation-platform-support'
          }
        },
      },
    },
  },
})
