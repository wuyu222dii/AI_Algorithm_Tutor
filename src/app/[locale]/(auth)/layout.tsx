import { envConfigs } from '@/config';
import {
  BrandLogo,
  LocaleSelector,
  ThemeToggler,
} from '@/shared/blocks/common';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-svh w-full overflow-y-auto px-4 pt-20 pb-8 sm:pt-24">
      <div className="absolute top-4 left-4 z-10 max-w-[55vw]">
        <BrandLogo
          brand={{
            title: envConfigs.app_name,
            logo: {
              src: envConfigs.app_logo,
              alt: envConfigs.app_name,
            },
            url: '/',
            target: '_self',
            className: '',
          }}
        />
      </div>
      <div className="absolute top-4 right-4 flex items-center gap-4">
        <ThemeToggler />
        <LocaleSelector type="button" />
      </div>
      <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-lg items-center justify-center">
        {children}
      </div>
    </div>
  );
}
