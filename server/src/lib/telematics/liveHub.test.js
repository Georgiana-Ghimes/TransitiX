import { describe, expect, it, beforeEach } from 'vitest';
import {
  _resetLiveHubForTests,
  _subscriberCount,
  publish,
  subscribe,
} from './liveHub.js';

function fakeRes() {
  const chunks = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
}

describe('liveHub', () => {
  beforeEach(() => _resetLiveHubForTests());

  it('delivers frames only to the company that subscribed', () => {
    const a = fakeRes();
    const b = fakeRes();
    subscribe('co-a', a);
    subscribe('co-b', b);
    expect(publish('co-a', 'position', { vehicle_id: 'v1' })).toBe(1);
    expect(a.chunks[0]).toContain('event: position');
    expect(a.chunks[0]).toContain('"vehicle_id":"v1"');
    expect(b.chunks).toHaveLength(0);
  });

  it('unsubscribe stops delivery', () => {
    const res = fakeRes();
    const unsub = subscribe('co', res);
    unsub();
    expect(_subscriberCount('co')).toBe(0);
    expect(publish('co', 'ping', {})).toBe(0);
  });
});
