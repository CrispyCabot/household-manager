import type { TextBlock, TextBlockType, TextRun } from '@hhm/shared';

/**
 * Converts between the DOM a contentEditable element produces and the
 * structured block/run document the API stores. Deliberately never touches
 * `innerHTML` with a string in either direction — nodes are read from or
 * built with the live DOM API — so there is no HTML-string parsing step for
 * an attacker-controlled payload to exploit (see schemas.ts's doc comment).
 */

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

const NO_MARKS: Marks = { bold: false, italic: false, underline: false, strike: false };

export function emptyBlocks(): TextBlock[] {
  return [{ type: 'paragraph', runs: [] }];
}

export function domToBlocks(root: HTMLElement): TextBlock[] {
  const blocks: TextBlock[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim() !== '') blocks.push({ type: 'paragraph', runs: [{ text, ...NO_MARKS }] });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === 'UL' || tag === 'OL') {
      const type: TextBlockType = tag === 'UL' ? 'bullet' : 'number';
      for (const li of Array.from(el.children)) {
        if (li.tagName !== 'LI') continue;
        blocks.push({ type, runs: elementToRuns(li as HTMLElement, NO_MARKS) });
      }
      continue;
    }

    if (tag === 'BR') continue;

    let type: TextBlockType = 'paragraph';
    if (tag === 'H1') type = 'h1';
    else if (tag === 'H2') type = 'h2';
    else if (tag === 'H3') type = 'h3';

    blocks.push({ type, runs: elementToRuns(el, NO_MARKS) });
  }

  return blocks.length === 0 ? emptyBlocks() : blocks;
}

function elementToRuns(el: HTMLElement, inherited: Marks): TextRun[] {
  const runs: TextRun[] = [];

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text !== '') runs.push({ text, ...inherited });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const child = node as HTMLElement;
    const tag = child.tagName;
    if (tag === 'BR') continue;

    const marks: Marks = { ...inherited };
    if (tag === 'B' || tag === 'STRONG' || child.style.fontWeight === 'bold' || child.style.fontWeight === '700') marks.bold = true;
    if (tag === 'I' || tag === 'EM' || child.style.fontStyle === 'italic') marks.italic = true;
    if (tag === 'U' || child.style.textDecorationLine.includes('underline')) marks.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || child.style.textDecorationLine.includes('line-through')) marks.strike = true;

    runs.push(...elementToRuns(child, marks));
  }

  return runs;
}

function appendRuns(el: HTMLElement, runs: TextRun[]): void {
  for (const run of runs) {
    let node: Node = document.createTextNode(run.text);
    if (run.strike) node = wrap('s', node);
    if (run.underline) node = wrap('u', node);
    if (run.italic) node = wrap('i', node);
    if (run.bold) node = wrap('b', node);
    el.appendChild(node);
  }
}

function wrap(tag: string, node: Node): Node {
  const el = document.createElement(tag);
  el.appendChild(node);
  return el;
}

const HEADING_TAG: Partial<Record<TextBlockType, string>> = { h1: 'h1', h2: 'h2', h3: 'h3' };

/** Builds real DOM nodes for the given blocks — used to (re)populate the contentEditable root. */
export function blocksToFragment(blocks: TextBlock[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    if (block.type === 'bullet' || block.type === 'number') {
      const list = document.createElement(block.type === 'bullet' ? 'ul' : 'ol');
      while (i < blocks.length && blocks[i]!.type === block.type) {
        const li = document.createElement('li');
        appendRuns(li, blocks[i]!.runs);
        list.appendChild(li);
        i++;
      }
      frag.appendChild(list);
      continue;
    }

    const el = document.createElement(HEADING_TAG[block.type] ?? 'p');
    appendRuns(el, block.runs);
    if (block.runs.length === 0) el.appendChild(document.createElement('br'));
    frag.appendChild(el);
    i++;
  }
  return frag;
}

/** Plain-text preview for a board card — no marks, blocks joined by spaces. */
export function previewText(blocks: TextBlock[], maxLength = 140): string {
  const text = blocks
    .map((b) => b.runs.map((r) => r.text).join(''))
    .filter((t) => t.trim() !== '')
    .join('  ·  ');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function blocksEqual(a: TextBlock[], b: TextBlock[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
