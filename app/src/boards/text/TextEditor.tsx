import { useEffect, useRef, useState } from 'react';
import type { TextBlock } from '@hhm/shared';
import { blocksEqual, blocksToFragment, domToBlocks, emptyBlocks } from './serialize.js';

const MARK_BUTTONS: { label: string; command: string; title: string }[] = [
  { label: 'B', command: 'bold', title: 'Bold' },
  { label: 'I', command: 'italic', title: 'Italic' },
  { label: 'U', command: 'underline', title: 'Underline' },
  { label: 'S', command: 'strikeThrough', title: 'Strikethrough' },
];

const BLOCK_BUTTONS: { label: string; tag: string; title: string }[] = [
  { label: 'H1', tag: 'H1', title: 'Heading 1' },
  { label: 'H2', tag: 'H2', title: 'Heading 2' },
  { label: 'H3', tag: 'H3', title: 'Heading 3' },
  { label: 'P', tag: 'P', title: 'Paragraph' },
];

/**
 * A contentEditable rich-text editor. `document.execCommand` is deprecated
 * but still the only zero-dependency way to get bold/italic/list/heading
 * editing out of a contentEditable region, and every command it runs here
 * stays within this project's no-new-dependency, no-raw-HTML-on-the-wire
 * approach (see serialize.ts).
 */
export function TextEditor({
  initialBlocks,
  onSave,
  saving,
}: {
  initialBlocks: TextBlock[];
  onSave: (blocks: TextBlock[]) => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSaved = useRef<TextBlock[]>(initialBlocks);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});
  // Populated exactly once per mount: re-running on every `initialBlocks`
  // change would clobber in-progress edits whenever the query refetches
  // after our own autosave.
  const [populated, setPopulated] = useState(false);

  useEffect(() => {
    if (populated || ref.current === null) return;
    const blocks = initialBlocks.length > 0 ? initialBlocks : emptyBlocks();
    ref.current.appendChild(blocksToFragment(blocks));
    lastSaved.current = blocks;
    setPopulated(true);
  }, [initialBlocks, populated]);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  function flush() {
    if (ref.current === null) return;
    const blocks = domToBlocks(ref.current);
    if (blocksEqual(blocks, lastSaved.current)) return;
    lastSaved.current = blocks;
    onSave(blocks);
  }

  function scheduleFlush() {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flush, 1500);
  }

  function updateActiveMarks() {
    if (document.activeElement !== ref.current) return;
    try {
      setActiveMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
      });
    } catch {
      // queryCommandState can throw when there is no active selection yet
    }
  }

  useEffect(() => {
    document.addEventListener('selectionchange', updateActiveMarks);
    return () => document.removeEventListener('selectionchange', updateActiveMarks);
  }, []);

  function exec(command: string, value?: string) {
    ref.current?.focus();
    document.execCommand(command, false, value);
    updateActiveMarks();
    scheduleFlush();
  }

  return (
    <div className="texteditor">
      <div className="texteditor__toolbar">
        {MARK_BUTTONS.map((b) => (
          <button
            key={b.command}
            type="button"
            title={b.title}
            aria-pressed={activeMarks[b.command] === true}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(b.command)}
          >
            {b.label}
          </button>
        ))}
        <span className="texteditor__divider" />
        <button type="button" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>
          • List
        </button>
        <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>
          1. List
        </button>
        <span className="texteditor__divider" />
        {BLOCK_BUTTONS.map((b) => (
          <button key={b.tag} type="button" title={b.title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', b.tag)}>
            {b.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="texteditor__content"
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleFlush}
        onBlur={flush}
      />
      <p className="texteditor__saved">{saving ? 'Saving…' : 'Saved'}</p>
    </div>
  );
}
