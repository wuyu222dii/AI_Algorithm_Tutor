'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { IconDots, IconMessageCircle } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/core/i18n/navigation';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/shared/components/ui/sidebar';
import { useAppContext } from '@/shared/contexts/app';
import { useChatContext } from '@/shared/contexts/chat';

export function ChatLibrary() {
  const t = useTranslations('ai.chat.library');
  const params = useParams();

  const { user } = useAppContext();

  const { chats, setChats } = useChatContext();
  const [hasMore, setHasMore] = useState(false);

  const page = 1;
  const limit = 10;

  const fetchChats = useCallback(async () => {
    try {
      const resp = await fetch('/api/chat/list', {
        method: 'POST',
        body: JSON.stringify({ page, limit }),
      });
      if (!resp.ok) {
        throw new Error(`fetch chats failed with status: ${resp.status}`);
      }
      const { code, message, data } = await resp.json();
      if (code !== 0) {
        throw new Error(message);
      }

      const { list, hasMore } = data;

      setChats(list);
      setHasMore(hasMore);
    } catch (e: any) {
      console.log('fetch chats failed:', e);
      return;
    }
  }, [limit, page, setChats]);

  useEffect(() => {
    if (user) {
      fetchChats();
    }
  }, [fetchChats, user]);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('title')}</SidebarGroupLabel>
      <SidebarMenu>
        {chats.length > 0 &&
          chats.slice(0, limit).map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton
                asChild
                className={
                  params.id === chat.id
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : ''
                }
              >
                <Link href={`/chat/${chat.id}`}>
                  <IconMessageCircle className="text-sidebar-foreground/70" />
                  <span>{chat.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

        {hasMore && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/chat/history">
                <IconDots className="text-sidebar-foreground/70" />
                <span>{t('more')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
