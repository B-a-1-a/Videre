import { useMemo } from "react";

interface AuthUser {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  createdAt?: string;
}

interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  isSigningIn: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const LOCAL_USER: AuthUser = {
  id: "local-user",
  name: "Local User",
  email: "local@videre.app",
  image: "/videre.svg",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export function useAuth(): UseAuthResult {
  const user = useMemo(() => LOCAL_USER, []);

  return {
    user,
    isLoading: false,
    isSigningIn: false,
    signInWithGoogle: async () => {
      return;
    },
    signOut: async () => {
      return;
    },
  };
}
