// Single shared socket.io connection. Uses same-origin by default (Vite proxies
// /socket.io to the server in dev; in prod the server serves the client), so no
// URL config is needed for the common case.
import { io, type Socket } from 'socket.io-client';

export const socket: Socket = io({
  autoConnect: true,
  transports: ['websocket'],
  // Sends the httpOnly auth cookie on the handshake so the server can tie a
  // match to a logged-in account — see server/src/sockets/handlers.ts.
  withCredentials: true,
});
