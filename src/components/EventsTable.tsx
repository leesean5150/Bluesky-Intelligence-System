"use client";

import React, { useState, useEffect, useCallback } from "react";

interface IntelligenceEvent {
  id: string;
  post_text: string | null;
  uri: string | null;
  external_title: string | null;
  external_description: string | null;
  post_created_at: string | null;
  actionable_insights: string | null;
  impact_score: number | null;
  retrieved_context: string | null;
  ingested_at: string;
}

const PAGE_SIZE = 10;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ImpactBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400">—</span>;

  let cls = "bg-yellow-50 text-yellow-700 ring-yellow-200";
  if (score >= 90) cls = "bg-red-50 text-red-700 ring-red-200";
  else if (score >= 70) cls = "bg-orange-50 text-orange-700 ring-orange-200";

  return (
    <span
      className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-bold ring-1 ${cls}`}
    >
      {score}
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
        {label}
      </div>
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  );
}

function parseInsights(raw: string): string[] {
  // PostgreSQL array literal: {"item1","item2",...}
  if (raw.startsWith("{") && raw.endsWith("}")) {
    const matches = raw.slice(1, -1).match(/"((?:[^"\\]|\\.)*)"/g);
    if (matches) {
      const items = matches.map((m) => m.slice(1, -1).replace(/\\"/g, '"')).filter(Boolean);
      if (items.length) return items;
    }
  }
  // JSON array: ["item1","item2",...]
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  // Newline-separated or bullet/numbered list
  const byLine = raw.split("\n").map((l) => l.replace(/^[\d]+[.)]\s*|^[-•*]\s*/, "").trim()).filter(Boolean);
  return byLine.length > 1 ? byLine : [raw.trim()];
}

function InsightsRow({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const items = parseInsights(value);
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
        Actionable Insights
      </div>
      {items.length === 1 ? (
        <p className="text-sm text-gray-700 leading-relaxed">{items[0]}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700 leading-relaxed">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EventsTable() {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchEvents = () => {
      fetch("/api/posts")
        .then((r) => r.json())
        .then((data: IntelligenceEvent[]) => {
          setEvents(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };

    fetchEvents();

    const es = new EventSource("/api/stream");
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      const msg: { type?: string } = JSON.parse(e.data);
      if (msg.type === "connected") return;

      // Always re-fetch everything for any update notification
      fetchEvents();
      setPage(1);
    };
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== id));
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const pageEvents = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            connected ? "text-emerald-600" : "text-gray-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-gray-300"
            }`}
          />
          {connected ? "Live" : "Connecting…"}
        </span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 w-20">
                Score
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Event
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 w-44 hidden md:table-cell">
                Ingested
              </th>
              <th className="px-4 py-3 w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-400 text-sm">
                  Loading events…
                </td>
              </tr>
            ) : pageEvents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-400 text-sm">
                  No events yet. Waiting for ingestion…
                </td>
              </tr>
            ) : (
              pageEvents.map((event) => {
                const isExpanded = expandedIds.has(event.id);
                const isDeleting = deletingIds.has(event.id);
                const title =
                  event.external_title ||
                  (event.post_text ? event.post_text.slice(0, 120) : "Untitled");

                return (
                  <React.Fragment key={event.id}>
                    <tr
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer select-none ${
                        isExpanded ? "bg-gray-50" : ""
                      } ${isDeleting ? "opacity-40" : ""}`}
                      onClick={() => toggleExpand(event.id)}
                    >
                      <td className="px-4 py-3">
                        <ImpactBadge score={event.impact_score} />
                      </td>
                      <td className="px-4 py-3 min-w-0">
                        <div className="font-medium text-gray-900 truncate max-w-lg">{title}</div>
                        {event.uri && (
                          <a
                            href={event.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline truncate block max-w-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {event.uri}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell whitespace-nowrap">
                        {formatDate(event.ingested_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            disabled={isDeleting}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteEvent(event.id);
                            }}
                            className="text-gray-300 hover:text-red-500 transition-colors disabled:cursor-not-allowed"
                            title="Delete"
                          >
                            <TrashIcon />
                          </button>
                          <span className="text-gray-300">
                            <ChevronIcon open={isExpanded} />
                          </span>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-6 py-5">
                          <div className="grid grid-cols-1 gap-5 max-w-4xl">
                            <DetailRow label="Post Text" value={event.post_text} />
                            <DetailRow
                              label="External Description"
                              value={event.external_description}
                            />
                            <InsightsRow value={event.actionable_insights} />
                            <DetailRow
                              label="Retrieved Context"
                              value={
                                event.retrieved_context
                                  ? event.retrieved_context.slice(0, 800) +
                                    (event.retrieved_context.length > 800 ? "…" : "")
                                  : null
                              }
                            />
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
                                Event ID
                              </div>
                              <code className="text-xs text-gray-500 font-mono break-all">
                                {event.id}
                              </code>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
