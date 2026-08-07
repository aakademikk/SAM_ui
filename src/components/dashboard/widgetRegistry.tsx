'use client';

import type { ComponentType } from 'react';
import {
  Bot,
  Brain,
  CheckSquare,
  FolderKanban,
  Activity,
  Sparkles,
  TerminalSquare,
  Wallet,
} from 'lucide-react';

import type { WidgetKind, WidgetSize } from '@/types/dashboard';
import type { ToneName } from '@/components/ui/Indicators';

import { AIInsightsWidget } from '@/components/dashboard/widgets/AIInsightsWidget';
import { AgentFleetWidget } from '@/components/dashboard/widgets/AgentFleetWidget';
import { VaultMemoryWidget } from '@/components/dashboard/widgets/VaultMemoryWidget';
import { CommandTerminalWidget } from '@/components/dashboard/widgets/CommandTerminalWidget';
import { ActiveProjectsWidget } from '@/components/dashboard/widgets/ActiveProjectsWidget';
import { SystemHealthWidget } from '@/components/dashboard/widgets/SystemHealthWidget';
import { FinanceBalanceWidget } from '@/components/dashboard/widgets/FinanceBalanceWidget';
import { DailyTasksWidget } from '@/components/dashboard/widgets/DailyTasksWidget';

/** Props every widget receives from the grid. */
export interface WidgetProps {
  size: WidgetSize;
  index: number;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isOverlay?: boolean;
}

export interface WidgetDescriptor {
  id: WidgetKind;
  title: string;
  description: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  tone: ToneName;
  component: ComponentType<WidgetProps>;
}

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetDescriptor> = {
  'ai-insights': {
    id: 'ai-insights',
    title: 'SAM Insights',
    description: "Unsolicited observations about your estate and your decisions.",
    icon: Sparkles,
    tone: 'accent',
    component: AIInsightsWidget,
  },
  'agent-fleet': {
    id: 'agent-fleet',
    title: 'Agent Fleet',
    description: 'Live roster of the worker swarms under supervision.',
    icon: Bot,
    tone: 'accent-2',
    component: AgentFleetWidget,
  },
  'vault-memory': {
    id: 'vault-memory',
    title: 'Vault Memory',
    description: 'Persistent business memory indexing and retrieval.',
    icon: Brain,
    tone: 'accent',
    component: VaultMemoryWidget,
  },
  'command-terminal': {
    id: 'command-terminal',
    title: 'Command Terminal',
    description: 'Raw execution surface for workflows, containers and jobs.',
    icon: TerminalSquare,
    tone: 'success',
    component: CommandTerminalWidget,
  },
  'active-projects': {
    id: 'active-projects',
    title: 'Active Projects',
    description: 'Atwood Systems deployments and delivery health.',
    icon: FolderKanban,
    tone: 'info',
    component: ActiveProjectsWidget,
  },
  'system-health': {
    id: 'system-health',
    title: 'System Health',
    description: 'Host resources, services and automation reliability.',
    icon: Activity,
    tone: 'accent-2',
    component: SystemHealthWidget,
  },
  'finance-balance': {
    id: 'finance-balance',
    title: 'Finance',
    description: 'Balances, burn and runway, delivered without sentiment.',
    icon: Wallet,
    tone: 'success',
    component: FinanceBalanceWidget,
  },
  'daily-tasks': {
    id: 'daily-tasks',
    title: 'Daily Tasks',
    description: 'The list you keep meaning to clear.',
    icon: CheckSquare,
    tone: 'accent',
    component: DailyTasksWidget,
  },
};

export const WIDGET_ORDER: WidgetKind[] = Object.keys(WIDGET_REGISTRY) as WidgetKind[];
