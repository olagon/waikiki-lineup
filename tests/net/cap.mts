// The spending cap, end to end: with every allowed room occupied, a new room is refused (by name and through the
// lobby), and an open room still lets people in.
// usage: tests/run.sh tests/net/cap.mts [origin]   Run it when nobody else is online: other people's rooms count too.
import { Session } from '../../client/net/session';
import { DEFAULT_LOOK } from '../../shared/looks';
import { TUNING as T } from '../../shared/tuning';

const origin = process.argv[2] ?? 'http://localhost:8787', tag = Math.random().toString(36).slice(2, 6);
const join = (room: string) => Session.join(origin, 'canoes', room, 'cap' + Math.random(), 'Cap', DEFAULT_LOOK);
const tryJoin = (room: string) => join(room).then((s) => { s.close(); return 'joined'; }, (e: Error) => `refused (${e.message})`);

const open: Session[] = [];
for (let i = 0; i < T.rooms.maxRooms; i++) open.push(await join(`cap${tag}${i}`));
await new Promise((r) => setTimeout(r, 1500));
const extraRoom = await tryJoin(`cap${tag}x`); // a room past the cap, named directly
const otherBreak = (await fetch(`${origin}/api/join?break=queens`)).status; // the lobby asked for a room where none is open
const openRoom = await tryJoin(`cap${tag}0`); // a room that is already open
const direct = (await fetch(`${origin}/api/ws?break=canoes&room=cap${tag}y`)).status; // straight at the socket address, skipping the lobby
open.forEach((s) => s.close());
await new Promise((r) => setTimeout(r, 1500));
const afterLeaving = (await fetch(`${origin}/api/join?break=queens`)).status; // everyone left: rooms may open again

const pass = extraRoom !== 'joined' && otherBreak === 503 && openRoom === 'joined' && direct === 503 && afterLeaving === 200;
console.log(JSON.stringify({ maxRooms: T.rooms.maxRooms, extraRoom, otherBreak, openRoom, direct, afterLeaving, pass }));
process.exit(pass ? 0 : 1);
