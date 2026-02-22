type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string;
  createdAt: string;
};

const LOCAL_USER: SessionUser = {
  id: "local-user",
  name: "Local User",
  email: "local@videre.app",
  image: "/videre.svg",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const auth = {
  api: {
    async getSession() {
      return {
        user: LOCAL_USER,
        session: {
          userId: LOCAL_USER.id,
        },
      };
    },
  },
  async handler(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/api/auth/session")) {
      return new Response(
        JSON.stringify({
          user: LOCAL_USER,
          session: { userId: LOCAL_USER.id },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response(
      JSON.stringify({
        user: LOCAL_USER,
        session: { userId: LOCAL_USER.id },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  },
};
