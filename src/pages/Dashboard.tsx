import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type PickMode } from "../lib/api";
import { Button, Card, Field, Input, Alert, Spinner, Empty } from "../components/ui";
import { kickoffLabel } from "../lib/format";

export function Dashboard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["pools"], queryFn: api.pools });
  const [tab, setTab] = useState<"none" | "create" | "join">("none");

  const done = () => {
    qc.invalidateQueries({ queryKey: ["pools"] });
    setTab("none");
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-xl font-bold tracking-tight">Your pools</h1>

      {isLoading ? (
        <Spinner />
      ) : data && data.pools.length > 0 ? (
        <div className="mt-5 space-y-3">
          {data.pools.map((p) => (
            <Link key={p.id} to={`/p/${p.slug}`} className="block">
              <Card className="p-4 transition-colors hover:border-star-500/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="mt-0.5 text-xs text-chalk-500">
                      {p.pickMode === "full" ? "Full choice" : "Against the spread"}
                      {p.role !== "member" && ` · ${p.role}`}
                    </p>
                  </div>
                  <span className="text-chalk-500">›</span>
                </div>
                {p.joinOpen && (
                  <p className="mt-3 border-t border-pitch-800 pt-3 text-xs text-chalk-500">
                    Closes to new members {kickoffLabel(p.joinClosesAt)}
                    {p.inviteCode && (
                      <>
                        {" · code "}
                        <span className="font-mono text-chalk-200">{p.inviteCode}</span>
                      </>
                    )}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <Empty title="No pools yet" body="Create one, or join a friend's with its name and password." />
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Button
          variant={tab === "create" ? "primary" : "ghost"}
          onClick={() => setTab(tab === "create" ? "none" : "create")}
          className="flex-1"
        >
          Create a pool
        </Button>
        <Button
          variant={tab === "join" ? "primary" : "ghost"}
          onClick={() => setTab(tab === "join" ? "none" : "join")}
          className="flex-1"
        >
          Join a pool
        </Button>
      </div>

      {tab === "create" && <CreatePool onDone={done} />}
      {tab === "join" && <JoinPool onDone={done} />}
    </div>
  );
}

function CreatePool({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [pickMode, setPickMode] = useState<PickMode>("full");

  const m = useMutation({
    mutationFn: () => api.createPool({ name, joinPassword, pickMode }),
    onSuccess: onDone,
  });

  return (
    <Card className="mt-4 p-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {m.error && <Alert>{(m.error as ApiError).message}</Alert>}

        <Field label="Pool name" hint="Friends use this name to find the pool.">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday League" />
        </Field>

        <Field label="Join password" hint="At least 4 characters. Share it with the people you invite.">
          <Input
            required
            minLength={4}
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-chalk-400 uppercase">
            Pick format
          </span>
          <div className="grid gap-2">
            <ModeOption
              active={pickMode === "full"}
              onClick={() => setPickMode("full")}
              title="Full choice"
              body="Pick home, draw or away on every league match."
            />
            <ModeOption
              active={pickMode === "simple"}
              onClick={() => setPickMode("simple")}
              title="Against the spread"
              body="Pick which side covers a goal handicap, frozen Monday 8am ET."
            />
          </div>
          <p className="mt-2 text-xs text-chalk-500">
            Knockout rounds are the same either way — pick who advances. The format locks once
            the season kicks off.
          </p>
        </div>

        <Button type="submit" loading={m.isPending} className="w-full">
          Create pool
        </Button>
      </form>
    </Card>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-star-500 bg-star-500/10"
          : "border-pitch-700 bg-pitch-950/40 hover:border-pitch-600"
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-chalk-500">{body}</p>
    </button>
  );
}

function JoinPool({ onDone }: { onDone: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const m = useMutation({
    mutationFn: () => api.joinPool({ identifier, joinPassword }),
    onSuccess: onDone,
  });

  return (
    <Card className="mt-4 p-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {m.error && <Alert>{(m.error as ApiError).message}</Alert>}

        <Field label="Pool name or invite code">
          <Input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </Field>

        <Field label="Join password">
          <Input
            required
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" loading={m.isPending} className="w-full">
          Join pool
        </Button>
      </form>
    </Card>
  );
}
