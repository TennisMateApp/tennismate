// app/matches/page.tsx (Server Component)
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import MatchesClient from './MatchesClient';

export default function Page() {
  return <MatchesClient />;
}
