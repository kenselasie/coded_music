"use client";

import { ToastProvider } from "@kenselasie/codeddesign";
import { darkTheme } from "@kenselasie/codeddesign/theme";
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";

const NAV = [
  {
    href: "/",
    label: "Library",
    match: (path: string) => path === "/" || path.startsWith("/tracks"),
    icon: (
      <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Zm2 .5v10h12V7H6Zm2 2h4v1.5H8V9Zm0 3h8v1.5H8V12Zm0 3h6v1.5H8V15Z"
        />
      </svg>
    ),
  },
  {
    href: "/add",
    label: "Add song",
    match: (path: string) => path.startsWith("/add"),
    icon: (
      <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Zm1 16a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"
        />
      </svg>
    ),
  },
  {
    href: "/processing",
    label: "Processing",
    match: (path: string) => path.startsWith("/processing"),
    icon: (
      <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 5h2v14H4V5Zm5 4h2v10H9V9Zm5-2h2v12h-2V7Zm5 5h2v7h-2v-7Z"
        />
      </svg>
    ),
  },
] as const;

function initials(name?: string | null, email?: string | null) {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const authPage = pathname === "/login" || pathname === "/signup";
  const theme = stylex.props(darkTheme);
  const displayName =
    session?.user?.name || session?.user?.email?.split("@")[0] || "Account";

  return (
    <div
      className={`app-shell ${authPage ? "app-shell--auth" : ""} ${theme.className ?? ""}`.trim()}
      style={theme.style}
    >
      {!authPage ? (
        <aside className="app-sidebar">
          <Link href="/" className="app-brand">
            <span className="app-brand-mark" aria-hidden="true" />
            CodedMusic
          </Link>

          <div className="app-nav-section">Workspace</div>
          <nav aria-label="Primary" className="app-nav">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.match(pathname) ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="app-sidebar-footer">
            <div className="app-user">
              <div className="app-user-avatar" aria-hidden="true">
                {initials(session?.user?.name, session?.user?.email)}
              </div>
              <div className="app-user-meta">
                <div className="app-user-name">{displayName}</div>
                {session?.user?.email ? (
                  <div className="app-user-email">{session.user.email}</div>
                ) : null}
              </div>
            </div>
            {session?.user ? (
              <button
                type="button"
                className="app-signout"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </aside>
      ) : null}
      <ToastProvider>
        <main className="app-main">
          <div className="app-content">{children}</div>
        </main>
      </ToastProvider>
    </div>
  );
}
