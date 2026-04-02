/**
 * nuxtblog/view-counter — 服务端入口
 *
 * 展示能力:
 *  - DB Migration (自定义表 + 索引)
 *  - nuxtblog.db (query / execute)
 *  - nuxtblog.store (原子计数器做快速缓存)
 *  - 自定义路由 (public + admin 两种 auth)
 *  - content.render filter (注入浏览量到前端)
 *  - pipeline (定时聚合)
 */

// ── 生命周期 ─────────────────────────────────────────────────────────────────

export function activate(ctx: PluginContext): void {
  nuxtblog.log.info('View Counter plugin activated')

  // 监听文章浏览事件 — 快速路径：先用 store 原子计数器
  ctx.subscriptions.push(
    nuxtblog.on('post.viewed', (data) => {
      nuxtblog.store.increment(`views:${data.id}`)
    })
  )

  // 在 content.render 时注入浏览量数据
  ctx.subscriptions.push(
    nuxtblog.filter('content.render', (ctx) => {
      const postId = ctx.data.id as number
      const views = nuxtblog.store.get(`views:${postId}`) as number | null
      ctx.meta['view_count'] = views ?? 0
    })
  )
}

export function deactivate(): void {
  nuxtblog.log.info('View Counter plugin deactivated')
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 简单的 IP 哈希（非加密，仅用于去重） */
function hashIP(ip: string): string {
  let hash = 0
  for (let i = 0; i < ip.length; i++) {
    const ch = ip.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash = hash & hash // 转为 32 位整数
  }
  return 'ip_' + Math.abs(hash).toString(36)
}

function today(): string {
  return new Date().toISOString().slice(0, 10) // "2026-04-03"
}

// ── 路由: POST /api/plugin/view-counter/track ──────────────────────────────
// 由 public.js 在文章页面调用，auth = public

export function handleTrack(req: PluginRequest): PluginResponse {
  const { post_id } = req.body as { post_id: number }
  if (!post_id || typeof post_id !== 'number') {
    return { status: 400, body: { error: 'missing post_id' } }
  }

  const excludeAdmin = nuxtblog.settings.get('exclude_admin') as boolean
  if (excludeAdmin && req.userRole === 'admin') {
    return { status: 200, body: { data: { tracked: false, reason: 'admin_excluded' } } }
  }

  const mode = (nuxtblog.settings.get('count_mode') as string) || 'unique_ip'
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown'
  const ipHash = hashIP(ip)

  // 去重逻辑
  if (mode === 'unique_ip') {
    const dedupeKey = `dedup:${post_id}:${ipHash}:${today()}`
    const already = nuxtblog.store.get(dedupeKey)
    if (already) {
      return { status: 200, body: { data: { tracked: false, reason: 'duplicate_ip' } } }
    }
    nuxtblog.store.set(dedupeKey, 1)
  } else if (mode === 'unique_user') {
    if (req.userId) {
      const dedupeKey = `dedup:${post_id}:u${req.userId}:${today()}`
      const already = nuxtblog.store.get(dedupeKey)
      if (already) {
        return { status: 200, body: { data: { tracked: false, reason: 'duplicate_user' } } }
      }
      nuxtblog.store.set(dedupeKey, 1)
    }
  }

  // 写入详细日志
  nuxtblog.db.execute(
    'INSERT INTO plugin_nuxtblog_view_counter_logs (post_id, user_id, ip_hash, user_agent, referer) VALUES (?, ?, ?, ?, ?)',
    post_id,
    req.userId || 0,
    ipHash,
    req.headers['user-agent'] || '',
    req.headers['referer'] || ''
  )

  // 更新日聚合（upsert）
  const dateStr = today()
  const existing = nuxtblog.db.query(
    'SELECT views FROM plugin_nuxtblog_view_counter_daily WHERE post_id = ? AND date = ?',
    post_id, dateStr
  )
  if (existing && existing.length > 0) {
    nuxtblog.db.execute(
      'UPDATE plugin_nuxtblog_view_counter_daily SET views = views + 1 WHERE post_id = ? AND date = ?',
      post_id, dateStr
    )
  } else {
    nuxtblog.db.execute(
      'INSERT INTO plugin_nuxtblog_view_counter_daily (post_id, date, views, unique_views) VALUES (?, ?, 1, 1)',
      post_id, dateStr
    )
  }

  // 更新 store 快速计数
  const total = nuxtblog.store.increment(`views:${post_id}`)

  return { status: 200, body: { data: { tracked: true, total } } }
}

// ── 路由: GET /api/plugin/view-counter/stats ───────────────────────────────
// 仪表板总览，auth = admin

export function handleStats(req: PluginRequest): PluginResponse {
  const days = parseInt(req.query['days'] || '30', 10)
  const dateFrom = new Date()
  dateFrom.setDate(dateFrom.getDate() - days)
  const dateStr = dateFrom.toISOString().slice(0, 10)

  // 按天汇总
  const dailyTotals = nuxtblog.db.query(
    'SELECT date, SUM(views) as views, SUM(unique_views) as unique_views FROM plugin_nuxtblog_view_counter_daily WHERE date >= ? GROUP BY date ORDER BY date',
    dateStr
  )

  // Top 10 文章
  const topPosts = nuxtblog.db.query(
    'SELECT post_id, SUM(views) as total_views FROM plugin_nuxtblog_view_counter_daily WHERE date >= ? GROUP BY post_id ORDER BY total_views DESC LIMIT 10',
    dateStr
  )

  // 总计
  const totalResult = nuxtblog.db.query(
    'SELECT COUNT(*) as total_logs FROM plugin_nuxtblog_view_counter_logs'
  )

  return {
    status: 200,
    body: {
      data: {
        daily: dailyTotals,
        top_posts: topPosts,
        total_logs: totalResult?.[0]?.total_logs ?? 0,
      }
    }
  }
}

// ── 路由: GET /api/plugin/view-counter/post/{id} ───────────────────────────
// 单篇文章详情，auth = admin

export function handlePostStats(req: PluginRequest): PluginResponse {
  // 从 path 中提取 post_id
  const parts = req.path.split('/')
  const postId = parseInt(parts[parts.length - 1], 10)
  if (isNaN(postId)) {
    return { status: 400, body: { error: 'invalid post id' } }
  }

  const days = parseInt(req.query['days'] || '30', 10)
  const dateFrom = new Date()
  dateFrom.setDate(dateFrom.getDate() - days)
  const dateStr = dateFrom.toISOString().slice(0, 10)

  // 日趋势
  const trend = nuxtblog.db.query(
    'SELECT date, views, unique_views FROM plugin_nuxtblog_view_counter_daily WHERE post_id = ? AND date >= ? ORDER BY date',
    postId, dateStr
  )

  // 来源分布（referer）
  const referers = nuxtblog.db.query(
    'SELECT referer, COUNT(*) as count FROM plugin_nuxtblog_view_counter_logs WHERE post_id = ? AND created_at >= ? GROUP BY referer ORDER BY count DESC LIMIT 20',
    postId, dateStr
  )

  // 总浏览量（store 快速读取）
  const totalViews = nuxtblog.store.get(`views:${postId}`) as number | null

  return {
    status: 200,
    body: {
      data: {
        post_id: postId,
        total_views: totalViews ?? 0,
        trend,
        referers,
      }
    }
  }
}

// ── Pipeline: 每日清理过期日志 ──────────────────────────────────────────────
// 在 package.json pipelines 中声明，或由外部 cron 调用

export function cleanupOldLogs(ctx: StepContext): void {
  const retentionDays = (nuxtblog.settings.get('retention_days') as number) || 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffStr = cutoff.toISOString()

  const deleted = nuxtblog.db.execute(
    'DELETE FROM plugin_nuxtblog_view_counter_logs WHERE created_at < ?',
    cutoffStr
  )

  nuxtblog.log.info(`Cleaned up ${deleted} view logs older than ${retentionDays} days`)

  // 同时清理 store 中过期的去重键
  const expiredKeys = nuxtblog.store.deletePrefix('dedup:')
  nuxtblog.log.info(`Cleaned up ${expiredKeys} dedup keys`)
}
