import { Redirect } from 'expo-router';

/** Already signed in when the Google sign-in came back: nothing to do here. (Signed out, SignIn handles it.) */
export default function AuthGoogle() {
  return <Redirect href="/groups" />;
}
