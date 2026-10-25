import { Redirect } from 'expo-router';

/**
 * Home is /groups. On the website the server shows the landing page at / and never loads the app
 * there; this only runs in the phone apps and on in-app links to /.
 */
export default function Index() {
  return <Redirect href="/groups" />;
}
