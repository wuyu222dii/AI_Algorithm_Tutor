'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpenText,
  ChartNoAxesColumn,
  ClipboardCheck,
  Code2,
  LibraryBig,
  LogIn,
  Sparkles,
  X,
} from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

const VISITOR_WELCOME_KEY = 'algocoach:visitor-welcome:v1';

const copy = {
  zh: {
    badge: '访客模式',
    title: '先看看 AI 算法教练能做什么',
    description:
      '无需注册即可体验“教、练、测、评”完整流程。访客进度保存在当前浏览器，登录后可同步到个人账户。',
    features: [
      {
        title: '教：逐级形成思路',
        description: '从概念提示到解法方向和伪代码，保留独立思考空间。',
        icon: BookOpenText,
      },
      {
        title: '练：真实运行代码',
        description: '在浏览器中执行 JavaScript 或 Python，并查看测试反馈。',
        icon: Code2,
      },
      {
        title: '测：独立限时测评',
        description: '关闭 AI 提示，用固定题目检验正确率与解题效率。',
        icon: ClipboardCheck,
      },
      {
        title: '评：定位薄弱环节',
        description: '沉淀错因、知识点掌握度和个性化复习卡片。',
        icon: ChartNoAxesColumn,
      },
    ],
    continue: '以访客身份开始',
    problems: '浏览题库',
    signIn: '登录同步进度',
    reopen: '访客导览',
    close: '关闭访客导览',
  },
  en: {
    badge: 'Guest mode',
    title: 'See what AlgoCoach can do',
    description:
      'Explore the full learn, practice, assess, and review loop without registering. Guest progress stays in this browser; signing in enables account sync.',
    features: [
      {
        title: 'Learn: build the approach',
        description:
          'Move from concepts to direction and pseudocode without losing ownership.',
        icon: BookOpenText,
      },
      {
        title: 'Practice: run real code',
        description:
          'Execute JavaScript or Python in the browser and inspect test feedback.',
        icon: Code2,
      },
      {
        title: 'Assess: work independently',
        description:
          'Turn off AI assistance and measure accuracy and efficiency under time.',
        icon: ClipboardCheck,
      },
      {
        title: 'Review: find weak patterns',
        description:
          'Keep diagnoses, topic mastery, and personalized review cards together.',
        icon: ChartNoAxesColumn,
      },
    ],
    continue: 'Continue as guest',
    problems: 'Browse problems',
    signIn: 'Sign in to sync',
    reopen: 'Guest tour',
    close: 'Close guest tour',
  },
} as const;

export function VisitorWelcomeDialog({ locale }: { locale: 'zh' | 'en' }) {
  const t = copy[locale];
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id;
  const [open, setOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(false);

  useEffect(() => {
    if (isPending) return;

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(VISITOR_WELCOME_KEY) === 'seen';
    } catch {
      // The welcome window still works when browser storage is restricted.
    }

    const timer = window.setTimeout(
      () => {
        if (userId) {
          setOpen(false);
          return;
        }
        if (seen) setHasSeen(true);
        else setOpen(true);
      },
      seen || userId ? 0 : 350
    );

    return () => window.clearTimeout(timer);
  }, [isPending, userId]);

  function rememberVisit() {
    try {
      window.sessionStorage.setItem(VISITOR_WELCOME_KEY, 'seen');
    } catch {
      // Closing the window should never depend on browser storage access.
    }
    setHasSeen(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) rememberVisit();
  }

  if (isPending || userId) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100svh-2rem)] max-w-2xl gap-0 overflow-y-auto rounded-lg p-0"
        >
          <DialogHeader className="bg-muted/40 relative border-b p-5 pr-14 text-left sm:p-6 sm:pr-16">
            <Badge className="mb-1 w-fit rounded-md" variant="secondary">
              <Sparkles />
              {t.badge}
            </Badge>
            <DialogTitle className="text-xl leading-7 sm:text-2xl">
              {t.title}
            </DialogTitle>
            <DialogDescription className="max-w-xl leading-6">
              {t.description}
            </DialogDescription>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4"
                aria-label={t.close}
                title={t.close}
              >
                <X />
              </Button>
            </DialogClose>
          </DialogHeader>

          <div className="grid px-5 sm:grid-cols-2 sm:px-6">
            {t.features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="flex min-w-0 gap-3 border-b py-4 sm:odd:pr-5 sm:even:border-l sm:even:pl-5"
                >
                  <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm leading-5 font-semibold">
                      {feature.title}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {feature.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-muted/30 flex flex-col gap-3 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="min-w-0 flex-1">
                <Link href="/learn" onClick={rememberVisit}>
                  {t.continue}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-w-0 flex-1">
                <Link href="/problems" onClick={rememberVisit}>
                  <LibraryBig />
                  {t.problems}
                </Link>
              </Button>
            </div>
            <Button asChild variant="ghost" size="sm" className="self-center">
              <Link href="/sign-in" onClick={rememberVisit}>
                <LogIn />
                {t.signIn}
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {!open && hasSeen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-background/95 fixed right-4 bottom-4 z-40 shadow-md backdrop-blur"
          onClick={() => setOpen(true)}
        >
          <Sparkles />
          {t.reopen}
        </Button>
      ) : null}
    </>
  );
}
