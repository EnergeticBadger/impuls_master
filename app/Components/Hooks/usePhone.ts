import { useSyncExternalStore } from 'react';

// the stylesheets' phone layout (`max-width: 640px`), for the few things CSS can't move or reword
const PHONE = '(max-width: 640px)';

function subscribe(changed: () => void) {
  const query = matchMedia(PHONE);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}

// false on the server, so the page renders the desktop layout first and switches once it's in the browser
export function usePhone() {
  return useSyncExternalStore(subscribe, () => matchMedia(PHONE).matches, () => false);
}
