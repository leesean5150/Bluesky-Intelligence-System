import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { rows } = await pool.query(
      `SELECT id, post_text, uri, external_title, external_description,
              post_created_at, actionable_insights, impact_score,
              retrieved_context, ingested_at
       FROM intelligence_events WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error(`GET /api/posts/${id} error:`, err);
    return NextResponse.json({ error: "Failed to fetch event" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM intelligence_events WHERE id = $1",
      [id]
    );
    if (!rowCount) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/posts/${id} error:`, err);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
