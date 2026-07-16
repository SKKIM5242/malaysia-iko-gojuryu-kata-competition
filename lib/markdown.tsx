import type { ReactNode } from "react";

/**
 * Minimal markdown renderer for announcement bodies — supports headings,
 * bold, italic, links, unordered lists, and paragraphs. Deliberately tiny
 * to avoid a dependency for the small subset the owner actually writes.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // bold → italic → links
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2]) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{m[2]}</strong>);
    } else if (m[4]) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{m[4]}</em>);
    } else if (m[6] && m[7]) {
      nodes.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={m[7]}
          className="text-red-700 underline underline-offset-2"
          rel="noopener noreferrer"
        >
          {m[6]}
        </a>,
      );
    }
    last = pattern.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Matches a GFM table separator row: `|---|:--:|--:|` etc. */
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        if (/^#{1,3}\s/.test(trimmed)) {
          const level = trimmed.match(/^#+/)![0].length;
          const content = renderInline(trimmed.replace(/^#{1,3}\s+/, ""), `h${bi}`);
          if (level === 1) return <h2 key={bi} className="text-xl font-bold">{content}</h2>;
          if (level === 2) return <h3 key={bi} className="text-lg font-bold">{content}</h3>;
          return <h4 key={bi} className="font-bold">{content}</h4>;
        }
        const lines = trimmed.split("\n");
        if (lines.length >= 2 && lines[0].includes("|") && TABLE_SEPARATOR.test(lines[1])) {
          const headerCells = parseTableRow(lines[0]);
          const bodyRows = lines.slice(2).map(parseTableRow);
          return (
            <div key={bi} className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-neutral-300 bg-neutral-50">
                    {headerCells.map((c, ci) => (
                      <th key={ci} className="px-3 py-2 text-left font-bold text-neutral-800">
                        {renderInline(c, `th${bi}-${ci}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-neutral-100 last:border-b-0">
                      {row.map((c, ci) => (
                        <td key={ci} className="px-3 py-2 align-top">
                          {renderInline(c, `td${bi}-${ri}-${ci}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
