import { Redirect, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../../../src/data/StoreProvider';
import { ExpenseDetail } from '../../../../src/screens/ExpenseDetail';
import { Header } from '../../../../src/ui/Header';
import { Screen, useWide } from '../../../../src/ui/kit';
import { Missing } from '../../../../src/ui/Missing';

export default function ExpenseScreen() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid: string }>();
  const { state } = useStore();
  const wide = useWide();
  // Laptops show expenses in the group's side panel, so a direct link opens that view.
  if (wide) return <Redirect href={`/group/${id}?e=${eid}`} />;
  const e = state.expenses.find((x) => x.id === eid);
  if (!e) return <Missing what="expense" back={`/group/${id}`} />;
  return (
    <Screen maxWidth={640}>
      <Header back={`/group/${id}`} />
      <ExpenseDetail expense={e} />
    </Screen>
  );
}
