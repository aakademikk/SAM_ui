import { Terminal } from '@/components/terminal/Terminal';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  return <Terminal jobId={id} />;
}
