/**
 * `eas.json` build profiles (docs/DEPLOYMENT.md). A build anyone else installs must be a
 * production build -- no dev panel, no clock travel (invariant 11) -- and must talk to the
 * server over HTTPS, because Android release builds refuse cleartext HTTP.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Profile {
  developmentClient?: boolean;
  env?: Record<string, string>;
}

const eas = JSON.parse(readFileSync(join(__dirname, '..', 'eas.json'), 'utf8')) as {
  build: Record<string, Profile>;
};

describe('eas.json build profiles', () => {
  it('only the development profile is a dev build', () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      const env = profile.env?.EXPO_PUBLIC_MUTUAL_ENV;
      if (name === 'development') {
        expect(env).toBe('dev');
        expect(profile.developmentClient).toBe(true);
      } else {
        expect(env).toBe('prod');
        expect(profile.developmentClient).toBeFalsy();
      }
    }
  });

  it('every release profile points at an https server', () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      if (name === 'development') continue;
      expect(profile.env?.EXPO_PUBLIC_SERVER_URL).toMatch(/^https:\/\//);
    }
  });
});
