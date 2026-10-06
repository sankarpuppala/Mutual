/**
 * The network boundary (CLAUDE.md invariant 1, SPEC §13.8). These tests pin the things that
 * would be privacy bugs rather than ordinary bugs: that a transport error never carries the
 * URL (a URL can contain a peer or match id, and an error message can end up in a log), and
 * that the session token comes from secure storage rather than being passed by screens.
 */
import { ApiError, NetworkError, api, baseUrl, isDev } from '@/api/client';
import { clearSessionToken, setSessionToken } from '@/storage/secure';

const realFetch = global.fetch;

function mockFetch(impl: jest.Mock): jest.Mock {
  global.fetch = impl as unknown as typeof fetch;
  return impl;
}

afterEach(async () => {
  global.fetch = realFetch;
  await clearSessionToken();
});

describe('api client', () => {
  it('reads its base URL and env from the Expo config', () => {
    expect(baseUrl()).toBe('http://localhost:8000');
    expect(isDev()).toBe(true);
  });

  it('prefixes /v1 and attaches the stored session token', async () => {
    await setSessionToken('session-abc');
    const fetchMock = mockFetch(
      jest.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })),
    );
    await api.get('/account/me');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://localhost:8000/v1/account/me');
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer session-abc');
  });

  it('omits the Authorization header when the caller asks for no auth', async () => {
    const fetchMock = mockFetch(jest.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await api.post('/auth/request-otp', { email: 'a@b.ac.in' }, { auth: false });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns undefined for 204 and 202 rather than failing to parse an empty body', async () => {
    mockFetch(jest.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.post('/discovery/pause')).resolves.toBeUndefined();
  });

  it('surfaces the server error code so screens can branch on it', async () => {
    mockFetch(
      jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'campus_not_open', message: 'Not yet.' }), {
          status: 403,
        }),
      ),
    );
    await expect(api.post('/auth/request-otp', {}, { auth: false })).rejects.toMatchObject({
      status: 403,
      code: 'campus_not_open',
    });
  });

  it('never lets a transport error carry the URL into its message', async () => {
    mockFetch(
      jest
        .fn()
        .mockRejectedValue(new Error('request to http://localhost:8000/v1/matches/xyz failed')),
    );
    const error = await api.get('/matches/xyz').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).not.toContain('matches');
    expect((error as Error).message).not.toContain('localhost');
  });

  it('keeps a non-JSON error body from becoming a crash', async () => {
    mockFetch(jest.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })));
    const error = await api.get('/config').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('http_error');
  });

  it('sends a compact JSON body with a JSON content type', async () => {
    const fetchMock = mockFetch(jest.fn().mockResolvedValue(new Response(null, { status: 201 })));
    await api.put('/signals/2026-10-05', { tokens: ['a', 'b'] });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[1].body).toBe('{"tokens":["a","b"]}');
    expect((call[1].headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
