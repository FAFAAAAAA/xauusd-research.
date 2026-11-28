// Protocol shared by the Worker (signaling) and the browser pages.
// Signaling messages only carry setup data (SDP, ICE). Video and audio never pass through the server.

export type Role = 'host' | 'viewer';

/** Room id alphabet: no 0/O, 1/I/L, so it can be read aloud or typed from a screenshot. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_ID_LENGTH = 8;
export const ROOM_ID_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const PIN_RE = /^\d{6}$/;

/** Exact strings for the Durable Object auto-response, so pings never wake the object. */
export const PING = '{"t":"ping"}';
export const PONG = '{"t":"pong"}';

/** WebSocket close codes the client must not retry. */
export const CLOSE = {
  replaced: 4001, // same role opened the room in another tab or device
  ended: 4004, // host ended the room
  unauthorized: 4403, // token not valid for this room
  notFound: 4404, // room does not exist or expired
} as const;
export const FATAL_CLOSE_CODES: readonly number[] = Object.values(CLOSE);

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Peer-to-peer messages, relayed as-is by the room. `pcId` names one RTCPeerConnection instance of the host. */
export type Signal =
  | { k: 'hello'; pcId: string | null; connected: boolean; ios: boolean }
  | { k: 'offer'; pcId: string; sdp: string }
  | { k: 'answer'; pcId: string; sdp: string }
  | { k: 'ice'; pcId: string; cand: IceCandidate }
  | { k: 'status'; sharing: boolean; audio: boolean };

export type ClientMsg = { t: 'signal'; data: Signal } | { t: 'end' };

export type ServerMsg =
  | { t: 'welcome'; role: Role; peer: boolean }
  | { t: 'peer'; role: Role; present: boolean }
  | { t: 'signal'; data: Signal }
  | { t: 'ended' }
  | { t: 'error'; code: 'not_found' | 'unauthorized' | 'bad_request' }
  | { t: 'pong' };

export interface CreateRoomResponse {
  roomId: string;
  pin: string;
  token: string;
}

export type JoinResponse =
  | { ok: true; token: string }
  | { ok: false; reason: 'wrong_pin'; left: number }
  | { ok: false; reason: 'locked'; retryAfterSec: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'bad_request' };

export interface IceResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  turn: boolean;
}

/** Limits enforced by the room. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
export const ROOM_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
