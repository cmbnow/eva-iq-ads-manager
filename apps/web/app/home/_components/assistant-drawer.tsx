'use client';

import { useEffect, useRef, useState } from 'react';

import { FileText, Paperclip, Send, Sparkles, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import {
  createConversation,
  getMessages,
  listConversations,
  sendMessage,
} from '../chat/_lib/conversations';

type Msg = { role: 'user' | 'assistant'; content: string; hasImage?: boolean };
type Attached = {
  data: string;
  mediaType: string;
  name: string;
  isImage: boolean;
  preview?: string;
};

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<Attached | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || ready) return;
    setReady(true);
    listConversations()
      .then(async (list) => {
        const id = list[0]?.id ?? (await createConversation())?.id ?? null;
        setConvoId(id);
        if (id) {
          const m = await getMessages(id);
          setMessages(m.map((x) => ({ role: x.role, content: x.content, hasImage: x.hasImage })));
        }
      })
      .catch(() => {});
  }, [open, ready]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, open]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    const isImage = (file.type || '').startsWith('image/');
    setImage({
      data: btoa(bin),
      mediaType: file.type || 'application/octet-stream',
      name: file.name,
      isImage,
      preview: isImage ? URL.createObjectURL(file) : undefined,
    });
    e.target.value = '';
  }

  async function onSend() {
    if (busy) return;
    const text = input.trim();
    if (!text && !image) return;
    let id = convoId;
    if (!id) {
      id = (await createConversation())?.id ?? null;
      setConvoId(id);
    }
    if (!id) return;
    setMessages((p) => [...p, { role: 'user', content: text || '(screenshot)', hasImage: !!image }]);
    setInput('');
    const img = image;
    setImage(null);
    setBusy(true);
    const res = await sendMessage({ conversationId: id, text, attachment: img ? { data: img.data, mediaType: img.mediaType, name: img.name } : null });
    if (res.ok) setMessages((p) => [...p, { role: 'assistant', content: res.reply }]);
    else setMessages((p) => [...p, { role: 'assistant', content: `⚠️ ${res.error}` }]);
    setBusy(false);
  }

  return (
    <>
      {/* Floating launcher */}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className={'fixed right-5 bottom-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500 text-white shadow-lg transition-transform hover:scale-105'}
          aria-label={'Open EVA IQ assistant'}
        >
          <Sparkles className={'h-6 w-6'} />
        </button>
      ) : null}

      {/* Panel */}
      <div
        className={cn(
          'bg-background fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l shadow-2xl transition-transform duration-200 sm:w-[400px]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className={'flex items-center justify-between border-b p-3'}>
          <p className={'flex items-center gap-2 text-sm font-semibold'}>
            <Sparkles className={'h-4 w-4 text-cyan-500'} /> EVA IQ Assistant
          </p>
          <button onClick={() => setOpen(false)} className={'text-muted-foreground hover:text-foreground'}>
            <X className={'h-5 w-5'} />
          </button>
        </div>

        <div ref={scrollRef} className={'flex-1 space-y-3 overflow-y-auto p-3'}>
          {messages.length === 0 ? (
            <p className={'text-muted-foreground text-sm'}>
              Ask EVA IQ anything — about this client, an ad, or drop a CSV export / screenshot of your Ads Manager and ask “what should I change?”
            </p>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[88%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted',
              )}
            >
              {m.hasImage ? <span className={'mr-1'}>🖼️</span> : null}
              {m.content}
            </div>
          ))}
          {busy ? <p className={'text-muted-foreground text-xs'}>EVA IQ is thinking…</p> : null}
        </div>

        {image ? (
          <div className={'flex items-center gap-2 border-t px-3 py-2'}>
            {image.isImage && image.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.preview} alt={''} className={'h-8 w-8 rounded object-cover'} />
            ) : (
              <FileText className={'text-muted-foreground h-5 w-5'} />
            )}
            <span className={'text-muted-foreground truncate text-xs'}>
              {image.isImage ? 'Image attached' : image.name}
            </span>
            <button onClick={() => setImage(null)} className={'text-muted-foreground ml-auto'}>
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
            className={'border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm focus-visible:outline-none'}
            disabled={busy}
          />
          <Button size={'icon'} onClick={onSend} disabled={busy || (!input.trim() && !image)}>
            <Send className={'h-4 w-4'} />
          </Button>
        </div>
      </div>
    </>
  );
}
