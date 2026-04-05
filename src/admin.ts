/**
 * nuxtblog/view-counter — Admin Dashboard (admin.js)
 *
 * Exports the AnalyticsDashboard Vue component for the plugin page system.
 * Uses Options API with template string (requires host runtimeCompiler: true).
 * Tailwind CSS classes are available from the host app.
 */

export const AnalyticsDashboard = {
  name: 'AnalyticsDashboard',

  template: /* html */ `
    <div class="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-[var(--ui-text)]">浏览统计</h1>
          <p class="text-sm text-[var(--ui-text-muted)] mt-1">查看博客的浏览量趋势和热门文章</p>
        </div>
        <div class="flex items-center gap-1 rounded-lg p-1"
          style="background: var(--ui-bg-elevated);">
          <button
            v-for="opt in dayOptions" :key="opt.value"
            @click="days = opt.value"
            :class="[
              'px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer',
              days === opt.value
                ? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
                : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
            ]">
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Loading skeleton -->
      <template v-if="loading">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div v-for="i in 4" :key="i"
            class="rounded-xl p-5 animate-pulse"
            style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
            <div class="h-8 w-20 rounded mb-2" style="background: var(--ui-border);"></div>
            <div class="h-4 w-16 rounded" style="background: var(--ui-border);"></div>
          </div>
        </div>
        <div class="rounded-xl p-6 animate-pulse"
          style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
          <div class="h-5 w-24 rounded mb-6" style="background: var(--ui-border);"></div>
          <div class="h-48 rounded" style="background: var(--ui-border); opacity: 0.5;"></div>
        </div>
      </template>

      <!-- Error -->
      <div v-else-if="error"
        class="rounded-xl p-8 text-center"
        style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
        <svg class="mx-auto mb-3 size-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p class="text-red-500 mb-3">{{ error }}</p>
        <button @click="fetchStats"
          class="px-4 py-2 text-sm rounded-lg transition-colors cursor-pointer"
          style="background: var(--ui-bg); border: 1px solid var(--ui-border); color: var(--ui-text);">
          重试
        </button>
      </div>

      <template v-else>
        <!-- Stats Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div v-for="card in statCards" :key="card.label"
            class="rounded-xl p-4 md:p-5 transition-shadow hover:shadow-md"
            style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-2xl md:text-3xl font-bold tracking-tight"
                  :style="{ color: card.color }">
                  {{ formatNumber(card.value) }}
                </div>
                <div class="text-xs mt-1.5" style="color: var(--ui-text-muted);">{{ card.label }}</div>
              </div>
              <div class="size-9 rounded-lg flex items-center justify-center shrink-0"
                :style="{ background: card.bg }">
                <svg class="size-5" :style="{ color: card.color }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" :d="card.iconPath" />
                </svg>
              </div>
            </div>
            <div v-if="card.sub" class="text-xs mt-2" style="color: var(--ui-text-dimmed);">{{ card.sub }}</div>
          </div>
        </div>

        <!-- Trend Chart -->
        <div class="rounded-xl p-4 md:p-6"
          style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold" style="color: var(--ui-text);">浏览趋势</h2>
            <div class="flex items-center gap-4 text-xs" style="color: var(--ui-text-muted);">
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-4 h-0.5 rounded-full bg-blue-500"></span> 总浏览
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-4 h-0.5 rounded-full bg-emerald-500" style="border-top: 2px dashed;"></span> 独立访客
              </span>
            </div>
          </div>

          <div v-if="chartData.length > 1" class="relative">
            <!-- Y axis labels -->
            <div class="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] pr-2 z-10"
              style="color: var(--ui-text-dimmed); width: 40px;">
              <span v-for="label in yLabels" :key="label">{{ label }}</span>
            </div>

            <!-- Chart -->
            <div style="margin-left: 44px;">
              <svg :viewBox="'0 0 ' + cw + ' ' + ch" class="w-full" style="height: 220px;" preserveAspectRatio="none">
                <!-- Grid -->
                <line v-for="i in 5" :key="'g'+i"
                  :x1="0" :y1="ch * (i-1) / 4" :x2="cw" :y2="ch * (i-1) / 4"
                  stroke="currentColor" stroke-width="1" style="color: var(--ui-border); opacity: 0.5;" />

                <!-- Area gradient -->
                <defs>
                  <linearGradient id="vcAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.2" />
                    <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.01" />
                  </linearGradient>
                </defs>
                <polygon :points="areaPoints" fill="url(#vcAreaGrad)" />

                <!-- Views line -->
                <polyline :points="linePoints" fill="none" stroke="#3b82f6" stroke-width="2.5"
                  stroke-linejoin="round" stroke-linecap="round" />

                <!-- Unique views line -->
                <polyline :points="uniqueLinePoints" fill="none" stroke="#10b981" stroke-width="1.5"
                  stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 4" />

                <!-- Hover dots -->
                <template v-for="(pt, i) in chartPoints" :key="'p'+i">
                  <circle :cx="pt.x" :cy="pt.y" r="12" fill="transparent"
                    class="cursor-pointer"
                    @mouseenter="hoverIdx = i" @mouseleave="hoverIdx = -1" />
                  <circle v-if="hoverIdx === i"
                    :cx="pt.x" :cy="pt.y" r="4"
                    fill="#3b82f6" stroke="white" stroke-width="2" />
                </template>
              </svg>

              <!-- Tooltip -->
              <div v-if="hoverIdx >= 0 && chartData[hoverIdx]"
                class="absolute px-3 py-2 rounded-lg text-xs shadow-lg pointer-events-none z-20"
                style="background: var(--ui-bg-inverted); color: var(--ui-text-inverted); transform: translate(-50%, -100%); top: 0; margin-top: -8px;"
                :style="{ left: (44 + chartPoints[hoverIdx].x / cw * 100) + '%' }">
                <div class="font-medium">{{ chartData[hoverIdx].date }}</div>
                <div>浏览: {{ chartData[hoverIdx].views }}</div>
                <div>独立: {{ chartData[hoverIdx].unique_views }}</div>
              </div>

              <!-- X axis -->
              <div class="flex justify-between mt-2 text-[10px]" style="color: var(--ui-text-dimmed);">
                <span v-for="label in xLabels" :key="label">{{ label }}</span>
              </div>
            </div>
          </div>

          <div v-else class="flex items-center justify-center text-sm" style="height: 220px; color: var(--ui-text-muted);">
            暂无浏览数据
          </div>
        </div>

        <!-- Top Posts -->
        <div class="rounded-xl p-4 md:p-6"
          style="background: var(--ui-bg-elevated); border: 1px solid var(--ui-border);">
          <h2 class="text-base font-semibold mb-4" style="color: var(--ui-text);">热门文章 Top 10</h2>

          <div v-if="topPosts.length" class="space-y-2.5">
            <a v-for="(post, idx) in topPosts" :key="post.post_id"
              :href="'/admin/posts/edit/' + post.post_id"
              class="flex items-center gap-3 group rounded-lg px-3 py-2.5 -mx-1 transition-colors"
              style="color: var(--ui-text);"
              @mouseenter="$event.currentTarget.style.background = 'var(--ui-bg-accented)'"
              @mouseleave="$event.currentTarget.style.background = 'transparent'">
              <!-- Rank -->
              <span :class="[
                'size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                idx < 3 ? 'text-white' : ''
              ]" :style="{
                background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7c2f' : 'var(--ui-bg-accented)',
                color: idx >= 3 ? 'var(--ui-text-muted)' : undefined
              }">{{ idx + 1 }}</span>

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
                <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--ui-bg-accented);">
                  <div class="h-full rounded-full transition-all duration-700"
                    :style="{
                      width: barWidth(post.total_views) + '%',
                      background: idx < 3 ? 'var(--ui-primary)' : 'var(--ui-text-dimmed)'
                    }"></div>
                </div>
              </div>
            </a>
          </div>

          <div v-else class="flex items-center justify-center h-32 text-sm" style="color: var(--ui-text-muted);">
            暂无浏览数据
          </div>
        </div>
      </template>
    </div>
  `,

  data() {
    return {
      loading: true,
      error: null as string | null,
      days: 30,
      hoverIdx: -1,
      stats: null as { daily: any[]; top_posts: any[]; total_logs: number } | null,
      postTitles: {} as Record<number, string>,
      dayOptions: [
        { label: '7 天', value: 7 },
        { label: '30 天', value: 30 },
        { label: '90 天', value: 90 },
      ],
      cw: 900,
      ch: 200,
    }
  },

  computed: {
    chartData(): any[] {
      return this.stats?.daily || []
    },

    totalViews(): number {
      return this.chartData.reduce((s: number, d: any) => s + (d.views || 0), 0)
    },

    todayViews(): number {
      const today = new Date().toISOString().slice(0, 10)
      return this.chartData.find((d: any) => d.date === today)?.views || 0
    },

    avgDaily(): number {
      return this.chartData.length ? Math.round(this.totalViews / this.chartData.length) : 0
    },

    statCards(): any[] {
      return [
        {
          label: '总浏览量', value: this.totalViews,
          color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',
          iconPath: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
          sub: this.days + ' 天内',
        },
        {
          label: '今日浏览', value: this.todayViews,
          color: '#10b981', bg: 'rgba(16,185,129,0.1)',
          iconPath: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
        },
        {
          label: '日均浏览', value: this.avgDaily,
          color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)',
          iconPath: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
        },
        {
          label: '日志记录', value: this.stats?.total_logs || 0,
          color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',
          iconPath: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125',
        },
      ]
    },

    maxViews(): number {
      return Math.max(1, ...this.chartData.map((d: any) => d.views || 0))
    },

    chartPoints(): Array<{ x: number; y: number }> {
      const data = this.chartData
      if (data.length < 2) return []
      const pad = 2
      return data.map((d: any, i: number) => ({
        x: pad + (i / (data.length - 1)) * (this.cw - pad * 2),
        y: pad + (1 - (d.views || 0) / this.maxViews) * (this.ch - pad * 2),
      }))
    },

    linePoints(): string {
      return this.chartPoints.map((p: any) => `${p.x},${p.y}`).join(' ')
    },

    areaPoints(): string {
      const pts = this.chartPoints
      if (pts.length < 2) return ''
      return `${pts[0].x},${this.ch} ${this.linePoints} ${pts[pts.length - 1].x},${this.ch}`
    },

    uniqueLinePoints(): string {
      const data = this.chartData
      if (data.length < 2) return ''
      const pad = 2
      return data.map((d: any, i: number) => {
        const x = pad + (i / (data.length - 1)) * (this.cw - pad * 2)
        const y = pad + (1 - (d.unique_views || 0) / this.maxViews) * (this.ch - pad * 2)
        return `${x},${y}`
      }).join(' ')
    },

    xLabels(): string[] {
      const data = this.chartData
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
    },

    yLabels(): string[] {
      const max = this.maxViews
      return [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0]
        .map((v: number) => this.formatNumber(v))
    },

    topPosts(): any[] {
      return (this.stats?.top_posts || []).map((p: any) => ({
        ...p,
        title: this.postTitles[p.post_id],
      }))
    },

    maxPostViews(): number {
      const posts = this.stats?.top_posts || []
      return posts.length ? (posts[0].total_views || 1) : 1
    },
  },

  watch: {
    days() {
      this.fetchStats()
    },
  },

  mounted() {
    this.fetchStats()
  },

  methods: {
    async fetchStats() {
      this.loading = true
      this.error = null
      try {
        const res = await fetch(`/api/plugin/view-counter/stats?days=${this.days}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        // GoFrame wraps in { code, message, data } — plugin routes return { data: { ... } }
        this.stats = json.data?.daily ? json.data : json
        await this.fetchPostTitles()
      } catch (e: any) {
        this.error = e.message || '加载失败'
      } finally {
        this.loading = false
      }
    },

    async fetchPostTitles() {
      const posts = this.stats?.top_posts || []
      if (!posts.length) return
      try {
        // Fetch post titles in parallel (best-effort)
        await Promise.all(posts.map(async (p: any) => {
          try {
            const res = await fetch(`/api/v1/posts/${p.post_id}`)
            if (res.ok) {
              const json = await res.json()
              const title = json.data?.title || json.data?.post?.title
              if (title) this.postTitles[p.post_id] = title
            }
          } catch {}
        }))
        // Trigger reactivity
        this.postTitles = { ...this.postTitles }
      } catch {
        // Silently ignore — IDs are shown as fallback
      }
    },

    formatNumber(n: number): string {
      if (n == null) return '0'
      if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
      return String(n)
    },

    barWidth(views: number): number {
      return Math.max(3, (views / this.maxPostViews) * 100)
    },
  },
}
