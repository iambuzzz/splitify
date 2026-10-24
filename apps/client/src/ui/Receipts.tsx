import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Expense, ME, type Receipt, isAdmin } from '../data/model';
import { type DuplicateOf, type ReceiptFile, useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { pickFiles } from './files';
import { Button, Card, Label, T, isHovered, useWide } from './kit';
import { prepareReceipt } from './prepareReceipt';

const TILE = 76;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Loads a receipt's display URL (fetched with the sign-in token, then kept). */
function useReceiptUrl(r: Receipt | null) {
  const { receiptUrl } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (r) receiptUrl(r).then((u) => live && setUrl(u)).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [r?.id]);
  return { url, failed };
}

function Tile({ r, onPress }: { r: Receipt; onPress: () => void }) {
  const { theme } = useTheme();
  const pdf = r.contentType === 'application/pdf';
  const { url, failed } = useReceiptUrl(pdf ? null : r);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pdf ? 'Open bill (PDF)' : 'Open bill photo'}
      onPress={onPress}
      style={(st) => ({ width: TILE, height: TILE, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.c.border, backgroundColor: theme.c.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: isHovered(st) ? 0.85 : 1 })}
    >
      {pdf ? (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Feather name="file-text" size={24} color={theme.c.text} />
          <T size={11} weight="bold">
            PDF
          </T>
        </View>
      ) : url ? (
        <Image source={{ uri: url }} style={{ width: TILE, height: TILE }} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : failed ? (
        <Feather name="image" size={22} color={theme.c.muted} />
      ) : (
        <ActivityIndicator size="small" color={theme.c.muted} />
      )}
    </Pressable>
  );
}

/** Full-size view of one receipt, with who added it and (for those allowed) Remove. */
function Viewer({ r, canRemove, onRemove, onClose, name }: { r: Receipt; canRemove: boolean; onRemove: () => void; onClose: () => void; name: (id: string) => string }) {
  const { theme } = useTheme();
  const wide = useWide();
  const pdf = r.contentType === 'application/pdf';
  const { url, failed } = useReceiptUrl(r);
  const [confirm, setConfirm] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: wide ? 32 : 12, paddingTop: wide ? 32 : insets.top + 12, paddingBottom: wide ? 32 : insets.bottom + 12 }}
      >
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 900, flex: 1, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T size={14} color="#FFFFFF" style={{ flex: 1 }}>
              {`Added by ${name(r.by)} · ${fmtWhen(r.at)}`}
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {failed ? (
              <T color="#FFFFFF">This file couldn’t be loaded. Check your connection and try again.</T>
            ) : !url ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : pdf ? (
              <View style={{ alignItems: 'center', gap: 14 }}>
                <Feather name="file-text" size={56} color="#FFFFFF" />
                <Button title="Open the PDF" icon="external-link" size="md" onPress={() => (Platform.OS === 'web' ? window.open(url, '_blank', 'noopener') : Linking.openURL(url).catch(() => {}))} />
              </View>
            ) : (
              <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel="Bill photo" />
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {url && !pdf && Platform.OS === 'web' ? <Button title="Open full size" icon="maximize-2" size="md" variant="secondary" onPress={() => window.open(url, '_blank', 'noopener')} /> : null}
            {canRemove ? (
              confirm ? (
                <>
                  <Button title="Yes, remove it" size="md" variant="danger" onPress={onRemove} />
                  <Button title="Keep it" size="md" variant="secondary" onPress={() => setConfirm(false)} />
                </>
              ) : (
                <Button title="Remove" icon="trash-2" size="md" variant="secondary" onPress={() => setConfirm(true)} />
              )
            ) : null}
          </View>
          {canRemove && confirm ? (
            <T size={13} color="#FFFFFF" style={{ textAlign: 'center' }}>
              It disappears for everyone. The group’s history keeps a note that it was removed.
            </T>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The bill behind an expense: photos and PDFs anyone in the group can see. Adding works in the
 * browser; photos are shrunk and cleaned (no location data) before they leave the device.
 */
export function Receipts({ expense: e, name }: { expense: Expense; name: (id: string) => string }) {
  const { theme } = useTheme();
  const { state, features, addReceipt, dispatch } = useStore();
  // Coming from the expense form: photos that couldn't be added there, or one that's also on another expense.
  const params = useLocalSearchParams<{ upload?: string; dup?: string }>();
  const fromForm = state.expenses.find((x) => x.id === params.dup && x.id !== e.id);
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(
    params.upload ? `${params.upload === '1' ? 'A photo' : `${params.upload} photos`} couldn’t be added. The expense is saved; try adding again here.` : null,
  );
  const [dup, setDup] = useState<DuplicateOf | null>(fromForm ? { expenseId: fromForm.id, title: fromForm.title, sameExpense: false } : null);
  const [open, setOpen] = useState<Receipt | null>(null);
  const member = state.groups.find((g) => g.id === e.groupId)?.members.includes(ME) ?? false;
  const canAdd = features.receipts && Platform.OS === 'web' && member && e.receipts.length < 20;
  const canRemove = (r: Receipt) => member && (r.by === ME || e.payer === ME || isAdmin(state, e.groupId));

  if (!e.receipts.length && !canAdd) return null;

  const add = async () => {
    setProblem(null);
    setDup(null);
    const files = await pickFiles('image/*,application/pdf', true);
    for (const f of files.slice(0, 20 - e.receipts.length)) {
      setBusy((n) => n + 1);
      try {
        const res = await addReceipt(e.id, await prepareReceipt(f));
        if (res.duplicateOf && !res.duplicateOf.sameExpense) setDup(res.duplicateOf);
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'Could not add the file. Try again.');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  return (
    <Card>
      <Label>{e.receipts.length ? `Bill photos (${e.receipts.length})` : 'Bill photo'}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {e.receipts.map((r) => (
          <Tile key={r.id} r={r} onPress={() => setOpen(r)} />
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <View key={`up${i}`} accessibilityLabel="Uploading" style={{ width: TILE, height: TILE, borderRadius: 12, borderWidth: 1, borderColor: theme.c.border, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={theme.c.muted} />
          </View>
        ))}
        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a photo or PDF of the bill"
            onPress={add}
            style={(st) => ({ width: TILE, height: TILE, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.c.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: isHovered(st) ? 0.8 : 1 })}
          >
            <Feather name="camera" size={20} color={theme.c.text} />
            <T size={11} weight="bold">
              Add
            </T>
          </Pressable>
        ) : null}
      </View>
      {!e.receipts.length && canAdd ? (
        <T size={13} color={theme.c.muted}>
          Add a photo or PDF of the bill, so everyone can check the numbers.
        </T>
      ) : null}
      {dup ? (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/group/${e.groupId}/expense/${dup.expenseId}`)}>
          <T size={13} weight="semibold" color={theme.c.attnText} style={{ backgroundColor: theme.c.attnBg, borderRadius: 10, padding: 10 }}>
            {`The same photo is on “${dup.title}”. Is one of these a duplicate? Tap to open it.`}
          </T>
        </Pressable>
      ) : null}
      {problem ? (
        <T size={13} weight="semibold" color={theme.c.owe}>
          {problem}
        </T>
      ) : null}
      {open ? (
        <Viewer
          r={open}
          name={name}
          canRemove={canRemove(open)}
          onClose={() => setOpen(null)}
          onRemove={() => {
            dispatch({ type: 'remove_receipt', id: e.id, receiptId: open.id });
            setOpen(null);
          }}
        />
      ) : null}
    </Card>
  );
}

export interface PickedReceipt {
  key: string;
  file: ReceiptFile;
  /** For the thumbnail (photos only). */
  url?: string;
}

/**
 * Photos and PDFs picked in the expense form, before the expense is saved. They're got ready
 * (shrunk, location removed) as soon as they're picked, and uploaded once the expense exists.
 */
export function ReceiptPicker({ files, onChange, max }: { files: PickedReceipt[]; onChange: (f: PickedReceipt[]) => void; max: number }) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const room = Math.max(0, max - files.length);

  const add = async () => {
    setProblem(null);
    const picked = (await pickFiles('image/*,application/pdf', true)).slice(0, room);
    const ready: PickedReceipt[] = [];
    setBusy(picked.length);
    for (const f of picked) {
      try {
        const file = await prepareReceipt(f);
        ready.push({ key: `${Date.now()}-${Math.random()}`, file, url: file.type === 'application/pdf' ? undefined : URL.createObjectURL(file.blob) });
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'Could not use that file.');
      }
      setBusy((n) => n - 1);
    }
    if (ready.length) onChange([...files, ...ready]);
  };
  const remove = (key: string) => {
    const f = files.find((x) => x.key === key);
    if (f?.url) URL.revokeObjectURL(f.url);
    onChange(files.filter((x) => x.key !== key));
  };

  return (
    <View style={{ gap: 10 }}>
      <Label>{files.length ? `Bill photos (${files.length})` : 'Bill photo'}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {files.map((f) => (
          <View key={f.key} style={{ width: TILE, height: TILE }}>
            <View style={{ width: TILE, height: TILE, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.c.border, backgroundColor: theme.c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              {f.url ? (
                <Image source={{ uri: f.url }} style={{ width: TILE, height: TILE }} resizeMode="cover" accessibilityLabel="Bill photo to add" />
              ) : (
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Feather name="file-text" size={24} color={theme.c.text} />
                  <T size={11} weight="bold">
                    PDF
                  </T>
                </View>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove this file"
              onPress={() => remove(f.key)}
              hitSlop={6}
              style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.c.text, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="x" size={14} color={theme.c.bg} />
            </Pressable>
          </View>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <View key={`prep${i}`} accessibilityLabel="Getting the photo ready" style={{ width: TILE, height: TILE, borderRadius: 12, borderWidth: 1, borderColor: theme.c.border, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={theme.c.muted} />
          </View>
        ))}
        {room > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a photo or PDF of the bill"
            onPress={add}
            style={(st) => ({ width: TILE, height: TILE, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.c.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: isHovered(st) ? 0.8 : 1 })}
          >
            <Feather name="camera" size={20} color={theme.c.text} />
            <T size={11} weight="bold">
              Add
            </T>
          </Pressable>
        ) : null}
      </View>
      {!files.length && !busy ? (
        <T size={13} color={theme.c.muted}>
          Optional: a photo or PDF of the bill, so everyone can check the numbers.
        </T>
      ) : null}
      {problem ? (
        <T size={13} weight="semibold" color={theme.c.owe}>
          {problem}
        </T>
      ) : null}
    </View>
  );
}
