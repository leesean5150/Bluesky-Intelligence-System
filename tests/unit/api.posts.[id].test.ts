import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  default: { query: vi.fn() },
}))

import { DELETE } from "@/app/api/posts/[id]/route"
import pool from "@/lib/db"

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("DELETE /api/posts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes an existing event and returns ok", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 } as any)

    const res = await DELETE(new Request("http://localhost"), makeParams("abc123"))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ ok: true })
    expect(vi.mocked(pool.query)).toHaveBeenCalledWith(
      "DELETE FROM intelligence_events WHERE id = $1",
      ["abc123"]
    )
  })

  it("returns 404 when event does not exist", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 } as any)

    const res = await DELETE(new Request("http://localhost"), makeParams("nonexistent"))
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data).toEqual({ error: "Not found" })
  })

  it("returns 500 on database error", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("DB error"))

    const res = await DELETE(new Request("http://localhost"), makeParams("any-id"))
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data).toEqual({ error: "Failed to delete event" })
  })
})
