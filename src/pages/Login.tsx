import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, Field, Input, Alert } from "../components/ui";
import { Wordmark } from "../components/brand";

const LINK_ERRORS: Record<string, string> = {
  missing: "That link was incomplete. Request a new one.",
  invalid: "That link is not valid. Request a new one.",
  used: "That link has already been used. Request a new one.",
  expired: "That link expired. Links last 15 minutes — request a new one.",
};

interface LoginProps {
  /** Render just the form, for embedding inside another page's card. */
  embedded?: boolean;
  /** Same-origin path to return to after the link is used. */
  next?: string;
}

export function Login({ embedded, next }: LoginProps = {}) {
  const [params] = useSearchParams();
  const { refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    LINK_ERRORS[params.get("error") ?? ""] ?? null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (usePassword) {
        await api.passwordLogin(email, password);
        refresh();
      } else {
        await api.magicLink(email, next);
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const form = sent ? (
    <div className="space-y-4 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-star-500/15 text-xl">
        ✉️
      </div>
      <div>
        <p className="font-semibold">Check your email</p>
        <p className="mt-1.5 text-sm text-chalk-400">
          We sent a sign-in link to <span className="text-chalk-200">{email}</span>. It works
          once and expires in 15 minutes.
          {next && " Opening it will take you straight to the pool."}
        </p>
      </div>
      <Button variant="ghost" onClick={() => setSent(false)} className="w-full">
        Use a different email
      </Button>
    </div>
  ) : (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <Field label="Email">
        <Input
          type="email"
          required
          autoFocus={!embedded}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      {usePassword && (
        <Field label="Password">
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      )}

      <Button type="submit" loading={busy} className="w-full">
        {usePassword ? "Sign in" : "Email me a sign-in link"}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setUsePassword((v) => !v);
            setError(null);
          }}
          className="text-xs text-chalk-400 underline-offset-4 hover:text-chalk-200 hover:underline"
        >
          {usePassword ? "Email me a link instead" : "I have a password"}
        </button>
      </div>
    </form>
  );

  if (embedded) return form;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <Wordmark size="lg" />
        <p className="mt-3 text-sm text-chalk-400">
          Champions League predictions, round by round.
        </p>
        <div className="rule mt-6 w-40" />
      </div>

      <Card className="p-6">{form}</Card>

      <p className="mt-6 text-center text-xs text-chalk-500">
        No account needed — signing in with a link creates one.
      </p>
    </div>
  );
}
