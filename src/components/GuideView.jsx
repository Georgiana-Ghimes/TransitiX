import React, { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { searchSections } from '@/lib/guide';
import { readCollapsed, writeCollapsed } from '@/lib/collapsePreference';
import { cn } from '@/lib/utils';

/**
 * One guide, rendered.
 *
 * The same component serves the office sidebar and a phone sheet, because the two audiences
 * differ in what they read, not in how a paragraph should look. What changes with the screen is
 * width, and that is a class.
 *
 * Sections start open and remember being closed, per section and per browser. A reference
 * document is read once in full and then used as a lookup, and a reader who closed eight
 * sections to get at the ninth should not have to do it again tomorrow.
 */

function Steps({ items }) {
  return (
    <ol className="mt-2 space-y-2 list-none counter-reset">
      {items.map((item, i) => (
        <li key={item} className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A2B4E] text-[11px] font-semibold text-white">
            {i + 1}
          </span>
          <span className="text-sm leading-relaxed text-slate-700">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Terms({ items }) {
  return (
    <dl className="mt-2 space-y-2.5">
      {items.map((t) => (
        <div key={t.term} className="sm:flex sm:gap-4">
          <dt className="text-sm font-semibold text-[#0A2B4E] sm:w-56 sm:shrink-0">{t.term}</dt>
          <dd className="text-sm leading-relaxed text-slate-700">{t.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'steps':
      return <Steps items={block.items} />;
    case 'terms':
      return <Terms items={block.items} />;
    case 'note':
      return (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-600">
          {block.text}
        </p>
      );
    case 'warn':
      return (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
          {block.text}
        </p>
      );
    default:
      return <p className="mt-2 text-sm leading-relaxed text-slate-700">{block.text}</p>;
  }
}

function Section({ section, guideId, forceOpen }) {
  const storageId = `guide_${guideId}_${section.id}`;
  const [closed, setClosed] = useState(() => readCollapsed(storageId, false));
  // A search result is always shown open: the reader asked for this section by name, and
  // handing it back collapsed because of a preference set last week is an unhelpful kind of
  // consistency.
  const open = forceOpen || !closed;

  const toggle = () => {
    if (forceOpen) return;
    const next = !closed;
    setClosed(next);
    writeCollapsed(storageId, next);
  };

  return (
    <section id={section.id} className="border-b border-slate-100 py-4 last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <ChevronDown
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform',
            open ? '' : '-rotate-90',
            forceOpen && 'opacity-0',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-[#0A2B4E]">{section.title}</span>
          {section.lead && (
            <span className="mt-0.5 block text-sm leading-relaxed text-slate-500">{section.lead}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-1 pl-6">
          {(section.blocks ?? []).map((block, i) => (
            <Block key={`${section.id}-${i}`} block={block} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function GuideView({ guide, className, header = null }) {
  const [q, setQ] = useState('');
  const sections = useMemo(() => searchSections(guide?.sections, q), [guide, q]);
  const searching = q.trim().length > 0;
  const total = (guide?.sections ?? []).length;

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#0A2B4E] sm:text-2xl">{guide?.title}</h1>
        {guide?.intro && <p className="mt-1 text-sm leading-relaxed text-slate-600">{guide.intro}</p>}
      </div>

      {header}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Caută în ghid"
          aria-label="Caută în ghid"
          className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm focus:border-[#1D4E89] focus:outline-none"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Șterge căutarea"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {searching && (
        <p className="mb-2 text-xs text-slate-500">
          {sections.length === 0
            ? `Niciun capitol nu conține asta. Ghidul are ${total} capitole, șterge căutarea ca să le vezi pe toate.`
            : `${sections.length} din ${total} capitole.`}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white px-4 sm:px-5">
        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            guideId={guide?.id}
            forceOpen={searching}
          />
        ))}
      </div>
    </div>
  );
}
