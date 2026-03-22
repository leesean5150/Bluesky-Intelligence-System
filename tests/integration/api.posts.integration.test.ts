import { describe, it, expect, beforeEach, afterEach } from "vitest"
import pool from "@/lib/db"
import { GET } from "@/app/api/posts/route"
import { DELETE } from "@/app/api/posts/[id]/route"

// Unique ID per test run to avoid collisions with real data
const TEST_ID = `test-${crypto.randomUUID()}`

beforeEach(async () => {
  await pool.query(
    `INSERT INTO intelligence_events (id, post_text, ingested_at, impact_score)
     VALUES ($1, $2, NOW(), $3)`,
    [TEST_ID, "integration test post — aramco pipeline", 75]
  )
})

afterEach(async () => {
  // Safe even if the test already deleted the row
  await pool.query("DELETE FROM intelligence_events WHERE id = $1", [TEST_ID])
})

describe("GET /api/posts (integration)", () => {
  it("returns a JSON array", async () => {
    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it("includes the seeded event in the response", async () => {
    const res = await GET()
    const data = await res.json()

    const found = data.find((e: { id: string }) => e.id === TEST_ID)
    expect(found).toBeDefined()
    expect(found.impact_score).toBe(75)
    expect(found.post_text).toBe("integration test post — aramco pipeline")
  })
})

describe("DELETE /api/posts/[id] (integration)", () => {
  it("deletes an existing event and confirms removal from DB", async () => {
    const res = await DELETE(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: TEST_ID }) }
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ ok: true })

    const { rows } = await pool.query(
      "SELECT id FROM intelligence_events WHERE id = $1",
      [TEST_ID]
    )
    expect(rows).toHaveLength(0)
  })

  it("returns 404 for a non-existent event", async () => {
    const res = await DELETE(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    )
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data).toEqual({ error: "Not found" })
  })
})
