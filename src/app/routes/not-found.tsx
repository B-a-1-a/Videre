import { Link } from "react-router-dom";

export function NotFoundRoute() {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-black text-white">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">404</h1>
        <p className="text-zinc-400 mb-4">Page not found.</p>
        <Link to="/">Back to Home</Link>
      </div>
    </div>
  );
}
