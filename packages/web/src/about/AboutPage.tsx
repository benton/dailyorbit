import {
  Bot,
  Database,
  Mail,
  Newspaper,
  Search,
  MessageSquare,
  Bell,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { libraryImageUrl } from '../newspaper/types.ts';

const features = [
  {
    icon: Database,
    title: 'Complete FCC IBFS Archive',
    desc: 'Every international and satellite filing, comment, and attachment — fully indexed and searchable.',
  },
  {
    icon: Bot,
    title: 'AI-Powered Summaries',
    desc: 'LLM-generated summaries of every document and filing timeline, powered by multi-model inference.',
  },
  {
    icon: Search,
    title: 'Full-Text Keyword & Vector Search',
    desc: 'BM25 keyword and semantic vector search across every FCC IBFS filing ever submitted.',
  },
  {
    icon: Bell,
    title: 'Real-Time Alerts',
    desc: 'Save searches, enable alerts, and receive email notifications when new filings match.',
  },
  {
    icon: MessageSquare,
    title: 'RAG-powered Chat Consultants',
    desc: 'Ask questions and get answers grounded in the actual filing data, with cited sources.',
  },
  {
    icon: Newspaper,
    title: 'Automated Daily Newspaper',
    desc: 'AI-written articles, editorials, and news summaries generated fresh each day.',
  },
];

const techStack = [
  'Full-stack TypeScript monorepo',
  'DuckDB — analytics, full-text search, and vector search in a single engine',
  'AWS Bedrock — multi-model inference for summarization, embeddings, and RAG',
  'Server-Sent Events for real-time streaming chat',
  'Automated nightly data pipeline with incremental ingestion',
  'React + Hono + Radix UI',
];

export default function AboutPage() {
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ imagePath: string }>(
      `/api/newspaper/library/portraits/${encodeURIComponent('Benton Roberts')}`,
    )
      .then((data) => {
        if (data?.imagePath) {
          const libraryIdx: number = data.imagePath.indexOf('library/');
          const subpath: string =
            libraryIdx >= 0
              ? data.imagePath.slice(libraryIdx + 'library/'.length)
              : (data.imagePath.split('/').pop() ?? '');
          setPortraitUrl(libraryImageUrl(subpath));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Hero */}
      <section className="text-center">
        <h1
          className="text-4xl font-bold"
          style={{
            color: 'var(--do-text-heading)',
            fontFamily: 'var(--do-font-heading)',
          }}
        >
          The Daily Orbit
        </h1>
        <p className="mt-2 text-lg text-on-surface-muted">
          AI-Powered Satellite Communications Industry Intelligence
        </p>
        <p className="mt-2 text-sm text-on-surface-muted">
          <em>
            – by{' '}
            <a href="https://bentonroberts.com" className="text-on-surface-muted" target="_blank">
              benton
            </a>
          </em>
        </p>
      </section>

      {/* Features */}
      <section>
        <h2
          className="mb-4 text-xl font-semibold"
          style={{
            color: 'var(--do-text-heading)',
            fontFamily: 'var(--do-font-heading)',
          }}
        >
          What It Does
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div
              className="rounded-theme border border-border-theme bg-surface-card p-4"
              key={f.title}
            >
              <div className="mb-2 flex items-center gap-2">
                <f.icon className="h-5 w-5 text-accent-theme" />
                <h3 className="font-medium text-on-surface">{f.title}</h3>
              </div>
              <p className="text-sm text-on-surface-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it's built */}
      <section>
        <h2
          className="mb-4 text-xl font-semibold"
          style={{
            color: 'var(--do-text-heading)',
            fontFamily: 'var(--do-font-heading)',
          }}
        >
          How It's Built
        </h2>
        <div className="rounded-theme border border-border-theme bg-surface-card p-4">
          <p className="mb-3 text-sm text-on-surface-muted">
            This was built from scratch in under three weeks using AI-accelerated development. But
            it's far from "vide coded". Every layer — data ingestion, search indexing, LLM
            integration, and frontend — was designed and implemented with well-established software
            architecture patterns and the hard-won lessons from decades of coding experience.
          </p>
          <ul className="space-y-1.5">
            {techStack.map((item) => (
              <li className="flex items-start gap-2 text-sm text-on-surface" key={item}>
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-theme" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section>
        <h2
          className="mb-4 text-xl font-semibold"
          style={{
            color: 'var(--do-text-heading)',
            fontFamily: 'var(--do-font-heading)',
          }}
        >
          What's Next
        </h2>
        <div className="rounded-theme border border-border-theme bg-surface-card p-6 text-center">
          <p className="text-on-surface">
            This product has lots of great features. If you'd like to hire me to make it even{' '}
            <em>more</em> powerful, or you're interested in building something similar for your own
            use case, send me an email! I'll be happy to give you a short demo of the administrative
            interface, which exposes the prompts and other fine-grained controls for the LLM
            inference calls, per-user cost tracking, and more. We could also talk about engineering
            and look at some code, if that interests you.
            <hr className="my-4" />
            {portraitUrl && (
              <figure className="my-4 inline-block">
                <img
                  alt="(not) the Creator of this Site"
                  className="mx-auto h-40 w-32 rounded-theme border border-border-theme object-cover"
                  src={portraitUrl}
                />
                <figcaption className="mt-1 text-xs text-on-surface-muted italic">
                  (not) the Creator of this Site
                </figcaption>
              </figure>
            )}
            <p className="text-on-surface">
              Contact me at{' '}
              <a
                className="text-accent-theme underline hover:no-underline"
                href="mailto:benton@bentonroberts.com"
              >
                benton@bentonroberts.com
              </a>
            </p>
          </p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <a
              className="inline-flex items-center gap-1.5 rounded-theme border border-border-theme px-4 py-2 text-sm text-on-surface hover:bg-on-surface/5"
              href="https://bentonroberts.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Full Resume
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-theme border border-border-theme px-4 py-2 text-sm text-on-surface hover:bg-on-surface/5"
              href="mailto:benton@bentonroberts.com"
            >
              <Mail className="h-3.5 w-3.5" />
              Get in Touch
            </a>
          </div>
        </div>
      </section>

      {/* Sign in */}
      <section className="text-center">
        <p className="text-sm text-on-surface-muted">
          Already have an account?{' '}
          <Link className="text-accent-theme underline hover:no-underline" to="/login">
            Sign In
          </Link>
        </p>
      </section>
    </div>
  );
}
