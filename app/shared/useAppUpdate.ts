/**
 * App update detection — so a supporter never has to be told to "clear the
 * cache", and never calls about a stale page.
 *
 * WHY THIS EXISTS (user, 2026-10-07)
 * ----------------------------------
 * "i don't want users calling me for such issues". The app is a PWA with a
 * service worker that precaches the bundle. `registerType: "autoUpdate"`
 * installs a new worker in the background, but the RUNNING page keeps the old
 * bundle until it is reloaded — and on iOS a Home-Screen app can sit on a
 * stale bundle for days. That is exactly the "I don't see the change you
 * deployed" report, and it is invisible to the user.
 *
 * WHAT THIS DOES
 * --------------
 *  1. Registers the service worker and listens for `onNeedRefresh` — the
 *     moment a new version is waiting.
 *  2. Also POLLS for updates (on an interval and whenever the app returns to
 *     the foreground), because `onNeedRefresh` alone can miss a worker that
 *     was already waiting when the page loaded.
 *  3. Exposes `applyUpdate()`, which activates the waiting worker and reloads
 *     ONCE — the user taps a button instead of being told to clear caches.
 *
 * The banner is deliberately non-blocking: the app keeps working on the old
 * bundle until the user chooses to update. A forced reload mid-read would be
 * worse than a slightly stale page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

/** How often to ask the browser whether a new worker is waiting. */
const POLL_MS = 60 * 60 * 1000; // hourly

/** How long a manual/automatic update check may take before giving up. */
const CHECK_TIMEOUT_MS = 8000;

export interface AppUpdate {
  /** True when a new version is installed and waiting to activate. */
  needRefresh: boolean;
  /** True once the app is cached and usable offline for the first time. */
  offlineReady: boolean;
  /** Activate the waiting worker and reload. Safe to call repeatedly. */
  applyUpdate: () => void;
  /** Dismiss the banner without updating (it returns on the next check). */
  dismiss: () => void;
  /**
   * Ask the browser to check for a new version NOW. Returns true when one is
   * waiting. Used by the manual "Sök efter uppdatering" button so a supporter
   * can force a check instead of waiting for the hourly poll.
   */
  checkNow: () => Promise<boolean>;
}

export function useAppUpdate(): AppUpdate {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const updateSW = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
        setDismissed(false);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisteredSW(_swUrl, r) {
        registration.current = r ?? null;
      },
    });
    updateSW.current = update;
  }, []);

  // Poll for a waiting worker. `onNeedRefresh` fires when a NEW worker is
  // found during this page's lifetime; a worker that was ALREADY waiting when
  // the page loaded does not re-fire it, so an explicit check is needed.
  //
  // The check is RACED against a timeout: `registration.update()` can hang
  // when the network stalls, and a hung check must never leave the button
  // stuck on "Söker…" forever. A timeout is treated as "no update found".
  const checkNow = useCallback(async (): Promise<boolean> => {
    const r = registration.current;
    if (!r) return false;
    try {
      const updated = await Promise.race([
        r.update().then(() => true),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), CHECK_TIMEOUT_MS)),
      ]);
      if (!updated) return false;
      if (r.waiting) {
        setNeedRefresh(true);
        setDismissed(false);
        return true;
      }
    } catch {
      /* offline or blocked */
    }
    return false;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void checkNow(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkNow]);

  const applyUpdate = useCallback(() => {
    const fn = updateSW.current;
    if (fn) {
      // `true` tells the plugin to reload the page after activating.
      void fn(true);
    } else {
      window.location.reload();
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { needRefresh: needRefresh && !dismissed, offlineReady, applyUpdate, dismiss, checkNow };
}
