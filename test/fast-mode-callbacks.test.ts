import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage, CardActionEvent } from '@larksuiteoapi/node-sdk';
import type { SessionRecord } from '../src/bot/session-store';
import type { Project } from '../src/project/registry';
import type { AppConfig } from '../src/config/schema';
const fake = vi.hoisted(() => ({
  rec: undefined as SessionRecord | undefined,
  project: {} as Project,
  send: vi.fn(async () => ({ messageId: 'model-card' })),
  update: vi.fn(async () => true),
  patch: vi.fn(),
  models: [{ id: 'only', displayName: 'Only', description: '', supportedEfforts: ['medium'], defaultEffort: 'medium', hidden: false, isDefault: true }],
}));
vi.mock('../src/agent', async original => ({ ...await original<object>(), createBackend: () => ({
  id: 'codex-appserver', listModels: async () => fake.models,
}) }));
vi.mock('../src/project/registry', async original => ({ ...await original<object>(),
  getProjectByName: async () => fake.project,
  getProjectByChatId: async () => fake.project,
  updateProject: async (_name: string, patch: Partial<Project>) => { Object.assign(fake.project, patch); },
}));
vi.mock('../src/bot/session-store', async original => ({ ...await original<object>(),
  getSession: async () => fake.rec,
  patchSession: async (_id: string, patch: Partial<SessionRecord> | ((r: SessionRecord) => Partial<SessionRecord>)) => {
    fake.patch(patch);
    if (fake.rec) Object.assign(fake.rec, typeof patch === 'function' ? patch(fake.rec) : patch);
  },
}));
vi.mock('../src/bot/session-title-coordinator', () => ({ SessionTitleCoordinator: class { startRecovery() {} async shutdown() {} } }));
vi.mock('../src/card/managed', () => ({ sendManagedCard: fake.send, updateManagedCard: fake.update }));
import { createOrchestrator } from '../src/bot/handle-message';
import { MC } from '../src/card/command-cards';
import { DM, GS } from '../src/card/dm-cards';
let orchestrator: ReturnType<typeof createOrchestrator>;
const cfg: AppConfig = { accounts: { app: { id: 'app', secret: 'test', tenant: 'feishu' } }, preferences: { access: { ownerOpenId: 'owner' }, completionReminder: { mode: 'manual' } } };
function event(a: string, option?: string, user = 'owner', form?: Record<string, unknown>): CardActionEvent {
  return { messageId: 'model-card', chatId: 'chat', operator: { openId: user }, action: { value: { a, n: 'p' }, option }, raw: { action: { form_value: form } } } as unknown as CardActionEvent;
}
async function openModel() {
  await orchestrator.onMessage({ messageId: 'msg', chatId: 'chat', chatType: 'group', threadId: 'topic', content: '/model', senderId: 'owner', senderName: 'Owner', mentionedBot: true, createTime: Date.now(), rawContentType: 'text', resources: [], mentions: [], mentionAll: false } as NormalizedMessage);
  await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.project = { name: 'p', chatId: 'chat', cwd: '/tmp', blank: false, createdAt: 1, backend: 'codex-appserver', defaultFastMode: true };
  fake.rec = { threadId: 'topic', chatId: 'chat', cwd: '/tmp', sessionId: 'host', backend: 'codex-appserver', model: 'only', effort: 'medium', fastMode: true, summary: '', createdAt: 1, updatedAt: 1 };
  orchestrator = createOrchestrator({ send: vi.fn(async () => ({})) } as never, cfg, '/tmp');
});
afterEach(async () => { await orchestrator.shutdown(); });

describe('Fast card callbacks', () => {
  it('persists off from /model and echoes it without changing the project default', async () => {
    await openModel();
    await orchestrator.dispatcher.handle(event(MC.fast, 'off'));
    await vi.waitFor(() => expect(fake.rec?.fastMode).toBe(false), { timeout: 2000 });
    expect(fake.project.defaultFastMode).toBe(true);
    expect(JSON.stringify(fake.update.mock.calls)).toContain('Fast 已关闭');
  });
  it('rejects another user and invalid options', async () => {
    await openModel();
    await orchestrator.dispatcher.handle(event(MC.fast, 'off', 'other'));
    await orchestrator.dispatcher.handle(event(MC.fast, 'invalid'));
    expect(fake.patch).not.toHaveBeenCalled();
  });
  it('rejects a stale card after the session binding changes', async () => {
    await openModel();
    fake.rec!.sessionId = 'replacement';
    await orchestrator.dispatcher.handle(event(MC.fast, 'off'));
    await vi.waitFor(() => expect(fake.update).toHaveBeenCalled(), { timeout: 2000 });
    expect(fake.patch).not.toHaveBeenCalled();
    expect(fake.rec?.fastMode).toBe(true);
  });
  it.each([DM.modelDefaultSubmit, GS.modelDefaultSubmit])('saves Fast-only single-model form through %s', async action => {
    await orchestrator.dispatcher.handle(event(action, undefined, 'owner', { fastMode: 'off', effort: 'medium' }));
    await vi.waitFor(() => expect(fake.project.defaultFastMode).toBe(false));
    expect(fake.project.defaultModel).toBe('only');
    expect(fake.rec?.fastMode).toBe(true);
  });
  it('does not let non-admins change project Fast defaults', async () => {
    await orchestrator.dispatcher.handle(event(GS.modelDefaultSubmit, undefined, 'other', { fastMode: 'off' }));
    expect(fake.project.defaultFastMode).toBe(true);
  });
});
