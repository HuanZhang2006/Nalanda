import { useEffect, useRef } from "react";
import type { User } from "@supabase/supabase-js";
// @ts-ignore — ported vanilla module
import { mountNalanda } from "./legacy/app";
import { supabase } from "./lib/supabase";

// Mounts the full app ported from the prototype (shell + every view), parameterized by the signed-in user and a sign-out callback
export function NalandaApp({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const signOutRef = useRef(onSignOut);
  signOutRef.current = onSignOut;

  useEffect(() => {
    if (!ref.current) return;
    const cleanup = mountNalanda(ref.current, {
      user: { id: user.id, email: user.email },
      supabase,
      onSignOut: () => signOutRef.current(),
    });
    return cleanup;
    // Token refreshes do not remount, but switching accounts within the same React tree must destroy the old session state.
  }, [user.id, user.email]);

  return <div className="app" ref={ref} />;
}
