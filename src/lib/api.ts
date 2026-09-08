export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Something went wrong.");
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

// ------------------------------------------------------------------- types

export type Selection = "SIDE_A" | "SIDE_B" | "DRAW";
export type PickMode = "full" | "simple";

export interface User {
  id: string;
  email: string;
  username: string | null;
  timezone: string;
  hasPassword: boolean;
  notifPrefs: { reminders: boolean; digests: boolean };
}

export interface Pool {
  id: string;
  slug: string;
  name: string;
  pickMode: PickMode;
  modeLocked: boolean;
  inviteCode?: string;
  joinClosesAt: string;
  joinOpen: boolean;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export interface RoundSummary {
  code: string;
  name: string;
  kind: "league" | "knockout";
  pointsPerPick: number;
  sequence: number;
  status: string;
  firstKickoffAt: string | null;
  contestCount: number;
  openCount: number;
  pickedCount: number;
}

export interface TeamRef {
  id: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
}

export interface Contest {
  id: string;
  kind: "fixture" | "tie";
  sideA: TeamRef;
  sideB: TeamRef;
  locksAt: string;
  locked: boolean;
  status: string;
  outcome: Selection | null;
  allowedSelections: Selection[];
  line: { sideA: number; sideB: number; book: string } | null;
  awaitingLine: boolean;
  myPick: {
    selection: Selection;
    lineAtPick: number | null;
    isCorrect: boolean | null;
    pointsAwarded: number | null;
  } | null;
}

export interface RoundDetail {
  round: {
    code: string;
    name: string;
    kind: "league" | "knockout";
    pointsPerPick: number;
    status: string;
    firstKickoffAt: string | null;
    oddsLockAt: string | null;
    pickMode: PickMode;
  };
  awaitingDraw: boolean;
  contests: Contest[];
}

export interface StandingsRow {
  userId: string;
  name: string;
  total: number;
  rank: number | null;
  rounds: Record<
    string,
    { points: number; cumulative: number; rank: number | null; picksMade: number; picksPossible: number } | null
  >;
}

export interface Standings {
  pool: { slug: string; name: string; pickMode: PickMode };
  rounds: { code: string; name: string; kind: string; pointsPerPick: number; status: string }[];
  standings: StandingsRow[];
}

// --------------------------------------------------------------------- api

export const api = {
  me: () => req<{ user: User | null }>("/api/auth/me"),
  magicLink: (email: string) => post<{ ok: true }>("/api/auth/magic-link", { email }),
  passwordLogin: (email: string, password: string) =>
    post<{ ok: true }>("/api/auth/password/login", { email, password }),
  forgot: (email: string) => post<{ ok: true }>("/api/auth/password/forgot", { email }),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  updateProfile: (patch: Partial<{ username: string; timezone: string; password: string }>) =>
    req<{ ok: true }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(patch) }),

  pools: () => req<{ pools: Pool[] }>("/api/pools"),
  createPool: (input: { name: string; joinPassword: string; pickMode: PickMode }) =>
    post<{ pool: Pool }>("/api/pools", input),
  joinPool: (input: { identifier: string; joinPassword: string }) =>
    post<{ pool: Pool }>("/api/pools/join", input),
  pool: (slug: string) => req<{ pool: Pool }>(`/api/pools/${slug}`),
  members: (slug: string) =>
    req<{ members: { userId: string; name: string; role: string; email?: string }[] }>(
      `/api/pools/${slug}/members`,
    ),

  rounds: (slug: string) =>
    req<{ pickMode: PickMode; rounds: RoundSummary[] }>(`/api/pools/${slug}/rounds`),
  round: (slug: string, code: string) =>
    req<RoundDetail>(`/api/pools/${slug}/rounds/${code}`),
  submitPicks: (slug: string, picks: { contestId: string; selection: Selection }[]) =>
    post<{ accepted: unknown[] }>(`/api/pools/${slug}/picks`, { picks }),

  standings: (slug: string) => req<Standings>(`/api/pools/${slug}/standings`),
};
