import { redirect } from 'next/navigation';

/** The office now lives on top of every page (see OfficeDock in the Shell). */
export default function KantorPage() {
  redirect('/trade');
}
