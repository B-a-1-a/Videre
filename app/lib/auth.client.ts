const LOCAL_USER = {
  id: "local-user",
  name: "Local User",
  email: "local@videre.app",
  image: "/videre.svg",
};

export const authClient = {
  async getSession() {
    return { user: LOCAL_USER, session: { userId: LOCAL_USER.id } };
  },
  signIn: {
    async social() {
      return { ok: true };
    },
  },
  async signOut() {
    return { ok: true };
  },
};
