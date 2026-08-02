import type { MouseEvent, ReactNode } from "react";

interface AppLinkProps {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly ariaCurrent?: "page";
}

export function AppLink({
  to,
  children,
  className,
  ariaLabel,
  ariaCurrent,
}: AppLinkProps) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (window.location.pathname !== to) {
      window.history.pushState(null, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  return (
    <a
      className={className}
      href={to}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      onClick={navigate}
    >
      {children}
    </a>
  );
}
