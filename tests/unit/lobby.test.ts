import { describe, it, expect, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
// Loaded by a computed path so the client's type check does not pull in the Worker's types.
const { Lobby } = (await import('../../worker/lobby' + '')) as { Lobby: new (ctx: never, env: never) => { fetch(r: Request): Promise<Response> } };
import { TUNING as T } from '../../shared/tuning';

const lobby = () => {
  const store = new Map<string, unknown>();
  const ctx = { storage: { list: async () => new Map(), put: async (k: string, v: unknown) => void store.set(k, v), delete: async (k: string) => void store.delete(k) } };
  const l = new Lobby(ctx as never, {} as never);
  const get = (path: string) => l.fetch(new Request('https://lobby' + path));
  const report = (room: string, humans: number) => l.fetch(new Request('https://lobby/report', { method: 'POST', body: JSON.stringify({ spot: 'canoes', room, humans }) }));
  return { get, report };
};

describe('the spending cap on rooms', () => {
  it('opens rooms up to the cap, then refuses new ones but still lets people into open ones', async () => {
    const { get, report } = lobby();
    for (let i = 0; i < T.rooms.maxRooms; i++) { expect((await get(`/admit?break=canoes&room=room${i}`)).status).toBe(200); await report(`room${i}`, T.rooms.maxHumans); }
    expect((await get('/admit?break=queens&room=extra')).status).toBe(503); // a hand-typed room, on the other break
    expect((await get('/join?break=canoes')).status).toBe(503); // every open room is full, and no new one may open
    expect((await get('/admit?break=canoes&room=room0')).status).toBe(200); // an open room is always reachable
    await report('room0', 3);
    expect(((await (await get('/join?break=canoes')).json()) as { room: string }).room).toBe('room0'); // space again: sent there
    await report('room1', 0); // the last person left
    expect((await get('/admit?break=queens&room=extra')).status).toBe(200);
  });
  it('holds the slot between admitting someone and the room reporting, so two people cannot both open the last room', async () => {
    const { get } = lobby();
    for (let i = 0; i < T.rooms.maxRooms; i++) expect((await get(`/admit?break=canoes&room=room${i}`)).status).toBe(200);
    expect((await get('/admit?break=canoes&room=another')).status).toBe(503);
  });
});
