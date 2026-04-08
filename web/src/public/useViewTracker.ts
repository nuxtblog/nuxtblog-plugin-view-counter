/**
 * View Tracker composable — tracks page views on article pages.
 *
 * Usage in host app:
 *   const { trackView } = useViewTracker()
 *   trackView(postId)
 *
 * Features:
 *   - Session-based dedup (same post won't be tracked twice per session)
 *   - 1s delay to avoid blocking page load
 *   - Silent failures (never affects UX)
 */
import { ref } from 'vue'

const tracked = ref(new Set<number>())

export function useViewTracker() {
  function trackView(postId: number) {
    if (!postId || tracked.value.has(postId)) return

    // Browser session dedup
    const sessionKey = `nb_view_${postId}`
    if (sessionStorage.getItem(sessionKey)) {
      tracked.value.add(postId)
      return
    }

    sessionStorage.setItem(sessionKey, '1')
    tracked.value.add(postId)

    // Delay 1s to not block rendering
    setTimeout(() => {
      fetch('/api/plugin/view-counter/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      }).catch(() => {})
    }, 1000)
  }

  return { trackView, tracked }
}
