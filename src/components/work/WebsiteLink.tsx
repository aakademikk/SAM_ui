/**
 * SAM — outside websites are never framed (Must 18). A card with the host and a
 * link that opens a new tab with no referrer and no handle back to SAM_ui.
 * Only http and https addresses produce a link.
 */
export interface WebsiteLinkProps {
  href: string;
}

function parseWebAddress(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function WebsiteLink({ href }: WebsiteLinkProps) {
  const url = parseWebAddress(href);
  if (!url) return null;
  return (
    <div className="my-2 flex flex-col gap-2 rounded border p-3">
      <span className="text-sm opacity-70">Outside website</span>
      <span className="break-all font-medium">{url.host}</span>
      <a
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="inline-flex min-h-[44px] items-center justify-center rounded border px-4 py-2 text-center"
      >
        Open in a new tab
      </a>
    </div>
  );
}
