/**
 * SAM — locked-off frame for HTML pages SAM made (Must 16).
 *
 * sandbox is exactly "allow-scripts": no same-origin, pop-ups, forms, modals or
 * top navigation. The frame's own document request carries the session cookie;
 * the page's own requests come from an opaque origin and carry none.
 */
export interface HtmlFrameProps {
  path: string;
  from?: string;
}

export function HtmlFrame({ path, from }: HtmlFrameProps) {
  let src = `/api/vault/file?path=${encodeURIComponent(path)}`;
  if (from) src += `&from=${encodeURIComponent(from)}`;
  const name = path.split('/').filter(Boolean).pop() || path;
  return (
    <iframe
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={src}
      title={`HTML page: ${name}`}
      className="h-full w-full border-0 bg-white"
    />
  );
}
