'use client';

import type { ComponentType } from 'react';
import { Banknote, CheckSquare, FolderKanban, Activity } from 'lucide-react';

import type { WidgetKind, WidgetSize } from '@/types/dashboard';
import type { ToneName } from '@/components/ui/Indicators';

import { ActiveProjectsWidget } from '@/components/dashboard/widgets/ActiveProjectsWidget';
import { SystemHealthWidget } from '@/components/dashboard/widgets/SystemHealthWidget';
import { DailyTasksWidget } from '@/components/dashboard/widgets/DailyTasksWidget';
import { MoneyInWidget } from '@/components/dashboard/widgets/MoneyInWidget';

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
  'daily-tasks': {
    id: 'daily-tasks',
    title: 'Daily Tasks',
    description: 'The list you keep meaning to clear.',
    icon: CheckSquare,
    tone: 'accent',
    component: DailyTasksWidget,
  },
  'money-in': {
    id: 'money-in',
    title: 'Money In',
    description: 'Income you logged — real money, no estimates.',
    icon: Banknote,
    tone: 'success',
    component: MoneyInWidget,
  },
};

export const WIDGET_ORDER: WidgetKind[] = Object.keys(WIDGET_REGISTRY) as WidgetKind[];
