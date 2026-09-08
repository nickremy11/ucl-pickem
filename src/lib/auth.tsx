import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type User } from "./api";

interface AuthValue {
  user: User | null;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  refresh: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    // The session cookie can be revoked server-side, so never serve a stale
    // "signed in" state from cache after a navigation.
    staleTime: 30_000,
  });

  return (
    <AuthContext.Provider
      value={{
        user: data?.user ?? null,
        loading: isLoading,
        refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
