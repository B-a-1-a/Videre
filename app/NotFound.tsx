import { Link } from "react-router";
import { Button } from "~/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          404
        </p>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you requested does not exist in this desktop build.
        </p>
        <div className="pt-2">
          <Link to="/projects">
            <Button>Go to Projects</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
