import { AsyncLocalStorage } from "node:async_hooks";

// Who the faked session belongs to. Tests call signInAs() before a server action, or runAs()
// to give concurrent calls their own user (the session is read after the first await, so a
// shared variable would be overwritten by the time a racing call looks at it).
type User = { id: string; name: string; email: string };

let user: User | null = null;
const scoped = new AsyncLocalStorage<User | null>();

export function signInAs(u: User | null) {
  user = u;
}

export function runAs<T>(u: User, fn: () => Promise<T>): Promise<T> {
  return scoped.run(u, fn);
}

export function currentSession() {
  const u = scoped.getStore() ?? user;
  return u ? { user: u, session: { id: `s-${u.id}`, userId: u.id } } : null;
}
