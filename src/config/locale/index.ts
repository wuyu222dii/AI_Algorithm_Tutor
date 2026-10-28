import { envConfigs } from '..';

export const localeNames: any = {
  en: 'English',
  zh: '中文',
};

export const locales = ['en', 'zh'];

export const defaultLocale = envConfigs.locale;

export const localePrefix = 'as-needed';

export const localeDetection = false;

export const localeMessagesRootPath = '@/config/locale/messages';

export const localeMessagesPaths = [
  'common',
  'landing',
  'settings/sidebar',
  'settings/profile',
  'settings/security',
  'coach/learn',
  'coach/problems',
  'coach/progress',
  'coach/practice',
  'pages/index',
  'pages/about',
  'pages/for-interview-prep',
  'pages/for-students',
  'pages/how-it-works',
];
