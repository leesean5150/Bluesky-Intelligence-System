import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, post_uri, post_text, uri, external_title, external_description,
        post_created_at, actionable_insights, stakeholders, impact_score, reasoning,
        retrieved_context, ingested_at
      FROM intelligence_events
      ORDER BY ingested_at DESC
    `);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/posts error:", err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
