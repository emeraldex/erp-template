"use client";

import { useEffect, useState } from "react";
import { getSession, Session } from "./api";

/**
 * The signed-in user's cached profile, read after mount. Reading localStorage
 * during render makes the server HTML (no session) differ from the first
 * client render, and React then throws away and rebuilds the whole tree.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => setSession(getSession()), []);
  return session;
}
