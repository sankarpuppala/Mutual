/**
 * The in-app self-test must pass in the app's own JS environment (risks R4, R5). Running it
 * under jest is not a substitute for running it on a phone -- the dev panel does that --
 * but it catches a broken import path or a mangled vectors.json before a build.
 */
import { runProtocolSelfTest } from '@/dev/protocolSelfTest';

describe('protocol self-test', () => {
  it('reproduces every vector it checks', () => {
    const result = runProtocolSelfTest();
    expect(result.cases.filter((c) => !c.passed)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('checks at least ten vectors, as PLAN.md Phase 8 requires', () => {
    expect(runProtocolSelfTest().cases.length).toBeGreaterThanOrEqual(10);
  });

  it('knows which protocol version it is testing', () => {
    expect(runProtocolSelfTest().protocolVersion).toBe(1);
  });
});
