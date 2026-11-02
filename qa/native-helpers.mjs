import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Poll in the test process so an unresolved renderer Promise can never pass. */
export async function poll(read, accept, label, timeout = 8000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(40);
  } while (Date.now() < end);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

export async function nativePage(app, url) {
  return poll(
    async () => {
      for (const page of app.context().pages()) {
        try {
          if ((await page.evaluate(() => location.href)) === url) return page;
        } catch {
          /* A document can be replaced while being inspected. */
        }
      }
    },
    Boolean,
    `Native page ${url}`,
  );
}
