import { useCallback, useEffect, useRef, useState } from 'react';
import type { Consultant, Conversation, Message } from './types.ts';
import { ToastProvider, useToast } from '../ui/toast.tsx';
import {
  createConversation,
  deleteConversation,
  fetchConsultants,
  fetchConversation,
  fetchConversations,
  renameConversation,
} from './api.ts';
import ChatCostBadge from './ChatCostBadge.tsx';
import ChatInput from './ChatInput.tsx';
import ConsultantSelector from './ConsultantSelector.tsx';
import ConversationSidebar from './ConversationSidebar.tsx';
import MessageThread from './MessageThread.tsx';
import { useChatStream } from './useChatStream.ts';

export default function ChatPage() {
  return (
    <ToastProvider>
      <ChatPageInner />
    </ToastProvider>
  );
}

function ChatPageInner() {
  const [consultants, setConsultants] = useState<Array<Consultant>>([]);
  const [conversations, setConversations] = useState<Array<Conversation>>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<Message>>([]);
  const [selectedConsultant, setSelectedConsultant] = useState<Consultant | null>(null);
  const [isNewConversation, setIsNewConversation] = useState<boolean>(true);
  const [displayCostCents, setDisplayCostCents] = useState<number>(0);
  const baseCostRef = useRef<number>(0);
  const { toast } = useToast();
  const { cancel, reset, sendMessage, state: streamState } = useChatStream();

  // Build consultant lookup map
  const consultantMap: Map<number, Consultant> = new Map(
    consultants.map((c: Consultant) => [c.id, c]),
  );

  // Load consultants and conversations on mount
  useEffect(() => {
    void (async () => {
      try {
        const [c, convs] = await Promise.all([fetchConsultants(), fetchConversations()]);
        setConsultants(c);
        setConversations(convs);
        if (c.length > 0) {
          setSelectedConsultant(c[0]!);
        }
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : 'Failed to load';
        toast(msg, 'error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load conversation messages when active changes
  useEffect(() => {
    if (activeConvId == null) {
      return;
    }
    void (async () => {
      try {
        const conv = await fetchConversation(activeConvId);
        setMessages(conv.messages);
        // Set consultant to match conversation's current consultant
        const consultant: Consultant | undefined = consultantMap.get(conv.consultantId);
        if (consultant != null) {
          setSelectedConsultant(consultant);
        }
        // Initialize cost from conversation total
        baseCostRef.current = conv.totalCostCents;
        setDisplayCostCents(conv.totalCostCents);
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : 'Failed to load conversation';
        toast(msg, 'error');
      }
    })();
  }, [activeConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When streaming completes, refresh messages and conversation list
  useEffect(() => {
    if (streamState.status !== 'done') {
      return;
    }
    if (activeConvId == null) {
      return;
    }
    void (async () => {
      const conv = await fetchConversation(activeConvId);
      setMessages(conv.messages);
      // Reset cost to authoritative server value
      baseCostRef.current = conv.totalCostCents;
      setDisplayCostCents(conv.totalCostCents);
      const convs = await fetchConversations();
      setConversations(convs);
    })();
    reset();
  }, [streamState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-update cost from SSE usage events during streaming
  useEffect(() => {
    if (streamState.usage?.costCents == null) {
      return;
    }
    setDisplayCostCents(baseCostRef.current + streamState.usage.costCents);
  }, [streamState.usage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle new conversation
  const handleNew = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setIsNewConversation(true);
    setDisplayCostCents(0);
    baseCostRef.current = 0;
    reset();
  }, [reset]);

  // Handle selecting a conversation
  const handleSelect = useCallback(
    (id: string) => {
      setActiveConvId(id);
      setIsNewConversation(false);
      reset();
    },
    [reset],
  );

  // Handle sending a message
  const handleSend = useCallback(
    async (content: string) => {
      if (selectedConsultant == null) {
        return;
      }

      let convId: string = activeConvId ?? '';

      // Create conversation if new
      if (convId === '') {
        try {
          const conv = await createConversation(selectedConsultant.id);
          convId = conv.id;
          setActiveConvId(convId);
          setIsNewConversation(false);
          setConversations((prev) => [conv, ...prev]);
        } catch (error: unknown) {
          const msg: string =
            error instanceof Error ? error.message : 'Failed to create conversation';
          toast(msg, 'error');
          return;
        }
      }

      // Add optimistic user message to local state
      const optimisticMsg: Message = {
        consultantId: null,
        content,
        conversationId: convId,
        costCents: 0,
        createdAt: new Date().toISOString(),
        id: `temp-${String(Date.now())}`,
        inputTokens: null,
        modelId: null,
        outputTokens: null,
        role: 'user',
        sequence: messages.length + 1,
        sources: null,
      };
      setMessages((prev) => [...prev, optimisticMsg]);

      sendMessage(convId, content);
    },
    [activeConvId, selectedConsultant, messages.length, sendMessage, toast],
  );

  // Handle rename
  const handleRename = useCallback(
    async (id: string, title: string) => {
      try {
        await renameConversation(id, title);
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : 'Rename failed';
        toast(msg, 'error');
      }
    },
    [toast],
  );

  // Handle delete
  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this conversation?')) {
        return;
      }
      try {
        await deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConvId === id) {
          handleNew();
        }
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : 'Delete failed';
        toast(msg, 'error');
      }
    },
    [activeConvId, handleNew, toast],
  );

  // Handle consultant switch during conversation
  const handleConsultantSwitch = useCallback((consultant: Consultant) => {
    setSelectedConsultant(consultant);
  }, []);

  const isStreaming: boolean = ['rewriting', 'retrieving', 'generating'].includes(
    streamState.status,
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <ConversationSidebar
        activeId={activeConvId}
        conversations={conversations}
        onDelete={handleDelete}
        onNew={handleNew}
        onRename={handleRename}
        onSelect={handleSelect}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {isNewConversation && messages.length === 0 ? (
          /* New conversation — show full consultant selector */
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <h1 className="mb-2 text-2xl font-semibold text-neutral-800 dark:text-neutral-200">
              Chat with your Team
            </h1>
            <p className="mb-6 text-neutral-500">Choose a consultant to start</p>
            <div className="w-full max-w-2xl">
              <ConsultantSelector
                consultants={consultants}
                onSelect={handleConsultantSwitch}
                selected={selectedConsultant}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Cost badge header */}
            <div className="flex items-center justify-end border-b border-neutral-100 px-4 py-1 dark:border-neutral-800">
              <ChatCostBadge costCents={displayCostCents} />
            </div>
            {/* Message thread */}
            <MessageThread
              consultants={consultantMap}
              isStreaming={isStreaming}
              messages={messages}
              streamingAnswer={streamState.answer}
              streamingSources={streamState.sources}
            />
          </>
        )}

        {/* Status bar */}
        {isStreaming && streamState.statusMessage !== '' && (
          <div className="border-t border-neutral-100 px-4 py-1 text-center text-xs text-neutral-400 dark:border-neutral-800">
            {streamState.statusMessage}
          </div>
        )}

        {/* Error */}
        {streamState.error != null && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {streamState.error}
          </div>
        )}

        {/* Input */}
        <ChatInput
          consultants={consultants}
          disabled={selectedConsultant == null}
          isStreaming={isStreaming}
          onCancel={cancel}
          onSelectConsultant={handleConsultantSwitch}
          onSend={handleSend}
          selectedConsultant={selectedConsultant}
        />
      </div>
    </div>
  );
}
