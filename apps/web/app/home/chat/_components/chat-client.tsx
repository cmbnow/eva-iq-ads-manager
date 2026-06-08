'use client';

import { useEffect, useRef, useState } from 'react';

import { FileText, Paperclip, Plus, Send, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import {
  type ConversationMeta,
  createConversation,
  getMessages,
  listConversations,
  sendMessage,
} from '../_lib/conversations';

type Msg = { role: 'user' | 'assistant'; content: string; hasImage?: boolean };
type Attached = {
  data: string;
  mediaType: string;
  name: string;
  isImage: boolean;
  preview?: string;
};

export function ChatClient() {
  const [convos, setConvos] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<Attached | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listConversations()
      .then((list) => {
        setConvos(list);
        if (list[0]) selectConvo(list[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  function selectConvo(id: string) {
    setActiveId(id);
    setMessages([]);
    getMessages(id)
      .then((m) => setMessages(m.map((x) => ({ role: x.role, content: x.content, hasImage: x.hasImage }))))
      .catch(() => {});
  }

  async function onNew() {
    const c = await createConversation();
    if (!c) return;
    const meta: ConversationMeta = { id: c.id, title: 'New conversation', updatedAt: new Date().toISOString() };
    setConvos((p) => [meta, ...p]);
    setActiveId(c.id);
    setMessages([]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    const data = btoa(binary);
    const isImage = (file.type || '').startsWith('image/');
    setImage({
      data,
      mediaType: file.type || 'application/octet-stream',
      name: file.name,
      isImage,
      preview: isImage ? URL.createObjectURL(file) : undefined,
    });
    e.target.value = ''; // allow re-selecting the same file
  }

  async function onSend() {
    if (busy) return;
    const text = input.trim();
    if (!text && !image) return;

    let convoId = activeId;
    if (!convoId) {
      const c = await createConversation();
      if (!c) {
        setErr('Could not start a conversation.');
        return;
      }
      convoId = c.id;
      setActiveId(convoId);
      setConvos((p) => [{ id: convoId!, title: 'New conversation', updatedAt: new Date().toISOString() }, ...p]);
    }

    setMessages((p) => [...p, { role: 'user', content: text || '(screenshot)', hasImage: !!image }]);
    setInput('');
    const img = image;
    setImage(null);
    setBusy(true);
    setErr(null);

    const res = await sendMessage({ conversationId: convoId, text, attachment: img ? { data: img.data, mediaType: img.mediaType, name: img.name } : null });
    if (res.ok) {
      setMessages((p) => [...p, { role: 'assistant', content: res.reply }]);
      listConversations().then(setConvos).catch(() => {});
    } else {
      setErr(res.error);
    }
    setBusy(false);
  }

  return (
    <div className={'grid gap-4 lg:grid-cols-4'}>
      {/* Conversation list */}
      <div className={'min-w-0 space-y-2 lg:col-span-1'}>
        <Button variant={'outline'} className={'w-full justify-start'} onClick={onNew}>
          <Plus className={'mr-2 h-4 w-4'} /> New conversation
        </Button>
        {convos.map((c) => (
          <button
            key={c.id}
            onClick={() => selectConvo(c.id)}
            className={cn(
              'w-full truncate rounded-md border px-3 py-2 text-left text-sm transition-colors',
              activeId === c.id ? 'border-primary bg-accent' : 'hover:bg-accent/50',
            )}
          >
            {c.title}
          </button>
        ))}
        {convos.length === 0 ? (
          <p className={'text-muted-foreground px-1 text-xs'}>No conversations yet.</p>
        ) : null}
      </div>

      {/* Thread */}
      <div className={'min-w-0 lg:col-span-3'}>
        <Card className={'flex h-[36rem] flex-col overflow-hidden'}>
          <div ref={scrollRef} className={'flex-1 space-y-3 overflow-y-auto p-4'}>
            {messages.length === 0 ? (
              <p className={'text-muted-foreground text-sm'}>
                Ask EVA IQ about this client, or drop in a CSV export / screenshot of your Ads Manager and ask “what should I change?”
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                  m.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted',
                )}
              >
                {m.hasImage ? <span className={'mr-1'}>🖼️</span> : null}
                {m.content}
              </div>
            ))}
            {busy ? <p className={'text-muted-foreground text-xs'}>EVA IQ is thinking…</p> : null}
            {err ? <p className={'text-destructive text-sm'}>{err}</p> : null}
          </div>

          {image ? (
            <div className={'flex items-center gap-2 border-t px-3 py-2'}>
              {image.isImage && image.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.preview} alt={'attachment'} className={'h-10 w-10 rounded object-cover'} />
              ) : (
                <FileText className={'text-muted-foreground h-5 w-5'} />
              )}
              <span className={'text-muted-foreground truncate text-xs'}>
                {image.isImage ? 'Image attached' : image.name}
              </span>
              <button onClick={() => setImage(null)} className={'text-muted-foreground hover:text-foreground ml-auto'}>
                <X className={'h-4 w-4'} />
              </button>
            </div>
          ) : null}

          <div className={'flex items-center gap-2 border-t p-3'}>
            <label className={'text-muted-foreground hover:text-foreground cursor-pointer'} title={'Attach CSV, Excel, Word, PDF, text, or image'}>
              <Paperclip className={'h-5 w-5'} />
              <input
                type={'file'}
                accept={'.csv,.tsv,.txt,.md,.json,.xlsx,.xls,.docx,.pdf,image/*'}
                className={'hidden'}
                onChange={onFile}
              />
            </label>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSend();
              }}
              placeholder={'Message EVA IQ…'}
              className={'border-input bg-background focus-visible:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none'}
              disabled={busy}
            />
            <Button size={'icon'} onClick={onSend} disabled={busy || (!input.trim() && !image)}>
              <Send className={'h-4 w-4'} />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
