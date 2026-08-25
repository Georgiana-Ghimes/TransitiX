/**
 * In-process pub/sub for the office live board (SSE).
 * Fine for a single API node — same limit as the idle clocks in evaluate.js.
 */

const companies = new Map(); // companyId → Set<res>

export function subscribe(companyId, res) {
  if (!companyId || !res) return () => {};
  let set = companies.get(companyId);
  if (!set) {
    set = new Set();
    companies.set(companyId, set);
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) companies.delete(companyId);
  };
}

export function publish(companyId, event, data) {
  const set = companies.get(companyId);
  if (!set?.size) return 0;
  const payload = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  const frame = `event: ${event}\ndata: ${payload}\n\n`;
  let n = 0;
  for (const res of [...set]) {
    try {
      res.write(frame);
      n += 1;
    } catch {
      set.delete(res);
    }
  }
  if (!set.size) companies.delete(companyId);
  return n;
}

/** Test / diagnostics. */
export function _subscriberCount(companyId) {
  return companies.get(companyId)?.size || 0;
}

export function _resetLiveHubForTests() {
  companies.clear();
}
