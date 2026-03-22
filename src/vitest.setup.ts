import { vi } from "vitest"

// Suppress console.error noise from expected error-path tests
vi.spyOn(console, "error").mockImplementation(() => {})
