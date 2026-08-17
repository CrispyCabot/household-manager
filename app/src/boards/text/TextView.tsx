import type { TextBlock, TextRun } from '@hhm/shared';
import type { ReactNode } from 'react';
import { previewText } from './serialize.js';

/** Renders a run's text through React children (auto-escaped) — see the security note atop serialize.ts. */
function renderRun(run: TextRun, key: number): ReactNode {
  let node: ReactNode = run.text;
  if (run.strike) node = <s>{node}</s>;
  if (run.underline) node = <u>{node}</u>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong>{node}</strong>;
  return <span key={key}>{node}</span>;
}

/** Read-only rendering of a text board's blocks — the default view before "Edit" is clicked. */
export function TextView({ blocks }: { blocks: TextBlock[] }) {
  if (previewText(blocks) === '') {
    return <p className="notice">Nothing here yet. Click Edit to add content.</p>;
  }

  const elements: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;

    if (block.type === 'bullet' || block.type === 'number') {
      const items: ReactNode[] = [];
      while (i < blocks.length && blocks[i]!.type === block.type) {
        items.push(<li key={i}>{blocks[i]!.runs.map(renderRun)}</li>);
        i++;
      }
      elements.push(
        block.type === 'bullet' ? (
          <ul key={elements.length}>{items}</ul>
        ) : (
          <ol key={elements.length}>{items}</ol>
        ),
      );
      continue;
    }

    const runs = block.runs.map(renderRun);
    if (block.type === 'h1') elements.push(<h1 key={i}>{runs}</h1>);
    else if (block.type === 'h2') elements.push(<h2 key={i}>{runs}</h2>);
    else if (block.type === 'h3') elements.push(<h3 key={i}>{runs}</h3>);
    else elements.push(<p key={i}>{runs}</p>);
    i++;
  }

  return <div className="textview">{elements}</div>;
}
