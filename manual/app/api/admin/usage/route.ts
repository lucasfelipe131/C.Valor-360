import { NextRequest, NextResponse } from "next/server";
import { ensureAccessSchema, requireAdmin } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    const pool = await ensureAccessSchema();
    const [summary, pages, recent, daily, locations, devices, topUsers, adminActions] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM app_users) AS "totalUsers",
          (SELECT COUNT(*)::int FROM app_users WHERE status = 'active') AS "activeUsers",
          (SELECT COUNT(*)::int FROM app_users WHERE status = 'blocked' AND (email IS NULL OR email_verified_at IS NOT NULL)) AS "blockedUsers",
          (SELECT COUNT(*)::int FROM app_users WHERE email IS NOT NULL AND email_verified_at IS NULL) AS "pendingUsers",
          (SELECT COUNT(*)::int FROM app_users WHERE created_at >= NOW() - INTERVAL '30 days') AS "newUsers30d",
          (SELECT COUNT(*)::int FROM app_users WHERE expires_at > NOW() AND expires_at <= NOW() + INTERVAL '7 days') AS "expiring7d",
          COUNT(*) FILTER (WHERE event_type = 'login')::int AS logins,
          COUNT(*) FILTER (WHERE event_type = 'login' AND created_at >= NOW() - INTERVAL '7 days')::int AS "logins7d",
          COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS "activeUsers24h",
          COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS "activeUsers7d",
          COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS "activeUsers30d",
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS "events7d",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS "eventsToday"
        FROM app_usage_events
      `),
      pool.query(`
        SELECT page_key AS page, COUNT(*)::int AS visits
        FROM app_usage_events
        WHERE event_type = 'page_view'
          AND page_key <> ''
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY page_key
        ORDER BY visits DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT e.event_type AS "eventType", e.page_key AS page,
               e.created_at AS "createdAt", u.display_name AS "displayName",
               u.username
        FROM app_usage_events e
        JOIN app_users u ON u.id = e.user_id
        ORDER BY e.created_at DESC
        LIMIT 60
      `),
      pool.query(`
        WITH days AS (
          SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
        ), totals AS (
          SELECT DATE(created_at) AS day,
                 COUNT(*)::int AS events,
                 COUNT(DISTINCT user_id)::int AS users,
                 COUNT(*) FILTER (WHERE event_type = 'login')::int AS logins
          FROM app_usage_events
          WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
          GROUP BY DATE(created_at)
        ), registrations AS (
          SELECT DATE(created_at) AS day, COUNT(*)::int AS "newUsers"
          FROM app_users
          WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
          GROUP BY DATE(created_at)
        )
        SELECT days.day::text,
               COALESCE(totals.events, 0)::int AS events,
               COALESCE(totals.users, 0)::int AS users,
               COALESCE(totals.logins, 0)::int AS logins,
               COALESCE(registrations."newUsers", 0)::int AS "newUsers"
        FROM days
        LEFT JOIN totals USING (day)
        LEFT JOIN registrations USING (day)
        ORDER BY days.day
      `),
      pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (user_id)
                 user_id,
                 NULLIF(detail->>'city', '') AS city,
                 NULLIF(detail->>'region', '') AS region,
                 NULLIF(detail->>'country', '') AS country
          FROM app_usage_events
          WHERE event_type = 'access_location'
          ORDER BY user_id, created_at DESC
        )
        SELECT CONCAT_WS(' · ', city, region, country) AS location,
               COUNT(*)::int AS users
        FROM latest
        WHERE city IS NOT NULL OR region IS NOT NULL OR country IS NOT NULL
        GROUP BY location
        ORDER BY users DESC, location
        LIMIT 12
      `),
      pool.query(`
        SELECT
          CASE
            WHEN user_agent ~* '(ipad|tablet)' THEN 'Tablet'
            WHEN user_agent ~* '(mobile|android|iphone)' THEN 'Celular'
            ELSE 'Computador'
          END AS device,
          COUNT(DISTINCT user_id)::int AS users,
          COUNT(*)::int AS sessions
        FROM app_sessions
        WHERE last_seen_at >= NOW() - INTERVAL '30 days'
        GROUP BY device
        ORDER BY users DESC, sessions DESC
      `),
      pool.query(`
        SELECT u.id, u.display_name AS "displayName", u.email,
               COUNT(e.id)::int AS events,
               COUNT(e.id) FILTER (WHERE e.event_type = 'login')::int AS logins,
               COUNT(DISTINCT DATE(e.created_at))::int AS "activeDays",
               MAX(e.created_at) AS "lastActivityAt"
        FROM app_users u
        JOIN app_usage_events e
          ON e.user_id = u.id
         AND e.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY u.id
        ORDER BY events DESC, "lastActivityAt" DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT e.event_type AS "eventType", e.created_at AS "createdAt",
               e.detail, u.display_name AS "displayName"
        FROM app_usage_events e
        JOIN app_users u ON u.id = e.user_id
        WHERE e.event_type LIKE 'admin_%'
        ORDER BY e.created_at DESC
        LIMIT 30
      `),
    ]);
    return NextResponse.json({
      summary: summary.rows[0] ?? {},
      pages: pages.rows,
      recent: recent.rows,
      daily: daily.rows,
      locations: locations.rows,
      devices: devices.rows,
      topUsers: topUsers.rows,
      adminActions: adminActions.rows,
    });
  } catch (error) {
    console.error("admin:usage", error);
    return NextResponse.json({ error: "Não foi possível consultar o uso." }, { status: 500 });
  }
}
