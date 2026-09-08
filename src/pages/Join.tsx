import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, Button, Spinner, Alert } from "../components/ui";
import { Wordmark, StarMark } from "../components/brand";
import { kickoffLabel } from "../lib/format";
import { Login } from "./Login";

/**
 * Invite landing page.
 *
 * Handles the case that matters most — someone with no account clicking a link
 * from a group chat. They see what they are joining first, sign in with the
 * invite remembered across the email round-trip, and land back here already
 * authenticated, at which point the join happens without another tap.
 */
export function Join() {
  const { code = "" } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api.invite(code),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.acceptInvite(code),
    onSuccess: ({ pool }) => {
      qc.invalidateQueries({ queryKey: ["pools"] });
      navigate(`/p/${pool.slug}`, { replace: true });
    },
  });

  // Auto-join once signed in, so returning from the magic link lands the user
  // straight in the pool. The ref keeps StrictMode's double-effect from firing
  // two joins.
  const attempted = useRef(false);
  useEffect(() => {
    if (loading || !user || !data?.invite.joinOpen || accept.isPending) return;
    if (attempted.current) return;
    attempted.current = true;
    accept.mutate();
  }, [loading, user, data, accept]);

  if (isLoading || loading) return <Spinner />;

  if (error) {
    return (
      <Shell>
        <Card className="p-7 text-center">
          <p className="text-2xl">🔗</p>
          <p className="mt-3 font-bold">This invite link isn&rsquo;t valid</p>
          <p className="mt-1.5 text-sm text-chalk-400">
            {error instanceof ApiError ? error.message : "Ask whoever invited you for a new one."}
          </p>
        </Card>
      </Shell>
    );
  }

  const invite = data!.invite;

  // Already a member: skip the ceremony entirely.
  if (invite.alreadyMember && invite.slug) {
    navigate(`/p/${invite.slug}`, { replace: true });
    return <Spinner />;
  }

  return (
    <Shell>
      <Card className="overflow-hidden">
        <div className="border-b border-pitch-800 bg-gradient-to-br from-star-500/15 to-nebula-500/10 px-6 py-7 text-center">
          <StarMark size={40} className="mx-auto" />
          <p className="mt-3 text-[11px] font-bold tracking-[0.16em] text-star-300 uppercase">
            You&rsquo;re invited to
          </p>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight">{invite.name}</h1>
          <p className="mt-2 text-sm text-chalk-400">
            {invite.memberCount} {invite.memberCount === 1 ? "player" : "players"} ·{" "}
            {invite.pickMode === "full" ? "Full choice" : "Against the spread"}
          </p>
        </div>

        <div className="p-6">
          {!invite.joinOpen ? (
            <Alert>
              This pool closed to new members at kickoff on{" "}
              {kickoffLabel(invite.joinClosesAt)}.
            </Alert>
          ) : user ? (
            <div className="space-y-3">
              {accept.error && <Alert>{(accept.error as ApiError).message}</Alert>}
              <Button
                className="w-full"
                loading={accept.isPending}
                onClick={() => accept.mutate()}
              >
                {accept.isPending ? "Joining…" : `Join ${invite.name}`}
              </Button>
              <p className="text-center text-xs text-chalk-500">
                Joining closes {kickoffLabel(invite.joinClosesAt)}.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-center text-sm text-chalk-400">
                Sign in and you&rsquo;ll join automatically — no password needed.
              </p>
              {/*
                Reuse the real sign-in form rather than a cut-down copy, passing
                the invite as the destination so it survives the email round
                trip and works when the link is opened on another device.
              */}
              <Login embedded next={`/join/${code}`} />
            </>
          )}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-7 flex justify-center">
        <Wordmark />
      </div>
      {children}
    </div>
  );
}
