'use server';

import {
  type ClaudeContentBlock,
  type ClaudeMessage,
  callClaude,
  getTenantContext,
} from '~/lib/server/ai';
import { buildAttachmentBlocks } from '~/lib/server/attachments';

export type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasImage: boolean;
  createdAt: string;
};

export async function listConversations(): Promise<ConversationMeta[]> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('conversations')
    .select('id, title, updated_at')
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    title: String(c.title),
    updatedAt: String(c.updated_at),
  }));
}

export async function createConversation(): Promise<{ id: string } | null> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('conversations')
    .insert({ tenant_id: tenant.id, user_id: user?.id ?? null })
    .select('id')
    .single();
  return data ? { id: String(data.id) } : null;
}

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('messages')
    .select('id, role, content, image_refs, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data ?? [])
    .filter((m: Record<string, unknown>) => m.role !== 'system')
    .map((m: Record<string, unknown>) => ({
      id: String(m.id),
      role: m.role as 'user' | 'assistant',
      content: String(m.content),
      hasImage: Array.isArray(m.image_refs) && m.image_refs.length > 0,
      createdAt: String(m.created_at),
    }));
}

export type SendResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

export async function sendMessage(params: {
  conversationId: string;
  text: string;
  attachment?: { data: string; mediaType: string; name: string } | null;
}): Promise<SendResult> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Route the attachment (CSV/text/Excel/Word/PDF/image) into content blocks.
  // Unsupported types return a friendly message — never a 400 from the API.
  let attBlocks: ClaudeContentBlock[] | null = null;
  let attIsImage = false;
  if (params.attachment) {
    const routed = await buildAttachmentBlocks(params.attachment);
    if (!routed.ok) return { ok: false, error: routed.error };
    attBlocks = routed.blocks;
    attIsImage = routed.isImage;
  }

  // Only images go to tenant-scoped image storage (documents are parsed to text).
  const imageRefs: string[] = [];
  if (params.attachment && attIsImage) {
    try {
      const path = `${tenant.id}/${crypto.randomUUID()}`;
      const bytes = Buffer.from(params.attachment.data, 'base64');
      const { error } = await supabase.storage
        .from('advisor-images')
        .upload(path, bytes, { contentType: params.attachment.mediaType });
      if (!error) imageRefs.push(path);
    } catch {
      /* best-effort */
    }
  }

  // Persist the user's message.
  await db.from('messages').insert({
    conversation_id: params.conversationId,
    tenant_id: tenant.id,
    role: 'user',
    content: params.text,
    image_refs: imageRefs,
  });

  // Load recent history for context.
  const { data: history } = await db
    .from('messages')
    .select('role, content')
    .eq('conversation_id', params.conversationId)
    .order('created_at', { ascending: true })
    .limit(20);

  const priorMessages: ClaudeMessage[] = ((history ?? []) as Record<string, unknown>[])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }));

  // Attach the routed blocks to the latest user turn (the one we just added).
  if (attBlocks && priorMessages.length) {
    const last = priorMessages[priorMessages.length - 1]!;
    last.content = [
      ...attBlocks,
      {
        type: 'text',
        text:
          params.text ||
          (attIsImage ? 'Please analyze this screenshot.' : 'Please analyze this file.'),
      },
    ];
  }

  const system = `You are EVA IQ, a Meta ads advisor for "${tenant.name}". The owner is NOT technical — be warm, plain-spoken, concise, and concrete. Use first-party-audience strategy only. When the user shares a screenshot, a CSV/Excel export, or a Word/PDF document, read it and explain what the numbers mean and what to change. Apply the account's rules: scale budgets gradually (never >~30–40% per step), give exact dollar figures, and only recommend switching an ad set from Initiate Checkout to Purchase if that ad set individually paces ~50+ purchases per 7-day window.`;

  const res = await callClaude({
    feature: params.attachment ? (attIsImage ? 'chat_image' : 'chat_file') : 'chat',
    maxTokens: 1200,
    system,
    messages: priorMessages,
  });

  if (!res.ok) return { ok: false, error: res.error };

  // Persist assistant reply + token usage on the row.
  await db.from('messages').insert({
    conversation_id: params.conversationId,
    tenant_id: tenant.id,
    role: 'assistant',
    content: res.text,
    tokens_in: res.tokensIn,
    tokens_out: res.tokensOut,
    model: 'claude-sonnet-4-6',
  });

  // Title the conversation from the first user message; bump updated_at.
  const title =
    params.text.trim().slice(0, 48) ||
    (params.attachment
      ? attIsImage
        ? 'Screenshot analysis'
        : `File: ${params.attachment.name}`.slice(0, 48)
      : 'New conversation');
  await db
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', params.conversationId);
  if (priorMessages.length <= 2) {
    await db
      .from('conversations')
      .update({ title })
      .eq('id', params.conversationId);
  }

  return { ok: true, reply: res.text };
}
