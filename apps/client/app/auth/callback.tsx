import { Redirect } from 'expo-router';

/** Already signed in when the email's button was opened: nothing to do here. (Signed out, SignIn handles it.) */
export default function AuthCallback() {
  return <Redirect href="/groups" />;
}
