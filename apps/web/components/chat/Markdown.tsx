import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_SCHEME } from "@/lib/citations";

/** Renders the assistant's markdown (lists, bold, tables); `cite:` links become source pills. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) =>
            href?.startsWith(CITE_SCHEME) ? (
              <span className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 align-middle text-xs font-medium text-brand-ink" title={`Source: ${decodeURIComponent(href.slice(CITE_SCHEME.length))}`}>
                <span aria-hidden>📄</span>
                <span className="sr-only">Source: </span>
                {children}
              </span>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="text-brand underline">
                {children}
              </a>
            ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-stone-200 px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-stone-100 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
