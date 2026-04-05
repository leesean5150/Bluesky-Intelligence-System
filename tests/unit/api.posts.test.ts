import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  default: { query: vi.fn() },
}))

import { GET } from "@/app/api/posts/route"
import pool from "@/lib/db"

const mockEvent = {
  id: "test-abc123",
  post_text: "Aramco pipeline disrupted",
  uri: "https://example.com",
  external_title: "Breaking: Aramco news",
  external_description: "Details here",
  post_created_at: "2025-01-01T00:00:00Z",
  actionable_insights: '{"Buy crude futures","Monitor Ras Tanura"}',
  impact_score: 85,
  reasoning: "High geopolitical risk",
  retrieved_context: "Ras Tanura is a major export terminal.",
  ingested_at: "2025-01-01T01:00:00Z",
}

describe("GET /api/posts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns events as a JSON array", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockEvent] } as any)

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe("test-abc123")
    expect(data[0].impact_score).toBe(85)
  })

  it("returns an empty array when no events exist", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any)

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual([])
  })

  it("returns 500 on database error", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("DB connection failed"))

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data).toEqual({ error: "Failed to fetch events" })
  })
})
