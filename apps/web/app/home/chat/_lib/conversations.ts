'use server';

import {
  type ClaudeContentBlock,
  type ClaudeMessage,
  callClaude,
  getTenantContext,
} from '~/lib/server/ai';

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
  image?: { data: string; mediaType: string } | null;
}): Promise<SendResult> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Optionally store the screenshot in tenant-scoped storage.
  const imageRefs: string[] = [];
  if (params.image) {
    try {
      const path = `${tenant.id}/${crypto.randomUUID()}`;
      const bytes = Buffer.from(params.image.data, 'base64');
      const { error } = await supabase.storage
        .from('advisor-images')
        .upload(path, bytes, { contentType: params.image.mediaType });
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

  // Attach the image to the latest user turn (the one we just added).
  if (params.image && priorMessages.length) {
    const last = priorMessages[priorMessages.length - 1]!;
    const blocks: ClaudeContentBlock[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: params.image.mediaType,
          data: params.image.data,
        },
      },
      { type: 'text', text: params.text || 'Please analyze this screenshot.' },
    ];
    last.content = blocks;
  }

  const system = `You are EVA IQ, a Meta ads advisor for "${tenant.name}". The owner is NOT technical — be warm, plain-spoken, concise, and concrete. Use first-party-audience strategy only. When the user shares a screenshot of Meta Ads Manager, read it and explain what you see and what to change. Apply the account's rules: scale budgets gradually (never >~30–40% per step), give exact dollar figures, and only recommend switching an ad set from Initiate Checkout to Purchase if that ad set individually paces ~50+ purchases per 7-day window.`;

  const res = await callClaude({
    feature: params.image ? 'chat_image' : 'chat',
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
    params.text.trim().slice(0, 48) || 'Screenshot analysis';
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
