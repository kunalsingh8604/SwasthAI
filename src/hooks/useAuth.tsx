import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMeFn } from "@/server/functions/auth";

export type User = {
  id: string;
  email: string;
  displayName?: string;
  preferredLanguage?: string;
};

type AuthCtx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  setAuth: (user: User | null, token: string | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  token: null,
  loading: true,
  setAuth: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setAuth = (u: User | null, t: string | null) => {
    setUser(u);
    setTokenState(t);
    if (t) {
      localStorage.setItem("auth_token", t);
    } else {
      localStorage.removeItem("auth_token");
    }
  };

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    if (!storedToken) {
      setLoading(false);
      return;
    }

    setTokenState(storedToken);
    getMeFn({ data: { token: storedToken } })
      .then((res) => {
        if (res?.user) {
          setUser(res.user);
        } else {
          setAuth(null, null);
        }
      })
      .catch((err) => {
        console.error("Auth check failed", err);
        setAuth(null, null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const signOut = async () => {
    setAuth(null, null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, setAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
