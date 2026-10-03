import FleetView from '@/components/dashboard/fleet/FleetView';

/**
 * SAM — the home page, now the fleet floor (T22, Must 1, 22).
 *
 * `FleetView` picks the desktop shell or the phone layout before first
 * paint (T13). The old Dashboard moved to `/classic`, unchanged, reachable
 * only by its URL (it is not in the nav).
 */
export default function Page() {
  return <FleetView />;
}
