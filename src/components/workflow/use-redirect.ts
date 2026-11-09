"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Replaces the current route with `to` while `when` holds, e.g. when a stage
 * is opened without the input of the previous stages (after a reload).
 */
export function useRedirect(when: boolean, to: string): void {
  const router = useRouter();
  useEffect(() => {
    if (when) router.replace(to);
  }, [when, to, router]);
}
