import { DurableObject } from 'cloudflare:workers';
import { TUNING as T } from '../shared/tuning';
import { BREAKS } from '../shared/waves';

interface RoomInfo { humans: number; at: number }
const STALE_MS = 90000;

/** One object for the whole game: which rooms exist for each break and how many humans are in them. */
export class Lobby extends DurableObject<Env> {
  private rooms = new Map<string, RoomInfo>(); // key: "<break>:<room>"
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    for (const [k, v] of await this.ctx.storage.list<RoomInfo>({ prefix: 'r:' })) this.rooms.set(k.slice(2), v);
    this.loaded = true;
  }
  /** Rooms with someone in them right now, across every break. */
  private open(): [string, RoomInfo][] {
    const now = Date.now();
    return [...this.rooms].filter(([, v]) => now - v.at < STALE_MS && v.humans > 0);
  }
  private live(spot: string): [string, RoomInfo][] { return this.open().filter(([k]) => k.startsWith(spot + ':')); }
  /** The hard cap. Anyone may join a room that is already open; a new room may open only while fewer than maxRooms are. */
  private admits(key: string): boolean {
    const open = this.open();
    return open.some(([k]) => k === key) || open.length < T.rooms.maxRooms;
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    const url = new URL(req.url);
    if (url.pathname === '/report' && req.method === 'POST') {
      const { spot, room, humans } = (await req.json()) as { spot: string; room: string; humans: number };
      const key = `${spot}:${room}`, info = { humans, at: Date.now() };
      this.rooms.set(key, info);
      if (humans > 0) await this.ctx.storage.put('r:' + key, info); else { this.rooms.delete(key); await this.ctx.storage.delete('r:' + key); }
      return new Response('ok');
    }
    if (url.pathname === '/rooms') {
      const out: Record<string, { rooms: number; humans: number }> = {};
      for (const spot of Object.keys(BREAKS)) { const l = this.live(spot); out[spot] = { rooms: l.length, humans: l.reduce((a, [, v]) => a + v.humans, 0) }; }
      return Response.json(out);
    }
    if (url.pathname === '/join') {
      const spot = url.searchParams.get('break') ?? 'canoes', want = url.searchParams.get('room');
      if (!BREAKS[spot]) return new Response('unknown break', { status: 400 });
      // An invite link names the room. Otherwise: the fullest room that still has space, or a new one.
      let room = want && /^[a-z0-9]{3,12}$/.test(want) ? want : undefined;
      if (!room) room = this.live(spot).filter(([, v]) => v.humans < T.rooms.maxHumans).sort((a, b) => b[1].humans - a[1].humans)[0]?.[0].split(':')[1];
      if (!room) room = Math.random().toString(36).slice(2, 8);
      if (!this.admits(`${spot}:${room}`)) return Response.json({ full: true }, { status: 503 });
      return Response.json({ break: spot, room });
    }
    // The Worker asks this before any socket reaches a room, so a hand-typed room id cannot get around the cap.
    if (url.pathname === '/admit') {
      const key = `${url.searchParams.get('break')}:${url.searchParams.get('room')}`;
      if (!this.admits(key)) return Response.json({ full: true }, { status: 503 });
      // Hold the slot until the room's own report arrives, so two people cannot both open the last room.
      if (!this.open().some(([k]) => k === key)) this.rooms.set(key, { humans: 1, at: Date.now() });
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}
