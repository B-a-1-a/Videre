import React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, LogOut, HardDrive } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Progress } from "~/components/ui/progress";

type UserLike = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export function ProfileMenu({
  user,
  starCount: _starCount,
  onSignOut,
}: {
  user: UserLike;
  starCount: number | null;
  onSignOut: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [usedBytes, setUsedBytes] = React.useState<number | null>(null);
  const [limitBytes, setLimitBytes] = React.useState<number>(2 * 1024 * 1024 * 1024);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/storage");
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) {
          const u = Number(j?.usedBytes || 0);
          const l = Number(j?.limitBytes || limitBytes);
          setUsedBytes(Number.isFinite(u) ? u : 0);
          setLimitBytes(Number.isFinite(l) ? l : 2 * 1024 * 1024 * 1024);
        }
      } catch {
        console.error("Storage fetch failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limitBytes]);

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"] as const;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-6 w-6 rounded-full overflow-hidden border border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/30 relative ml-1">
          <div className="absolute inset-0 bg-muted flex items-center justify-center text-[10px] font-medium">
            {(user.name ?? user.email ?? "").slice(0, 1).toUpperCase()}
          </div>
          {user.image && (
            <img
              src={user.image}
              alt={user.name ?? user.email ?? "Profile"}
              className="h-full w-full object-cover relative z-10"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              referrerPolicy="no-referrer"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.name || user.email || "Signed in"}</div>
        <DropdownMenuItem asChild>
          <a href="/profile" className="text-xs">
            View profile
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <button
            className="w-full flex items-center gap-2 text-xs"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            Switch theme
          </button>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Local Storage</DropdownMenuLabel>
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              Storage
            </span>
            <span className="font-mono">
              {usedBytes === null ? "..." : `${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}`}
            </span>
          </div>
          {
            <Progress
              // @ts-ignore radix root value
              value={
                usedBytes !== null && limitBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100)) : 0
              }
            />
          }
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            onSignOut();
            setTimeout(() => {
              // Use navigation API or router instead of direct href assignment
              window.location.assign("/");
            }, 100);
          }}
          variant="destructive">
          <LogOut className="h-4 w-4" />
          <span className="text-xs font-medium">Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
