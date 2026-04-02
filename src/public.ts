/**
 * nuxtblog/view-counter — 前台 public.js
 *
 * 在文章页面自动发送浏览量追踪请求。
 * 由宿主注入到公共前端页面 <head> 中。
 */

;(function () {
  // 只在文章详情页执行
  const postMeta = document.querySelector<HTMLMetaElement>('meta[name="nuxtblog:post-id"]')
  if (!postMeta) return

  const postId = parseInt(postMeta.content, 10)
  if (isNaN(postId)) return

  // 浏览器端去重：同一 session 同一文章只发一次
  const sessionKey = `nb_view_${postId}`
  if (sessionStorage.getItem(sessionKey)) return
  sessionStorage.setItem(sessionKey, '1')

  // 延迟 1 秒发送，避免影响页面加载
  setTimeout(() => {
    fetch('/api/plugin/view-counter/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId }),
    }).catch(() => {
      // 静默失败，不影响用户体验
    })
  }, 1000)
})()
