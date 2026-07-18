import type { SVGProps } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Bug,
  ChartNoAxesColumn,
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardCheck,
  Code2,
  FileText,
  FlaskConical,
  Folder,
  Github,
  HelpCircle,
  History,
  Home,
  House,
  Info,
  Layers3,
  Library,
  LibraryBig,
  Lightbulb,
  ListChecks,
  Mail,
  Menu,
  MessagesSquare,
  Newspaper,
  NotebookTabs,
  Play,
  Plus,
  Route,
  ScanSearch,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Target,
  User,
  UserRound,
  Users,
} from 'lucide-react';
import {
  RiChat2Line,
  RiDiscordFill,
  RiFlashlightFill,
  RiQuestionLine,
  RiTaskLine,
  RiTwitterXFill,
} from 'react-icons/ri';

const LUCIDE_ICONS = {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Bug,
  ChartNoAxesColumn,
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardCheck,
  Code2,
  FileText,
  FlaskConical,
  Folder,
  Github,
  HelpCircle,
  History,
  Home,
  House,
  Info,
  Layers3,
  Library,
  LibraryBig,
  Lightbulb,
  ListChecks,
  Mail,
  Menu,
  MessagesSquare,
  Newspaper,
  NotebookTabs,
  Play,
  Plus,
  Route,
  ScanSearch,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Target,
  User,
  UserRound,
  Users,
} as const;

const REMIX_ICONS = {
  RiChat2Line,
  RiDiscordFill,
  RiFlashlightFill,
  RiQuestionLine,
  RiTaskLine,
  RiTwitterXFill,
} as const;

export type SmartIconName =
  | keyof typeof LUCIDE_ICONS
  | keyof typeof REMIX_ICONS;

export interface SmartIconProps extends SVGProps<SVGSVGElement> {
  name: string;
  size?: number;
}

export function SmartIcon({
  name,
  size = 24,
  className,
  ...props
}: SmartIconProps) {
  if (name.startsWith('Ri')) {
    const IconComponent =
      REMIX_ICONS[name as keyof typeof REMIX_ICONS] ?? RiQuestionLine;
    return <IconComponent size={size} className={className} {...props} />;
  }

  const IconComponent =
    LUCIDE_ICONS[name as keyof typeof LUCIDE_ICONS] ?? HelpCircle;
  return <IconComponent size={size} className={className} {...props} />;
}
