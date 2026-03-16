import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Badge } from '../ui/badge.tsx';
import { Label } from '../ui/label.tsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TemplateVariable = {
  name: string;
  source: string;
  description: string;
  example: string;
};

export type PromptEditorProps = {
  /** Section title, e.g. "Summarization Prompts" */
  title: string;
  /** Brief description shown below the title */
  description: string;
  /** Current system prompt value */
  systemPrompt: string;
  /** Current user prompt template value */
  userPrompt: string;
  /** Built-in default system prompt (for reset) */
  defaultSystemPrompt: string;
  /** Built-in default user prompt (for reset) */
  defaultUserPrompt: string;
  /** Available template variables */
  variables: readonly TemplateVariable[];
  /** Called when the admin changes the system prompt */
  onSystemPromptChange: (value: string) => void;
  /** Called when the admin changes the user prompt */
  onUserPromptChange: (value: string) => void;
  /** Whether the section starts expanded */
  defaultOpen?: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptEditor({
  title,
  description,
  systemPrompt,
  userPrompt,
  defaultSystemPrompt,
  defaultUserPrompt,
  variables,
  onSystemPromptChange,
  onUserPromptChange,
  defaultOpen = false,
}: PromptEditorProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const [varsOpen, setVarsOpen] = useState<boolean>(false);

  const handleResetSystem = useCallback(() => {
    onSystemPromptChange(defaultSystemPrompt);
  }, [defaultSystemPrompt, onSystemPromptChange]);

  const handleResetUser = useCallback(() => {
    onUserPromptChange(defaultUserPrompt);
  }, [defaultUserPrompt, onUserPromptChange]);

  const isSystemDefault: boolean =
    systemPrompt === defaultSystemPrompt || systemPrompt === '';
  const isUserDefault: boolean =
    userPrompt === defaultUserPrompt || userPrompt === '';

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      {/* Collapsible header */}
      <button
        className="flex w-full items-center gap-2 px-6 py-4 text-left"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-neutral-400" />
          : <ChevronRight className="h-4 w-4 text-neutral-400" />
        }
        <div>
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        </div>
        {!isSystemDefault || !isUserDefault ? (
          <Badge className="ml-auto" variant="secondary">customized</Badge>
        ) : null}
      </button>

      {open && (
        <div className="space-y-6 border-t border-neutral-200 px-6 pb-6 pt-4 dark:border-neutral-800">
          {/* System Prompt */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor={`${title}-system`}>System Prompt</Label>
              {!isSystemDefault && (
                <button
                  className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  onClick={handleResetSystem}
                  title="Reset to default"
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
            <textarea
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm leading-relaxed dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              id={`${title}-system`}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder={defaultSystemPrompt}
              rows={8}
              value={systemPrompt}
            />
            {systemPrompt === '' && (
              <p className="mt-1 text-xs text-neutral-400">
                Blank = built-in default is used
              </p>
            )}
          </div>

          {/* User Prompt Template */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor={`${title}-user`}>User Prompt Template</Label>
              {!isUserDefault && (
                <button
                  className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  onClick={handleResetUser}
                  title="Reset to default"
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
            <textarea
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm leading-relaxed dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              id={`${title}-user`}
              onChange={(e) => onUserPromptChange(e.target.value)}
              placeholder={defaultUserPrompt}
              rows={12}
              value={userPrompt}
            />
            {userPrompt === '' && (
              <p className="mt-1 text-xs text-neutral-400">
                Blank = built-in default is used
              </p>
            )}
          </div>

          {/* Variable Reference (nested collapsible) */}
          <div>
            <button
              className="flex items-center gap-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              onClick={() => setVarsOpen(!varsOpen)}
              type="button"
            >
              {varsOpen
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />
              }
              Available Variables
              <Badge variant="secondary">{variables.length}</Badge>
            </button>

            {varsOpen && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500 dark:border-neutral-700">
                      <th className="pb-2 pr-4">Variable</th>
                      <th className="pb-2 pr-4">Source</th>
                      <th className="pb-2 pr-4">Description</th>
                      <th className="pb-2">Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variables.map((v) => (
                      <tr
                        className="border-b border-neutral-100 dark:border-neutral-800"
                        key={v.name}
                      >
                        <td className="py-2 pr-4">
                          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">
                            {'{{' + v.name + '}}'}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-neutral-500">
                          {v.source}
                        </td>
                        <td className="py-2 pr-4">{v.description}</td>
                        <td className="py-2 font-mono text-xs text-neutral-500">
                          {v.example}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
