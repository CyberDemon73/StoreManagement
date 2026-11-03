import { redirect } from 'next/navigation';

// The app decides where to land based on the session (see (app)/layout). Unauthenticated
// users are bounced to /login by the shell; sellers land on /home, managers on /dashboard.
export default function Home() {
  redirect('/dashboard');
}
