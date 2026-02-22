export async function loader() {
  return new Response(null, {
    status: 302,
    headers: { Location: "/projects" },
  });
}

export default function IndexRoute() {
  return null;
}
