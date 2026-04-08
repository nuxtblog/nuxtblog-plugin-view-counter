// Package viewcounter implements the view-counter plugin as a Go-native plugin.
//
// It tracks article page views with configurable dedup modes (every_visit,
// unique_ip, unique_user), stores detailed logs and daily aggregates, and
// exposes admin API routes for the analytics dashboard.
package viewcounter

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	pluginsdk "github.com/nuxtblog/nuxtblog/sdk"
)

//go:embed plugin.yaml
var manifestYAML []byte

//go:embed web/dist/admin.mjs
var adminMJS []byte

//go:embed web/dist/public.mjs
var publicMJS []byte

func init() {
	pluginsdk.Register(&ViewCounter{})
}

// ViewCounter is the Go-native view counter plugin.
type ViewCounter struct {
	pluginsdk.BasePlugin
	ctx pluginsdk.PluginContext
}

func (p *ViewCounter) Manifest() pluginsdk.Manifest {
	return pluginsdk.ParseManifestCached("nuxtblog-plugin-view-counter", manifestYAML)
}

func (p *ViewCounter) Activate(ctx pluginsdk.PluginContext) error {
	p.ctx = ctx
	ctx.Log.Info("View Counter plugin activated (Go native)")
	return nil
}

func (p *ViewCounter) Deactivate() error {
	p.ctx.Log.Info("View Counter plugin deactivated")
	return nil
}

func (p *ViewCounter) Migrations() []pluginsdk.Migration {
	return p.Manifest().Migrations
}

func (p *ViewCounter) Assets() map[string][]byte {
	return map[string][]byte{
		"admin.mjs":  adminMJS,
		"public.mjs": publicMJS,
	}
}

func (p *ViewCounter) Filters() []pluginsdk.FilterDef {
	return []pluginsdk.FilterDef{
		{
			Event: "filter:content.render",
			Handler: func(fc *pluginsdk.FilterContext) {
				postID, ok := fc.Data["id"]
				if !ok {
					return
				}
				key := fmt.Sprintf("views:%v", postID)
				val, _ := p.ctx.Store.Get(key)
				if val == nil {
					fc.Meta["view_count"] = 0
				} else {
					switch v := val.(type) {
					case float64:
						fc.Meta["view_count"] = int(v)
					default:
						fc.Meta["view_count"] = v
					}
				}
			},
		},
	}
}

func (p *ViewCounter) OnEvent(ctx context.Context, event string, data map[string]any) {
	if event == "post.viewed" {
		id, ok := data["id"]
		if !ok {
			return
		}

		// Update KV counter
		key := fmt.Sprintf("views:%v", id)
		_, _ = p.ctx.Store.Increment(key)

		// Also upsert daily aggregate so the analytics dashboard shows data
		today := time.Now().Format("2006-01-02")
		rows, _ := p.ctx.DB.Query(
			"SELECT views FROM plugin_nuxtblog_view_counter_daily WHERE post_id = ? AND date = ?",
			id, today,
		)
		if len(rows) > 0 {
			_, _ = p.ctx.DB.Execute(
				"UPDATE plugin_nuxtblog_view_counter_daily SET views = views + 1 WHERE post_id = ? AND date = ?",
				id, today,
			)
		} else {
			_, _ = p.ctx.DB.Execute(
				"INSERT INTO plugin_nuxtblog_view_counter_daily (post_id, date, views, unique_views) VALUES (?, ?, 1, 1)",
				id, today,
			)
		}
	}
}

func (p *ViewCounter) Routes(r pluginsdk.RouteRegistrar) {
	r.Handle("POST", "/api/plugin/view-counter/track", p.handleTrack, pluginsdk.WithAuth("public"))
	r.Handle("GET", "/api/plugin/view-counter/stats", p.handleStats, pluginsdk.WithAuth("admin"))
	r.Handle("GET", "/api/plugin/view-counter/post/{id}", p.handlePostStats, pluginsdk.WithAuth("admin"))
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

func (p *ViewCounter) handleTrack(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PostID int `json:"post_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PostID == 0 {
		writeJSON(w, 400, map[string]any{"error": "missing post_id"})
		return
	}

	// Check exclude_admin setting
	excludeAdmin := p.ctx.Settings.Get("exclude_admin")
	if excludeAdmin == true {
		role := r.Header.Get("X-User-Role")
		if role == "admin" || role == "3" {
			writeJSON(w, 200, map[string]any{"data": map[string]any{"tracked": false, "reason": "admin_excluded"}})
			return
		}
	}

	mode := "unique_ip"
	if m := p.ctx.Settings.Get("count_mode"); m != nil {
		if ms, ok := m.(string); ok && ms != "" {
			mode = ms
		}
	}

	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.Header.Get("X-Real-Ip")
	}
	if ip == "" {
		ip = r.RemoteAddr
	}
	ipHash := hashIP(ip)
	today := time.Now().Format("2006-01-02")

	// Dedup logic
	if mode == "unique_ip" {
		dedupeKey := fmt.Sprintf("dedup:%d:%s:%s", body.PostID, ipHash, today)
		existing, _ := p.ctx.Store.Get(dedupeKey)
		if existing != nil {
			writeJSON(w, 200, map[string]any{"data": map[string]any{"tracked": false, "reason": "duplicate_ip"}})
			return
		}
		_ = p.ctx.Store.Set(dedupeKey, 1)
	} else if mode == "unique_user" {
		userID := r.Header.Get("X-User-Id")
		if userID != "" && userID != "0" {
			dedupeKey := fmt.Sprintf("dedup:%d:u%s:%s", body.PostID, userID, today)
			existing, _ := p.ctx.Store.Get(dedupeKey)
			if existing != nil {
				writeJSON(w, 200, map[string]any{"data": map[string]any{"tracked": false, "reason": "duplicate_user"}})
				return
			}
			_ = p.ctx.Store.Set(dedupeKey, 1)
		}
	}

	// Insert detailed log
	_, _ = p.ctx.DB.Execute(
		"INSERT INTO plugin_nuxtblog_view_counter_logs (post_id, user_id, ip_hash, user_agent, referer) VALUES (?, ?, ?, ?, ?)",
		body.PostID, 0, ipHash, r.Header.Get("User-Agent"), r.Header.Get("Referer"),
	)

	// Upsert daily aggregate
	rows, _ := p.ctx.DB.Query(
		"SELECT views FROM plugin_nuxtblog_view_counter_daily WHERE post_id = ? AND date = ?",
		body.PostID, today,
	)
	if len(rows) > 0 {
		_, _ = p.ctx.DB.Execute(
			"UPDATE plugin_nuxtblog_view_counter_daily SET views = views + 1 WHERE post_id = ? AND date = ?",
			body.PostID, today,
		)
	} else {
		_, _ = p.ctx.DB.Execute(
			"INSERT INTO plugin_nuxtblog_view_counter_daily (post_id, date, views, unique_views) VALUES (?, ?, 1, 1)",
			body.PostID, today,
		)
	}

	// Update store counter
	total, _ := p.ctx.Store.Increment(fmt.Sprintf("views:%d", body.PostID))

	writeJSON(w, 200, map[string]any{"data": map[string]any{"tracked": true, "total": total}})
}

func (p *ViewCounter) handleStats(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 30
	if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
		days = d
	}

	dateFrom := time.Now().AddDate(0, 0, -days).Format("2006-01-02")

	daily, _ := p.ctx.DB.Query(
		"SELECT date, SUM(views) as views, SUM(unique_views) as unique_views FROM plugin_nuxtblog_view_counter_daily WHERE date >= ? GROUP BY date ORDER BY date",
		dateFrom,
	)

	topPosts, _ := p.ctx.DB.Query(
		"SELECT post_id, SUM(views) as total_views FROM plugin_nuxtblog_view_counter_daily WHERE date >= ? GROUP BY post_id ORDER BY total_views DESC LIMIT 10",
		dateFrom,
	)

	totalResult, _ := p.ctx.DB.Query(
		"SELECT COUNT(*) as total_logs FROM plugin_nuxtblog_view_counter_logs",
	)

	totalLogs := 0
	if len(totalResult) > 0 {
		if v, ok := totalResult[0]["total_logs"]; ok {
			totalLogs = toInt(v)
		}
	}

	writeJSON(w, 200, map[string]any{
		"data": map[string]any{
			"daily":      daily,
			"top_posts":  topPosts,
			"total_logs": totalLogs,
		},
	})
}

func (p *ViewCounter) handlePostStats(w http.ResponseWriter, r *http.Request) {
	// Extract post ID from path: /api/plugin/view-counter/post/{id}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) == 0 {
		writeJSON(w, 400, map[string]any{"error": "invalid path"})
		return
	}
	postID, err := strconv.Atoi(parts[len(parts)-1])
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid post id"})
		return
	}

	daysStr := r.URL.Query().Get("days")
	days := 30
	if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
		days = d
	}

	dateFrom := time.Now().AddDate(0, 0, -days).Format("2006-01-02")

	trend, _ := p.ctx.DB.Query(
		"SELECT date, views, unique_views FROM plugin_nuxtblog_view_counter_daily WHERE post_id = ? AND date >= ? ORDER BY date",
		postID, dateFrom,
	)

	referers, _ := p.ctx.DB.Query(
		"SELECT referer, COUNT(*) as count FROM plugin_nuxtblog_view_counter_logs WHERE post_id = ? AND created_at >= ? GROUP BY referer ORDER BY count DESC LIMIT 20",
		postID, dateFrom,
	)

	totalViews, _ := p.ctx.Store.Get(fmt.Sprintf("views:%d", postID))

	writeJSON(w, 200, map[string]any{
		"data": map[string]any{
			"post_id":     postID,
			"total_views": totalViews,
			"trend":       trend,
			"referers":    referers,
		},
	})
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func hashIP(ip string) string {
	var hash int
	for _, ch := range ip {
		hash = ((hash << 5) - hash) + int(ch)
		hash &= hash
	}
	if hash < 0 {
		hash = -hash
	}
	return "ip_" + strconv.FormatInt(int64(hash), 36)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func toInt(v any) int {
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(math.Round(val))
	case string:
		n, _ := strconv.Atoi(val)
		return n
	default:
		return 0
	}
}
