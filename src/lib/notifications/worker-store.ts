/** How many rows are due at a moment: what the next claims would pick up, leases aside. */
export type DueCounts = {
  /** Pending outbox rows whose `send_at` has passed. */
  notifications: number;
  /** Unmuted reminders whose `next_notify_at` has passed. */
  reminders: number;
};

/** One worker's heartbeat: its name, when it last ticked and the build it runs. */
export type Heartbeat = {
  name: string;
  beatAt: Date;
  version: string;
};

/**
 * The worker's storage. It acts for every user, as the service (secret key), never as a signed-in
 * caller. The Supabase implementation is `src/lib/supabase/worker-store.ts`; tests use a fake.
 */
export interface WorkerStore {
  /** Records that the worker `name` ticked at `beatAt`, replacing its previous heartbeat. */
  writeHeartbeat(heartbeat: Heartbeat): Promise<void>;
  /** Counts the due rows at `now` without claiming (leasing) any of them. */
  countDue(now: Date): Promise<DueCounts>;
}
