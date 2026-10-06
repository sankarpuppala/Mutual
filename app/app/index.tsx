/**
 * Entry route. Sends a signed-in device to the morning letter and everyone else to the
 * welcome screen. Phase 10 replaces the placeholder check with the real one (a session
 * token plus an identity key in secure storage).
 */

import { Redirect } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';

import { getIdentity, getSessionToken } from '@/storage/secure';

export default function Index(): ReactNode | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const [token, identity] = await Promise.all([getSessionToken(), getIdentity()]);
      setSignedIn(Boolean(token && identity));
    })();
  }, []);

  if (signedIn === null) return null; // one frame of the plain background, never a spinner
  return signedIn ? <Redirect href="/(tabs)/today" /> : <Redirect href="/(onboarding)/welcome" />;
}
