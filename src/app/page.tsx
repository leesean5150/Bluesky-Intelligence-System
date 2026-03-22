import EventsTable from "@/components/EventsTable";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">Intelligence Events</h1>
        <p className="text-sm text-gray-500 mt-1">
          Real-time Bluesky monitoring · Saudi Aramco &amp; Iran conflict
        </p>
      </div>
      <EventsTable />
    </main>
  );
}
