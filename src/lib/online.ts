import { useSyncExternalStore } from "react";

/**
 * navigator.onLine as a React value. Only a hint: false is reliable (airplane
 * mode, no interface), but true can still mean a captive portal or dead Wi-Fi
 * — so it's used only to skip layers that *can't* work offline, never to
 * block anything that might.
 */
function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
