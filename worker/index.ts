import { Room } from './room';
import { Lobby } from './lobby';
import { BREAKS } from '../shared/waves';
export { Room, Lobby };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName('lobby'));
    if (url.pathname === '/api/health') return Response.json({ ok: true, t: Date.now() });
    if (url.pathname === '/api/join') return lobby().fetch('https://lobby/join' + url.search);
    if (url.pathname === '/api/rooms') return lobby().fetch('https://lobby/rooms');
    if (url.pathname === '/api/ws' || url.pathname === '/api/stats') {
      const spot = url.searchParams.get('break') ?? '', room = url.searchParams.get('room') ?? '';
      if (!BREAKS[spot] || !/^[a-z0-9]{3,12}$/.test(room)) return new Response('bad room', { status: 400 });
      if (url.pathname === '/api/ws' && !(await lobby().fetch(`https://lobby/admit?break=${spot}&room=${room}`)).ok) return Response.json({ full: true }, { status: 503 }); // the spending cap
      // Rooms live in western North America: about 50-60 ms round trip from Hawaiʻi.
      const stub = env.ROOM.get(env.ROOM.idFromName(`${spot}:${room}`), { locationHint: 'wnam' });
      return stub.fetch(req);
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
