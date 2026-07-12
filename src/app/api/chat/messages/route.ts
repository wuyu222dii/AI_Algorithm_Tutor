import {
  legacyFeatureDisabledResponse,
  legacyFeaturesEnabled,
} from '@/shared/lib/legacy-features';
import { respData, respErr } from '@/shared/lib/resp';
import { findChatById } from '@/shared/models/chat';
import {
  getChatMessages,
  getChatMessagesCount,
} from '@/shared/models/chat_message';
import { getUserInfo } from '@/shared/models/user';

export async function POST(req: Request) {
  if (!legacyFeaturesEnabled()) {
    return legacyFeatureDisabledResponse();
  }

  try {
    let { chatId, page, limit } = await req.json();
    if (!chatId) {
      return respErr('chatId is required');
    }

    if (!page) {
      page = 1;
    }
    if (!limit) {
      limit = 30;
    }

    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const chat = await findChatById(chatId);
    if (!chat || chat.userId !== user.id) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const messages = await getChatMessages({
      userId: user.id,
      chatId,
      page,
      limit,
    });
    const total = await getChatMessagesCount({
      userId: user.id,
      chatId,
    });

    return respData({
      list: messages,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (e: any) {
    console.log('get chat messages failed:', e);
    return respErr(`get chat messages failed: ${e.message}`);
  }
}
