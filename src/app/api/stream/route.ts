import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { PoolClient } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function ensureTrigger(client: PoolClient) {
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_new_intelligence_event()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('new_intelligence_event', NEW.id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`
    CREATE OR REPLACE TRIGGER intelligence_events_notify_trigger
    AFTER INSERT ON intelligence_events
    FOR EACH ROW EXECUTE FUNCTION notify_new_intelligence_event();
  `);
}

export async function GET(request: NextRequest) {
  const client = await pool.connect();

  try {
    await ensureTrigger(client);
    await client.query("LISTEN new_intelligence_event");
  } catch (err) {
    client.release();
    console.error("SSE setup error:", err);
    return NextResponse.json({ error: "Stream setup failed" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      client.on("notification", (_msg) => {
        if (!closed) {
          // Send a simple update signal; the frontend will re-fetch the full list
          controller.enqueue(
            encoder.encode('data: {"type":"update"}\n\n')
          );
        }
      });

      client.on("error", (err) => {
        console.error("SSE pg client error:", err);
        if (!closed) {
          closed = true;
          controller.close();
          client.release();
        }
      });

      request.signal.addEventListener("abort", () => {
        if (!closed) {
          closed = true;
          client.release();
          controller.close();
        }
      });
    },
    cancel() {
      if (!closed) {
        closed = true;
        client.release();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
