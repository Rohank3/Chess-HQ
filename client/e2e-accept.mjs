import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const guestToken = process.env.GUEST_TOKEN;
if (!guestToken) throw new Error('GUEST_TOKEN env required');

// 1. Create a challenge as the browser guest (white).
const createRes = await fetch(`${API}/api/challenges`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestToken}` },
  body: JSON.stringify({ initialMs: 600000, incrementMs: 0 }),
});
const challenge = await createRes.json();
if (!createRes.ok) {
  console.error('create_challenge_failed', challenge);
  process.exit(1);
}
console.log('CHALLENGE_ID', challenge.id);

// 2. Register a fresh guest joiner (black).
const guestRes = await fetch(`${API}/api/auth/guest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const joiner = await guestRes.json();
if (!guestRes.ok) {
  console.error('joiner_guest_failed', joiner);
  process.exit(1);
}
console.log('JOINER', joiner.user.username);
console.log('JOINER_TOKEN', joiner.token);

// 3. Connect and accept the challenge. Stay connected 10 minutes (the game
//    clock) so the click-to-move test can run, then resign to clean up.
const socket = io(API, { auth: { token: joiner.token }, transports: ['websocket'] });
socket.on('connect', () => {
  socket.emit('challenge:join', { challengeId: challenge.id }, (ack) => {
    console.log('JOIN_ACK', JSON.stringify(ack));
    if (!ack?.ok) {
      socket.disconnect();
      process.exit(1);
    }
    console.log('GAME_ID', ack.gameId);
    setTimeout(() => {
      socket.emit('game:resign', { gameId: ack.gameId }, (r) => {
        console.log('RESIGN_ACK', JSON.stringify(r));
        socket.disconnect();
        process.exit(0);
      });
    }, 600000);
  });
});
socket.on('connect_error', (e) => {
  console.error('CONNECT_ERROR', e.message);
  process.exit(1);
});
