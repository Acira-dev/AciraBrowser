// No React, no CSS here, so tests can load it.
/** The message as JSON, exactly as it is sent, one field to a line (a list stays on its line). */
export function messageText(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const lines = Object.entries(payload).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(',\n')}\n}`;
}

