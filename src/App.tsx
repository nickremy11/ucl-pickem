import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./lib/auth";
import { api } from "./lib/api";
import { Spinner } from "./components/ui";
import { Starfield, Wordmark } from "./components/brand";
import { Login } from "./pages/Login";
import { Join } from "./pages/Join";
import { Dashboard } from "./pages/Dashboard";
import { Pool } from "./pages/Pool";
import { Round } from "./pages/Round";
import { Standings } from "./pages/Standings";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <>
        <Starfield />
        <Spinner />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Starfield />
        <Routes>
          {/* An invite must be reachable without an account — that is the
              whole point of the link. */}
          <Route path="/join/:code" element={<Join />} />
          <Route path="*" element={<Login />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      <Starfield />
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/p/:slug" element={<Pool />} />
        <Route path="/p/:slug/r/:code" element={<Round />} />
        <Route path="/p/:slug/standings" element={<Standings />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function Nav() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();

  async function signOut() {
    await api.logout();
    qc.clear();
    refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-pitch-800/70 bg-pitch-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
        <Link to="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3">
          <span className="max-w-40 truncate text-xs text-chalk-500">
            {user?.username ?? user?.email}
          </span>
          <button
            onClick={signOut}
            className="text-xs text-chalk-400 underline-offset-4 hover:text-chalk-200 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
