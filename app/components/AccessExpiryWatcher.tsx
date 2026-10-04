"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AccessExpiryWatcher({ accessUntil }: { accessUntil: string }) {
  const router = useRouter();

  useEffect(() => {
    const remaining = new Date(accessUntil).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      router.refresh();
      return;
    }
    // setTimeout uses a signed 32-bit delay; long paid periods need another check.
    const timer = window.setTimeout(() => router.refresh(), Math.min(remaining + 500, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [accessUntil, router]);

  return null;
}
