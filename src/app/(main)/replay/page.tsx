import { redirect } from 'next/navigation';

// Replay was removed from the menu at the owner's request (1 Nov 2026). The API stays for the tests; the page redirects home.
export default function ReplayRemoved() {
  redirect('/');
}
