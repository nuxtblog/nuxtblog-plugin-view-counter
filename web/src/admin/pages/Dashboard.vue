<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { UCard, UBadge, UButton, USkeleton, UTabs, UIcon, UAlert } from '@nuxtblog/ui'

const themeTokens = (window as any).__nuxtblog_theme
const primaryHex = computed(() => themeTokens?.primaryHex || '#8b5cf6')
/** Read a CSS var with fallback */
function cssVar(name: string, fallback: string): string {
  return themeTokens?.getCssVar?.(name) || fallback
}

const loading = ref(true)
const error = ref<string | null>(null)
const days = ref(30)
const hoverIdx = ref(-1)
const stats = ref<{ daily: any[]; top_posts: any[]; total_logs: number } | null>(null)
const postTitles = ref<Record<number, string>>({})

const dayOptions = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
]

const tabItems = computed(() =>
  dayOptions.map(opt => ({ label: opt.label, value: String(opt.value) })),
)

const selectedTab = computed({
  get: () => String(days.value),
  set: (val: string) => { days.value = Number(val) },
})

const cw = 900
const ch = 200

const chartData = computed(() => stats.value?.daily || [])
const totalViews = computed(() => chartData.value.reduce((s, d) => s + (d.views || 0), 0))
const todayViews = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return chartData.value.find(d => d.date === today)?.views || 0
})
const avgDaily = computed(() =>
  chartData.value.length ? Math.round(totalViews.value / chartData.value.length) : 0,
)

const statCards = computed(() => [
  {
    label: '总浏览量',
    value: totalViews.value,
    color: primaryHex.value,
    bg: primaryHex.value + '1a',
    icon: 'i-heroicons-eye',
    sub: days.value + ' 天内',
  },
  {
    label: '今日浏览',
    value: todayViews.value,
    color: cssVar('--color-primary-400', '#10b981'),
    bg: cssVar('--color-primary-400', '#10b981') + '1a',
    icon: 'i-heroicons-chart-bar',
  },
  {
    label: '日均浏览',
    value: avgDaily.value,
    color: cssVar('--color-primary-600', '#8b5cf6'),
    bg: cssVar('--color-primary-600', '#8b5cf6') + '1a',
    icon: 'i-heroicons-arrow-trending-up',
  },
  {
    label: '日志记录',
    value: stats.value?.total_logs || 0,
    color: cssVar('--color-primary-800', '#f59e0b'),
    bg: cssVar('--color-primary-800', '#f59e0b') + '1a',
    icon: 'i-heroicons-circle-stack',
  },
])

const maxViews = computed(() =>
  Math.max(1, ...chartData.value.map(d => d.views || 0)),
)

const chartPoints = computed(() => {
  const data = chartData.value
  if (data.length < 2) return []
  const pad = 2
  return data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (cw - pad * 2),
    y: pad + (1 - (d.views || 0) / maxViews.value) * (ch - pad * 2),
  }))
})

const linePoints = computed(() =>
  chartPoints.value.map(p => `${p.x},${p.y}`).join(' '),
)

const areaPoints = computed(() => {
  const pts = chartPoints.value
  if (pts.length < 2) return ''
  return `${pts[0].x},${ch} ${linePoints.value} ${pts[pts.length - 1].x},${ch}`
})

const uniqueLinePoints = computed(() => {
  const data = chartData.value
  if (data.length < 2) return ''
  const pad = 2
  return data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (cw - pad * 2)
    const y = pad + (1 - (d.unique_views || 0) / maxViews.value) * (ch - pad * 2)
    return `${x},${y}`
  }).join(' ')
})

const xLabels = computed(() => {
  const data = chartData.value
  if (data.length <= 1) return []
  const count = Math.min(7, data.length)
  const step = Math.max(1, Math.floor((data.length - 1) / (count - 1)))
  const labels: string[] = []
  for (let i = 0; i < data.length; i += step) {
    labels.push(data[i].date.slice(5))
  }
  const last = data[data.length - 1].date.slice(5)
  if (labels[labels.length - 1] !== last) {
    labels[labels.length - 1] = last
  }
  return labels
})

const yLabels = computed(() => {
  const max = maxViews.value
  return [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0]
    .map(v => formatNumber(v))
})

const topPosts = computed(() =>
  (stats.value?.top_posts || []).map(p => ({
    ...p,
    title: postTitles.value[p.post_id],
  })),
)

const maxPostViews = computed(() => {
  const posts = stats.value?.top_posts || []
  return posts.length ? (posts[0].total_views || 1) : 1
})

function formatNumber(n: number): string {
  if (n == null) return '0'
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function barWidth(views: number): number {
  return Math.max(3, (views / maxPostViews.value) * 100)
}

async function fetchPostTitles() {
  const posts = stats.value?.top_posts || []
  if (!posts.length) return
  try {
    await Promise.all(posts.map(async (p: any) => {
      try {
        const res = await fetch(`/api/v1/posts/${p.post_id}`)
        if (res.ok) {
          const json = await res.json()
          const title = json.data?.title || json.data?.post?.title
          if (title) postTitles.value[p.post_id] = title
        }
      }
      catch {}
    }))
    postTitles.value = { ...postTitles.value }
  }
  catch {}
}

async function fetchStats() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/plugin/view-counter/stats?days=${days.value}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    stats.value = json.data?.daily ? json.data : json
    await fetchPostTitles()
  }
  catch (e: any) {
    error.value = e.message || '加载失败'
  }
  finally {
    loading.value = false
  }
}

watch(days, () => fetchStats())
onMounted(() => fetchStats())
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-[var(--ui-text)]">浏览统计</h1>
        <p class="text-sm text-[var(--ui-text-muted)] mt-1">查看博客的浏览量趋势和热门文章</p>
      </div>
      <UTabs
        v-model="selectedTab"
        :items="tabItems"
        size="sm"
      />
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <UCard v-for="i in 4" :key="i">
          <div class="space-y-2">
            <USkeleton class="h-8 w-20" />
            <USkeleton class="h-4 w-16" />
          </div>
        </UCard>
      </div>
      <UCard>
        <div class="space-y-4">
          <USkeleton class="h-5 w-24" />
          <USkeleton class="h-48 w-full" />
        </div>
      </UCard>
    </template>

    <!-- Error -->
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :title="error"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" size="sm" @click="fetchStats">重试</UButton>
      </template>
    </UAlert>

    <template v-else>
      <!-- Stats Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <UCard v-for="card in statCards" :key="card.label" class="transition-shadow hover:shadow-md">
          <div class="flex items-start justify-between">
            <div>
              <div
                class="text-2xl md:text-3xl font-bold tracking-tight"
                :style="{ color: card.color }"
              >
                {{ formatNumber(card.value) }}
              </div>
              <div class="text-xs mt-1.5 text-[var(--ui-text-muted)]">{{ card.label }}</div>
            </div>
            <div
              class="size-9 rounded-lg flex items-center justify-center shrink-0"
              :style="{ background: card.bg }"
            >
              <UIcon :name="card.icon" class="size-5" :style="{ color: card.color }" />
            </div>
          </div>
          <div v-if="card.sub" class="text-xs mt-2 text-[var(--ui-text-dimmed)]">{{ card.sub }}</div>
        </UCard>
      </div>

      <!-- Trend Chart -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-[var(--ui-text)]">浏览趋势</h2>
            <div class="flex items-center gap-4 text-xs text-[var(--ui-text-muted)]">
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-4 h-0.5 rounded-full" :style="{ background: primaryHex }" /> 总浏览
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-4 h-0.5 rounded-full bg-emerald-500" style="border-top: 2px dashed" /> 独立访客
              </span>
            </div>
          </div>
        </template>

        <div v-if="chartData.length > 1" class="relative">
          <!-- Y axis labels -->
          <div
            class="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] pr-2 z-10"
            style="color: var(--ui-text-dimmed); width: 40px"
          >
            <span v-for="label in yLabels" :key="label">{{ label }}</span>
          </div>

          <!-- Chart -->
          <div style="margin-left: 44px">
            <svg :viewBox="'0 0 ' + cw + ' ' + ch" class="w-full" style="height: 220px" preserveAspectRatio="none">
              <!-- Grid -->
              <line
                v-for="i in 5"
                :key="'g' + i"
                :x1="0"
                :y1="ch * (i - 1) / 4"
                :x2="cw"
                :y2="ch * (i - 1) / 4"
                stroke="currentColor"
                stroke-width="1"
                style="color: var(--ui-border); opacity: 0.5"
              />

              <!-- Area gradient -->
              <defs>
                <linearGradient id="vcAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" :stop-color="primaryHex" stop-opacity="0.2" />
                  <stop offset="100%" :stop-color="primaryHex" stop-opacity="0.01" />
                </linearGradient>
              </defs>
              <polygon :points="areaPoints" fill="url(#vcAreaGrad)" />

              <!-- Views line -->
              <polyline
                :points="linePoints"
                fill="none"
                :stroke="primaryHex"
                stroke-width="2.5"
                stroke-linejoin="round"
                stroke-linecap="round"
              />

              <!-- Unique views line -->
              <polyline
                :points="uniqueLinePoints"
                fill="none"
                stroke="#10b981"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-dasharray="6 4"
              />

              <!-- Hover dots -->
              <template v-for="(pt, i) in chartPoints" :key="'p' + i">
                <circle
                  :cx="pt.x"
                  :cy="pt.y"
                  r="12"
                  fill="transparent"
                  class="cursor-pointer"
                  @mouseenter="hoverIdx = i"
                  @mouseleave="hoverIdx = -1"
                />
                <circle
                  v-if="hoverIdx === i"
                  :cx="pt.x"
                  :cy="pt.y"
                  r="4"
                  :fill="primaryHex"
                  stroke="white"
                  stroke-width="2"
                />
              </template>
            </svg>

            <!-- Tooltip -->
            <div
              v-if="hoverIdx >= 0 && chartData[hoverIdx]"
              class="absolute px-3 py-2 rounded-lg text-xs shadow-lg pointer-events-none z-20"
              style="background: var(--ui-bg-inverted); color: var(--ui-text-inverted); transform: translate(-50%, -100%); top: 0; margin-top: -8px"
              :style="{ left: (44 + chartPoints[hoverIdx].x / cw * 100) + '%' }"
            >
              <div class="font-medium">{{ chartData[hoverIdx].date }}</div>
              <div>浏览: {{ chartData[hoverIdx].views }}</div>
              <div>独立: {{ chartData[hoverIdx].unique_views }}</div>
            </div>

            <!-- X axis -->
            <div class="flex justify-between mt-2 text-[10px]" style="color: var(--ui-text-dimmed)">
              <span v-for="label in xLabels" :key="label">{{ label }}</span>
            </div>
          </div>
        </div>

        <div v-else class="flex items-center justify-center text-sm" style="height: 220px; color: var(--ui-text-muted)">
          暂无浏览数据
        </div>
      </UCard>

      <!-- Top Posts -->
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-[var(--ui-text)]">热门文章 Top 10</h2>
        </template>

        <div v-if="topPosts.length" class="space-y-2.5">
          <a
            v-for="(post, idx) in topPosts"
            :key="post.post_id"
            :href="'/admin/posts/edit/' + post.post_id"
            class="flex items-center gap-3 group rounded-lg px-3 py-2.5 -mx-1 transition-colors hover:bg-[var(--ui-bg-accented)]"
            style="color: var(--ui-text)"
          >
            <!-- Rank -->
            <UBadge
              :color="idx < 3 ? 'primary' : 'neutral'"
              :variant="idx < 3 ? 'solid' : 'subtle'"
              class="size-7 justify-center rounded-full text-xs font-bold"
            >
              {{ idx + 1 }}
            </UBadge>

            <!-- Title + bar -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-sm font-medium truncate group-hover:text-[var(--ui-primary)]">
                  {{ post.title || ('文章 #' + post.post_id) }}
                </span>
                <span class="text-sm font-semibold shrink-0 ml-3 tabular-nums">
                  {{ formatNumber(post.total_views) }}
                </span>
              </div>
              <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--ui-bg-accented)">
                <div
                  class="h-full rounded-full transition-all duration-700"
                  :style="{
                    width: barWidth(post.total_views) + '%',
                    background: idx < 3 ? 'var(--ui-primary)' : 'var(--ui-text-dimmed)',
                  }"
                />
              </div>
            </div>
          </a>
        </div>

        <div v-else class="flex items-center justify-center h-32 text-sm" style="color: var(--ui-text-muted)">
          暂无浏览数据
        </div>
      </UCard>
    </template>
  </div>
</template>
