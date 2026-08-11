import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authHttp.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error.js';
import { usernameSchema } from '../security/validation.js';
import {
  sendFriendRequest,
  listFriendships,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriendship,
  type FriendUser,
} from '../services/friends.js';
import { isUserOnline, emitToUser } from '../sockets/lobby.js';

export const friendsRouter = Router();

const addFriendSchema = z.object({
  username: usernameSchema,
});

const friendshipIdSchema = z.object({
  id: z.string().uuid(),
});

function withOnline(user: FriendUser): FriendUser & { online: boolean } {
  return { ...user, online: isUserOnline(user.id) };
}

/**
 * GET /api/friends — the full friend graph for the signed-in user: accepted
 * friends, incoming requests, and outgoing requests.
 */
friendsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.isGuest) {
      return next(forbidden('guests_only', 'Guest accounts cannot use friends — sign in'));
    }
    const list = await listFriendships(req.user!.id);
    res.json({
      friends: list.friends.map((f) => ({ id: f.id, user: withOnline(f.user), createdAt: f.createdAt })),
      incoming: list.incoming.map((f) => ({ id: f.id, user: withOnline(f.user), createdAt: f.createdAt })),
      outgoing: list.outgoing.map((f) => ({ id: f.id, user: withOnline(f.user), createdAt: f.createdAt })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/friends { username } — send a friend request. If the target has
 * already requested us, the pair auto-accepts. Emits realtime events to the
 * other side so their dashboard updates without a refresh.
 */
friendsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.isGuest) {
      return next(forbidden('guests_only', 'Guest accounts cannot use friends — sign in'));
    }
    const parsed = addFriendSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(badRequest('validation_error', parsed.error.issues[0]?.message));
    }

    const result = await sendFriendRequest(req.user!.id, parsed.data.username);
    if (result.kind === 'error') {
      if (result.error === 'user_not_found') {
        return next(notFound('user_not_found', result.message));
      }
      if (result.error === 'already_friends' || result.error === 'already_requested') {
        return next(conflict(result.error, result.message));
      }
      return next(badRequest(result.error, result.message));
    }

    const { friendshipId, accepted, friend, me } = result;
    if (accepted) {
      // The target had already requested us — notify them that the pair is
      // now mutual. `friend` is us from their perspective.
      emitToUser(friend.id, 'friend:accepted', { friendshipId, friend: me });
      res.status(201).json({ id: friendshipId, accepted: true, friend: withOnline(friend) });
    } else {
      emitToUser(friend.id, 'friend:request', { friendshipId, requester: me });
      res.status(201).json({ id: friendshipId, accepted: false, friend: withOnline(friend) });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/friends/:id/accept — accept an incoming request. Notifies the
 * requester in realtime.
 */
friendsRouter.post('/:id/accept', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.isGuest) {
      return next(forbidden('guests_only', 'Guest accounts cannot use friends — sign in'));
    }
    const parsed = friendshipIdSchema.safeParse({ id: req.params.id });
    if (!parsed.success) {
      return next(badRequest('validation_error', 'Invalid friend request id'));
    }
    const result = await acceptFriendRequest(req.user!.id, parsed.data.id);
    if (!result.ok) {
      return next(notFound('request_not_found', result.message));
    }
    // From the requester's perspective the new friend is us (the acceptor).
    emitToUser(result.requester.id, 'friend:accepted', {
      friendshipId: result.friendshipId,
      friend: result.acceptor,
    });
    res.json({ id: result.friendshipId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/friends/:id/decline — decline an incoming request. Notifies the
 * requester in realtime.
 */
friendsRouter.post('/:id/decline', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.isGuest) {
      return next(forbidden('guests_only', 'Guest accounts cannot use friends — sign in'));
    }
    const parsed = friendshipIdSchema.safeParse({ id: req.params.id });
    if (!parsed.success) {
      return next(badRequest('validation_error', 'Invalid friend request id'));
    }
    const result = await declineFriendRequest(req.user!.id, parsed.data.id);
    if (!result.ok) {
      return next(notFound('request_not_found', result.message));
    }
    emitToUser(result.requesterId, 'friend:declined', { friendshipId: parsed.data.id });
    res.json({ id: parsed.data.id });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/friends/:id — remove an accepted friendship (or cancel an
 * outgoing request). Either side can do it.
 */
friendsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.isGuest) {
      return next(forbidden('guests_only', 'Guest accounts cannot use friends — sign in'));
    }
    const parsed = friendshipIdSchema.safeParse({ id: req.params.id });
    if (!parsed.success) {
      return next(badRequest('validation_error', 'Invalid friendship id'));
    }
    const result = await removeFriendship(req.user!.id, parsed.data.id);
    if (!result.ok) {
      return next(notFound('friendship_not_found', result.message));
    }
    res.json({ id: parsed.data.id });
  } catch (err) {
    next(err);
  }
});
