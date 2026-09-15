import { expect, it } from 'vitest';
import { loadMemoryContext } from '../src/bot/memory-context';
import type { AppConfig } from '../src/config/schema';
it('does not block memory results on verbose stderr', async () => {
  const cfg = { preferences: { memoryContext: { command: process.execPath, args: ['-e', "process.stderr.write('x'.repeat(2 * 1024 * 1024), () => process.stdout.write('useful memory'))"], timeoutMs: 1500 } } } as AppConfig;
  expect(await loadMemoryContext(cfg, { chat_id: 'test', message_id: 'test', query: 'hello' })).toBe('useful memory');
});
