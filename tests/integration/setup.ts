import { vi } from "vitest";
import { currentSession } from "./session";

// Outside Next.js there is no request: fake only the session and the cache invalidation.
// Everything else (permission checks, tenancy checks, database) is the real code.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => currentSession() } } }));
